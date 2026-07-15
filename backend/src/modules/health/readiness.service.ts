import {
  defaultMaxSnapshotFutureSkewMs,
  getMarketSnapshotIssue,
  type MarketDataService,
} from "../market-data/market-data.service.js";
import type { MarketSnapshotStore } from "../market-data/market-snapshot.repository.js";
import type { MarketSnapshot, QuoteRequest, SignedQuote } from "../../shared/types/rfq.js";
import type { SignerService } from "../signer/signer.service.js";
import type { HedgeIntentService } from "../hedge/hedge.service.js";
import type { BinanceSymbolRulesHealth } from "../hedge/binance-symbol-rules.js";
import type { IInventoryService } from "../inventory/inventory.service.js";
import type { MetricsService } from "../metrics/metrics.service.js";
import type { PnlStore } from "../pnl/pnl.service.js";
import type { PricingEngine, PricingResult } from "../pricing/pricing.engine.js";
import type { QuoteRepository } from "../quote/quote.repository.js";
import type { QuoteIdempotencyStore } from "../quote/quote-idempotency.store.js";
import type { RateLimiter } from "../rate-limit/rate-limit.service.js";
import type { RiskDecisionStore } from "../risk/risk-decision.repository.js";
import type { RiskEngine } from "../risk/risk.engine.js";
import type { ToxicFlowScoreStore } from "../risk/toxic-flow-score.store.js";
import type { QuoteExposureStore } from "../risk/quote-exposure.store.js";
import type { TreasuryLiquidityProvider } from "../risk/treasury-liquidity.provider.js";
import type { SettlementIndexerRiskGuard } from "../risk/settlement-indexer-risk.guard.js";
import type { RoutePlan, RoutingEngine } from "../routing/routing.engine.js";
import type { SettlementEventStore } from "../settlement/settlement-event.service.js";
import type { SubmitReservationStore } from "../execution/submit-reservation.store.js";
import {
  assertQuoteControlState,
  type QuoteControlStore,
} from "../quote-control/quote-control.store.js";

export type ReadinessComponentStatus = "ok" | "degraded";
export type ReadinessComponentName =
  | "marketData"
  | "marketSnapshotStore"
  | "routing"
  | "pricing"
  | "risk"
  | "signer"
  | "quoteRepository"
  | "quoteControl"
  | "riskDecisionStore"
  | "rateLimitStore"
  | "inventory"
  | "execution"
  | "settlementEventStore"
  | "pnl"
  | "metrics";
export type ReadinessComponents = Record<ReadinessComponentName, ReadinessComponentStatus>;

export interface ReadinessResponse {
  status: "ready" | "degraded";
  components: ReadinessComponents;
}

export interface ReadinessServiceDeps {
  marketDataService: MarketDataService;
  marketSnapshotStore: MarketSnapshotStore;
  routingEngine: RoutingEngine;
  pricingEngine: PricingEngine;
  riskEngine: RiskEngine;
  toxicFlowScoreStore: ToxicFlowScoreStore;
  quoteExposureStore?: QuoteExposureStore;
  settlementIndexerRiskGuard?: SettlementIndexerRiskGuard;
  treasuryLiquidityProvider?: TreasuryLiquidityProvider;
  signerService: SignerService;
  quoteRepository: QuoteRepository;
  quoteIdempotencyStore: QuoteIdempotencyStore;
  quoteControlStore: QuoteControlStore;
  riskDecisionStore: RiskDecisionStore;
  rateLimiter: Pick<RateLimiter, "checkHealth">;
  inventoryService: IInventoryService;
  hedgeService: HedgeIntentService;
  hedgeRouteRulesHealth?: BinanceSymbolRulesHealth;
  settlementEventService: SettlementEventStore;
  pnlService: PnlStore;
  metricsService: MetricsService;
  submitReservationStore: SubmitReservationStore;
}

export interface ReadinessServiceConfig {
  maxSnapshotAgeMs: number;
  maxSnapshotFutureSkewMs: number;
  probeRequest: QuoteRequest;
  probeSnapshot: MarketSnapshot;
  probeRoutePlan: RoutePlan;
  probePricing: PricingResult;
  probeQuote: SignedQuote;
}

