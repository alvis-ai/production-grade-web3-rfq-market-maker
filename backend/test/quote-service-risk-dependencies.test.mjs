import assert from "node:assert/strict";
import test from "node:test";
import { InventoryService } from "../dist/modules/inventory/inventory.service.js";
import { StaticMarketDataService } from "../dist/modules/market-data/market-data.service.js";
import { InMemoryMarketSnapshotRepository } from "../dist/modules/market-data/market-snapshot.repository.js";
import { FormulaPricingEngine } from "../dist/modules/pricing/pricing.engine.js";
import { InMemoryQuoteRepository } from "../dist/modules/quote/quote.repository.js";
import { QuoteService } from "../dist/modules/quote/quote.service.js";
import { InMemoryRiskDecisionRepository } from "../dist/modules/risk/risk-decision.repository.js";
import { BasicRiskEngine, defaultBasicRiskPolicy } from "../dist/modules/risk/risk.engine.js";
import { InternalInventoryRoutingEngine } from "../dist/modules/routing/routing.engine.js";

const request = {
  chainId: 1,
  user: "0x0000000000000000000000000000000000000001",
  tokenIn: "0x0000000000000000000000000000000000000002",
  tokenOut: "0x0000000000000000000000000000000000000003",
  amountIn: "1000000000",
  slippageBps: 50,
};

test("QuoteService persists approved and rejected risk decisions before signer boundary", async () => {
  const approvedRiskDecisionStore = new InMemoryRiskDecisionRepository();
  const approvedService = new QuoteService({
    ...quoteServiceDeps(),
    riskDecisionStore: approvedRiskDecisionStore,
  });

  const approvedQuote = await approvedService.createQuote(request);
  const approvedDecision = await approvedRiskDecisionStore.findByQuoteId(approvedQuote.quoteId);

  assert.equal(approvedDecision.decision, "approved");
  assert.equal(approvedDecision.reasonCode, undefined);
  assert.equal(approvedDecision.policyVersion, "basic-risk-v1");

  const rejectedQuoteRepository = new InMemoryQuoteRepository();
  const rejectedRiskDecisionStore = new InMemoryRiskDecisionRepository();
  const saveRequested = rejectedQuoteRepository.saveRequested.bind(rejectedQuoteRepository);
  let rejectedQuoteId;
  rejectedQuoteRepository.saveRequested = async (input) => {
    rejectedQuoteId = input.quoteId;
    await saveRequested(input);
  };
  const rejectedService = new QuoteService({
    ...quoteServiceDeps(),
    quoteRepository: rejectedQuoteRepository,
    riskDecisionStore: rejectedRiskDecisionStore,
    riskEngine: new BasicRiskEngine({
      ...defaultBasicRiskPolicy,
      maxSlippageBps: 1,
    }),
  });

  await assert.rejects(
    rejectedService.createQuote(request),
    (error) => {
      assert.equal(error.code, "RISK_REJECTED");
      return true;
    },
  );

  const rejectedDecision = await rejectedRiskDecisionStore.findByQuoteId(rejectedQuoteId);
  assert.equal(rejectedDecision.decision, "rejected");
  assert.equal(rejectedDecision.reasonCode, "SLIPPAGE_TOO_WIDE");
  assert.equal(rejectedDecision.policyVersion, "basic-risk-v1");
});

test("QuoteService binds the persisted risk decision and request trace to signing", async () => {
  let signerInput;
  const service = new QuoteService({
    ...quoteServiceDeps(),
    signerService: {
      async signQuote(input) {
        signerInput = input;
        return fixedSignature();
      },
      async verifyQuoteSignature() { return true; },
    },
  });

  const quote = await service.createQuote(request, {
    principalId: "principal_test",
    traceId: "tr_external_42",
  });
  assert.equal(signerInput.quoteId, quote.quoteId);
  assert.equal(signerInput.snapshotId, quote.snapshotId);
  assert.equal(signerInput.riskDecisionId, `rd_${quote.quoteId}`);
  assert.equal(signerInput.riskPolicyVersion, "basic-risk-v1");
  assert.equal(signerInput.traceId, "tr_external_42");
});

