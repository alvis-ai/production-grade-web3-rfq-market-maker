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
              marketSpreadBps: 0,
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