export const defaultReadinessServiceConfig: ReadinessServiceConfig = {
  maxSnapshotAgeMs: 5_000,
  maxSnapshotFutureSkewMs: defaultMaxSnapshotFutureSkewMs,
  probeRequest: {
    chainId: 1,
    user: "0x0000000000000000000000000000000000000001",
    tokenIn: "0x0000000000000000000000000000000000000002",
    tokenOut: "0x0000000000000000000000000000000000000003",
    amountIn: "1000000000",
    slippageBps: 50,
  },
  probeSnapshot: {
    snapshotId: "readiness_snapshot",
    midPrice: "1",
    liquidityUsd: "10000000000000",
    marketSpreadBps: 0,
    volatilityBps: 25,
    observedAt: "2026-01-01T00:00:00.000Z",
  },
  probeRoutePlan: {
    routeId: "readiness_route",
    venue: "internal_inventory",
    tokenIn: "0x0000000000000000000000000000000000000002",
    tokenOut: "0x0000000000000000000000000000000000000003",
    expectedLiquidityUsd: "10000000000000",
  },
  probePricing: {
    amountOut: "998400000",
    minAmountOut: "993408000",
    spreadBps: 16,
    sizeImpactBps: 1,
    marketSpreadBps: 0,
    inventorySkewBps: 0,
    volatilityPremiumBps: 5,
    hedgeCostBps: 0,
    pricingVersion: "readiness-pricing-v1",
  },
  probeQuote: {
    user: "0x0000000000000000000000000000000000000001",
    tokenIn: "0x0000000000000000000000000000000000000002",
    tokenOut: "0x0000000000000000000000000000000000000003",
    amountIn: "1000000000",
    amountOut: "998400000",
    minAmountOut: "993408000",
    nonce: "1",
    deadline: 4_102_444_800,
    chainId: 1,
  },
};

const readinessServiceConfigFields = [
  "maxSnapshotAgeMs",
  "maxSnapshotFutureSkewMs",
  "probeRequest",
  "probeSnapshot",
  "probeRoutePlan",
  "probePricing",
  "probeQuote",
] as const;
const readinessServiceDepsFields = [
  "marketDataService",
  "marketSnapshotStore",
  "routingEngine",
  "pricingEngine",
  "riskEngine",
  "toxicFlowScoreStore",
  "signerService",
  "quoteRepository",
  "quoteIdempotencyStore",
  "quoteControlStore",
  "riskDecisionStore",
  "rateLimiter",
  "inventoryService",
  "hedgeService",
  "settlementEventService",
  "pnlService",
  "metricsService",
  "submitReservationStore",
] as const;
const probeRequestFields = ["chainId", "user", "tokenIn", "tokenOut", "amountIn", "slippageBps"] as const;
const probeSnapshotFields = [
  "snapshotId",
  "midPrice",
  "liquidityUsd",
  "marketSpreadBps",
  "volatilityBps",
  "observedAt",
] as const;
const probeRoutePlanFields = ["routeId", "venue", "tokenIn", "tokenOut", "expectedLiquidityUsd"] as const;
const probePricingFields = [
  "amountOut",
  "minAmountOut",
  "spreadBps",
  "sizeImpactBps",
  "marketSpreadBps",
  "inventorySkewBps",
  "volatilityPremiumBps",
  "hedgeCostBps",
  "pricingVersion",
] as const;
const probeQuoteFields = [
  "user",
  "tokenIn",
  "tokenOut",
  "amountIn",
  "amountOut",
  "minAmountOut",
  "nonce",
  "deadline",
  "chainId",
] as const;
const signerProbeCacheMs = 30_000;

export class ReadinessService {
  private readonly deps: ReadinessServiceDeps;
  private readonly config: ReadinessServiceConfig;
  private signerStatusCache: { status: ReadinessComponentStatus; expiresAtMs: number } | undefined;
  private signerProbeInFlight: Promise<ReadinessComponentStatus> | undefined;

  constructor(
    deps: ReadinessServiceDeps,
    config: ReadinessServiceConfig = defaultReadinessServiceConfig,
  ) {
    assertRecord(config, "config");
    assertOwnFields(config, readinessServiceConfigFields, "config");
    assertPositiveSafeInteger(config.maxSnapshotAgeMs, "maxSnapshotAgeMs");
    assertPositiveSafeInteger(config.maxSnapshotFutureSkewMs, "maxSnapshotFutureSkewMs");
    assertProbeFields(config);
    assertReadinessServiceDeps(deps);
    this.deps = cloneReadinessServiceDeps(deps);
    this.config = cloneReadinessServiceConfig(config);
  }