test("QuoteService blocks signing when persisted risk evidence is malformed", async () => {
  let signAttempts = 0;
  const service = new QuoteService({
    ...quoteServiceDeps(),
    riskDecisionStore: {
      async saveDecision(input) {
        return {
          riskDecisionId: "rd_other",
          quoteId: input.quoteId,
          decision: input.decision.status,
          policyVersion: input.decision.policyVersion,
          createdAt: new Date().toISOString(),
        };
      },
      async findByQuoteId() { return undefined; },
    },
    signerService: {
      async signQuote() { signAttempts += 1; return fixedSignature(); },
      async verifyQuoteSignature() { return true; },
    },
  });

  await assert.rejects(service.createQuote(request), (error) => error?.code === "QUOTE_STORE_UNAVAILABLE");
  assert.equal(signAttempts, 0);
});

test("QuoteService fails closed on malformed risk engine decisions before signing", async () => {
  const approvedWithInheritedReason = Object.assign(Object.create({ reasonCode: "SLIPPAGE_TOO_WIDE" }), {
    status: "approved",
    policyVersion: "test-risk",
  });
  const malformedRiskDecisions = [
    undefined,
    Object.create({ status: "approved", policyVersion: "test-risk" }),
    { status: "approved", policyVersion: "" },
    { status: "approved", policyVersion: new String("test-risk") },
    { status: "approved", policyVersion: "test-risk", reasonCode: "SLIPPAGE_TOO_WIDE" },
    approvedWithInheritedReason,
    { status: "rejected", policyVersion: "test-risk" },
    { status: "rejected", policyVersion: "test-risk", reasonCode: "TEMPORARY_RISK_REASON" },
    { status: "rejected", policyVersion: "test-risk", reasonCode: "SLIPPAGE_TOO_WIDE", checks: [] },
    { status: "skipped", policyVersion: "test-risk" },
  ];

  for (const malformedRiskDecision of malformedRiskDecisions) {
    const quoteRepository = new InMemoryQuoteRepository();
    const riskDecisionStore = new InMemoryRiskDecisionRepository();
    const saveRequested = quoteRepository.saveRequested.bind(quoteRepository);
    let requestedQuoteId;
    let signAttempts = 0;
    quoteRepository.saveRequested = async (input) => {
      requestedQuoteId = input.quoteId;
      await saveRequested(input);
    };

    const service = new QuoteService({
      ...quoteServiceDeps(),
      quoteRepository,
      riskDecisionStore,
      riskEngine: {
        async evaluate() {
          return malformedRiskDecision;
        },
      },
      signerService: {
        async signQuote() {
          signAttempts += 1;
          return fixedSignature();
        },
        async verifyQuoteSignature() {
          return true;
        },
      },
    });

    await assert.rejects(
      service.createQuote(request),
      (error) => {
        assert.equal(error.code, "RISK_REJECTED");
        assert.equal(error.statusCode, 409);
        return true;
      },
    );

    assert.equal(signAttempts, 0);
    assert.match(requestedQuoteId, /^q_/);
    const persistedDecision = await riskDecisionStore.findByQuoteId(requestedQuoteId);
    assert.equal(persistedDecision.decision, "rejected");
    assert.equal(persistedDecision.reasonCode, "RISK_ENGINE_UNAVAILABLE");
    assert.equal(persistedDecision.policyVersion, "risk-engine-unavailable");
    const status = await quoteRepository.findStatus(requestedQuoteId);
    assert.equal(status.status, "rejected");
    assert.equal(status.errorCode, "RISK_ENGINE_UNAVAILABLE");
  }
});

test("QuoteService blocks signer when risk decision persistence fails", async () => {
  const quoteRepository = new InMemoryQuoteRepository();
  const saveRequested = quoteRepository.saveRequested.bind(quoteRepository);
  let requestedQuoteId;
  let signerCalls = 0;
  const releasedQuoteIds = [];
  quoteRepository.saveRequested = async (input) => {
    requestedQuoteId = input.quoteId;
    await saveRequested(input);
  };
  const service = new QuoteService({
    ...quoteServiceDeps(),
    quoteRepository,
    quoteExposureStore: {
      async reserve() {
        return { status: "reserved", notionalUsdE18: "1000000000000000000" };
      },
      async release(quoteId) {
        releasedQuoteIds.push(quoteId);
      },
    },
    riskDecisionStore: {
      checkHealth() {},
      async saveDecision() {
        throw new Error("risk decision audit store offline");
      },
      async findByQuoteId() {
        return undefined;
      },
    },
    signerService: {
      async signQuote() {
        signerCalls += 1;
        return fixedSignature();
      },
      async verifyQuoteSignature() {
        return true;
      },
    },
  });

  await assert.rejects(
    service.createQuote(request),
    (error) => {
      assert.equal(error.code, "QUOTE_STORE_UNAVAILABLE");
      return true;
    },
  );

  assert.match(requestedQuoteId, /^q_/);
  const status = await quoteRepository.findStatus(requestedQuoteId);
  assert.equal(status.status, "failed");
  assert.equal(status.errorCode, "QUOTE_STORE_UNAVAILABLE");
  assert.equal(signerCalls, 0);
  assert.deepEqual(releasedQuoteIds, [requestedQuoteId]);
});

