import Fastify from "fastify";
import { SkeletonExecutionService } from "./modules/execution/execution.service.js";
import { endPool } from "./db/pool.js";
import { HedgeService } from "./modules/hedge/hedge.service.js";
import { PostgresHedgeService } from "./modules/hedge/postgres-hedge.service.js";
import { DeltaNeutralHedgePlanner } from "./modules/hedge/hedge-intent-planner.js";
import {
  defaultReadinessServiceConfig,
  ReadinessService,
} from "./modules/health/readiness.service.js";
import { InventoryService, type IInventoryService } from "./modules/inventory/inventory.service.js";
import { PostgresInventoryService } from "./modules/inventory/postgres-inventory.service.js";
import { InMemoryMarketSnapshotRepository } from "./modules/market-data/market-snapshot.repository.js";
import { PostgresMarketSnapshotStore } from "./modules/market-data/postgres-market-snapshot.repository.js";
import { CachedMarketDataService } from "./modules/market-data/cached-market-data.service.js";
import { SharedPriceCache } from "./modules/market-data/price-cache.js";
import { BackgroundPriceUpdater } from "./modules/market-data/price-updater.js";
import {
  BackgroundMarketSnapshotSampler,
  buildMarketSnapshotSamplingPairs,
  defaultMarketSnapshotSampleIntervalMs,
} from "./modules/market-data/market-snapshot-sampler.js";
import { CEXOrderBookMonitor } from "./modules/market-data/cex-orderbook/cex-orderbook-monitor.js";
import { MetricsService } from "./modules/metrics/metrics.service.js";
import { PnlService } from "./modules/pnl/pnl.service.js";
import { PostgresPnlStore } from "./modules/pnl/postgres-pnl.store.js";
import { QuoteSnapshotPnlValuationProvider } from "./modules/pnl/quote-snapshot-valuation.provider.js";
import { InMemoryQuoteRepository } from "./modules/quote/quote.repository.js";
import { PostgresQuoteRepository } from "./modules/quote/postgres-quote.repository.js";
import { defaultQuoteServiceConfig, QuoteService } from "./modules/quote/quote.service.js";
import { InMemoryRiskDecisionRepository } from "./modules/risk/risk-decision.repository.js";
import { PostgresRiskDecisionStore } from "./modules/risk/postgres-risk-decision.repository.js";
import { InternalInventoryRoutingEngine } from "./modules/routing/routing.engine.js";
import { SettlementEventService } from "./modules/settlement/settlement-event.service.js";
import { PostgresSettlementEventStore } from "./modules/settlement/postgres-settlement-event.store.js";
import { LocalSettlementVerifier } from "./modules/settlement/settlement-verifier.service.js";
import { ObservedSignerService } from "./modules/signer/signer.service.js";
import {
  createSignerRuntime,
  readSignerRuntimeConfig,
} from "./modules/signer/signer-runtime.js";
import {
  installGatewayBoundary,
  maxStatusIdentifierRouteParamLength,
} from "./api/http-boundary.js";
import { registerTradingRoutes } from "./api/trading-routes.js";
import { registerQuoteControlRoutes } from "./api/quote-control-routes.js";
import { registerToxicFlowScoreRoutes } from "./api/toxic-flow-score-routes.js";
import {
  buildDefaultSettlementVerifierPolicy,
  buildRuntimeSettlementEvidenceProvider,
  buildRuntimeTreasuryLiquidityProvider,
  readGatewayServerSettings,
  resolveApiKeyAuthenticator,
  resolvePostgresPool,
  resolveQuoteControlStore,
  resolveRateLimiter,
  resolveSubmitReservationStore,
  resolveToxicFlowScoreStore,
  type BuildServerOptions,
} from "./runtime/gateway-runtime.js";
import {
  buildDefaultRiskEngine,
  buildRequiredCexCacheKeys,
  buildMarketReadinessConfig,
  readCexOrderBookConfig,
  readCexOrderBookPairs,
  readDefaultMarketDataRuntime,
  readMarketDataPairs,
  readDynamicToxicFlowRiskConfig,
  readTokenRegistry,
  resolveQuoteExposureStore,
  resolvePricingRuntime,
} from "./runtime/market-runtime.js";
import { DynamicToxicFlowRiskEngine } from "./modules/risk/dynamic-toxic-flow-risk.engine.js";
import {
  installGracefulShutdown,
  readServerListenConfig,
  runtimeProcess,
} from "./runtime/server-process.js";

export { installGracefulShutdown, readServerListenConfig } from "./runtime/server-process.js";
export type { BuildServerOptions } from "./runtime/gateway-runtime.js";