  async check(): Promise<ReadinessResponse> {
    const marketDataStatus = await this.checkMarketData();
    const marketSnapshotStoreStatus = await this.checkDependency(this.deps.marketSnapshotStore);
    const routingStatus = await this.checkRouting();
    const pricingStatus = await this.checkPricing();
    const riskStatus = await this.checkRisk();
    const signerStatus = await this.checkSigner();
    const quoteRepositoryStatus = await this.checkDependencies([
      this.deps.quoteRepository,
      this.deps.quoteIdempotencyStore,
    ]);
    const quoteControlStatus = await this.checkQuoteControl();
    const riskDecisionStoreStatus = await this.checkDependency(this.deps.riskDecisionStore);
    const rateLimitStoreStatus = await this.checkDependency(this.deps.rateLimiter);
    const inventoryStatus = await this.checkDependency(this.deps.inventoryService);
    const hedgeStatus = await this.checkDependency(this.deps.hedgeService);
    const hedgeRouteRulesStatus = this.deps.hedgeRouteRulesHealth
      ? await this.checkDependency(this.deps.hedgeRouteRulesHealth)
      : "ok";
    const settlementEventStoreStatus = await this.checkDependency(this.deps.settlementEventService);
    const pnlStatus = await this.checkDependency(this.deps.pnlService);
    const metricsStatus = await this.checkDependency(this.deps.metricsService);
    const submitReservationStatus = await this.checkDependency(this.deps.submitReservationStore);
    const components = {
      marketData: marketDataStatus,
      marketSnapshotStore: marketSnapshotStoreStatus,
      routing: routingStatus,
      pricing: pricingStatus,
      risk: riskStatus,
      signer: signerStatus,
      quoteRepository: quoteRepositoryStatus,
      quoteControl: quoteControlStatus,
      riskDecisionStore: riskDecisionStoreStatus,
      rateLimitStore: rateLimitStoreStatus,
      inventory: inventoryStatus,
      execution: hedgeStatus === "ok" && hedgeRouteRulesStatus === "ok" && submitReservationStatus === "ok"
        ? "ok"
        : "degraded",
      settlementEventStore: settlementEventStoreStatus,
      pnl: pnlStatus,
      metrics: metricsStatus,
    } as const;

    const hasDegradedComponent = Object.values(components).some((status) => status === "degraded");

    return {
      status: hasDegradedComponent ? "degraded" : "ready",
      components,
    };
  }

  private async checkMarketData(): Promise<ReadinessComponentStatus> {
    try {
      const snapshot = await this.deps.marketDataService.getSnapshot(this.config.probeRequest);
      return getMarketSnapshotIssue(
        snapshot,
        this.config.maxSnapshotAgeMs,
        this.config.maxSnapshotFutureSkewMs,
      ) ? "degraded" : "ok";
    } catch {
      return "degraded";
    }
  }

  private async checkSigner(): Promise<ReadinessComponentStatus> {
    const cached = this.signerStatusCache;
    if (cached && Date.now() < cached.expiresAtMs) return cached.status;
    if (this.signerProbeInFlight) return this.signerProbeInFlight;

    const probe = this.probeSigner();
    this.signerProbeInFlight = probe;
    try {
      const status = await probe;
      this.signerStatusCache = { status, expiresAtMs: Date.now() + signerProbeCacheMs };
      return status;
    } finally {
      if (this.signerProbeInFlight === probe) this.signerProbeInFlight = undefined;
    }
  }

  private async probeSigner(): Promise<ReadinessComponentStatus> {
    try {
      if (typeof this.deps.signerService.checkHealth === "function") {
        await this.deps.signerService.checkHealth();
        return "ok";
      }
      const signature = await this.deps.signerService.signQuote({
        quote: this.config.probeQuote,
        quoteId: "readiness_probe",
        snapshotId: "readiness_snapshot",
      });
      const verified = await this.deps.signerService.verifyQuoteSignature(this.config.probeQuote, signature);
      return verified ? "ok" : "degraded";
    } catch {
      return "degraded";
    }
  }

  private async checkRouting(): Promise<ReadinessComponentStatus> {
    try {
      await this.deps.routingEngine.selectRoute({
        request: this.config.probeRequest,
        snapshot: this.config.probeSnapshot,
      });
      return "ok";
    } catch {
      return "degraded";
    }
  }

