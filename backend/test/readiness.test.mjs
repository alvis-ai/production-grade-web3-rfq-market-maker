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

const readinessComponents = [
  "marketData",
  "marketSnapshotStore",
  "routing",
  "pricing",
  "risk",
  "signer",
  "quoteRepository",
  "quoteControl",
  "riskDecisionStore",
  "rateLimitStore",
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
  assert.equal(readiness.components.rateLimitStore, "ok");
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

test("ReadinessService degrades quote persistence when idempotency storage is unavailable", async () => {
  const readiness = await createReadinessService({
    quoteIdempotencyStore: {
      async checkHealth() {
        throw new Error("quote idempotency unavailable");
      },
    },
  }).check();

  assert.equal(readiness.status, "degraded");
  assert.equal(readiness.components.quoteRepository, "degraded");
});

test("ReadinessService degrades execution when live hedge route rules drift", async () => {
  const readiness = await createReadinessService({
    hedgeRouteRulesHealth: {
      async checkHealth() {
        throw new Error("venue filters changed");
      },
    },
  }).check();

  assert.equal(readiness.status, "degraded");
  assert.equal(readiness.components.execution, "degraded");
});

test("ReadinessService uses a dedicated remote signer health probe when available", async () => {
  let healthChecks = 0;
  let signCalls = 0;
  const readiness = await createReadinessService({
    signerService: {
      async checkHealth() { healthChecks += 1; },
      async signQuote() { signCalls += 1; throw new Error("must not sign readiness quote"); },
      async verifyQuoteSignature() { return false; },
    },
  }).check();

  assert.equal(readiness.components.signer, "ok");
  assert.equal(healthChecks, 1);
  assert.equal(signCalls, 0);
});

test("ReadinessService degrades when the distributed rate limit store is unavailable", async () => {
  const readiness = await createReadinessService({
    rateLimiter: {
      async checkHealth() {
        throw new Error("redis unavailable");
      },
    },
  }).check();

  assert.equal(readiness.status, "degraded");
  assert.equal(readiness.components.rateLimitStore, "degraded");
  assert.equal(readiness.components.quoteRepository, "ok");
});

test("ReadinessService degrades when the quote control store is unavailable", async () => {
  const readiness = await createReadinessService({
    quoteControlStore: {
      async checkHealth() { throw new Error("quote control unavailable"); },
      async getState() { throw new Error("quote control unavailable"); },
      async updateState() { throw new Error("quote control unavailable"); },
      async getPausedPairCount() { throw new Error("quote control unavailable"); },
    },
  }).check();

  assert.equal(readiness.status, "degraded");
  assert.equal(readiness.components.quoteControl, "degraded");
  assert.equal(readiness.components.quoteRepository, "ok");
});

test("ReadinessService reports intentional quote pause as healthy and refreshes its gauge", async () => {
  const deps = readinessServiceDeps();
  await deps.quoteControlStore.updateState({
    paused: true,
    reason: "incident response",
    expectedVersion: 0,
  }, "institution_ops:ops_writer");
  await deps.quoteControlStore.updatePairState({
    chainId: 1,
    tokenLow: "0x0000000000000000000000000000000000000002",
    tokenHigh: "0x0000000000000000000000000000000000000003",
  }, {
    paused: true,
    reason: "pair incident response",
    expectedVersion: 0,
  }, "institution_ops:ops_writer");

  const readiness = await new ReadinessService(deps).check();

  assert.equal(readiness.status, "ready");
  assert.equal(readiness.components.quoteControl, "ok");
  assert.match(deps.metricsService.renderPrometheus(), /rfq_quote_paused 1/);
  assert.match(deps.metricsService.renderPrometheus(), /rfq_quote_pairs_paused 1/);
});

test("ReadinessService degrades quote control on malformed shared state", async () => {
  const readiness = await createReadinessService({
    quoteControlStore: {
      checkHealth() {},
      async getState() { return { paused: false }; },
      async updateState() { return { paused: false }; },
      async getPausedPairCount() { return 0; },
    },
  }).check();

  assert.equal(readiness.status, "degraded");
  assert.equal(readiness.components.quoteControl, "degraded");
});

test("ReadinessService degrades execution when the submit reservation store is unavailable", async () => {
  const readiness = await createReadinessService({
    submitReservationStore: {
      async checkHealth() {
        throw new Error("submit reservation unavailable");
      },
      async acquire() {},
      async release() {},
    },
  }).check();

  assert.equal(readiness.status, "degraded");
  assert.equal(readiness.components.execution, "degraded");
  assert.equal(readiness.components.quoteRepository, "ok");
});

test("ReadinessService degrades risk when the quote exposure store is unavailable", async () => {
  const readiness = await createReadinessService({
    quoteExposureStore: {
      async checkHealth() {
        throw new Error("quote exposure store unavailable");
      },
      async reserve() {},
      async release() {},
    },
  }).check();

  assert.equal(readiness.status, "degraded");
  assert.equal(readiness.components.risk, "degraded");
  assert.equal(readiness.components.quoteRepository, "ok");
});

test("ReadinessService degrades risk when dynamic toxic flow score storage is unavailable", async () => {
  const readiness = await createReadinessService({
    toxicFlowScoreStore: {
      async checkHealth() { throw new Error("toxic score database unavailable"); },
      async getScore() { return null; },
      async updateScore() {},
    },
  }).check();

  assert.equal(readiness.status, "degraded");
  assert.equal(readiness.components.risk, "degraded");
});

test("ReadinessService degrades risk when the treasury liquidity RPC is unavailable", async () => {
  const readiness = await createReadinessService({
    treasuryLiquidityProvider: {
      async checkHealth() {
        throw new Error("treasury liquidity RPC unavailable");
      },
    },
  }).check();

  assert.equal(readiness.status, "degraded");
  assert.equal(readiness.components.risk, "degraded");
  assert.equal(readiness.components.quoteRepository, "ok");
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
  deps.rateLimiter = {
    checkHealth() {
      throw new Error("mutated rate limit store used");
    },
  };

  const readiness = await service.check();

  assert.equal(readiness.status, "ready");
  for (const component of readinessComponents) {
    assert.equal(readiness.components[component], "ok");
  }
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
    ...(overrides.quoteExposureStore ? { quoteExposureStore: overrides.quoteExposureStore } : {}),
    ...(overrides.treasuryLiquidityProvider
      ? { treasuryLiquidityProvider: overrides.treasuryLiquidityProvider }
      : {}),
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
    ...(overrides.hedgeRouteRulesHealth
      ? { hedgeRouteRulesHealth: overrides.hedgeRouteRulesHealth }
      : {}),
    settlementEventService: overrides.settlementEventService ?? new SettlementEventService(inventoryService),
    pnlService: overrides.pnlService ?? new PnlService(),
    metricsService: overrides.metricsService ?? new MetricsService(),
    submitReservationStore: overrides.submitReservationStore ?? new InMemorySubmitReservationStore(),
  };
}
