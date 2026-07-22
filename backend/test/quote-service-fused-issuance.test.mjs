import assert from "node:assert/strict";
import test from "node:test";
import { InventoryService } from "../dist/modules/inventory/inventory.service.js";
import { StaticMarketDataService } from "../dist/modules/market-data/market-data.service.js";
import { InMemoryMarketSnapshotRepository } from "../dist/modules/market-data/market-snapshot.repository.js";
import { FormulaPricingEngine } from "../dist/modules/pricing/pricing.engine.js";
import { InMemoryQuoteRepository } from "../dist/modules/quote/quote.repository.js";
import { QuoteService } from "../dist/modules/quote/quote.service.js";
import { InMemoryRiskDecisionRepository } from "../dist/modules/risk/risk-decision.repository.js";
import { BasicRiskEngine } from "../dist/modules/risk/risk.engine.js";
import { InternalInventoryRoutingEngine } from "../dist/modules/routing/routing.engine.js";

const request = {
  chainId: 1,
  user: "0x0000000000000000000000000000000000000001",
  tokenIn: "0x0000000000000000000000000000000000000002",
  tokenOut: "0x0000000000000000000000000000000000000003",
  amountIn: "1000000000",
  slippageBps: 50,
};

test("QuoteService fused issuance prepares before exposure, authorizes before signing, and finalizes once", async () => {
  const events = [];
  const legacyQuoteRepository = new InMemoryQuoteRepository();
  const service = new QuoteService({
    ...deps(),
    quoteRepository: failLegacyQuoteWrites(legacyQuoteRepository),
    marketSnapshotStore: failLegacySnapshotWrites(),
    riskDecisionStore: failLegacyRiskWrites(),
    quoteExposureStore: {
      async reserve() {
        assert.deepEqual(events.map(([name]) => name), ["prepare"]);
        events.push(["exposure"]);
        return { status: "reserved", notionalUsdE18: "1000000000000000000" };
      },
      async release() {},
    },
    quoteIssuanceStore: {
      async prepare(input) {
        events.push(["prepare", input]);
      },
      async authorize(input) {
        assert.deepEqual(events.map(([name]) => name), ["prepare", "exposure"]);
        events.push(["authorize", input]);
        return {
          riskDecisionId: `rd_${input.quoteId}`,
          quoteId: input.quoteId,
          decision: "approved",
          policyVersion: input.decision.policyVersion,
          createdAt: new Date().toISOString(),
        };
      },
      async finalize(input) {
        events.push(["finalize", input]);
      },
    },
    signerService: {
      async signQuote(input) {
        assert.deepEqual(events.map(([name]) => name), ["prepare", "exposure", "authorize"]);
        assert.equal(input.riskDecisionId, `rd_${input.quoteId}`);
        events.push(["sign", input]);
        return fixedSignature();
      },
      async verifyQuoteSignature() { return true; },
    },
  });

  const response = await service.createQuote(request);
  assert.deepEqual(events.map(([name]) => name), ["prepare", "exposure", "authorize", "sign", "finalize"]);
  assert.equal(
    events[0][1].routeDecision.routePlan.routeId,
    "route_1_0000000000000000000000000000000000000002_0000000000000000000000000000000000000003",
  );
  assert.equal(events[4][1].response.quoteId, response.quoteId);
  assert.equal(events[4][1].signedQuote.signature, response.signature);
});

test("QuoteService fused issuance stops before exposure when preparation fails", async () => {
  let exposureCalls = 0;
  let signerCalls = 0;
  const service = new QuoteService({
    ...deps(),
    quoteExposureStore: {
      async reserve() {
        exposureCalls += 1;
        return { status: "reserved", notionalUsdE18: "1000000000000000000" };
      },
      async release() {},
    },
    quoteIssuanceStore: {
      async prepare() { throw new Error("postgres unavailable"); },
      async authorize() { assert.fail("failed preparation cannot authorize"); },
      async finalize() { assert.fail("failed preparation cannot finalize"); },
    },
    signerService: {
      async signQuote() { signerCalls += 1; return fixedSignature(); },
      async verifyQuoteSignature() { return true; },
    },
  });

  await assert.rejects(service.createQuote(request), (error) => error?.code === "QUOTE_STORE_UNAVAILABLE");
  assert.equal(exposureCalls, 0);
  assert.equal(signerCalls, 0);
});

test("QuoteService overlaps Redis preparation with exposure and releases on preparation failure", async () => {
  const events = [];
  let releaseCalls = 0;
  let rejectPreparation;
  const preparation = new Promise((_resolve, reject) => { rejectPreparation = reject; });
  const service = new QuoteService({
    ...deps(),
    quoteExposureStore: {
      async reserve() {
        events.push("exposure");
        rejectPreparation(new Error("redis issuance unavailable"));
        return { status: "reserved", notionalUsdE18: "1000000000000000000" };
      },
      async release() { releaseCalls += 1; },
    },
    quoteIssuanceStore: {
      asynchronousProjection: true,
      async prepare() {
        events.push("prepare");
        return preparation;
      },
      async authorize() { assert.fail("failed asynchronous preparation cannot authorize"); },
      async finalize() { assert.fail("failed asynchronous preparation cannot finalize"); },
    },
  });

  await assert.rejects(service.createQuote(request), (error) => error?.code === "QUOTE_STORE_UNAVAILABLE");
  assert.deepEqual(events, ["prepare", "exposure"]);
  assert.equal(releaseCalls, 1);
});

