import assert from "node:assert/strict";
import test from "node:test";
import { HedgeService } from "../dist/modules/hedge/hedge.service.js";
import { ReadinessService, defaultReadinessServiceConfig } from "../dist/modules/health/readiness.service.js";
import { InventoryService } from "../dist/modules/inventory/inventory.service.js";
import { StaticMarketDataService } from "../dist/modules/market-data/market-data.service.js";
import { InMemoryMarketSnapshotRepository } from "../dist/modules/market-data/market-snapshot.repository.js";
import { MetricsService } from "../dist/modules/metrics/metrics.service.js";
import { PnlService } from "../dist/modules/pnl/pnl.service.js";
import { FormulaPricingEngine } from "../dist/modules/pricing/pricing.engine.js";
import { InMemoryQuoteRepository } from "../dist/modules/quote/quote.repository.js";
import { InMemoryRiskDecisionRepository } from "../dist/modules/risk/risk-decision.repository.js";
import { BasicRiskEngine } from "../dist/modules/risk/risk.engine.js";
import { InternalInventoryRoutingEngine } from "../dist/modules/routing/routing.engine.js";
import { SettlementEventService } from "../dist/modules/settlement/settlement-event.service.js";
import { LocalEIP712SignerService } from "../dist/modules/signer/signer.service.js";

const readinessComponents = [
  "marketData",
  "marketSnapshotStore",
  "routing",
  "pricing",
  "risk",
  "signer",
  "quoteRepository",
  "riskDecisionStore",
  "inventory",
  "execution",
  "settlementEventStore",
  "pnl",
  "metrics",
];

test("ReadinessService reports ready when every dependency probe succeeds", async () => {
  const readiness = await createReadinessService().check();

  assert.equal(readiness.status, "ready");
  assert.deepEqual(Object.keys(readiness.components), readinessComponents);
  for (const component of readinessComponents) {
    assert.equal(readiness.components[component], "ok");
  }
});

test("ReadinessService degrades the aggregate status when a dependency probe fails", async () => {
  class FailingQuoteRepository extends InMemoryQuoteRepository {
    async checkHealth() {
      throw new Error("quote repository unavailable");
    }
  }

  const readiness = await createReadinessService({
    quoteRepository: new FailingQuoteRepository(),
  }).check();

  assert.equal(readiness.status, "degraded");
  assert.deepEqual(Object.keys(readiness.components), readinessComponents);
  assert.equal(readiness.components.quoteRepository, "degraded");
  assert.equal(readiness.components.marketSnapshotStore, "ok");
  assert.equal(readiness.components.riskDecisionStore, "ok");
  assert.equal(readiness.components.marketData, "ok");
  assert.equal(readiness.components.routing, "ok");
  assert.equal(readiness.components.pricing, "ok");
  assert.equal(readiness.components.risk, "ok");
  assert.equal(readiness.components.signer, "ok");
  assert.equal(readiness.components.inventory, "ok");
  assert.equal(readiness.components.execution, "ok");
  assert.equal(readiness.components.settlementEventStore, "ok");
  assert.equal(readiness.components.pnl, "ok");
  assert.equal(readiness.components.metrics, "ok");
});

test("ReadinessService snapshots readiness configuration at construction", async () => {
  const mutableConfig = {
    ...defaultReadinessServiceConfig,
    maxSnapshotAgeMs: 5_000,
    maxSnapshotFutureSkewMs: 1_000,
    probeRequest: { ...defaultReadinessServiceConfig.probeRequest },
    probeSnapshot: { ...defaultReadinessServiceConfig.probeSnapshot },
    probeRoutePlan: { ...defaultReadinessServiceConfig.probeRoutePlan },
    probePricing: { ...defaultReadinessServiceConfig.probePricing },
    probeQuote: { ...defaultReadinessServiceConfig.probeQuote },
  };
  const service = createReadinessService({}, mutableConfig);

  mutableConfig.maxSnapshotAgeMs = 1;
  mutableConfig.maxSnapshotFutureSkewMs = 1;
  mutableConfig.probeRequest.tokenOut = mutableConfig.probeRequest.tokenIn;
  mutableConfig.probeSnapshot.midPrice = "0";
  mutableConfig.probeRoutePlan.tokenOut = mutableConfig.probeRoutePlan.tokenIn;
  mutableConfig.probePricing.amountOut = "0";
  mutableConfig.probeQuote.tokenOut = mutableConfig.probeQuote.tokenIn;

  const readiness = await service.check();

  assert.equal(readiness.status, "ready");
  for (const component of readinessComponents) {
    assert.equal(readiness.components[component], "ok");
  }
});

test("ReadinessService snapshots dependency object at construction", async () => {
  const deps = readinessServiceDeps();
  const service = new ReadinessService(deps);

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
  deps.routingEngine = {
    async selectRoute() {
      throw new Error("mutated routing engine used");
    },
  };
  deps.quoteRepository = {
    checkHealth() {
      throw new Error("mutated quote repository used");
    },
  };
  deps.riskDecisionStore = {
    checkHealth() {
      throw new Error("mutated risk decision store used");
    },
    async saveDecision() {
      throw new Error("mutated risk decision store used");
    },
    async findByQuoteId() {
      return undefined;
    },
  };

  const readiness = await service.check();

  assert.equal(readiness.status, "ready");
  for (const component of readinessComponents) {
    assert.equal(readiness.components[component], "ok");
  }
});