const disabledRateLimiterHealth = { checkHealth(): void {} };

export function buildServer(options: BuildServerOptions = {}) {
  const {
    bodyLimitBytes,
    corsAllowedOrigins,
    enableHsts,
    logger,
    quoteTtlSeconds,
    submitReservationLeaseMs,
    trustProxy,
  } = readGatewayServerSettings(options);
  const server = Fastify({
    logger,
    bodyLimit: bodyLimitBytes,
    maxParamLength: maxStatusIdentifierRouteParamLength,
  });
  const metricsService = new MetricsService();

  const defaultMarketData = options.marketDataService ? undefined : readDefaultMarketDataRuntime();
  const rawMarketDataService = options.marketDataService ?? defaultMarketData!.service;
  const cexPairs = defaultMarketData ? readCexOrderBookPairs() : [];
  const cexConfig = cexPairs.length > 0 ? readCexOrderBookConfig(cexPairs) : undefined;
  const priceUpdaterPairs = defaultMarketData ? readMarketDataPairs(defaultMarketData.defaultPairs) : [];
  const managedRiskPairs = [...(defaultMarketData?.defaultPairs ?? []), ...priceUpdaterPairs, ...cexPairs];
  const basePriceCache = defaultMarketData ? new SharedPriceCache(5_000) : undefined;
  const cexPriceCache = cexConfig ? new SharedPriceCache(cexConfig.monitor.maxSourceAgeMs) : undefined;
  const requiredCexCacheKeys = buildRequiredCexCacheKeys(cexPairs, cexConfig?.requireLiveBook ?? false);
  const marketDataService = defaultMarketData && basePriceCache
    ? new CachedMarketDataService(
        rawMarketDataService,
        cexPriceCache ? [cexPriceCache, basePriceCache] : [basePriceCache],
        metricsService,
        requiredCexCacheKeys,
      )
    : rawMarketDataService;
  const maxSnapshotAgeMs = defaultMarketData?.maxSnapshotAgeMs ?? defaultQuoteServiceConfig.maxSnapshotAgeMs;
  const signerRuntimeConfig = readSignerRuntimeConfig(undefined, {
    allowExternal: options.signerService !== undefined,
  });
  const defaultSignerRuntime = options.signerService === undefined
    ? createSignerRuntime(signerRuntimeConfig)
    : undefined;
  const signerService = options.signerService ?? defaultSignerRuntime!.service;
  const postgresPool = resolvePostgresPool(options);
  const ownsPostgresPool = postgresPool !== undefined && options.databasePool === undefined;
  const quoteControlStore = resolveQuoteControlStore(options.quoteControlStore, postgresPool);
  const toxicFlowScoreStore = resolveToxicFlowScoreStore(options.toxicFlowScoreStore, postgresPool);
  const hedgeService = options.hedgeService ?? (
    postgresPool ? new PostgresHedgeService(postgresPool) : new HedgeService()
  );
  const marketSnapshotStore = options.marketSnapshotStore ?? (
    postgresPool ? new PostgresMarketSnapshotStore(postgresPool) : new InMemoryMarketSnapshotRepository()
  );
  const quoteRepository = options.quoteRepository ?? (
    postgresPool ? new PostgresQuoteRepository(postgresPool) : new InMemoryQuoteRepository()
  );
  const riskDecisionStore = options.riskDecisionStore ?? (
    postgresPool ? new PostgresRiskDecisionStore(postgresPool) : new InMemoryRiskDecisionRepository()
  );
  const routingEngine = options.routingEngine ?? new InternalInventoryRoutingEngine();
  const pricingRuntime = resolvePricingRuntime(
    options.pricingEngine,
    options.tokenRegistry,
    [...(defaultMarketData?.defaultPairs ?? []), ...priceUpdaterPairs],
    cexPairs,
  );
  const pricingEngine = pricingRuntime.engine;
  const runtimeTokenRegistry = options.tokenRegistry ?? pricingRuntime.tokenRegistry ?? readTokenRegistry();
  const defaultRiskEngine = options.riskEngine === undefined
    ? buildDefaultRiskEngine(runtimeTokenRegistry, managedRiskPairs)
    : undefined;
  const riskEngine = options.riskEngine ?? new DynamicToxicFlowRiskEngine(
    defaultRiskEngine!,
    toxicFlowScoreStore,
    readDynamicToxicFlowRiskConfig(defaultRiskEngine!.getMaxToxicScoreBps()),
  );
  const quoteExposureStore = resolveQuoteExposureStore(
    options.quoteExposureStore,
    postgresPool,
    defaultRiskEngine,
    runtimeTokenRegistry,
  );
  const treasuryLiquidityProvider = options.treasuryLiquidityProvider ??
    buildRuntimeTreasuryLiquidityProvider();
  const postgresInventoryService = postgresPool ? new PostgresInventoryService(postgresPool) : undefined;
  const inMemoryInventoryService = postgresPool ? undefined : new InventoryService();
  const inventoryService: IInventoryService = postgresInventoryService ?? inMemoryInventoryService!;
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
      buildDefaultSettlementVerifierPolicy(signerRuntimeConfig),
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
  const quoteService = new QuoteService({
    inventoryService,
    marketDataService,
    marketSnapshotStore,
    hedgeService,
    pricingEngine,
    quoteExposureStore,
    quoteRepository,
    riskDecisionStore,
    riskEngine,
    routingEngine,
    signerService: new ObservedSignerService(signerService, metricsService),
    treasuryLiquidityProvider,
  }, {
    ...defaultQuoteServiceConfig,
    maxSnapshotAgeMs,
    quoteTtlSeconds,
  });
  // Start background price updater for managed pairs (only when using default service)
  const priceUpdater = defaultMarketData && basePriceCache && priceUpdaterPairs.length > 0
    ? new BackgroundPriceUpdater(rawMarketDataService, basePriceCache, {
        pairs: priceUpdaterPairs,
        intervalMs: 250,
        maxAgeMs: 5_000,
      })
    : undefined;

  // Start CEX order book monitor (only when using default service)
  const cexMonitor = defaultMarketData && cexPriceCache && cexConfig
    ? new CEXOrderBookMonitor(cexPriceCache, cexConfig.monitor, metricsService)
    : undefined;
  const snapshotSamplerCaches = cexPriceCache && basePriceCache
    ? [cexPriceCache, basePriceCache]
    : basePriceCache ? [basePriceCache] : [];
  const snapshotSampler = defaultMarketData && postgresPool && snapshotSamplerCaches.length > 0
    ? new BackgroundMarketSnapshotSampler(marketSnapshotStore, {
        pairs: buildMarketSnapshotSamplingPairs(priceUpdaterPairs, cexPairs),
        caches: snapshotSamplerCaches,
        requiredPrimaryCacheKeys: requiredCexCacheKeys,
        intervalMs: defaultMarketSnapshotSampleIntervalMs,
      })
    : undefined;
  priceUpdater?.start();
  cexMonitor?.start();
  snapshotSampler?.start();
  if (priceUpdater || cexMonitor || snapshotSampler) {
    server.addHook("onClose", async () => {
      priceUpdater?.stop();
      cexMonitor?.stop();
      snapshotSampler?.stop();
    });
  }
  if (ownsPostgresPool) {
    server.addHook("onClose", async () => {
      await endPool();
    });
  }
  if (postgresSettlementEventStore) {
    server.addHook("onReady", async () => {
      await postgresSettlementEventStore.initialize();
    });
  }
  if (rateLimiter?.close) {
    server.addHook("onClose", async () => {
      await rateLimiter.close?.();
    });
  }
  if (defaultSignerRuntime?.close) {
    server.addHook("onClose", async () => {
      await defaultSignerRuntime.close?.();
    });
  }

  const readinessPair = cexConfig?.requireLiveBook && cexPairs[0]
    ? { ...cexPairs[0], user: "0x0000000000000000000000000000000000000001" as const }
    : priceUpdaterPairs[0];
  const readinessService = new ReadinessService({
    hedgeService,
    inventoryService,
    marketDataService,
    marketSnapshotStore,
    metricsService,
    pnlService,
    pricingEngine,
    quoteExposureStore,
    quoteRepository,
    quoteControlStore,
    riskDecisionStore,
    riskEngine,
    toxicFlowScoreStore,
    rateLimiter: rateLimiter ?? disabledRateLimiterHealth,
    routingEngine,
    settlementEventService,
    signerService,
    submitReservationStore,
    treasuryLiquidityProvider,
  }, defaultMarketData && readinessPair
    ? buildMarketReadinessConfig(readinessPair, runtimeTokenRegistry, maxSnapshotAgeMs)
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

export async function startServer() {
  const server = buildServer();
  const processLike = runtimeProcess();
  const { host, port } = readServerListenConfig(processLike);
  await server.listen({ host, port });
  installGracefulShutdown(server, processLike);
  return server;
}

const processLike = runtimeProcess();

if (processLike?.argv?.[1] && import.meta.url.endsWith(processLike.argv[1])) {
  startServer().catch((error: unknown) => {
    console.error(error);
    if (processLike) {
      processLike.exitCode = 1;
    }
  });
}