test("QuoteService fused issuance blocks signer on malformed authorization evidence", async () => {
  let signerCalls = 0;
  const service = new QuoteService({
    ...deps(),
    quoteIssuanceStore: {
      async prepare() {},
      async authorize(input) {
        return {
          riskDecisionId: "rd_other",
          quoteId: input.quoteId,
          decision: "approved",
          policyVersion: input.decision.policyVersion,
          createdAt: new Date().toISOString(),
        };
      },
      async finalize() { assert.fail("malformed authorization cannot finalize"); },
    },
    signerService: {
      async signQuote() { signerCalls += 1; return fixedSignature(); },
      async verifyQuoteSignature() { return true; },
    },
  });
  await assert.rejects(service.createQuote(request), (error) => error?.code === "QUOTE_STORE_UNAVAILABLE");
  assert.equal(signerCalls, 0);
});

test("QuoteService overlaps fused idempotency admission with side-effect-free pricing", async () => {
  const events = [];
  let resolveAdmission;
  const admission = new Promise((resolve) => { resolveAdmission = resolve; });
  const pricingEngine = new FormulaPricingEngine();
  const service = new QuoteService({
    ...deps(),
    pricingEngine: {
      async price(input) {
        events.push("pricing");
        resolveAdmission({
          status: "acquired",
          reservation: {
            principalId: "principal_parallel",
            key: "quote_parallel_fused_0001",
            requestHash: "a".repeat(64),
            ownerToken: "quote_idem_parallel_0001",
            expiresAt: new Date(Date.now() + 10_000).toISOString(),
          },
        });
        return pricingEngine.price(input);
      },
    },
    quoteIdempotencyStore: {
      async checkHealth() {},
      async acquire() {
        events.push("acquire");
        return admission;
      },
      async bindQuote() { assert.fail("fused issuance binds idempotency during prepare"); },
      async complete() { assert.fail("fused issuance completes idempotency during finalize"); },
      async fail() { assert.fail("successful quote must not fail idempotency"); },
    },
    quoteIssuanceStore: {
      async prepare(input) {
        events.push("prepare");
        assert.equal(input.idempotency?.ownerToken, "quote_idem_parallel_0001");
      },
      async authorize(input) {
        events.push("authorize");
        return {
          riskDecisionId: `rd_${input.quoteId}`,
          quoteId: input.quoteId,
          decision: "approved",
          policyVersion: input.decision.policyVersion,
          createdAt: new Date().toISOString(),
        };
      },
      async finalize(input) {
        events.push("finalize");
        assert.equal(input.idempotency?.ownerToken, "quote_idem_parallel_0001");
      },
    },
  });

  assert.match((await service.createQuote(request, {
    principalId: "principal_parallel",
    idempotencyKey: "quote_parallel_fused_0001",
  })).quoteId, /^q_/);
  assert.deepEqual(events.slice(0, 2), ["acquire", "pricing"]);
  assert.equal(events.indexOf("prepare") > events.indexOf("pricing"), true);
  assert.deepEqual(events.slice(-3), ["prepare", "authorize", "finalize"]);
});

test("QuoteService returns a fused replay even when speculative pricing fails", async () => {
  const replay = {
    quoteId: "q_replayed",
    snapshotId: "snapshot_replayed",
    amountOut: "998",
    minAmountOut: "990",
    deadline: 4_102_444_800,
    nonce: "42",
    signature: fixedSignature(),
  };
  const service = new QuoteService({
    ...deps(),
    pricingEngine: {
      async price() {
        await Promise.resolve();
        throw new Error("speculative pricing unavailable");
      },
    },
    quoteIdempotencyStore: {
      async checkHealth() {},
      async acquire() { return { status: "replay", response: replay }; },
      async bindQuote() { assert.fail("replay must not bind"); },
      async complete() { assert.fail("replay must not complete"); },
      async fail() { assert.fail("replay must not fail"); },
    },
    quoteIssuanceStore: {
      async prepare() { assert.fail("replay must not prepare"); },
      async authorize() { assert.fail("replay must not authorize"); },
      async finalize() { assert.fail("replay must not finalize"); },
    },
  });

  assert.deepEqual(await service.createQuote(request, {
    principalId: "principal_replay",
    idempotencyKey: "quote_parallel_fused_replay_0001",
  }), replay);
});

function deps() {
  return {
    inventoryService: new InventoryService(),
    marketDataService: new StaticMarketDataService(),
    marketSnapshotStore: new InMemoryMarketSnapshotRepository(),
    pricingEngine: new FormulaPricingEngine(),
    quoteRepository: new InMemoryQuoteRepository(),
    riskDecisionStore: new InMemoryRiskDecisionRepository(),
    riskEngine: new BasicRiskEngine(),
    routingEngine: new InternalInventoryRoutingEngine(),
    signerService: {
      async signQuote() { return fixedSignature(); },
      async verifyQuoteSignature() { return true; },
    },
  };
}

function failLegacySnapshotWrites() {
  return {
    async saveSnapshot() { assert.fail("fused success must not call legacy snapshot persistence"); },
    async findBySnapshotId() { return undefined; },
  };
}

function failLegacyRiskWrites() {
  return {
    async saveDecision() { assert.fail("fused success must not call legacy risk persistence"); },
    async findByQuoteId() { return undefined; },
  };
}

function failLegacyQuoteWrites(repository) {
  return new Proxy(repository, {
    get(target, property) {
      if (["saveRequested", "saveRouteDecision", "saveSigned"].includes(String(property))) {
        return async () => assert.fail(`fused success must not call legacy ${String(property)}`);
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

function fixedSignature() {
  return `0x${"11".repeat(64)}1b`;
}
