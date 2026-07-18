import Fastify from "fastify";
import { SkeletonExecutionService } from "../modules/execution/execution.service.js";
import { endPool } from "../db/pool.js";
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
import { createSignerRuntime, readSignerRuntimeConfig } from "../modules/signer/signer-runtime.js";
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
  readGatewayServerSettings,
  resolveApiKeyAuthenticator,
  resolvePostgresPool,
  resolveRateLimiter,
  resolveSubmitReservationStore,
  type BuildServerOptions,
} from "./gateway-runtime.js";
import {
  buildDefaultRiskEngine,
  buildRuntimeBinanceSymbolRulesHealth,
  buildMarketReadinessConfig,
  assertProductionUsdReferenceRiskPolicy,
  readTokenRegistry,
  resolveQuoteExposureStore,
  resolvePricingRuntime,
} from "./market-runtime.js";
import { buildGatewayMarketDataRuntime } from "./gateway-market-data.js";
import { buildGatewayHedgeRiskRuntime } from "./gateway-hedge-risk.js";
import {
  assertProductionDailyLossRiskPolicy,
} from "./gateway-daily-loss-risk.js";
import { structuredLoggerConfig } from "../shared/logger/structured-logger.js";
import { resolveGatewayQuoteExposureRuntime } from "./gateway-quote-exposure.js";
import { closeGatewayResources } from "./gateway-resource-cleanup.js";
import { buildGatewayTreasuryLiquidityRuntime } from "./gateway-treasury-liquidity.js";
import { resolveGatewayQuoteIssuance } from "./gateway-quote-issuance.js";
import {
  buildGatewayCoreHotStateRuntime,
  registerGatewayHotStateLifecycles,
} from "./gateway-hot-state.js";
import { buildGatewayRiskRuntime } from "./gateway-risk-runtime.js";
export type { BuildServerOptions } from "./gateway-runtime.js";
export { closeGatewayResources } from "./gateway-resource-cleanup.js";
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
  const coreHotState = buildGatewayCoreHotStateRuntime({
    quoteControlStore: options.quoteControlStore,
    toxicFlowScoreStore: options.toxicFlowScoreStore,
    pool: postgresPool,
    observer: metricsService,
    settlementIndexerRiskGuard: options.settlementIndexerRiskGuard,
    logger: server.log,
  });
  const { config: hotStateConfig, settlementIndexerRiskGuard } = coreHotState;
  const quoteControlRuntime = coreHotState.quoteControl;
  const quoteControlStore = quoteControlRuntime.store;
  const toxicFlowRuntime = coreHotState.toxicFlow;
  const toxicFlowScoreStore = toxicFlowRuntime.store;
  const durableMarketSnapshotStore = options.marketSnapshotStore ?? (
    postgresPool ? new PostgresMarketSnapshotStore(postgresPool) : new InMemoryMarketSnapshotRepository()
  );
  const quoteRepository = options.quoteRepository ?? (
    postgresPool ? new PostgresQuoteRepository(postgresPool) : new InMemoryQuoteRepository()
  );
  const quoteIssuance = resolveGatewayQuoteIssuance(
    options, postgresPool, quoteIdempotencyLeaseMs, metricsService, server.log,
  );
  const { quoteIdempotencyStore, quoteIssuanceStore, runtime: quoteIssuanceRuntime } = quoteIssuance;
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
  const hedgeRiskRuntime = buildGatewayHedgeRiskRuntime(
    options.hedgeService, postgresPool, managedRiskPairs, hotStateConfig, server.log, metricsService,
  );
  const hedgeService = hedgeRiskRuntime.service;
  const hedgeRouteRulesHealth = options.hedgeRouteRulesHealth ??
    buildRuntimeBinanceSymbolRulesHealth(cexPairs);
  const defaultRiskEngine = options.riskEngine === undefined
    ? buildDefaultRiskEngine(runtimeTokenRegistry, managedRiskPairs)
    : undefined;
  const riskRuntime = buildGatewayRiskRuntime({
    configured: options.riskEngine,
    defaultEngine: defaultRiskEngine,
    toxicFlowScoreStore,
    tokenRegistry: runtimeTokenRegistry,
    managedPairs: managedRiskPairs,
    pool: postgresPool,
    hotStateConfig,
    observer: metricsService,
    logger: server.log,
  });
  const riskEngine = riskRuntime.engine;
  const postgresInventoryService = postgresPool ? new PostgresInventoryService(postgresPool) : undefined;
  const inMemoryInventoryService = postgresPool ? undefined : new InventoryService();
  const inventoryService: IInventoryService = postgresInventoryService ?? inMemoryInventoryService!;
  const treasuryLiquidityRuntime = buildGatewayTreasuryLiquidityRuntime(
    options.treasuryLiquidityProvider, managedRiskPairs, server.log,
  );
  const treasuryLiquidityProvider = treasuryLiquidityRuntime.provider;
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
  const pnlValuationProvider = new QuoteSnapshotPnlValuationProvider(
    durableMarketSnapshotStore,
    runtimeTokenRegistry,
  );
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
  marketRuntime.assertProductionPolicy();
  assertProductionUsdReferenceRiskPolicy(options.riskEngine === undefined);
  assertProductionDailyLossRiskPolicy(options.riskEngine === undefined, postgresPool);
  const quoteExposure = resolveGatewayQuoteExposureRuntime({
    configuredStore: options.quoteExposureStore,
    pool: postgresPool,
    policy: defaultRiskEngine?.getQuoteExposurePolicy(),
    tokenRegistry: runtimeTokenRegistry,
    canonicalInventoryService: inventoryService,
    durableMarketSnapshotStore,
    managedPairs: managedRiskPairs,
    metrics: metricsService,
    logger: server.log,
    asynchronousQuoteIssuance: quoteIssuanceRuntime?.asynchronousProjection === true,
    quoteProjectionBarrier: quoteIssuanceRuntime,
    resolveFallback: (state) => resolveQuoteExposureStore(
      options.quoteExposureStore, postgresPool, defaultRiskEngine, runtimeTokenRegistry, state, metricsService,
    ),
  });
  const {
    inventoryService: quoteInventoryService,
    marketSnapshotStore,
    quoteExposureStore,
    runtime: redisQuoteExposureRuntime,
  } = quoteExposure;
  const quoteService = new QuoteService(observeQuoteServiceDependencies({
    inventoryService: quoteInventoryService,
    marketDataService,
    marketSnapshotStore,
    hedgeService: hedgeRiskRuntime.quoteRiskProvider,
    pricingEngine,
    quoteIdempotencyStore,
    ...(quoteIssuanceStore ? { quoteIssuanceStore } : {}),
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
  const marketBackgroundRuntime = marketRuntime.startBackgroundTasks(marketSnapshotStore, postgresPool !== undefined);
  if (marketBackgroundRuntime) server.addHook("onReady", () => marketBackgroundRuntime.start());
  const hotStateClosers = registerGatewayHotStateLifecycles(server, [
    quoteControlRuntime.lifecycle,
    toxicFlowRuntime.lifecycle,
    hedgeRiskRuntime.lifecycle,
    riskRuntime.lifecycle,
    coreHotState.settlementIndexerLifecycle,
  ]);
  if (quoteIssuanceRuntime) server.addHook("onReady", () => quoteIssuanceRuntime.start());
  if (redisQuoteExposureRuntime) server.addHook("onReady", () => redisQuoteExposureRuntime.start());
  if (treasuryLiquidityRuntime.start) {
    server.addHook("onReady", () => treasuryLiquidityRuntime.start!());
  }
  if (postgresSettlementEventStore) {
    server.addHook("onReady", async () => {
      await postgresSettlementEventStore.initialize();
    });
  }
  server.addHook("onClose", async () => {
    await closeGatewayResources([
      ...(marketBackgroundRuntime ? [() => marketBackgroundRuntime.stop()] : []),
      ...hotStateClosers,
      ...(quoteIssuanceRuntime ? [() => quoteIssuanceRuntime.close()] : []),
      ...(redisQuoteExposureRuntime ? [() => redisQuoteExposureRuntime.close()] : []),
      ...(treasuryLiquidityRuntime.stop ? [() => treasuryLiquidityRuntime.stop!()] : []),
      ...(rateLimiter?.close ? [() => rateLimiter.close!()] : []),
      ...(defaultSignerRuntime?.close ? [() => defaultSignerRuntime.close!()] : []),
      ...(ownsPostgresPool ? [() => endPool()] : []),
    ]);
  });

  const readinessService = new ReadinessService({
    hedgeService,
    ...(hedgeRouteRulesHealth ? { hedgeRouteRulesHealth } : {}),
    inventoryService: quoteInventoryService,
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
