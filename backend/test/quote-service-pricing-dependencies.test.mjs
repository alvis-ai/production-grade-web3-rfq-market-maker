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

test("QuoteService rejects malformed pricing engine results before signing", async () => {
  const validPricingResult = {
    amountOut: "998400000",
    minAmountOut: "993408000",
    spreadBps: 16,
    sizeImpactBps: 1,
    inventorySkewBps: 0,
    volatilityPremiumBps: 5,
    hedgeCostBps: 0,
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
    { ...validPricingResult, volatilityPremiumBps: -1 },
    { ...validPricingResult, hedgeCostBps: 10001 },
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
            volatilityPremiumBps: 5,
            hedgeCostBps: 0,
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
