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
import { InMemoryQuoteIdempotencyStore } from "../dist/modules/quote/quote-idempotency.store.js";
import { InMemoryQuoteControlStore } from "../dist/modules/quote-control/quote-control.store.js";
import { InMemoryRiskDecisionRepository } from "../dist/modules/risk/risk-decision.repository.js";
import { BasicRiskEngine } from "../dist/modules/risk/risk.engine.js";
import { InMemoryToxicFlowScoreStore } from "../dist/modules/risk/toxic-flow-score.store.js";
import { InternalInventoryRoutingEngine } from "../dist/modules/routing/routing.engine.js";
import { SettlementEventService } from "../dist/modules/settlement/settlement-event.service.js";
import { LocalEIP712SignerService } from "../dist/modules/signer/signer.service.js";
import { InMemorySubmitReservationStore } from "../dist/modules/execution/submit-reservation.store.js";

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

  assert.throws(
    () =>
      createReadinessService(
        {},
        {
          ...defaultReadinessServiceConfig,
          probeRequest: Object.create(defaultReadinessServiceConfig.probeRequest),
        },
      ),
    /Readiness service probeRequest.chainId must be an own field/,
  );
  assert.throws(
    () =>
      createReadinessService(
        {},
        {
          ...defaultReadinessServiceConfig,
          probeSnapshot: Object.create(defaultReadinessServiceConfig.probeSnapshot),
        },
      ),
    /Readiness service probeSnapshot.snapshotId must be an own field/,
  );
  assert.throws(
    () =>
      createReadinessService(
        {},
        {
          ...defaultReadinessServiceConfig,
          probeRoutePlan: Object.create(defaultReadinessServiceConfig.probeRoutePlan),
        },
      ),
    /Readiness service probeRoutePlan.routeId must be an own field/,
  );
  assert.throws(
    () =>
      createReadinessService(
        {},
        {
          ...defaultReadinessServiceConfig,
          probePricing: Object.create(defaultReadinessServiceConfig.probePricing),
        },
      ),
    /Readiness service probePricing.amountOut must be an own field/,
  );
  assert.throws(
    () =>
      createReadinessService(
        {},
        {
          ...defaultReadinessServiceConfig,
          probeQuote: Object.create(defaultReadinessServiceConfig.probeQuote),
        },
      ),
    /Readiness service probeQuote.user must be an own field/,
  );
  assert.throws(
    () =>
      createReadinessService(
        {},
        {
          ...defaultReadinessServiceConfig,
          probeSnapshot: [],
        },
      ),
    /Readiness service probeSnapshot must be an object/,
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
    () => new ReadinessService({ ...deps, toxicFlowScoreStore: {} }),
    /Readiness service toxicFlowScoreStore.checkHealth must be a function/,
  );
  assert.throws(
    () => new ReadinessService({ ...deps, hedgeRouteRulesHealth: {} }),
    /Readiness service hedgeRouteRulesHealth.checkHealth must be a function/,
  );
  assert.throws(
    () => new ReadinessService({
      ...deps,
      settlementIndexerRiskGuard: { checkHealth() {} },
    }),
    /Readiness service settlementIndexerRiskGuard.assertQuoteSafe must be a function/,
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
    () => new ReadinessService({ ...deps, quoteIdempotencyStore: {} }),
    /Readiness service quoteIdempotencyStore.checkHealth must be a function/,
  );
  assert.throws(
    () => new ReadinessService({ ...deps, quoteControlStore: {} }),
    /Readiness service quoteControlStore.checkHealth must be a function/,
  );
  assert.throws(
    () => new ReadinessService({ ...deps, quoteControlStore: { checkHealth() {} } }),
    /Readiness service quoteControlStore.getState must be a function/,
  );
  assert.throws(
    () => new ReadinessService({
      ...deps,
      quoteControlStore: { checkHealth() {}, async getState() {} },
    }),
    /Readiness service quoteControlStore.getPausedPairCount must be a function/,
  );
  assert.throws(
    () =>
      new ReadinessService({
        ...deps,
        metricsService: {},
      }),
    /Readiness service metricsService.checkHealth must be a function/,
  );
  assert.throws(
    () =>
      new ReadinessService({
        ...deps,
        rateLimiter: {},
      }),
    /Readiness service rateLimiter.checkHealth must be a function/,
  );
  assert.throws(
    () =>
      new ReadinessService({
        ...deps,
        submitReservationStore: {},
      }),
    /Readiness service submitReservationStore.checkHealth must be a function/,
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
    toxicFlowScoreStore: overrides.toxicFlowScoreStore ?? new InMemoryToxicFlowScoreStore(),
    signerService: overrides.signerService ?? new LocalEIP712SignerService({
      privateKey: "0x59c6995e998f97a5a0044966f094538d9dae1ffc26a3b6d86dae8e3a0b97e6a0",
      settlementAddress: "0x0000000000000000000000000000000000000004",
    }),
    quoteRepository: overrides.quoteRepository ?? new InMemoryQuoteRepository(),
    quoteIdempotencyStore: overrides.quoteIdempotencyStore ?? new InMemoryQuoteIdempotencyStore(),
    quoteControlStore: overrides.quoteControlStore ?? new InMemoryQuoteControlStore(),
    riskDecisionStore: overrides.riskDecisionStore ?? new InMemoryRiskDecisionRepository(),
    rateLimiter: overrides.rateLimiter ?? { checkHealth() {} },
    inventoryService,
    hedgeService: overrides.hedgeService ?? new HedgeService(),
    settlementEventService: overrides.settlementEventService ?? new SettlementEventService(inventoryService),
    pnlService: overrides.pnlService ?? new PnlService(),
    metricsService: overrides.metricsService ?? new MetricsService(),
    submitReservationStore: overrides.submitReservationStore ?? new InMemorySubmitReservationStore(),
  };
}
