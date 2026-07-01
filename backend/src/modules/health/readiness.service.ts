import {
  defaultMaxSnapshotFutureSkewMs,
  getMarketSnapshotIssue,
  type MarketDataService,
} from "../market-data/market-data.service.js";
import type { MarketSnapshotStore } from "../market-data/market-snapshot.repository.js";
import type { MarketSnapshot, QuoteRequest, SignedQuote } from "../../shared/types/rfq.js";
import type { SignerService } from "../signer/signer.service.js";
import type { HedgeIntentService } from "../hedge/hedge.service.js";
import type { InventoryService } from "../inventory/inventory.service.js";
import type { MetricsService } from "../metrics/metrics.service.js";
import type { PnlStore } from "../pnl/pnl.service.js";
import type { PricingEngine, PricingResult } from "../pricing/pricing.engine.js";
import type { QuoteRepository } from "../quote/quote.repository.js";
import type { RiskDecisionStore } from "../risk/risk-decision.repository.js";
import type { RiskEngine } from "../risk/risk.engine.js";
import type { RoutePlan, RoutingEngine } from "../routing/routing.engine.js";
import type { SettlementEventStore } from "../settlement/settlement-event.service.js";

export type ReadinessComponentStatus = "ok" | "degraded";

export interface ReadinessResponse {
  status: "ready" | "degraded";
  components: Record<string, ReadinessComponentStatus>;
}

export interface ReadinessServiceDeps {
  marketDataService: MarketDataService;
  marketSnapshotStore: MarketSnapshotStore;
  routingEngine: RoutingEngine;
  pricingEngine: PricingEngine;
  riskEngine: RiskEngine;
  signerService: SignerService;
  quoteRepository: QuoteRepository;
  riskDecisionStore: RiskDecisionStore;
  inventoryService: InventoryService;
  hedgeService: HedgeIntentService;
  settlementEventService: SettlementEventStore;
  pnlService: PnlStore;
  metricsService: MetricsService;
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
    inventorySkewBps: 0,
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

export class ReadinessService {
  private readonly deps: ReadinessServiceDeps;
  private readonly config: ReadinessServiceConfig;

  constructor(
    deps: ReadinessServiceDeps,
    config: ReadinessServiceConfig = defaultReadinessServiceConfig,
  ) {
    assertPositiveSafeInteger(config.maxSnapshotAgeMs, "maxSnapshotAgeMs");
    assertPositiveSafeInteger(config.maxSnapshotFutureSkewMs, "maxSnapshotFutureSkewMs");
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
    const quoteRepositoryStatus = await this.checkDependency(this.deps.quoteRepository);
    const riskDecisionStoreStatus = await this.checkDependency(this.deps.riskDecisionStore);
    const inventoryStatus = await this.checkDependency(this.deps.inventoryService);
    const hedgeStatus = await this.checkDependency(this.deps.hedgeService);
    const settlementEventStoreStatus = await this.checkDependency(this.deps.settlementEventService);
    const pnlStatus = await this.checkDependency(this.deps.pnlService);
    const metricsStatus = await this.checkDependency(this.deps.metricsService);
    const components = {
      marketData: marketDataStatus,
      marketSnapshotStore: marketSnapshotStoreStatus,
      routing: routingStatus,
      pricing: pricingStatus,
      risk: riskStatus,
      signer: signerStatus,
      quoteRepository: quoteRepositoryStatus,
      riskDecisionStore: riskDecisionStoreStatus,
      inventory: inventoryStatus,
      // The current execution readiness probe is backed by the hedge intent store.
      execution: hedgeStatus,
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
    try {
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
      });
      return "ok";
    } catch {
      return "degraded";
    }
  }

  private async checkRisk(): Promise<ReadinessComponentStatus> {
    try {
      const decision = await this.deps.riskEngine.evaluate({
        request: this.config.probeRequest,
        pricing: this.config.probePricing,
      });
      return decision.status === "approved" ? "ok" : "degraded";
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
}

function assertPositiveSafeInteger(value: number, field: keyof ReadinessServiceConfig): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`Readiness service ${field} must be a positive safe integer`);
  }
}

function cloneReadinessServiceDeps(deps: ReadinessServiceDeps): ReadinessServiceDeps {
  return { ...deps };
}

function assertReadinessServiceDeps(deps: ReadinessServiceDeps): void {
  if (typeof deps !== "object" || deps === null) {
    throw new Error("Readiness service deps must be an object");
  }

  assertDependencyMethod(deps.marketDataService, "marketDataService", "getSnapshot");
  assertDependencyMethod(deps.routingEngine, "routingEngine", "selectRoute");
  assertDependencyMethod(deps.pricingEngine, "pricingEngine", "price");
  assertDependencyMethod(deps.riskEngine, "riskEngine", "evaluate");
  assertDependencyMethod(deps.signerService, "signerService", "signQuote");
  assertDependencyMethod(deps.signerService, "signerService", "verifyQuoteSignature");
  assertDependencyMethod(deps.marketSnapshotStore, "marketSnapshotStore", "checkHealth");
  assertDependencyMethod(deps.quoteRepository, "quoteRepository", "checkHealth");
  assertDependencyMethod(deps.riskDecisionStore, "riskDecisionStore", "checkHealth");
  assertDependencyMethod(deps.inventoryService, "inventoryService", "checkHealth");
  assertDependencyMethod(deps.hedgeService, "hedgeService", "checkHealth");
  assertDependencyMethod(deps.settlementEventService, "settlementEventService", "checkHealth");
  assertDependencyMethod(deps.pnlService, "pnlService", "checkHealth");
  assertDependencyMethod(deps.metricsService, "metricsService", "checkHealth");
}

function assertDependencyMethod(
  dependency: unknown,
  dependencyName: keyof ReadinessServiceDeps,
  methodName: string,
): void {
  const method = typeof dependency === "object" && dependency !== null
    ? (dependency as Record<string, unknown>)[methodName]
    : undefined;
  if (typeof method !== "function") {
    throw new Error(`Readiness service ${dependencyName}.${methodName} must be a function`);
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