  private async checkPricing(): Promise<ReadinessComponentStatus> {
    try {
      await this.deps.pricingEngine.price({
        request: this.config.probeRequest,
        snapshot: this.config.probeSnapshot,
        routePlan: this.config.probeRoutePlan,
        inventorySkewBps: 0,
        hedgeCostBps: 0,
      });
      return "ok";
    } catch {
      return "degraded";
    }
  }

  private async checkRisk(): Promise<ReadinessComponentStatus> {
    try {
      await this.deps.toxicFlowScoreStore.checkHealth();
      await this.deps.quoteExposureStore?.checkHealth?.();
      await this.deps.settlementIndexerRiskGuard?.checkHealth();
      await this.deps.treasuryLiquidityProvider?.checkHealth();
      await this.deps.riskEngine.checkHealth?.();
      const decision = await this.deps.riskEngine.evaluate({
        request: this.config.probeRequest,
        pricing: this.config.probePricing,
        snapshot: this.config.probeSnapshot,
      });
      return decision.status === "approved" ? "ok" : "degraded";
    } catch {
      return "degraded";
    }
  }

  private async checkQuoteControl(): Promise<ReadinessComponentStatus> {
    try {
      const state = await this.deps.quoteControlStore.getState();
      assertQuoteControlState(state);
      const pausedPairCount = await this.deps.quoteControlStore.getPausedPairCount();
      this.deps.metricsService.recordQuoteControlState(state.paused);
      this.deps.metricsService.recordPausedQuotePairCount(pausedPairCount);
      return "ok";
    } catch {
      return "degraded";
    }
  }

  private async checkDependency(dependency: { checkHealth?: () => void | Promise<void> }): Promise<ReadinessComponentStatus> {
    try {
      await dependency.checkHealth?.();
      return "ok";
    } catch {
      return "degraded";
    }
  }

  private async checkDependencies(
    dependencies: Array<{ checkHealth?: () => void | Promise<void> }>,
  ): Promise<ReadinessComponentStatus> {
    const statuses = await Promise.all(dependencies.map((dependency) => this.checkDependency(dependency)));
    return statuses.every((status) => status === "ok") ? "ok" : "degraded";
  }
}

function assertPositiveSafeInteger(value: number, field: keyof ReadinessServiceConfig): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`Readiness service ${field} must be a positive safe integer`);
  }
}

function assertProbeFields(config: ReadinessServiceConfig): void {
  assertRecord(config.probeRequest, "probeRequest");
  assertOwnFields(config.probeRequest, probeRequestFields, "probeRequest");
  assertRecord(config.probeSnapshot, "probeSnapshot");
  assertOwnFields(config.probeSnapshot, probeSnapshotFields, "probeSnapshot");
  assertRecord(config.probeRoutePlan, "probeRoutePlan");
  assertOwnFields(config.probeRoutePlan, probeRoutePlanFields, "probeRoutePlan");
  assertRecord(config.probePricing, "probePricing");
  assertOwnFields(config.probePricing, probePricingFields, "probePricing");
  assertRecord(config.probeQuote, "probeQuote");
  assertOwnFields(config.probeQuote, probeQuoteFields, "probeQuote");
}

function cloneReadinessServiceDeps(deps: ReadinessServiceDeps): ReadinessServiceDeps {
  return { ...deps };
}

