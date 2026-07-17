import Fastify from "fastify";
import { SkeletonExecutionService } from "../modules/execution/execution.service.js";
import { endPool } from "../db/pool.js";
import { HedgeService } from "../modules/hedge/hedge.service.js";
import { PostgresHedgeService } from "../modules/hedge/postgres-hedge.service.js";
import { DeltaNeutralHedgePlanner } from "../modules/hedge/hedge-intent-planner.js";
import {
  defaultReadinessServiceConfig,
  ReadinessService,
} from "../modules/health/readiness.service.js";
import { InventoryService, type IInventoryService } from "../modules/inventory/inventory.service.js";
import { PostgresInventoryService } from "../modules/inventory/postgres-inventory.service.js";
import { InMemoryMarketSnapshotRepository } from "../modules/market-data/market-snapshot.repository.js";
import { PostgresMarketSnapshotStore } from "../modules/market-data/postgres-market-snapshot.repository.js";
import { MetricsService } from "../modules/metrics/metrics.service.js";
import { PnlService } from "../modules/pnl/pnl.service.js";
import { PostgresPnlStore } from "../modules/pnl/postgres-pnl.store.js";
import { QuoteSnapshotPnlValuationProvider } from "../modules/pnl/quote-snapshot-valuation.provider.js";
import { InMemoryQuoteRepository } from "../modules/quote/quote.repository.js";
import { PostgresQuoteRepository } from "../modules/quote/postgres-quote.repository.js";
import { defaultQuoteServiceConfig, QuoteService } from "../modules/quote/quote.service.js";
import { observeQuoteServiceDependencies } from "../modules/quote/quote-service-observability.js";
import { InMemoryRiskDecisionRepository } from "../modules/risk/risk-decision.repository.js";
import { PostgresRiskDecisionStore } from "../modules/risk/postgres-risk-decision.repository.js";
import { InternalInventoryRoutingEngine } from "../modules/routing/routing.engine.js";
import { SettlementEventService } from "../modules/settlement/settlement-event.service.js";
import { PostgresSettlementEventStore } from "../modules/settlement/postgres-settlement-event.store.js";
import { LocalSettlementVerifier } from "../modules/settlement/settlement-verifier.service.js";
import { ObservedSignerService } from "../modules/signer/signer.service.js";
import {
  createSignerRuntime,
  readSignerRuntimeConfig,
} from "../modules/signer/signer-runtime.js";
import {
  installGatewayBoundary,
  maxStatusIdentifierRouteParamLength,
} from "../api/http-boundary.js";
import { registerTradingRoutes } from "../api/trading-routes.js";
import { registerQuoteControlRoutes } from "../api/quote-control-routes.js";
import { registerToxicFlowScoreRoutes } from "../api/toxic-flow-score-routes.js";
import {
  buildDefaultSettlementVerifierPolicy,
  buildRuntimeSettlementEvidenceProvider,
  buildRuntimeTreasuryLiquidityProvider,
  readGatewayServerSettings,
  resolveApiKeyAuthenticator,
  resolvePostgresPool,
  resolveQuoteIdempotencyStore,
  resolveQuoteControlStore,
  resolveRateLimiter,
  resolveSubmitReservationStore,
  resolveToxicFlowScoreStore,
  type BuildServerOptions,
} from "./gateway-runtime.js";
import {
  buildDefaultRiskEngine,
  buildRuntimeBinanceSymbolRulesHealth,
  buildMarketReadinessConfig,
  buildUsdReferenceRiskEngine,
  assertProductionUsdReferenceRiskPolicy,
  readDynamicToxicFlowRiskConfig,
  readTokenRegistry,
  resolveQuoteExposureStore,
  resolvePricingRuntime,
} from "./market-runtime.js";
import { buildGatewayMarketDataRuntime } from "./gateway-market-data.js";
import { readGatewayHedgeServiceConfig } from "./gateway-hedge-risk.js";
import {
  assertProductionDailyLossRiskPolicy,
  buildDailyLossRiskEngine,
} from "./gateway-daily-loss-risk.js";
import { buildRuntimeSettlementIndexerRiskGuard } from "./gateway-settlement-indexer-risk.js";
import { DynamicToxicFlowRiskEngine } from "../modules/risk/dynamic-toxic-flow-risk.engine.js";
import { structuredLoggerConfig } from "../shared/logger/structured-logger.js";

export type { BuildServerOptions } from "./gateway-runtime.js";

const disabledRateLimiterHealth = { checkHealth(): void {} };

