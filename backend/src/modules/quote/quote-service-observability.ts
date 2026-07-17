import type { QuoteServiceDeps } from "./quote-service-contract.js";

export const quoteLatencyStages = [
  "idempotency",
  "market_data",
  "market_snapshot_persistence",
  "quote_persistence",
  "routing",
  "pricing_inputs",
  "pricing",
  "inventory_projection",
  "risk",
  "treasury_liquidity",
  "indexer_guard",
  "exposure_reservation",
  "risk_persistence",
  "signing",
] as const;

export type QuoteLatencyStage = typeof quoteLatencyStages[number];

export interface QuoteLatencyObserver {
  recordQuoteStageLatency(stage: QuoteLatencyStage, seconds: number): void;
}

export function observeQuoteServiceDependencies(
  deps: QuoteServiceDeps,
  observer: QuoteLatencyObserver,
): QuoteServiceDeps {
  return {
    ...deps,
    marketDataService: observeMethods(deps.marketDataService, { getSnapshot: "market_data" }, observer),
    marketSnapshotStore: observeMethods(
      deps.marketSnapshotStore,
      { saveSnapshot: "market_snapshot_persistence" },
      observer,
    ),
    quoteRepository: observeMethods(deps.quoteRepository, {
      saveRequested: "quote_persistence",
      saveRouteDecision: "quote_persistence",
      saveRejected: "quote_persistence",
      saveSigned: "quote_persistence",
    }, observer),
    routingEngine: observeMethods(deps.routingEngine, { selectRoute: "routing" }, observer),
    inventoryService: observeMethods(deps.inventoryService, {
      calculateQuoteSkewBps: "pricing_inputs",
      projectSettlement: "inventory_projection",
    }, observer),
    pricingEngine: observeMethods(deps.pricingEngine, { price: "pricing" }, observer),
    riskEngine: observeMethods(deps.riskEngine, { evaluate: "risk" }, observer),
    riskDecisionStore: observeMethods(deps.riskDecisionStore, { saveDecision: "risk_persistence" }, observer),
    signerService: observeMethods(deps.signerService, { signQuote: "signing" }, observer),
    ...(deps.hedgeService === undefined ? {} : {
      hedgeService: observeMethods(deps.hedgeService, { quoteRiskPenaltyBps: "pricing_inputs" }, observer),
    }),
    ...(deps.quoteIdempotencyStore === undefined ? {} : {
      quoteIdempotencyStore: observeMethods(deps.quoteIdempotencyStore, {
        acquire: "idempotency",
        bindQuote: "idempotency",
        complete: "idempotency",
        fail: "idempotency",
      }, observer),
    }),
    ...(deps.quoteExposureStore === undefined ? {} : {
      quoteExposureStore: observeMethods(deps.quoteExposureStore, { reserve: "exposure_reservation" }, observer),
    }),
    ...(deps.treasuryLiquidityProvider === undefined ? {} : {
      treasuryLiquidityProvider: observeMethods(
        deps.treasuryLiquidityProvider,
        { getLiquidity: "treasury_liquidity" },
        observer,
      ),
    }),
    ...(deps.settlementIndexerRiskGuard === undefined ? {} : {
      settlementIndexerRiskGuard: observeMethods(
        deps.settlementIndexerRiskGuard,
        { assertQuoteSafe: "indexer_guard" },
        observer,
      ),
    }),
  };
}

function observeMethods<T extends object>(
  dependency: T,
  methodStages: Readonly<Record<string, QuoteLatencyStage>>,
  observer: QuoteLatencyObserver,
): T {
  const observedMethods = new Map<PropertyKey, unknown>();
  return new Proxy(dependency, {
    get(target, property) {
      const value = Reflect.get(target, property, target) as unknown;
      if (typeof value !== "function") return value;
      const cached = observedMethods.get(property);
      if (cached) return cached;
      const methodName = String(property);
      const stage = Object.prototype.hasOwnProperty.call(methodStages, methodName)
        ? methodStages[methodName]
        : undefined;
      const method = stage === undefined
        ? value.bind(target)
        : (...args: unknown[]) => observeCall(observer, stage, () => Reflect.apply(value, target, args));
      observedMethods.set(property, method);
      return method;
    },
  });
}

function observeCall<T>(observer: QuoteLatencyObserver, stage: QuoteLatencyStage, operation: () => T): T {
  const startedAt = performance.now();
  try {
    const result = operation();
    if (isPromiseLike(result)) {
      return result.then(
        (value) => {
          recordLatencyBestEffort(observer, stage, startedAt);
          return value;
        },
        (error: unknown) => {
          recordLatencyBestEffort(observer, stage, startedAt);
          throw error;
        },
      ) as T;
    }
    recordLatencyBestEffort(observer, stage, startedAt);
    return result;
  } catch (error) {
    recordLatencyBestEffort(observer, stage, startedAt);
    throw error;
  }
}

function isPromiseLike<T>(value: T): value is T & PromiseLike<Awaited<T>> {
  return (typeof value === "object" || typeof value === "function") && value !== null &&
    typeof (value as { then?: unknown }).then === "function";
}

function recordLatencyBestEffort(
  observer: QuoteLatencyObserver,
  stage: QuoteLatencyStage,
  startedAt: number,
): void {
  try {
    observer.recordQuoteStageLatency(stage, (performance.now() - startedAt) / 1_000);
  } catch {
    // Metrics must not change quote-path availability.
  }
}