test("QuoteService persists cumulative exposure rejection before signer boundary", async () => {
  const quoteRepository = new InMemoryQuoteRepository();
  const riskDecisionStore = new InMemoryRiskDecisionRepository();
  const saveRequested = quoteRepository.saveRequested.bind(quoteRepository);
  let requestedQuoteId;
  let signerCalls = 0;
  quoteRepository.saveRequested = async (input) => {
    requestedQuoteId = input.quoteId;
    await saveRequested(input);
  };
  const service = new QuoteService({
    ...quoteServiceDeps(),
    quoteRepository,
    riskDecisionStore,
    quoteExposureStore: {
      async reserve() {
        return { status: "rejected", reasonCode: "USER_OPEN_NOTIONAL_LIMIT_EXCEEDED" };
      },
      async release() {
        assert.fail("rejected exposure must not be released");
      },
    },
    signerService: {
      async signQuote() {
        signerCalls += 1;
        return fixedSignature();
      },
      async verifyQuoteSignature() {
        return true;
      },
    },
  });

  await assert.rejects(service.createQuote(request), (error) => {
    assert.equal(error.code, "RISK_REJECTED");
    assert.equal(error.internalReasonCode, "USER_OPEN_NOTIONAL_LIMIT_EXCEEDED");
    return true;
  });
  assert.equal(signerCalls, 0);
  const decision = await riskDecisionStore.findByQuoteId(requestedQuoteId);
  assert.equal(decision.decision, "rejected");
  assert.equal(decision.reasonCode, "USER_OPEN_NOTIONAL_LIMIT_EXCEEDED");
  assert.equal(decision.policyVersion, "basic-risk-v1");
});

test("QuoteService releases cumulative exposure when signing fails", async () => {
  const releasedQuoteIds = [];
  const service = new QuoteService({
    ...quoteServiceDeps(),
    quoteExposureStore: {
      async reserve() {
        return { status: "reserved", notionalUsdE18: "1000000000000000000" };
      },
      async release(quoteId) {
        releasedQuoteIds.push(quoteId);
      },
    },
    signerService: {
      async signQuote() {
        throw new Error("signer offline");
      },
      async verifyQuoteSignature() {
        return true;
      },
    },
  });

  await assert.rejects(service.createQuote(request), /signer offline/);
  assert.equal(releasedQuoteIds.length, 1);
  assert.match(releasedQuoteIds[0], /^q_/);
});

test("QuoteService fails closed on malformed exposure reservation results", async () => {
  for (const malformed of [
    undefined,
    { status: "reserved" },
    { status: "reserved", notionalUsdE18: "0" },
    { status: "rejected", reasonCode: "TEMPORARY_LIMIT" },
    { status: "reserved", notionalUsdE18: "1", extra: true },
  ]) {
    let signerCalls = 0;
    const riskDecisionStore = new InMemoryRiskDecisionRepository();
    const quoteRepository = new InMemoryQuoteRepository();
    const saveRequested = quoteRepository.saveRequested.bind(quoteRepository);
    let quoteId;
    quoteRepository.saveRequested = async (input) => {
      quoteId = input.quoteId;
      await saveRequested(input);
    };
    const service = new QuoteService({
      ...quoteServiceDeps(),
      quoteRepository,
      riskDecisionStore,
      quoteExposureStore: {
        async reserve() {
          return malformed;
        },
        async release() {},
      },
      signerService: {
        async signQuote() {
          signerCalls += 1;
          return fixedSignature();
        },
        async verifyQuoteSignature() {
          return true;
        },
      },
    });

    await assert.rejects(service.createQuote(request), (error) => error.code === "RISK_REJECTED");
    assert.equal(signerCalls, 0);
    assert.equal((await riskDecisionStore.findByQuoteId(quoteId)).reasonCode, "RISK_ENGINE_UNAVAILABLE");
  }
});