export function buildServer(options: BuildServerOptions = {}) {
  const {
    bodyLimitBytes,
    corsAllowedOrigins,
    enableHsts,
    logger,
    quoteIdempotencyLeaseMs,
    quoteTtlSeconds,
    requireQuoteIdempotencyKey,
    submitReservationLeaseMs,
    trustProxy,
  } = readGatewayServerSettings(options);
  const server = Fastify({
    logger: logger ? structuredLoggerConfig("rfq-api") : false,
    disableRequestLogging: true,
    bodyLimit: bodyLimitBytes,
    maxParamLength: maxStatusIdentifierRouteParamLength,
  });
  const metricsService = new MetricsService();
  const marketRuntime = buildGatewayMarketDataRuntime(options.marketDataService, metricsService, server.log);
  const {
    cexPairs,
    managedRiskPairs,
    marketDataService,
    maxSnapshotAgeMs,
    pricingPairs,
  } = marketRuntime;
  const signerRuntimeConfig = readSignerRuntimeConfig(undefined, {
    allowExternal: options.signerService !== undefined,
  });
  const defaultSignerRuntime = options.signerService === undefined
    ? createSignerRuntime(signerRuntimeConfig)
    : undefined;
  const signerService = options.signerService ?? defaultSignerRuntime!.service;
  const postgresPool = resolvePostgresPool(options, server.log);
  const ownsPostgresPool = postgresPool !== undefined && options.databasePool === undefined;
  const settlementIndexerRiskGuard = buildRuntimeSettlementIndexerRiskGuard(postgresPool, metricsService);
  const quoteControlStore = resolveQuoteControlStore(options.quoteControlStore, postgresPool);
  const toxicFlowScoreStore = resolveToxicFlowScoreStore(options.toxicFlowScoreStore, postgresPool);
  const hedgeServiceConfig = options.hedgeService === undefined
    ? readGatewayHedgeServiceConfig()
    : undefined;
  const hedgeService = options.hedgeService ?? (
    postgresPool
      ? new PostgresHedgeService(postgresPool, hedgeServiceConfig!)
      : new HedgeService(hedgeServiceConfig!)
  );
  const marketSnapshotStore = options.marketSnapshotStore ?? (
    postgresPool ? new PostgresMarketSnapshotStore(postgresPool) : new InMemoryMarketSnapshotRepository()
  );
  const quoteRepository = options.quoteRepository ?? (
    postgresPool ? new PostgresQuoteRepository(postgresPool) : new InMemoryQuoteRepository()
  );
  const quoteIdempotencyStore = resolveQuoteIdempotencyStore(
    options.quoteIdempotencyStore,
    postgresPool,
    quoteIdempotencyLeaseMs,
  );
  const riskDecisionStore = options.riskDecisionStore ?? (
    postgresPool ? new PostgresRiskDecisionStore(postgresPool) : new InMemoryRiskDecisionRepository()
  );
  const routingEngine = options.routingEngine ?? new InternalInventoryRoutingEngine();
  const pricingRuntime = resolvePricingRuntime(
    options.pricingEngine,
    options.tokenRegistry,
    pricingPairs,
    cexPairs,
    metricsService,
  );
  const pricingEngine = pricingRuntime.engine;
  const runtimeTokenRegistry = options.tokenRegistry ?? pricingRuntime.tokenRegistry ?? readTokenRegistry();
  const hedgeRouteRulesHealth = options.hedgeRouteRulesHealth ??
    buildRuntimeBinanceSymbolRulesHealth(cexPairs);
  const defaultRiskEngine = options.riskEngine === undefined
    ? buildDefaultRiskEngine(runtimeTokenRegistry, managedRiskPairs)
    : undefined;
  const riskEngine = options.riskEngine ?? buildDailyLossRiskEngine(
    buildUsdReferenceRiskEngine(
      new DynamicToxicFlowRiskEngine(
        defaultRiskEngine!,
        toxicFlowScoreStore,
        readDynamicToxicFlowRiskConfig(defaultRiskEngine!.getMaxToxicScoreBps()),
      ),
      runtimeTokenRegistry,
      managedRiskPairs,
      undefined,
      metricsService,
    ),
    runtimeTokenRegistry,
    managedRiskPairs,
    postgresPool,
    undefined,
    metricsService,
  );
  const postgresInventoryService = postgresPool ? new PostgresInventoryService(postgresPool) : undefined;
  const inMemoryInventoryService = postgresPool ? undefined : new InventoryService();
  const inventoryService: IInventoryService = postgresInventoryService ?? inMemoryInventoryService!;
  const quoteExposureStore = resolveQuoteExposureStore(
    options.quoteExposureStore,
    postgresPool,
    defaultRiskEngine,
    runtimeTokenRegistry,
    { inventoryService, marketSnapshotStore },
    metricsService,
  );
  const treasuryLiquidityProvider = options.treasuryLiquidityProvider ??
    buildRuntimeTreasuryLiquidityProvider();
  const postgresSettlementEventStore = postgresPool && options.settlementEventService === undefined
    ? new PostgresSettlementEventStore(postgresPool, postgresInventoryService!)
    : undefined;
  const settlementEventService = options.settlementEventService ??
    postgresSettlementEventStore ?? new SettlementEventService(inMemoryInventoryService!);
  const executionService = new SkeletonExecutionService({
    hedgeService,
    inventoryService,
    settlementEventService,
    settlementVerifier: options.settlementVerifier ?? new LocalSettlementVerifier(
      buildDefaultSettlementVerifierPolicy(signerRuntimeConfig, managedRiskPairs),
    ),
  }, options.settlementEvidenceProvider ?? buildRuntimeSettlementEvidenceProvider(signerRuntimeConfig.settlementAddress),
  new DeltaNeutralHedgePlanner(runtimeTokenRegistry));
  const pnlValuationProvider = new QuoteSnapshotPnlValuationProvider(marketSnapshotStore, runtimeTokenRegistry);
  const pnlService = options.pnlService ?? (
    postgresPool
      ? new PostgresPnlStore(postgresPool, pnlValuationProvider)
      : new PnlService(pnlValuationProvider, quoteRepository)
  );
  const submitReservationStore = resolveSubmitReservationStore(
    options.submitReservationStore,
    postgresPool,
    submitReservationLeaseMs,
  );
  const rateLimiter = resolveRateLimiter(options);
  const apiKeyAuthenticator = resolveApiKeyAuthenticator(options);
  const authenticatedPrincipals = installGatewayBoundary(server, {
    allowedOrigins: corsAllowedOrigins,
    apiKeyAuthenticator,
    enableHsts,
    metricsService,
  });
  const quoteService = new QuoteService(observeQuoteServiceDependencies({
    inventoryService,
    marketDataService,
    marketSnapshotStore,
    hedgeService,
    pricingEngine,
    quoteIdempotencyStore,
    quoteExposureStore,
    quoteRepository,
    riskDecisionStore,
    riskEngine,
    routingEngine,
    settlementIndexerRiskGuard,
    signerService: new ObservedSignerService(signerService, metricsService),
    treasuryLiquidityProvider,
  }, metricsService), {
    ...defaultQuoteServiceConfig,
    maxSnapshotAgeMs,
    quoteTtlSeconds,
  });
  marketRuntime.assertProductionPolicy();
  assertProductionUsdReferenceRiskPolicy(options.riskEngine === undefined);
  assertProductionDailyLossRiskPolicy(options.riskEngine === undefined, postgresPool);
  const stopMarketBackgroundTasks = marketRuntime.startBackgroundTasks(
    marketSnapshotStore,
    postgresPool !== undefined,
  );
  if (postgresSettlementEventStore) {
    server.addHook("onReady", async () => {
      await postgresSettlementEventStore.initialize();
    });
  }
  server.addHook("onClose", async () => {
    await closeGatewayResources([
      ...(stopMarketBackgroundTasks ? [stopMarketBackgroundTasks] : []),
      ...(rateLimiter?.close ? [() => rateLimiter.close!()] : []),
      ...(defaultSignerRuntime?.close ? [() => defaultSignerRuntime.close!()] : []),
      ...(ownsPostgresPool ? [() => endPool()] : []),
    ]);
  });

  const readinessService = new ReadinessService({
    hedgeService,
    ...(hedgeRouteRulesHealth ? { hedgeRouteRulesHealth } : {}),
    inventoryService,
    marketDataService,
    marketSnapshotStore,
    metricsService,
    pnlService,
    pricingEngine,
    quoteIdempotencyStore,
    quoteExposureStore,
    quoteRepository,
    quoteControlStore,
    riskDecisionStore,
    riskEngine,
    settlementIndexerRiskGuard,
    toxicFlowScoreStore,
    rateLimiter: rateLimiter ?? disabledRateLimiterHealth,
    routingEngine,
    settlementEventService,
    signerService,
    submitReservationStore,
    treasuryLiquidityProvider,
  }, marketRuntime.readinessPair
    ? buildMarketReadinessConfig(marketRuntime.readinessPair, runtimeTokenRegistry, maxSnapshotAgeMs)
    : defaultReadinessServiceConfig);

  registerTradingRoutes(server, {
    authenticatedPrincipals,
    corsAllowedOrigins,
    executionService,
    hedgeService,
    metricsService,
    pnlService,
    quoteRepository,
    quoteControlStore,
    quoteService,
    rateLimiter,
    readinessService,
    requireQuoteIdempotencyKey,
    settlementEventService,
    submitReservationStore,
    trustProxy,
  });
  registerQuoteControlRoutes(server, {
    authenticatedPrincipals,
    metricsService,
    quoteControlStore,
    rateLimiter,
    trustProxy,
  });
  registerToxicFlowScoreRoutes(server, {
    authenticatedPrincipals,
    metricsService,
    rateLimiter,
    toxicFlowScoreStore,
    trustProxy,
  });

  return server;
}

export async function closeGatewayResources(
  closers: readonly (() => void | Promise<void>)[],
): Promise<void> {
  let firstError: unknown;
  let failed = false;
  for (const close of closers) {
    try {
      await close();
    } catch (error) {
      if (!failed) firstError = error;
      failed = true;
    }
  }
  if (failed) throw firstError;
}