function assertReadinessServiceDeps(deps: ReadinessServiceDeps): void {
  assertRecord(deps, "deps");
  assertOwnFields(deps, readinessServiceDepsFields, "deps");
  if (
    "quoteExposureStore" in deps &&
    !Object.prototype.hasOwnProperty.call(deps, "quoteExposureStore")
  ) {
    throw new Error("Readiness service deps.quoteExposureStore must be an own field when provided");
  }
  if (
    "treasuryLiquidityProvider" in deps &&
    !Object.prototype.hasOwnProperty.call(deps, "treasuryLiquidityProvider")
  ) {
    throw new Error("Readiness service deps.treasuryLiquidityProvider must be an own field when provided");
  }
  if (
    "settlementIndexerRiskGuard" in deps &&
    !Object.prototype.hasOwnProperty.call(deps, "settlementIndexerRiskGuard")
  ) {
    throw new Error("Readiness service deps.settlementIndexerRiskGuard must be an own field when provided");
  }
  if (
    "hedgeRouteRulesHealth" in deps &&
    !Object.prototype.hasOwnProperty.call(deps, "hedgeRouteRulesHealth")
  ) {
    throw new Error("Readiness service deps.hedgeRouteRulesHealth must be an own field when provided");
  }
  assertDependencyMethod(deps.marketDataService, "marketDataService", "getSnapshot");
  assertDependencyMethod(deps.routingEngine, "routingEngine", "selectRoute");
  assertDependencyMethod(deps.pricingEngine, "pricingEngine", "price");
  assertDependencyMethod(deps.riskEngine, "riskEngine", "evaluate");
  assertDependencyMethod(deps.toxicFlowScoreStore, "toxicFlowScoreStore", "checkHealth");
  if (deps.quoteExposureStore !== undefined) {
    assertDependencyMethod(deps.quoteExposureStore, "quoteExposureStore", "checkHealth");
  }
  if (deps.treasuryLiquidityProvider !== undefined) {
    assertDependencyMethod(deps.treasuryLiquidityProvider, "treasuryLiquidityProvider", "checkHealth");
  }
  if (deps.settlementIndexerRiskGuard !== undefined) {
    assertDependencyMethod(deps.settlementIndexerRiskGuard, "settlementIndexerRiskGuard", "checkHealth");
    assertDependencyMethod(deps.settlementIndexerRiskGuard, "settlementIndexerRiskGuard", "assertQuoteSafe");
  }
  assertDependencyMethod(deps.signerService, "signerService", "signQuote");
  assertDependencyMethod(deps.signerService, "signerService", "verifyQuoteSignature");
  assertDependencyMethod(deps.marketSnapshotStore, "marketSnapshotStore", "checkHealth");
  assertDependencyMethod(deps.quoteRepository, "quoteRepository", "checkHealth");
  assertDependencyMethod(deps.quoteIdempotencyStore, "quoteIdempotencyStore", "checkHealth");
  assertDependencyMethod(deps.quoteControlStore, "quoteControlStore", "checkHealth");
  assertDependencyMethod(deps.quoteControlStore, "quoteControlStore", "getState");
  assertDependencyMethod(deps.quoteControlStore, "quoteControlStore", "getPausedPairCount");
  assertDependencyMethod(deps.riskDecisionStore, "riskDecisionStore", "checkHealth");
  assertDependencyMethod(deps.rateLimiter, "rateLimiter", "checkHealth");
  assertDependencyMethod(deps.inventoryService, "inventoryService", "checkHealth");
  assertDependencyMethod(deps.hedgeService, "hedgeService", "checkHealth");
  if (deps.hedgeRouteRulesHealth !== undefined) {
    assertDependencyMethod(deps.hedgeRouteRulesHealth, "hedgeRouteRulesHealth", "checkHealth");
  }
  assertDependencyMethod(deps.settlementEventService, "settlementEventService", "checkHealth");
  assertDependencyMethod(deps.pnlService, "pnlService", "checkHealth");
  assertDependencyMethod(deps.metricsService, "metricsService", "checkHealth");
  assertDependencyMethod(deps.submitReservationStore, "submitReservationStore", "checkHealth");
}

function assertDependencyMethod(
  dependency: unknown,
  dependencyName: keyof ReadinessServiceDeps,
  methodName: string,
): void {
  assertRecord(dependency, dependencyName);
  const method = (dependency as Record<string, unknown>)[methodName];
  if (typeof method !== "function") {
    throw new Error(`Readiness service ${dependencyName}.${methodName} must be a function`);
  }
}

function assertRecord(
  value: unknown,
  field:
    | "config"
    | "deps"
    | keyof ReadinessServiceDeps
    | "probeRequest"
    | "probeSnapshot"
    | "probeRoutePlan"
    | "probePricing"
    | "probeQuote",
): void {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Readiness service ${field} must be an object`);
  }
}

function assertOwnFields(value: object, fields: readonly string[], path: string): void {
  for (const field of fields) {
    if (!Object.prototype.hasOwnProperty.call(value, field)) {
      throw new Error(`Readiness service ${path}.${field} must be an own field`);
    }
  }
}

function cloneReadinessServiceConfig(config: ReadinessServiceConfig): ReadinessServiceConfig {
  return {
    ...config,
    probeRequest: { ...config.probeRequest },
    probeSnapshot: { ...config.probeSnapshot },
    probeRoutePlan: { ...config.probeRoutePlan },
    probePricing: { ...config.probePricing },
    probeQuote: { ...config.probeQuote },
  };
}
