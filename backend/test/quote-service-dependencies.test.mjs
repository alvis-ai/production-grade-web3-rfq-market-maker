import assert from "node:assert/strict";
import test from "node:test";
import { InventoryService } from "../dist/modules/inventory/inventory.service.js";
import { StaticMarketDataService } from "../dist/modules/market-data/market-data.service.js";
import { InMemoryMarketSnapshotRepository } from "../dist/modules/market-data/market-snapshot.repository.js";
import { FormulaPricingEngine } from "../dist/modules/pricing/pricing.engine.js";
import { InMemoryQuoteRepository } from "../dist/modules/quote/quote.repository.js";
import { InMemoryQuoteIdempotencyStore } from "../dist/modules/quote/quote-idempotency.store.js";
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

test("QuoteService overlaps snapshot persistence with idempotency binding", async () => {
  const marketSnapshotStore = new InMemoryMarketSnapshotRepository();
  const saveSnapshot = marketSnapshotStore.saveSnapshot.bind(marketSnapshotStore);
  const idempotency = new InMemoryQuoteIdempotencyStore();
  const bindQuote = idempotency.bindQuote.bind(idempotency);
  const gate = deferred();
  const started = new Set();
  marketSnapshotStore.saveSnapshot = async (input) => {
    started.add("snapshot");
    await gate.promise;
    return saveSnapshot(input);
  };
  idempotency.bindQuote = async (reservation, quoteId) => {
    started.add("idempotency");
    await gate.promise;
    return bindQuote(reservation, quoteId);
  };
  const service = new QuoteService({
    ...quoteServiceDeps(),
    marketSnapshotStore,
    quoteIdempotencyStore: idempotency,
  });

  const pending = service.createQuote(request, {
    principalId: "principal_parallel",
    idempotencyKey: "quote_parallel_dependencies_0001",
  });
  await waitFor(() => started.size === 2);
  gate.resolve();
  assert.match((await pending).quoteId, /^q_/);
});

test("QuoteService evaluates inventory skew and both hedge penalties concurrently", async () => {
  const inventory = new InventoryService();
  const calculateQuoteSkewBps = inventory.calculateQuoteSkewBps.bind(inventory);
  const gate = deferred();
  let started = 0;
  inventory.calculateQuoteSkewBps = async (input) => {
    started += 1;
    await gate.promise;
    return calculateQuoteSkewBps(input);
  };
  const service = new QuoteService({
    ...quoteServiceDeps(),
    inventoryService: inventory,
    hedgeService: {
      async quoteRiskPenaltyBps() {
        started += 1;
        await gate.promise;
        return 0;
      },
    },
  });

  const pending = service.createQuote(request);
  await waitFor(() => started === 3);
  gate.resolve();
  assert.match((await pending).quoteId, /^q_/);
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

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

async function waitFor(predicate) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error("Timed out waiting for concurrent quote dependencies");
}