test("ReadinessService rejects unsafe freshness configuration at construction", () => {
  assert.throws(
    () => createReadinessService({}, null),
    /Readiness service config must be an object/,
  );
  assert.throws(
    () => createReadinessService({}, []),
    /Readiness service config must be an object/,
  );
  assert.throws(
    () => createReadinessService({}, Object.create(defaultReadinessServiceConfig)),
    /Readiness service config.maxSnapshotAgeMs must be an own field/,
  );

  const configWithInheritedProbeRequest = {
    maxSnapshotAgeMs: defaultReadinessServiceConfig.maxSnapshotAgeMs,
    maxSnapshotFutureSkewMs: defaultReadinessServiceConfig.maxSnapshotFutureSkewMs,
    probeSnapshot: defaultReadinessServiceConfig.probeSnapshot,
    probeRoutePlan: defaultReadinessServiceConfig.probeRoutePlan,
    probePricing: defaultReadinessServiceConfig.probePricing,
    probeQuote: defaultReadinessServiceConfig.probeQuote,
  };
  Object.setPrototypeOf(configWithInheritedProbeRequest, {
    probeRequest: defaultReadinessServiceConfig.probeRequest,
  });
  assert.throws(
    () => createReadinessService({}, configWithInheritedProbeRequest),
    /Readiness service config.probeRequest must be an own field/,
  );

  assert.throws(
    () =>
      createReadinessService(
        {},
        {
          ...defaultReadinessServiceConfig,
          maxSnapshotAgeMs: 0,
        },
      ),
    /Readiness service maxSnapshotAgeMs must be a positive safe integer/,
  );

  assert.throws(
    () =>
      createReadinessService(
        {},
        {
          ...defaultReadinessServiceConfig,
          maxSnapshotFutureSkewMs: Number.MAX_SAFE_INTEGER + 1,
        },
      ),
    /Readiness service maxSnapshotFutureSkewMs must be a positive safe integer/,
  );
});

test("ReadinessService rejects unsafe dependency configuration at construction", () => {
  const deps = readinessServiceDeps();

  assert.throws(
    () => new ReadinessService(undefined),
    /Readiness service deps must be an object/,
  );
  assert.throws(
    () => new ReadinessService([]),
    /Readiness service deps must be an object/,
  );
  assert.throws(
    () => new ReadinessService(Object.create(deps)),
    /Readiness service deps.marketDataService must be an own field/,
  );
  assert.throws(
    () =>
      new ReadinessService({
        ...deps,
        marketDataService: [],
      }),
    /Readiness service marketDataService must be an object/,
  );
  assert.throws(
    () =>
      new ReadinessService({
        ...deps,
        metricsService: [],
      }),
    /Readiness service metricsService must be an object/,
  );
  assert.throws(
    () =>
      new ReadinessService({
        ...deps,
        marketDataService: {},
      }),
    /Readiness service marketDataService.getSnapshot must be a function/,
  );
  assert.throws(
    () =>
      new ReadinessService({
        ...deps,
        routingEngine: {},
      }),
    /Readiness service routingEngine.selectRoute must be a function/,
  );
  assert.throws(
    () =>
      new ReadinessService({
        ...deps,
        pricingEngine: {},
      }),
    /Readiness service pricingEngine.price must be a function/,
  );
  assert.throws(
    () =>
      new ReadinessService({
        ...deps,
        riskEngine: {},
      }),
    /Readiness service riskEngine.evaluate must be a function/,
  );
  assert.throws(
    () =>
      new ReadinessService({
        ...deps,
        signerService: {
          async signQuote() {
            return `0x${"11".repeat(64)}1b`;
          },
        },
      }),
    /Readiness service signerService.verifyQuoteSignature must be a function/,
  );
  assert.throws(
    () =>
      new ReadinessService({
        ...deps,
        quoteRepository: {},
      }),
    /Readiness service quoteRepository.checkHealth must be a function/,
  );
  assert.throws(
    () =>
      new ReadinessService({
        ...deps,
        metricsService: {},
      }),
    /Readiness service metricsService.checkHealth must be a function/,
  );
});

function createReadinessService(overrides = {}, config = defaultReadinessServiceConfig) {
  return new ReadinessService(readinessServiceDeps(overrides), config);
}

function readinessServiceDeps(overrides = {}) {
  const inventoryService = overrides.inventoryService ?? new InventoryService();

  return {
    marketDataService: overrides.marketDataService ?? new StaticMarketDataService(),
    marketSnapshotStore: overrides.marketSnapshotStore ?? new InMemoryMarketSnapshotRepository(),
    routingEngine: overrides.routingEngine ?? new InternalInventoryRoutingEngine(),
    pricingEngine: overrides.pricingEngine ?? new FormulaPricingEngine(),
    riskEngine: overrides.riskEngine ?? new BasicRiskEngine(),
    signerService: overrides.signerService ?? new LocalEIP712SignerService({
      privateKey: "0x59c6995e998f97a5a0044966f094538d9dae1ffc26a3b6d86dae8e3a0b97e6a0",
      settlementAddress: "0x0000000000000000000000000000000000000004",
    }),
    quoteRepository: overrides.quoteRepository ?? new InMemoryQuoteRepository(),
    riskDecisionStore: overrides.riskDecisionStore ?? new InMemoryRiskDecisionRepository(),
    inventoryService,
    hedgeService: overrides.hedgeService ?? new HedgeService(),
    settlementEventService: overrides.settlementEventService ?? new SettlementEventService(inventoryService),
    pnlService: overrides.pnlService ?? new PnlService(),
    metricsService: overrides.metricsService ?? new MetricsService(),
  };
}
