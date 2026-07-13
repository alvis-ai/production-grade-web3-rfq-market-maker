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

test("QuoteService snapshots dependency object at construction", async () => {
  const quoteRepository = new InMemoryQuoteRepository();
  const replacementQuoteRepository = new InMemoryQuoteRepository();
  const deps = {
    ...quoteServiceDeps(),
    quoteRepository,
  };
  const service = new QuoteService(deps);

  deps.marketDataService = {
    async getSnapshot() {
      throw new Error("mutated market data used");
    },
  };
  deps.marketSnapshotStore = {
    checkHealth() {
      throw new Error("mutated market snapshot store used");
    },
    async saveSnapshot() {
      throw new Error("mutated market snapshot store used");
    },
    async findBySnapshotId() {
      return undefined;
    },
  };
  deps.pricingEngine = {
    async price() {
      throw new Error("mutated pricing engine used");
    },
  };
  deps.quoteRepository = replacementQuoteRepository;
  deps.signerService = {
    async signQuote() {
      throw new Error("mutated signer used");
    },
    async verifyQuoteSignature() {
      return false;
    },
  };

  const quote = await service.createQuote(request);

  assert.equal(quote.signature, fixedSignature());
  assert.match(quote.snapshotId, /^snapshot_1_00000000_00000000_[0-9a-z]+_[0-9a-z]+$/);
  assert.equal((await quoteRepository.findStatus(quote.quoteId)).status, "signed");
  assert.equal(await replacementQuoteRepository.findStatus(quote.quoteId), undefined);
});

test("QuoteService rejects unsafe dependency configuration at construction", () => {
  const deps = quoteServiceDeps();

  assert.throws(
    () => new QuoteService(undefined),
    /Quote service deps must be an object/,
  );
  assert.throws(
    () => new QuoteService([]),
    /Quote service deps must be an object/,
  );
  assert.throws(
    () => new QuoteService(Object.create(deps)),
    /Quote service deps.inventoryService must be an own field/,
  );

  const depsWithInheritedHedgeService = { ...deps };
  Object.setPrototypeOf(depsWithInheritedHedgeService, {
    hedgeService: {
      quoteRiskPenaltyBps() {
        return 0;
      },
    },
  });
  assert.throws(
    () => new QuoteService(depsWithInheritedHedgeService),
    /Quote service deps.hedgeService must be an own field when provided/,
  );
  const depsWithInheritedExposureStore = { ...deps };
  Object.setPrototypeOf(depsWithInheritedExposureStore, {
    quoteExposureStore: { reserve() {}, release() {} },
  });
  assert.throws(
    () => new QuoteService(depsWithInheritedExposureStore),
    /Quote service deps.quoteExposureStore must be an own field when provided/,
  );
  const depsWithInheritedTreasuryProvider = { ...deps };
  Object.setPrototypeOf(depsWithInheritedTreasuryProvider, {
    treasuryLiquidityProvider: { getLiquidity() {} },
  });
  assert.throws(
    () => new QuoteService(depsWithInheritedTreasuryProvider),
    /Quote service deps.treasuryLiquidityProvider must be an own field when provided/,
  );
  assert.throws(
    () =>
      new QuoteService({
        ...deps,
        marketDataService: [],
      }),
    /Quote service marketDataService must be an object/,
  );
  assert.throws(
    () =>
      new QuoteService({
        ...deps,
        quoteRepository: [],
      }),
    /Quote service quoteRepository must be an object/,
  );
  assert.throws(
    () =>
      new QuoteService({
        ...deps,
        marketDataService: {},
      }),
    /Quote service marketDataService.getSnapshot must be a function/,
  );
  assert.throws(
    () =>
      new QuoteService({
        ...deps,
        marketSnapshotStore: {},
      }),
    /Quote service marketSnapshotStore.saveSnapshot must be a function/,
  );
  assert.throws(
    () =>
      new QuoteService({
        ...deps,
        routingEngine: {},
      }),
    /Quote service routingEngine.selectRoute must be a function/,
  );
  assert.throws(
    () =>
      new QuoteService({
        ...deps,
        pricingEngine: {},
      }),
    /Quote service pricingEngine.price must be a function/,
  );
  assert.throws(
    () =>
      new QuoteService({
        ...deps,
        inventoryService: {},
      }),
    /Quote service inventoryService.calculateQuoteSkewBps must be a function/,
  );
  assert.throws(
    () =>
      new QuoteService({
        ...deps,
        riskEngine: {},
      }),
    /Quote service riskEngine.evaluate must be a function/,
  );
  assert.throws(
    () =>
      new QuoteService({
        ...deps,
        riskDecisionStore: {},
      }),
    /Quote service riskDecisionStore.saveDecision must be a function/,
  );
  assert.throws(
    () =>
      new QuoteService({
        ...deps,
        signerService: {},
      }),
    /Quote service signerService.signQuote must be a function/,
  );
  assert.throws(
    () =>
      new QuoteService({
        ...deps,
        quoteRepository: {},
      }),
    /Quote service quoteRepository.saveRequested must be a function/,
  );
  assert.throws(
    () =>
      new QuoteService({
        ...deps,
        hedgeService: "bad hedge dependency",
      }),
    /Quote service hedgeService must be an object when provided/,
  );
  assert.throws(
    () =>
      new QuoteService({
        ...deps,
        hedgeService: [],
      }),
    /Quote service hedgeService must be an object when provided/,
  );
  assert.throws(
    () =>
      new QuoteService({
        ...deps,
        hedgeService: {
          quoteRiskPenaltyBps: 25,
        },
      }),
    /Quote service hedgeService.quoteRiskPenaltyBps must be a function when provided/,
  );
  assert.throws(
    () => new QuoteService({ ...deps, quoteExposureStore: {} }),
    /Quote service quoteExposureStore.reserve must be a function/,
  );
  assert.throws(
    () => new QuoteService({
      ...deps,
      quoteExposureStore: { reserve() {}, release: true },
    }),
    /Quote service quoteExposureStore.release must be a function/,
  );
  assert.throws(
    () => new QuoteService({
      ...deps,
      treasuryLiquidityProvider: { getLiquidity() {} },
    }),
    /Quote service treasuryLiquidityProvider requires quoteExposureStore/,
  );
  assert.throws(
    () => new QuoteService({
      ...deps,
      quoteExposureStore: { reserve() {}, release() {} },
      treasuryLiquidityProvider: {},
    }),
    /Quote service treasuryLiquidityProvider.getLiquidity must be a function/,
  );
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
