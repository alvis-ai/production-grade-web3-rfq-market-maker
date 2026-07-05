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