test("QuoteService binds settlement indexer risk to the observed treasury head before signing", async () => {
  let observedGuardInput;
  let reserveCalls = 0;
  let signCalls = 0;
  const service = new QuoteService({
    ...quoteServiceDeps(),
    treasuryLiquidityProvider: {
      async getLiquidity() {
        return {
          chainId: 1,
          settlementAddress: "0x0000000000000000000000000000000000000044",
          treasuryAddress: "0x0000000000000000000000000000000000000055",
          token: request.tokenOut,
          availableBalance: "1000000000000000000000000",
          blockNumber: 123n,
        };
      },
    },
    settlementIndexerRiskGuard: {
      async checkHealth() {},
      async assertQuoteSafe(input) { observedGuardInput = input; },
    },
    quoteExposureStore: {
      async reserve() {
        reserveCalls += 1;
        return { status: "reserved", notionalUsdE18: "1000000000000000000" };
      },
      async release() {},
    },
    signerService: {
      async signQuote() { signCalls += 1; return fixedSignature(); },
      async verifyQuoteSignature() { return true; },
    },
  });

  await service.createQuote(request);
  assert.deepEqual(observedGuardInput, { chainId: 1, observedHead: 123n });
  assert.equal(reserveCalls, 1);
  assert.equal(signCalls, 1);

  const blockedRiskStore = new InMemoryRiskDecisionRepository();
  let blockedSignCalls = 0;
  const blocked = new QuoteService({
    ...quoteServiceDeps(),
    riskDecisionStore: blockedRiskStore,
    settlementIndexerRiskGuard: {
      async checkHealth() {},
      async assertQuoteSafe() { throw new Error("indexer lagged"); },
    },
    signerService: {
      async signQuote() { blockedSignCalls += 1; return fixedSignature(); },
      async verifyQuoteSignature() { return true; },
    },
  });
  await assert.rejects(
    blocked.createQuote(request),
    (error) => error.code === "RISK_REJECTED" && error.internalReasonCode === "RISK_ENGINE_UNAVAILABLE",
  );
  assert.equal(blockedSignCalls, 0);
});

test("QuoteService releases cumulative exposure when a quote leaves open status", async () => {
  const releasedQuoteIds = [];
  const service = new QuoteService({
    ...quoteServiceDeps(),
    quoteExposureStore: {
      async reserve() {
        return { status: "reserved", notionalUsdE18: "1000000000000000000" };
      },
      async release(quoteId) {
        releasedQuoteIds.push(quoteId);
      },
    },
  });

  const quote = await service.createQuote(request);
  assert.deepEqual(releasedQuoteIds, []);
  await service.markQuoteStatus(quote.quoteId, "expired");
  assert.deepEqual(releasedQuoteIds, [quote.quoteId]);
});

test("QuoteService retains exposure for failed signed quotes until deadline", async () => {
  const releasedQuoteIds = [];
  const service = new QuoteService({
    ...quoteServiceDeps(),
    quoteExposureStore: {
      async reserve() {
        return { status: "reserved", notionalUsdE18: "1000000000000000000" };
      },
      async release(quoteId) {
        releasedQuoteIds.push(quoteId);
      },
    },
  });

  const quote = await service.createQuote(request);
  await service.markQuoteFailed(quote.quoteId, "SETTLEMENT_REVERTED");
  assert.deepEqual(releasedQuoteIds, []);
});

test("QuoteService retains settled exposure evidence for possible reorg restoration", async () => {
  const releasedQuoteIds = [];
  const service = new QuoteService({
    ...quoteServiceDeps(),
    quoteExposureStore: {
      async reserve() {
        return { status: "reserved", notionalUsdE18: "1000000000000000000" };
      },
      async release(quoteId) {
        releasedQuoteIds.push(quoteId);
      },
    },
  });

  const quote = await service.createQuote(request);
  await service.markQuoteStatus(quote.quoteId, "settled", {
    txHash: `0x${"11".repeat(32)}`,
    settlementEventId: "se_reorg_evidence",
  });
  assert.deepEqual(releasedQuoteIds, []);
});

function fixedSignature() {
  return `0x${"11".repeat(64)}1b`;
}

function quoteServiceDeps() {
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
      async signQuote() {
        return fixedSignature();
      },
      async verifyQuoteSignature() {
        return true;
      },
    },
  };
}
