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

test("QuoteService persists market snapshots before downstream quote side effects", async () => {
  const marketSnapshotStore = new InMemoryMarketSnapshotRepository();
  const service = new QuoteService({
    ...quoteServiceDeps(),
    marketSnapshotStore,
  });

  const quote = await service.createQuote(request);
  const storedSnapshot = await marketSnapshotStore.findBySnapshotId(quote.snapshotId);

  assert.ok(storedSnapshot);
  assert.equal(storedSnapshot.chainId, request.chainId);
  assert.equal(storedSnapshot.tokenIn, request.tokenIn);
  assert.equal(storedSnapshot.tokenOut, request.tokenOut);
  assert.equal(storedSnapshot.midPrice, "1");
  assert.equal(storedSnapshot.liquidityUsd, "10000000000000");
  assert.equal(storedSnapshot.volatilityBps, 25);
  assert.equal(storedSnapshot.source, "static-market-data-v1");
});

test("QuoteService blocks routing and signer when market snapshot persistence fails", async () => {
  let routingCalls = 0;
  let signerCalls = 0;
  const service = new QuoteService({
    ...quoteServiceDeps(),
    marketSnapshotStore: {
      checkHealth() {},
      async saveSnapshot() {
        throw new Error("market snapshot store offline");
      },
      async findBySnapshotId() {
        return undefined;
      },
    },
    routingEngine: {
      async selectRoute() {
        routingCalls += 1;
        throw new Error("routing should not be called");
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

  assert.equal(routingCalls, 0);
  assert.equal(signerCalls, 0);
});

test("QuoteService marks requested quotes as failed when routing is unavailable", async () => {
  const quoteRepository = new InMemoryQuoteRepository();
  const saveRequested = quoteRepository.saveRequested.bind(quoteRepository);
  let requestedQuoteId;
  let pricingCalls = 0;
  let signerCalls = 0;
  quoteRepository.saveRequested = async (input) => {
    requestedQuoteId = input.quoteId;
    await saveRequested(input);
  };

  const service = new QuoteService({
    ...quoteServiceDeps(),
    quoteRepository,
    routingEngine: {
      async selectRoute() {
        throw new Error("routing backend offline");
      },
    },
    pricingEngine: {
      async price() {
        pricingCalls += 1;
        throw new Error("pricing should not be called");
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
      assert.equal(error.code, "ROUTING_UNAVAILABLE");
      return true;
    },
  );

  assert.match(requestedQuoteId, /^q_/);
  const status = await quoteRepository.findStatus(requestedQuoteId);
  assert.equal(status.status, "failed");
  assert.equal(status.errorCode, "ROUTING_UNAVAILABLE");
  assert.equal(pricingCalls, 0);
  assert.equal(signerCalls, 0);
});

test("QuoteService rejects malformed route plans before pricing and signing", async () => {
  const validRoutePlan = {
    routeId: "route_test",
    venue: "internal_inventory",
    tokenIn: request.tokenIn,
    tokenOut: request.tokenOut,
    expectedLiquidityUsd: "10000000000000",
  };
  const malformedRoutePlans = [
    undefined,
    Object.create(validRoutePlan),
    { ...validRoutePlan, internalVenue: "external" },
    { ...validRoutePlan, routeId: "route/test" },
    { ...validRoutePlan, venue: "external_amm" },
    { ...validRoutePlan, tokenIn: request.tokenOut },
    { ...validRoutePlan, tokenOut: request.tokenIn },
    { ...validRoutePlan, expectedLiquidityUsd: "01000000000000" },
  ];

  for (const malformedRoutePlan of malformedRoutePlans) {
    const quoteRepository = new InMemoryQuoteRepository();
    const saveRequested = quoteRepository.saveRequested.bind(quoteRepository);
    let requestedQuoteId;
    let pricingAttempts = 0;
    let signAttempts = 0;
    quoteRepository.saveRequested = async (input) => {
      requestedQuoteId = input.quoteId;
      await saveRequested(input);
    };

    const service = new QuoteService({
      ...quoteServiceDeps(),
      quoteRepository,
      routingEngine: {
        async selectRoute() {
          return malformedRoutePlan;
        },
      },
      pricingEngine: {
        async price() {
          pricingAttempts += 1;
          throw new Error("pricing should not be called for malformed route plans");
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
        assert.equal(error.code, "ROUTING_UNAVAILABLE");
        assert.equal(error.statusCode, 503);
        return true;
      },
    );

    assert.equal(pricingAttempts, 0);
    assert.equal(signAttempts, 0);
    assert.match(requestedQuoteId, /^q_/);
    const status = await quoteRepository.findStatus(requestedQuoteId);
    assert.equal(status.status, "failed");
    assert.equal(status.errorCode, "ROUTING_UNAVAILABLE");
  }
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
