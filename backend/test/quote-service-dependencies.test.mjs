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

test("QuoteService marks requested quotes as failed when pricing is unavailable", async () => {
  const quoteRepository = new InMemoryQuoteRepository();
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
    pricingEngine: {
      async price() {
        throw new Error("pricing backend offline");
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
      assert.equal(error.code, "PRICING_UNAVAILABLE");
      return true;
    },
  );

  assert.match(requestedQuoteId, /^q_/);
  const status = await quoteRepository.findStatus(requestedQuoteId);
  assert.equal(status.status, "failed");
  assert.equal(status.errorCode, "PRICING_UNAVAILABLE");
  assert.equal(signerCalls, 0);
});

test("QuoteService rejects malformed inventory and hedge pricing adjustments before pricing", async () => {
  const malformedPricingAdjustmentCases = [
    { inventorySkewBps: undefined, hedgeRiskPenaltyBps: 0 },
    { inventorySkewBps: Number.NaN, hedgeRiskPenaltyBps: 0 },
    { inventorySkewBps: 10_001, hedgeRiskPenaltyBps: 0 },
    { inventorySkewBps: 0.5, hedgeRiskPenaltyBps: 0 },
    { inventorySkewBps: "0", hedgeRiskPenaltyBps: 0 },
    { inventorySkewBps: 0, hedgeRiskPenaltyBps: undefined },
    { inventorySkewBps: 0, hedgeRiskPenaltyBps: -1 },
    { inventorySkewBps: 0, hedgeRiskPenaltyBps: 10_001 },
    { inventorySkewBps: 0, hedgeRiskPenaltyBps: 0.5 },
    { inventorySkewBps: 0, hedgeRiskPenaltyBps: "25" },
    { inventorySkewBps: 9_990, hedgeRiskPenaltyBps: 25 },
  ];

  for (const { inventorySkewBps, hedgeRiskPenaltyBps } of malformedPricingAdjustmentCases) {
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
      inventoryService: {
        calculateQuoteSkewBps() {
          return inventorySkewBps;
        },
        projectSettlement() {
          throw new Error("inventory projection should not be called for malformed pricing adjustments");
        },
      },
      hedgeService: {
        quoteRiskPenaltyBps() {
          return hedgeRiskPenaltyBps;
        },
      },
      quoteRepository,
      pricingEngine: {
        async price() {
          pricingAttempts += 1;
          throw new Error("pricing should not be called for malformed pricing adjustments");
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
        assert.equal(error.code, "PRICING_UNAVAILABLE");
        assert.equal(error.statusCode, 503);
        return true;
      },
    );

    assert.equal(pricingAttempts, 0);
    assert.equal(signAttempts, 0);
    assert.match(requestedQuoteId, /^q_/);
    const status = await quoteRepository.findStatus(requestedQuoteId);
    assert.equal(status.status, "failed");
    assert.equal(status.errorCode, "PRICING_UNAVAILABLE");
  }
});

test("QuoteService rejects malformed pricing engine results before signing", async () => {
  const validPricingResult = {
    amountOut: "998400000",
    minAmountOut: "993408000",
    spreadBps: 16,
    sizeImpactBps: 1,
    inventorySkewBps: 0,
    pricingVersion: "test-pricing",
  };
  const malformedPricingResults = [
    undefined,
    Object.create(validPricingResult),
    { ...validPricingResult, internalSpread: 8 },
    { ...validPricingResult, amountOut: "0998400000" },
    { ...validPricingResult, amountOut: "900", minAmountOut: "901" },
    { ...validPricingResult, spreadBps: -1 },
    { ...validPricingResult, sizeImpactBps: 10001 },
    { ...validPricingResult, inventorySkewBps: 10001 },
    { ...validPricingResult, pricingVersion: "pricing/v1" },
  ];

  for (const malformedPricingResult of malformedPricingResults) {
    const quoteRepository = new InMemoryQuoteRepository();
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
      pricingEngine: {
        async price() {
          return malformedPricingResult;
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
        assert.equal(error.code, "PRICING_UNAVAILABLE");
        assert.equal(error.statusCode, 503);
        return true;
      },
    );

    assert.equal(signAttempts, 0);
    assert.match(requestedQuoteId, /^q_/);
    const status = await quoteRepository.findStatus(requestedQuoteId);
    assert.equal(status.status, "failed");
    assert.equal(status.errorCode, "PRICING_UNAVAILABLE");
  }
});

test("QuoteService fails closed on malformed inventory projections before signing", async () => {
  const validInventoryProjection = {
    tokenIn: {
      chainId: request.chainId,
      token: request.tokenIn,
      balance: 1_000_000_000n,
    },
    tokenOut: {
      chainId: request.chainId,
      token: request.tokenOut,
      balance: -998_400_000n,
    },
  };
  const malformedInventoryProjections = [
    undefined,
    Object.create(validInventoryProjection),
    { ...validInventoryProjection, internalExposure: "unsafe" },
    { tokenOut: validInventoryProjection.tokenOut },
    { tokenIn: Object.create(validInventoryProjection.tokenIn), tokenOut: validInventoryProjection.tokenOut },
    { tokenIn: { ...validInventoryProjection.tokenIn, chainId: "1" }, tokenOut: validInventoryProjection.tokenOut },
    { tokenIn: { ...validInventoryProjection.tokenIn, token: request.tokenOut }, tokenOut: validInventoryProjection.tokenOut },
    { tokenIn: { ...validInventoryProjection.tokenIn, balance: "1000000000" }, tokenOut: validInventoryProjection.tokenOut },
    { tokenIn: validInventoryProjection.tokenIn, tokenOut: { ...validInventoryProjection.tokenOut, token: request.tokenIn } },
    { tokenIn: validInventoryProjection.tokenIn, tokenOut: { ...validInventoryProjection.tokenOut, balance: "0" } },
    { tokenIn: validInventoryProjection.tokenIn, tokenOut: { ...validInventoryProjection.tokenOut, pending: 1n } },
  ];

  for (const malformedInventoryProjection of malformedInventoryProjections) {
    const quoteRepository = new InMemoryQuoteRepository();
    const riskDecisionStore = new InMemoryRiskDecisionRepository();
    const saveRequested = quoteRepository.saveRequested.bind(quoteRepository);
    let requestedQuoteId;
    let riskAttempts = 0;
    let signAttempts = 0;
    quoteRepository.saveRequested = async (input) => {
      requestedQuoteId = input.quoteId;
      await saveRequested(input);
    };

    const service = new QuoteService({
      ...quoteServiceDeps(),
      inventoryService: {
        calculateQuoteSkewBps() {
          return 0;
        },
        projectSettlement() {
          return malformedInventoryProjection;
        },
      },
      quoteRepository,
      riskDecisionStore,
      pricingEngine: {
        async price() {
          return {
            amountOut: "998400000",
            minAmountOut: "993408000",
            spreadBps: 16,
            sizeImpactBps: 1,
            inventorySkewBps: 0,
            pricingVersion: "test-pricing",
          };
        },
      },
      riskEngine: {
        async evaluate() {
          riskAttempts += 1;
          return {
            status: "approved",
            policyVersion: "unsafe-risk-engine",
          };
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

    assert.equal(riskAttempts, 0);
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
  quoteRepository.saveRequested = async (input) => {
    requestedQuoteId = input.quoteId;
    await saveRequested(input);
  };
  const service = new QuoteService({
    ...quoteServiceDeps(),
    quoteRepository,
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
