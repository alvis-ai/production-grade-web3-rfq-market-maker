import assert from "node:assert/strict";
import test from "node:test";
import { InventoryService } from "../dist/modules/inventory/inventory.service.js";
import { StaticMarketDataService } from "../dist/modules/market-data/market-data.service.js";
import { InMemoryMarketSnapshotRepository } from "../dist/modules/market-data/market-snapshot.repository.js";
import { FormulaPricingEngine } from "../dist/modules/pricing/pricing.engine.js";
import { InMemoryQuoteRepository } from "../dist/modules/quote/quote.repository.js";
import { defaultQuoteServiceConfig, QuoteService } from "../dist/modules/quote/quote.service.js";
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

test("QuoteService snapshots runtime configuration at construction", async () => {
  const originalDateNow = Date.now;
  const fixedNow = originalDateNow();
  Date.now = () => fixedNow;
  const mutableConfig = {
    ...defaultQuoteServiceConfig,
    maxSnapshotAgeMs: 5_000,
    maxSnapshotFutureSkewMs: 1_000,
    quoteTtlSeconds: 120,
  };

  try {
    const service = new QuoteService(
      {
        ...quoteServiceDeps(),
        marketDataService: {
          async getSnapshot() {
            return {
              snapshotId: "snapshot_mutable_config",
              midPrice: "1",
              liquidityUsd: "10000000000000",
              volatilityBps: 25,
              observedAt: new Date(fixedNow - 2_000).toISOString(),
            };
          },
        },
      },
      mutableConfig,
    );

    mutableConfig.maxSnapshotAgeMs = 1;
    mutableConfig.maxSnapshotFutureSkewMs = 1;
    mutableConfig.quoteTtlSeconds = 1;

    const quote = await service.createQuote(request);

    assert.equal(quote.deadline, Math.floor(fixedNow / 1000) + 120);
    assert.equal(quote.snapshotId, "snapshot_mutable_config");
  } finally {
    Date.now = originalDateNow;
  }
});

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

test("QuoteService rejects unsafe runtime configuration at construction", () => {
  assert.throws(
    () => new QuoteService(quoteServiceDeps(), null),
    /Quote service config must be an object/,
  );
  assert.throws(
    () => new QuoteService(quoteServiceDeps(), []),
    /Quote service config must be an object/,
  );
  assert.throws(
    () => new QuoteService(quoteServiceDeps(), Object.create(defaultQuoteServiceConfig)),
    /Quote service config.maxSnapshotAgeMs must be an own field/,
  );

  const configWithInheritedTtl = {
    maxSnapshotAgeMs: defaultQuoteServiceConfig.maxSnapshotAgeMs,
    maxSnapshotFutureSkewMs: defaultQuoteServiceConfig.maxSnapshotFutureSkewMs,
  };
  Object.setPrototypeOf(configWithInheritedTtl, {
    quoteTtlSeconds: defaultQuoteServiceConfig.quoteTtlSeconds,
  });
  assert.throws(
    () => new QuoteService(quoteServiceDeps(), configWithInheritedTtl),
    /Quote service config.quoteTtlSeconds must be an own field/,
  );

  assert.throws(
    () =>
      new QuoteService(quoteServiceDeps(), {
        ...defaultQuoteServiceConfig,
        maxSnapshotAgeMs: 0,
      }),
    /Quote service maxSnapshotAgeMs must be a positive safe integer/,
  );

  assert.throws(
    () =>
      new QuoteService(quoteServiceDeps(), {
        ...defaultQuoteServiceConfig,
        maxSnapshotFutureSkewMs: Number.MAX_SAFE_INTEGER + 1,
      }),
    /Quote service maxSnapshotFutureSkewMs must be a positive safe integer/,
  );

  assert.throws(
    () =>
      new QuoteService(quoteServiceDeps(), {
        ...defaultQuoteServiceConfig,
        quoteTtlSeconds: -1,
      }),
    /Quote service quoteTtlSeconds must be a positive safe integer/,
  );
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
