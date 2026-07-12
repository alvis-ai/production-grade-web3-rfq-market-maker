import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import type pg from "pg";
import { privateKeyToAccount } from "viem/accounts";
import {
  SkeletonExecutionService,
  type SettlementEvidenceProvider,
} from "./modules/execution/execution.service.js";
import {
  parseReceiptExecutionConfig,
  RuntimeSettlementEvidenceProvider,
} from "./modules/execution/receipt-settlement-evidence.provider.js";
import { getPool, endPool } from "./db/pool.js";
import { HedgeService, type HedgeIntentService } from "./modules/hedge/hedge.service.js";
import { PostgresHedgeService } from "./modules/hedge/postgres-hedge.service.js";
import {
  defaultReadinessServiceConfig,
  ReadinessService,
  type ReadinessServiceConfig,
} from "./modules/health/readiness.service.js";
import { InventoryService, type IInventoryService } from "./modules/inventory/inventory.service.js";
import { PostgresInventoryService } from "./modules/inventory/postgres-inventory.service.js";
import { StaticMarketDataService, type MarketDataService } from "./modules/market-data/market-data.service.js";
import { InMemoryMarketSnapshotRepository, type MarketSnapshotStore } from "./modules/market-data/market-snapshot.repository.js";
import { PostgresMarketSnapshotStore } from "./modules/market-data/postgres-market-snapshot.repository.js";
import { CachedMarketDataService } from "./modules/market-data/cached-market-data.service.js";
import { SharedPriceCache } from "./modules/market-data/price-cache.js";
import { BackgroundPriceUpdater } from "./modules/market-data/price-updater.js";
import { CEXOrderBookMonitor } from "./modules/market-data/cex-orderbook/cex-orderbook-monitor.js";
import type { OrderBookPairConfig } from "./modules/market-data/cex-orderbook/orderbook.js";
import { ChainlinkMarketDataService } from "./modules/market-data/chainlink-market-data.service.js";
import {
  chainlinkConfiguredPairs,
  parseChainlinkMarketDataConfig,
  type ChainlinkMarketDataConfig,
} from "./modules/market-data/chainlink-config.js";
import { MetricsService } from "./modules/metrics/metrics.service.js";
import { PnlService, type PnlStore, type RecordPnlInput } from "./modules/pnl/pnl.service.js";
import { PostgresPnlStore } from "./modules/pnl/postgres-pnl.store.js";
import {
  defaultFormulaPricingConfig,
  FormulaPricingEngine,
  type PricingEngine,
} from "./modules/pricing/pricing.engine.js";
import {
  ConfiguredTokenRegistry,
  defaultTokenRegistryConfig,
  parseTokenRegistryConfig,
  requireTokenMetadata,
  type TokenRegistry,
} from "./modules/pricing/token-registry.js";
import { InMemoryQuoteRepository, type QuoteRepository } from "./modules/quote/quote.repository.js";
import { PostgresQuoteRepository } from "./modules/quote/postgres-quote.repository.js";
import { defaultQuoteServiceConfig, QuoteService } from "./modules/quote/quote.service.js";
import {
  InMemoryRateLimiter,
  maxRateLimitClientIdLength,
  rateLimitClientIdPattern,
  type RateLimitConfig,
  type RateLimiter,
  type RateLimitedEndpoint,
} from "./modules/rate-limit/rate-limit.service.js";
import {
  createRedisRateLimitClient,
  RedisRateLimiter,
} from "./modules/rate-limit/redis-rate-limit.service.js";
import { InMemoryRiskDecisionRepository, type RiskDecisionStore } from "./modules/risk/risk-decision.repository.js";
import { PostgresRiskDecisionStore } from "./modules/risk/postgres-risk-decision.repository.js";
import { BasicRiskEngine, type RiskEngine } from "./modules/risk/risk.engine.js";
import { InternalInventoryRoutingEngine, type RoutingEngine } from "./modules/routing/routing.engine.js";
import { SettlementEventService, type SettlementEventStore } from "./modules/settlement/settlement-event.service.js";
import { PostgresSettlementEventStore } from "./modules/settlement/postgres-settlement-event.store.js";
import {
  defaultLocalSettlementVerifierPolicy,
  LocalSettlementVerifier,
  type LocalSettlementVerifierPolicy,
  type SettlementVerifier,
} from "./modules/settlement/settlement-verifier.service.js";
import {
  LocalEIP712SignerService,
  ObservedSignerService,
  type LocalEIP712SignerConfig,
  type SignerService,
} from "./modules/signer/signer.service.js";
import { APIError, toAPIError } from "./shared/errors/api-error.js";
import { validateQuoteRequest } from "./shared/validation/quote-request.js";
import { validateSubmitQuoteRequest } from "./shared/validation/submit-request.js";
import { isCanonicalUtcIsoTimestamp } from "./shared/validation/timestamp.js";
import { defaultStaticMarketDataConfig } from "./modules/market-data/market-data.service.js";
import { simulatedPnlModelDescription } from "./shared/types/rfq.js";
import type { PnlTradeRecord } from "./shared/types/rfq.js";

const defaultBodyLimitBytes = 32_768;
const defaultCorsAllowedOrigins = ["http://localhost:5173"];
const defaultEnableHsts = false;
const defaultListenHost = "127.0.0.1";
const defaultListenPort = 3000;
const defaultTrustProxy = false;
const disabledRateLimiterHealth = { checkHealth(): void {} };
const maxTraceIdLength = 128;
const traceIdPattern = /^tr_[A-Za-z0-9._:-]+$/;
const maxStatusIdentifierLength = 128;
const maxStatusIdentifierRouteParamLength = maxStatusIdentifierLength + 1;
const statusIdentifierPattern = /^[A-Za-z0-9_:-]+$/;
const retryableSettlementEvidenceReasonCodes = new Set([
  "SETTLEMENT_SENDER_MISMATCH",
  "SETTLEMENT_TARGET_MISMATCH",
  "SETTLEMENT_CALLDATA_MISMATCH",
  "QUOTE_SETTLED_EVENT_MISSING",
  "QUOTE_SETTLED_EVENT_AMBIGUOUS",
]);
const buildServerOptionFields = [
  "bodyLimitBytes",
  "corsAllowedOrigins",
  "databasePool",
  "enableHsts",
  "hedgeService",
  "logger",
  "marketDataService",
  "marketSnapshotStore",
  "pnlService",
  "pricingEngine",
  "quoteRepository",
  "quoteTtlSeconds",
  "rateLimit",
  "rateLimiter",
  "riskDecisionStore",
  "riskEngine",
  "routingEngine",
  "settlementEvidenceProvider",
  "settlementEventService",
  "settlementVerifier",
  "signerService",
  "tokenRegistry",
  "trustProxy",
] as const;
const rateLimitOptionFields = ["windowMs", "maxQuoteRequests", "maxSubmitRequests", "maxStatusRequests"] as const;
const rateLimitDecisionFields = ["allowed", "remaining", "retryAfterSeconds"] as const;
const pnlTradeRecordFields = [
  "pnlId",
  "quoteId",
  "chainId",
  "user",
  "tokenIn",
  "tokenOut",
  "amountIn",
  "amountOut",
  "minAmountOut",
  "nonce",
  "deadline",
  "grossPnlTokenOut",
  "grossPnlBps",
  "model",
  "modelDescription",
  "realizedAt",
] as const;

interface RuntimeProcess {
  argv?: string[];
  env?: Record<string, string | undefined>;
  exitCode?: number;
  on?: (signal: "SIGTERM" | "SIGINT", listener: () => void) => unknown;
}

interface ShutdownLogger {
  error: (...input: unknown[]) => void;
}

export interface BuildServerOptions {
  logger?: boolean;
  databasePool?: pg.Pool;
  marketDataService?: MarketDataService;
  marketSnapshotStore?: MarketSnapshotStore;
  pricingEngine?: PricingEngine;
  quoteRepository?: QuoteRepository;
  riskDecisionStore?: RiskDecisionStore;
  riskEngine?: RiskEngine;
  routingEngine?: RoutingEngine;
  settlementEvidenceProvider?: SettlementEvidenceProvider;
  hedgeService?: HedgeIntentService;
  pnlService?: PnlStore;
  settlementEventService?: SettlementEventStore;
  settlementVerifier?: SettlementVerifier;
  signerService?: SignerService;
  tokenRegistry?: TokenRegistry;
  rateLimit?: Partial<RateLimitConfig> | false;
  rateLimiter?: RateLimiter;
  quoteTtlSeconds?: number;
  bodyLimitBytes?: number;
  corsAllowedOrigins?: readonly string[] | false;
  enableHsts?: boolean;
  trustProxy?: boolean;
}

interface DefaultMarketDataRuntime {
  service: MarketDataService;
  defaultPairs: ReturnType<typeof chainlinkConfiguredPairs>;
  maxSnapshotAgeMs: number;
}

interface PricingRuntime {
  engine: PricingEngine;
  tokenRegistry?: TokenRegistry;
}

export function buildServer(options: BuildServerOptions = {}) {
  assertBuildServerOptions(options);
  const logger = options.logger === undefined
    ? true
    : assertBooleanOption(options.logger, "logger");
  const bodyLimitBytes = options.bodyLimitBytes === undefined
    ? readBodyLimitBytes()
    : assertIntegerOption(options.bodyLimitBytes, "bodyLimitBytes", 1024, 1_048_576);
  const enableHsts = options.enableHsts === undefined
    ? readEnableHsts()
    : assertBooleanOption(options.enableHsts, "enableHsts");
  const trustProxy = options.trustProxy === undefined
    ? readTrustProxy()
    : assertBooleanOption(options.trustProxy, "trustProxy");
  const quoteTtlSeconds = options.quoteTtlSeconds === undefined
    ? readQuoteTtlSeconds()
    : assertIntegerOption(options.quoteTtlSeconds, "quoteTtlSeconds", 1, 3600);
  const server = Fastify({
    logger,
    bodyLimit: bodyLimitBytes,
    maxParamLength: maxStatusIdentifierRouteParamLength,
  });
  const corsAllowedOrigins = options.corsAllowedOrigins === false
    ? []
    : normalizeCorsAllowedOrigins(options.corsAllowedOrigins ?? readCorsAllowedOrigins());
  server.addHook("onRequest", async (request, reply) => {
    reply.header("x-trace-id", requestTraceId(request));
    applySecurityHeaders(reply, enableHsts);
    applyCorsHeaders(request, reply, corsAllowedOrigins);
  });
  server.setErrorHandler((error, request, reply) => {
    return sendError(reply, requestTraceId(request), frameworkErrorToAPIError(error));
  });
  server.setNotFoundHandler((request, reply) => {
    return sendError(reply, requestTraceId(request), new APIError("INVALID_REQUEST", "Route not found", 404));
  });

  const metricsService = new MetricsService();
  const defaultMarketData = options.marketDataService ? undefined : readDefaultMarketDataRuntime();
  const rawMarketDataService = options.marketDataService ?? defaultMarketData!.service;
  const cexPairs = defaultMarketData ? readCexOrderBookPairs() : [];
  const cexConfig = cexPairs.length > 0 ? readCexOrderBookConfig(cexPairs) : undefined;
  const priceUpdaterPairs = defaultMarketData ? readMarketDataPairs(defaultMarketData.defaultPairs) : [];
  const basePriceCache = defaultMarketData ? new SharedPriceCache(5_000) : undefined;
  const cexPriceCache = cexConfig ? new SharedPriceCache(cexConfig.maxSourceAgeMs) : undefined;
  const marketDataService = defaultMarketData && basePriceCache
    ? new CachedMarketDataService(
        rawMarketDataService,
        cexPriceCache ? [cexPriceCache, basePriceCache] : [basePriceCache],
        metricsService,
      )
    : rawMarketDataService;
  const maxSnapshotAgeMs = defaultMarketData?.maxSnapshotAgeMs ?? defaultQuoteServiceConfig.maxSnapshotAgeMs;
  let localSignerConfig: LocalEIP712SignerConfig | undefined;
  const getLocalSignerConfig = () => {
    localSignerConfig ??= readSignerConfig();
    return localSignerConfig;
  };
  const signerService = options.signerService ?? new LocalEIP712SignerService(getLocalSignerConfig());
  const postgresPool = resolvePostgresPool(options);
  const ownsPostgresPool = postgresPool !== undefined && options.databasePool === undefined;
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
  const riskEngine = options.riskEngine ?? new BasicRiskEngine();
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
      buildDefaultSettlementVerifierPolicy(getLocalSignerConfig()),
    ),
  }, options.settlementEvidenceProvider ?? buildRuntimeSettlementEvidenceProvider(getLocalSignerConfig()));
  const pnlService = options.pnlService ?? (
    postgresPool ? new PostgresPnlStore(postgresPool) : new PnlService()
  );
  const rateLimiter = resolveRateLimiter(options);
  const inFlightSubmitQuoteIds = new Set<string>();
  const quoteService = new QuoteService({
    inventoryService,
    marketDataService,
    marketSnapshotStore,
    hedgeService,
    pricingEngine,
    quoteRepository,
    riskDecisionStore,
    riskEngine,
    routingEngine,
    signerService: new ObservedSignerService(signerService, metricsService),
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
    ? new CEXOrderBookMonitor(cexPriceCache, cexConfig, metricsService)
    : undefined;
  priceUpdater?.start();
  cexMonitor?.start();
  if (priceUpdater || cexMonitor) {
    server.addHook("onClose", async () => {
      priceUpdater?.stop();
      cexMonitor?.stop();
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

  const readinessService = new ReadinessService({
    hedgeService,
    inventoryService,
    marketDataService,
    marketSnapshotStore,
    metricsService,
    pnlService,
    pricingEngine,
    quoteRepository,
    riskDecisionStore,
    riskEngine,
    rateLimiter: rateLimiter ?? disabledRateLimiterHealth,
    routingEngine,
    settlementEventService,
    signerService,
  }, defaultMarketData && priceUpdaterPairs[0]
    ? buildMarketReadinessConfig(priceUpdaterPairs[0], pricingRuntime.tokenRegistry, maxSnapshotAgeMs)
    : defaultReadinessServiceConfig);

  server.get("/health", async () => ({ status: "ok" }));
  server.options("/*", async (request, reply) => {
    if (!isCorsOriginAllowed(request, corsAllowedOrigins)) {
      return sendError(
        reply,
        requestTraceId(request),
        new APIError("INVALID_REQUEST", "CORS origin is not allowed", 403),
      );
    }

    return reply.code(204).send();
  });
  server.get("/ready", async (_request, reply) => {
    const readiness = await readinessService.check();
    metricsService.recordReadiness(readiness);
    if (readiness.status === "degraded") {
      return reply.code(503).send(readiness);
    }

    return readiness;
  });
  server.get("/metrics", async (_request, reply) => {
    return reply.type("text/plain").send(metricsService.renderPrometheus());
  });
  server.get("/pnl", async (request, reply) => {
    try {
      const rateLimitResult = await enforceRateLimit(rateLimiter, metricsService, "status", request, reply, trustProxy);
      if (!rateLimitResult.allowed) {
        return rateLimitResult.response;
      }

      return await pnlService.summary();
    } catch (error) {
      return sendError(reply, requestTraceId(request), pnlStoreFailure(error));
    }
  });
  server.get("/settlements/:settlementEventId", async (request, reply) => {
    try {
      const rateLimitResult = await enforceRateLimit(rateLimiter, metricsService, "status", request, reply, trustProxy);
      if (!rateLimitResult.allowed) {
        return rateLimitResult.response;
      }

      const { settlementEventId } = request.params as { settlementEventId: string };
      assertStatusIdentifier(settlementEventId, "settlementEventId");
      const status = await settlementEventService.getSettlementEvent(settlementEventId);
      if (!status) {
        return sendError(
          reply,
          requestTraceId(request),
          new APIError("SETTLEMENT_EVENT_NOT_FOUND", "Settlement event not found", 404),
        );
      }

      return status;
    } catch (error) {
      return sendError(reply, requestTraceId(request), settlementEventStatusFailure(error));
    }
  });
  server.get("/quote/:quoteId", async (request, reply) => {
    try {
      const rateLimitResult = await enforceRateLimit(rateLimiter, metricsService, "status", request, reply, trustProxy);
      if (!rateLimitResult.allowed) {
        return rateLimitResult.response;
      }

      const { quoteId } = request.params as { quoteId: string };
      assertStatusIdentifier(quoteId, "quoteId");
      const status = await quoteService.getQuoteStatus(quoteId);
      if (!status) {
        return sendError(reply, requestTraceId(request), new APIError("QUOTE_NOT_FOUND", "Quote not found", 404));
      }

      return status;
    } catch (error) {
      return sendError(reply, requestTraceId(request), toAPIError(error));
    }
  });
  server.get("/hedges/:hedgeOrderId", async (request, reply) => {
    try {
      const rateLimitResult = await enforceRateLimit(rateLimiter, metricsService, "status", request, reply, trustProxy);
      if (!rateLimitResult.allowed) {
        return rateLimitResult.response;
      }

      const { hedgeOrderId } = request.params as { hedgeOrderId: string };
      assertStatusIdentifier(hedgeOrderId, "hedgeOrderId");
      const status = await hedgeService.getHedgeIntent(hedgeOrderId);
      if (!status) {
        return sendError(reply, requestTraceId(request), new APIError("HEDGE_NOT_FOUND", "Hedge intent not found", 404));
      }

      return status;
    } catch (error) {
      return sendError(reply, requestTraceId(request), hedgeStatusFailure(error));
    }
  });
  server.post("/quote", async (request, reply) => {
    const startedAt = Date.now();
    metricsService.recordQuoteRequest();
    try {
      const rateLimitResult = await enforceRateLimit(rateLimiter, metricsService, "quote", request, reply, trustProxy);
      if (!rateLimitResult.allowed) {
        metricsService.recordQuoteError();
        return rateLimitResult.response;
      }

      const quoteRequest = validateQuoteRequest(request.body);
      const response = await quoteService.createQuote(quoteRequest);
      metricsService.recordQuoteResponse();
      return response;
    } catch (error) {
      metricsService.recordQuoteError();
      const apiError = toAPIError(error);
      if (apiError.code === "RISK_REJECTED") {
        metricsService.recordQuoteRejection(apiError.internalReasonCode ?? "RISK_REJECTED");
      }

      return sendError(reply, requestTraceId(request), apiError);
    } finally {
      metricsService.recordQuoteLatency(elapsedSeconds(startedAt));
    }
  });
  server.post("/submit", async (request, reply) => {
    const startedAt = Date.now();
    let quoteId: string | undefined;
    let releaseSubmitReservation: (() => void) | undefined;
    metricsService.recordSubmitRequest();
    try {
      const rateLimitResult = await enforceRateLimit(rateLimiter, metricsService, "submit", request, reply, trustProxy);
      if (!rateLimitResult.allowed) {
        metricsService.recordSubmitError();
        return rateLimitResult.response;
      }

      const submitRequest = validateSubmitQuoteRequest(request.body);
      quoteId = await quoteService.requireSubmittableSignedQuote(
        submitRequest.quote,
        submitRequest.signature,
        { allowExpired: submitRequest.txHash !== undefined },
      );
      releaseSubmitReservation = reserveSubmitQuoteId(inFlightSubmitQuoteIds, quoteId);
      const result = await executionService.submitQuote(submitRequest, { quoteId });
      const pnlRecord = result.settlementEventResult.duplicate
        ? undefined
        : await recordPnlSettlementBestEffort(pnlService, metricsService, { quoteId, quote: submitRequest.quote });
      metricsService.recordSubmitAccepted();
      if (!result.settlementEventResult.duplicate) {
        metricsService.recordSettlement();
        if (result.hedgeResult) {
          metricsService.recordHedgeIntent();
          metricsService.recordHedgeLag(result.hedgeLagSeconds ?? 0);
        }
        if (result.hedgeFailure) {
          metricsService.recordHedgeIntentError(result.hedgeFailure.reasonCode);
        }
        if (pnlRecord) {
          metricsService.recordPnlTrade(pnlRecord);
        }
        if (result.inventoryPositions) {
          recordInventoryPositionBestEffort(metricsService, result.inventoryPositions.tokenIn);
          recordInventoryPositionBestEffort(metricsService, result.inventoryPositions.tokenOut);
        }
      }
      await markPostSettlementQuoteStatus(quoteService, metricsService, quoteId, {
        txHash: result.response.txHash,
        settlementEventId: result.response.settlementEventId,
        hedgeOrderId: result.response.hedgeOrderId,
        pnlId: pnlRecord?.pnlId,
      });
      return reply.code(202).send({
        ...result.response,
        pnlId: pnlRecord?.pnlId,
      });
    } catch (error) {
      metricsService.recordSubmitError();
      const apiError = toAPIError(error);
      if (quoteId && shouldMarkSettlementRejectionFailed(apiError)) {
        await markSettlementRejectedQuoteFailed(quoteService, metricsService, quoteId, settlementRejectionFailureCode(apiError));
      }

      return sendError(reply, requestTraceId(request), apiError);
    } finally {
      releaseSubmitReservation?.();
      metricsService.recordSubmitLatency(elapsedSeconds(startedAt));
    }
  });

  return server;
}

async function enforceRateLimit(
  rateLimiter: RateLimiter | undefined,
  metricsService: MetricsService,
  endpoint: RateLimitedEndpoint,
  request: FastifyRequest,
  reply: FastifyReply,
  trustProxy: boolean,
): Promise<{ allowed: true } | { allowed: false; response: FastifyReply }> {
  if (!rateLimiter) {
    return { allowed: true };
  }

  const clientId = clientIdForRateLimit(request, trustProxy);
  let decision;
  try {
    decision = await rateLimiter.check({
      endpoint,
      clientId,
    });
    assertRateLimitDecision(decision);
  } catch {
    throw new APIError("RATE_LIMIT_UNAVAILABLE", "Rate limit store unavailable", 503);
  }
  if (decision.allowed) {
    reply.header("x-ratelimit-remaining", decision.remaining.toString());
    return { allowed: true };
  }

  const error = new APIError("RATE_LIMITED", "Too many requests", 429);
  metricsService.recordRateLimited(endpoint);
  return {
    allowed: false,
    response: sendError(reply.header("retry-after", decision.retryAfterSeconds.toString()), requestTraceId(request), error),
  };
}

function assertRateLimitDecision(decision: unknown): asserts decision is {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
} {
  if (!isRecord(decision)) {
    throw new Error("Rate limiter decision must be an object");
  }
  assertExactOwnFields(decision, rateLimitDecisionFields, "rate limiter decision");
  if (typeof decision.allowed !== "boolean") {
    throw new Error("Rate limiter decision allowed must be a boolean");
  }
  if (typeof decision.remaining !== "number" || !Number.isSafeInteger(decision.remaining) || decision.remaining < 0) {
    throw new Error("Rate limiter decision remaining must be a non-negative safe integer");
  }
  if (typeof decision.retryAfterSeconds !== "number" ||
      !Number.isSafeInteger(decision.retryAfterSeconds) || decision.retryAfterSeconds <= 0) {
    throw new Error("Rate limiter decision retryAfterSeconds must be a positive safe integer");
  }
}

function sendError(
  reply: FastifyReply,
  traceId: string,
  error: APIError,
) {
  return reply.header("x-trace-id", traceId).code(error.statusCode).send(error.toResponse(traceId));
}

function reserveSubmitQuoteId(inFlightSubmitQuoteIds: Set<string>, quoteId: string): () => void {
  if (inFlightSubmitQuoteIds.has(quoteId)) {
    throw new APIError("QUOTE_ALREADY_USED", "Quote already used", 409);
  }

  inFlightSubmitQuoteIds.add(quoteId);
  return () => {
    inFlightSubmitQuoteIds.delete(quoteId);
  };
}

function assertStatusIdentifier(value: unknown, field: "quoteId" | "hedgeOrderId" | "settlementEventId" | "pnlId"): void {
  if (typeof value !== "string") {
    throw new APIError("INVALID_REQUEST", `${field} must be a primitive string`, 400);
  }
  if (value.trim().length === 0) {
    throw new APIError("INVALID_REQUEST", `${field} must be a non-empty string`, 400);
  }
  if (value.length > maxStatusIdentifierLength) {
    throw new APIError("INVALID_REQUEST", `${field} must be 128 characters or fewer`, 400);
  }
  if (!statusIdentifierPattern.test(value)) {
    throw new APIError("INVALID_REQUEST", `${field} must contain only letters, numbers, underscore, colon, or hyphen`, 400);
  }
}

function applyCorsHeaders(
  request: FastifyRequest,
  reply: FastifyReply,
  allowedOrigins: readonly string[],
): void {
  const origin = requestOrigin(request);
  if (!origin || !allowedOrigins.includes(origin)) {
    return;
  }

  reply.header("access-control-allow-origin", origin);
  reply.header("vary", "Origin");
  reply.header("access-control-allow-methods", "GET,POST,OPTIONS");
  reply.header("access-control-allow-headers", "content-type,x-trace-id");
  reply.header("access-control-max-age", "600");
}

function applySecurityHeaders(reply: FastifyReply, enableHsts: boolean): void {
  reply.header("cache-control", "no-store");
  reply.header("x-content-type-options", "nosniff");
  reply.header("x-frame-options", "DENY");
  reply.header("referrer-policy", "no-referrer");
  reply.header("permissions-policy", "camera=(), microphone=(), geolocation=()");
  if (enableHsts) {
    reply.header("strict-transport-security", "max-age=31536000; includeSubDomains");
  }
}

function isCorsOriginAllowed(request: FastifyRequest, allowedOrigins: readonly string[]): boolean {
  const origin = requestOrigin(request);
  return !origin || allowedOrigins.includes(origin);
}

function requestOrigin(request: FastifyRequest): string | undefined {
  const origin = request.headers.origin;
  return typeof origin === "string" && origin.trim().length > 0 ? origin : undefined;
}

function frameworkErrorToAPIError(error: unknown): APIError {
  if (error instanceof APIError) {
    return error;
  }

  const code = frameworkErrorField(error, "code");
  const statusCode = frameworkErrorField(error, "statusCode");
  if (code === "FST_ERR_CTP_BODY_TOO_LARGE" || statusCode === 413) {
    return new APIError("INVALID_REQUEST", "Request body too large", 413);
  }

  if (statusCode === 400) {
    return new APIError("INVALID_REQUEST", "Malformed JSON request body", 400);
  }

  if (statusCode === 415) {
    return new APIError("INVALID_REQUEST", "Request content type must be application/json", 415);
  }

  return toAPIError(error);
}

function frameworkErrorField(error: unknown, field: "code" | "statusCode"): unknown {
  if (!isRecord(error) || !Object.prototype.hasOwnProperty.call(error, field)) {
    return undefined;
  }

  return error[field];
}

function hedgeStatusFailure(error: unknown): APIError {
  if (error instanceof APIError) {
    return error;
  }

  return new APIError("HEDGE_STORE_UNAVAILABLE", "Hedge store unavailable", 503);
}

function settlementEventStatusFailure(error: unknown): APIError {
  if (error instanceof APIError) {
    return error;
  }

  return new APIError("SETTLEMENT_EVENT_STORE_UNAVAILABLE", "Settlement event store unavailable", 503);
}

function pnlStoreFailure(error: unknown): APIError {
  if (error instanceof APIError) {
    return error;
  }

  return new APIError("PNL_STORE_UNAVAILABLE", "PnL store unavailable", 503);
}

async function recordPnlSettlementBestEffort(
  pnlService: PnlStore,
  metricsService: MetricsService,
  input: RecordPnlInput,
): Promise<PnlTradeRecord | undefined> {
  try {
    const pnlRecord = await pnlService.recordSettlement(input);
    assertPnlRecordResult(pnlRecord, input);
    return pnlRecord;
  } catch {
    metricsService.recordPnlRecordError("PNL_RECORD_FAILED");
    return undefined;
  }
}

function recordInventoryPositionBestEffort(
  metricsService: MetricsService,
  position: Parameters<MetricsService["recordInventoryPosition"]>[0],
): void {
  try {
    metricsService.recordInventoryPosition(position);
  } catch {
    // Settlement has already been accepted; a malformed gauge sample must not change submit semantics.
  }
}

function assertPnlRecordResult(record: unknown, input: RecordPnlInput): asserts record is PnlTradeRecord {
  if (!isRecord(record)) {
    throw new Error("API PnL record result must be an object");
  }

  assertExactOwnFields(record, pnlTradeRecordFields, "PnL record result");
  assertStatusIdentifier(record.pnlId, "pnlId");
  assertStatusIdentifier(record.quoteId, "quoteId");
  if (record.pnlId !== `pnl_${input.quoteId}` || record.quoteId !== input.quoteId) {
    throw new Error("API PnL record identifiers must match submitted quote");
  }
  if (
    typeof record.chainId !== "number" ||
    !Number.isSafeInteger(record.chainId) ||
    record.chainId <= 0 ||
    record.chainId !== input.quote.chainId
  ) {
    throw new Error("API PnL record chainId must match submitted quote");
  }
  assertAddress(record.user, "PnL record user");
  assertAddress(record.tokenIn, "PnL record tokenIn");
  assertAddress(record.tokenOut, "PnL record tokenOut");
  if (
    record.user.toLowerCase() !== input.quote.user.toLowerCase() ||
    record.tokenIn.toLowerCase() !== input.quote.tokenIn.toLowerCase() ||
    record.tokenOut.toLowerCase() !== input.quote.tokenOut.toLowerCase()
  ) {
    throw new Error("API PnL record quote parties must match submitted quote");
  }
  assertPositiveUIntString(record.amountIn, "PnL record amountIn");
  assertPositiveUIntString(record.amountOut, "PnL record amountOut");
  assertPositiveUIntString(record.minAmountOut, "PnL record minAmountOut");
  assertPositiveUIntString(record.nonce, "PnL record nonce");
  if (
    record.amountIn !== input.quote.amountIn ||
    record.amountOut !== input.quote.amountOut ||
    record.minAmountOut !== input.quote.minAmountOut ||
    record.nonce !== input.quote.nonce
  ) {
    throw new Error("API PnL record quote amounts must match submitted quote");
  }
  if (BigInt(record.amountOut) < BigInt(record.minAmountOut)) {
    throw new Error("API PnL record amountOut must be greater than or equal to minAmountOut");
  }
  if (
    typeof record.deadline !== "number" ||
    !Number.isSafeInteger(record.deadline) ||
    record.deadline <= 0 ||
    record.deadline !== input.quote.deadline
  ) {
    throw new Error("API PnL record deadline must match submitted quote");
  }

  assertIntString(record.grossPnlTokenOut, "PnL record grossPnlTokenOut");
  const expectedGrossPnl = BigInt(input.quote.amountIn) - BigInt(input.quote.amountOut);
  if (record.grossPnlTokenOut !== expectedGrossPnl.toString()) {
    throw new Error("API PnL record grossPnlTokenOut must match submitted quote");
  }
  if (!Number.isSafeInteger(record.grossPnlBps) || record.grossPnlBps !== calculateGrossPnlBps(input.quote.amountIn, expectedGrossPnl)) {
    throw new Error("API PnL record grossPnlBps must match submitted quote");
  }
  if (record.model !== "simulated_mid_price_v1") {
    throw new Error("API PnL record model must be simulated_mid_price_v1");
  }
  if (record.modelDescription !== simulatedPnlModelDescription) {
    throw new Error("API PnL record modelDescription must describe simulated_mid_price_v1");
  }
  if (!isCanonicalUtcIsoTimestamp(record.realizedAt)) {
    throw new Error("API PnL record realizedAt must be a canonical UTC ISO timestamp");
  }
}

function assertExactOwnFields(value: Record<string, unknown>, fields: readonly string[], path: string): void {
  const expected = new Set(fields);
  for (const key of Object.keys(value)) {
    if (!expected.has(key)) {
      throw new Error(`API ${path} must not include unknown field ${key}`);
    }
  }

  for (const field of fields) {
    if (!Object.prototype.hasOwnProperty.call(value, field)) {
      throw new Error(`API ${path}.${field} must be an own field`);
    }
  }
}

function assertPositiveUIntString(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || !/^[1-9][0-9]*$/.test(value)) {
    throw new Error(`API ${field} must be a positive uint string`);
  }
}

function assertIntString(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || !/^(0|-?[1-9][0-9]*)$/.test(value)) {
    throw new Error(`API ${field} must be an integer string`);
  }
}

function assertAddress(value: unknown, field: string): asserts value is `0x${string}` {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new Error(`API ${field} must be a 20-byte hex address`);
  }
}

function calculateGrossPnlBps(amountIn: string, grossPnl: bigint): number {
  const notional = BigInt(amountIn);
  if (notional <= 0n) {
    return 0;
  }

  const grossPnlBps = (grossPnl * 10_000n) / notional;
  if (grossPnlBps < BigInt(Number.MIN_SAFE_INTEGER) || grossPnlBps > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("API PnL record grossPnlBps must be a safe integer");
  }

  return Number(grossPnlBps);
}

async function markPostSettlementQuoteStatus(
  quoteService: QuoteService,
  metricsService: MetricsService,
  quoteId: string,
  metadata: {
    txHash?: `0x${string}`;
    settlementEventId?: string;
    hedgeOrderId?: string;
    pnlId?: string;
  },
): Promise<void> {
  try {
    await quoteService.markQuoteStatus(quoteId, "submitted", metadata);
  } catch {
    metricsService.recordQuoteStatusUpdateError("submitted");
  }

  try {
    await quoteService.markQuoteStatus(quoteId, "settled", metadata);
  } catch {
    metricsService.recordQuoteStatusUpdateError("settled");
  }
}

async function markSettlementRejectedQuoteFailed(
  quoteService: QuoteService,
  metricsService: MetricsService,
  quoteId: string,
  errorCode: string,
): Promise<void> {
  try {
    await quoteService.markQuoteFailed(quoteId, errorCode);
  } catch {
    metricsService.recordQuoteStatusUpdateError("failed");
  }
}

function settlementRejectionFailureCode(error: APIError): string {
  return error.internalReasonCode ?? error.code;
}

function shouldMarkSettlementRejectionFailed(error: APIError): boolean {
  if (error.code !== "SETTLEMENT_REVERTED") return false;
  return !retryableSettlementEvidenceReasonCodes.has(error.internalReasonCode ?? "");
}

function requestTraceId(request: FastifyRequest): string {
  const incomingTraceId = safeIncomingTraceId(request.headers["x-trace-id"]);
  if (incomingTraceId) {
    return incomingTraceId;
  }

  return `tr_${request.id}`;
}

function safeIncomingTraceId(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > maxTraceIdLength || !traceIdPattern.test(normalized)) {
    return undefined;
  }

  return normalized;
}

function elapsedSeconds(startedAt: number): number {
  return (Date.now() - startedAt) / 1000;
}

function clientIdForRateLimit(request: FastifyRequest, trustProxy: boolean): string {
  if (!trustProxy) {
    return assertGatewayRateLimitClientId(request.ip);
  }

  const forwardedFor = request.headers["x-forwarded-for"];
  if (typeof forwardedFor === "string" && forwardedFor.trim().length > 0) {
    const forwardedClientId = forwardedFor.split(",")[0]?.trim().toLowerCase();
    return forwardedClientId && forwardedClientId.length > 0
      ? assertGatewayRateLimitClientId(forwardedClientId)
      : assertGatewayRateLimitClientId(request.ip);
  }

  return assertGatewayRateLimitClientId(request.ip);
}

function assertGatewayRateLimitClientId(clientId: string): string {
  const normalized = clientId.trim().toLowerCase();
  if (normalized.length === 0) {
    throw new APIError("INVALID_REQUEST", "Rate limit clientId must be a non-empty string", 400);
  }
  if (normalized.length > maxRateLimitClientIdLength) {
    throw new APIError("INVALID_REQUEST", "Rate limit clientId must be 128 characters or fewer", 400);
  }
  if (!rateLimitClientIdPattern.test(normalized)) {
    throw new APIError(
      "INVALID_REQUEST",
      "Rate limit clientId must contain only letters, numbers, dot, underscore, colon, or hyphen",
      400,
    );
  }

  return normalized;
}

function readSignerConfig() {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  const nodeEnv = readOwnEnvValue(env, "NODE_ENV");
  const privateKey = readOwnEnvValue(env, "RFQ_SIGNER_PRIVATE_KEY");
  const settlementAddress = readOwnEnvValue(env, "RFQ_SETTLEMENT_ADDRESS");
  if (requiresExplicitSignerConfig(nodeEnv)) {
    requireConfiguredPrivateKey(privateKey, nodeEnv);
    requireConfiguredAddress(settlementAddress, "RFQ_SETTLEMENT_ADDRESS", nodeEnv);
  }

  return {
    privateKey: (privateKey ?? "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80") as `0x${string}`,
    settlementAddress: (settlementAddress ?? "0x0000000000000000000000000000000000000004") as `0x${string}`,
  };
}

function buildDefaultSettlementVerifierPolicy(
  signerConfig: LocalEIP712SignerConfig,
): LocalSettlementVerifierPolicy {
  return {
    ...defaultLocalSettlementVerifierPolicy,
    settlementAddress: signerConfig.settlementAddress,
    trustedSignerAddress: privateKeyToAccount(signerConfig.privateKey).address,
  };
}

function buildRuntimeSettlementEvidenceProvider(
  signerConfig: LocalEIP712SignerConfig,
): RuntimeSettlementEvidenceProvider {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  const nodeEnv = readOwnEnvValue(env, "NODE_ENV");
  const allowSimulatedSettlement = readOptionalBoolean(
    readOwnEnvValue(env, "RFQ_ALLOW_SIMULATED_SETTLEMENT"),
    !requiresExplicitSignerConfig(nodeEnv),
    "RFQ_ALLOW_SIMULATED_SETTLEMENT",
  );
  const config = parseReceiptExecutionConfig(readOwnEnvValue(env, "RFQ_RECEIPT_CONFIG_JSON"));
  if (!allowSimulatedSettlement && config.chains.length === 0) {
    throw new Error("RFQ_RECEIPT_CONFIG_JSON must configure at least one chain when simulated settlement is disabled");
  }
  for (const chain of config.chains) {
    if (chain.settlementAddress.toLowerCase() !== signerConfig.settlementAddress.toLowerCase()) {
      throw new Error("Receipt settlement address must match RFQ_SETTLEMENT_ADDRESS used for EIP-712 signing");
    }
  }
  return new RuntimeSettlementEvidenceProvider(config, allowSimulatedSettlement);
}

function readOptionalBoolean(value: string | undefined, defaultValue: boolean, name: string): boolean {
  if (value === undefined || value.trim().length === 0) return defaultValue;
  const normalized = value.trim().toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  throw new Error(`${name} must be true or false`);
}

function requiresExplicitSignerConfig(nodeEnv: string | undefined): boolean {
  return nodeEnv !== undefined && !["development", "test"].includes(nodeEnv);
}

function requireConfiguredEnv(value: string | undefined, name: string, nodeEnv: string | undefined): string {
  if (!value || value.trim().length === 0) {
    throw new Error(`${name} is required when NODE_ENV=${nodeEnv}`);
  }

  return value;
}

function requireConfiguredPrivateKey(value: string | undefined, nodeEnv: string | undefined): void {
  const privateKey = requireConfiguredEnv(value, "RFQ_SIGNER_PRIVATE_KEY", nodeEnv);
  if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
    throw new Error(`RFQ_SIGNER_PRIVATE_KEY must be a 32-byte hex string when NODE_ENV=${nodeEnv}`);
  }
}

function requireConfiguredAddress(value: string | undefined, name: string, nodeEnv: string | undefined): void {
  const address = requireConfiguredEnv(value, name, nodeEnv);
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
    throw new Error(`${name} must be a 20-byte hex address when NODE_ENV=${nodeEnv}`);
  }
}

function readQuoteTtlSeconds(): number {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  return readDecimalIntegerConfig(readOwnEnvValue(env, "RFQ_QUOTE_TTL_SECONDS"), {
    defaultValue: defaultQuoteServiceConfig.quoteTtlSeconds,
    max: 3600,
    min: 1,
    name: "RFQ_QUOTE_TTL_SECONDS",
  });
}

function readBodyLimitBytes(): number {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  return readDecimalIntegerConfig(readOwnEnvValue(env, "RFQ_BODY_LIMIT_BYTES"), {
    defaultValue: defaultBodyLimitBytes,
    max: 1_048_576,
    min: 1024,
    name: "RFQ_BODY_LIMIT_BYTES",
  });
}

function readDecimalIntegerConfig(
  configured: string | undefined,
  options: { defaultValue: number; max: number; min: number; name: string },
): number {
  if (!configured || configured.trim().length === 0) {
    return options.defaultValue;
  }

  const normalized = configured.trim();
  if (!/^[0-9]+$/.test(normalized)) {
    throw invalidDecimalIntegerConfigError(options);
  }

  const value = Number(normalized);
  if (!Number.isSafeInteger(value) || value < options.min || value > options.max) {
    throw invalidDecimalIntegerConfigError(options);
  }

  return value;
}

function invalidDecimalIntegerConfigError(options: { max: number; min: number; name: string }): Error {
  return new Error(`${options.name} must be a base-10 integer between ${options.min} and ${options.max}`);
}

function assertIntegerOption(value: number, name: string, min: number, max: number): number {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }

  return value;
}

function assertBooleanOption(value: boolean, name: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`${name} must be a boolean`);
  }

  return value;
}

function assertBuildServerOptions(options: unknown): asserts options is BuildServerOptions {
  if (!isRecord(options)) {
    throw new Error("buildServer options must be an object");
  }

  assertOptionalOwnFields(options, buildServerOptionFields, "options");
}

function resolvePostgresPool(options: BuildServerOptions): pg.Pool | undefined {
  if (options.databasePool !== undefined) {
    if (!isRecord(options.databasePool) || typeof options.databasePool.connect !== "function") {
      throw new Error("buildServer databasePool.connect must be a function");
    }
    return options.databasePool;
  }

  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  const nodeEnv = readOwnEnvValue(env, "NODE_ENV");
  const databaseUrl = readOwnEnvValue(env, "DATABASE_URL");
  if (!databaseUrl || databaseUrl.trim().length === 0) {
    if (requiresExplicitSignerConfig(nodeEnv)) {
      throw new Error(`DATABASE_URL is required when NODE_ENV=${nodeEnv}`);
    }
    return undefined;
  }

  return getPool();
}

function resolveRateLimiter(options: BuildServerOptions): RateLimiter | undefined {
  if (options.rateLimiter !== undefined) {
    if (options.rateLimit !== undefined) {
      throw new Error("buildServer rateLimiter and rateLimit cannot both be provided");
    }
    assertRateLimiterOption(options.rateLimiter);
    return options.rateLimiter;
  }

  const config = normalizeRateLimitOption(options.rateLimit);
  if (config === false) {
    return undefined;
  }

  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  const nodeEnv = readOwnEnvValue(env, "NODE_ENV");
  const configuredBackend = readOwnEnvValue(env, "RFQ_RATE_LIMIT_BACKEND");
  const backend = configuredBackend?.trim().toLowerCase() ||
    (requiresExplicitSignerConfig(nodeEnv) ? "redis" : "memory");
  if (backend !== "memory" && backend !== "redis") {
    throw new Error("RFQ_RATE_LIMIT_BACKEND must be memory or redis");
  }
  if (backend === "memory") {
    if (requiresExplicitSignerConfig(nodeEnv)) {
      throw new Error(`RFQ_RATE_LIMIT_BACKEND must be redis when NODE_ENV=${nodeEnv}`);
    }
    return new InMemoryRateLimiter(config);
  }

  const redisUrl = readOwnEnvValue(env, "RFQ_REDIS_URL");
  if (!redisUrl || redisUrl.trim().length === 0) {
    throw new Error("RFQ_REDIS_URL is required when RFQ_RATE_LIMIT_BACKEND=redis");
  }
  return new RedisRateLimiter(createRedisRateLimitClient(redisUrl), config);
}

function assertRateLimiterOption(rateLimiter: unknown): asserts rateLimiter is RateLimiter {
  if (!isRecord(rateLimiter)) {
    throw new Error("buildServer rateLimiter must be an object");
  }
  for (const method of ["check", "checkHealth"] as const) {
    if (typeof rateLimiter[method] !== "function") {
      throw new Error(`buildServer rateLimiter.${method} must be a function`);
    }
  }
  if (rateLimiter.close !== undefined && typeof rateLimiter.close !== "function") {
    throw new Error("buildServer rateLimiter.close must be a function when provided");
  }
}

function normalizeRateLimitOption(rateLimit: BuildServerOptions["rateLimit"]): RateLimitConfig | false {
  if (rateLimit === false) {
    return false;
  }

  if (rateLimit === undefined) {
    return {
      windowMs: 60_000,
      maxQuoteRequests: 120,
      maxSubmitRequests: 60,
      maxStatusRequests: 300,
    };
  }

  if (!isRecord(rateLimit)) {
    throw new Error("buildServer rateLimit must be an object or false");
  }
  assertOptionalOwnFields(rateLimit, rateLimitOptionFields, "rateLimit");

  return {
    windowMs: rateLimit.windowMs ?? 60_000,
    maxQuoteRequests: rateLimit.maxQuoteRequests ?? 120,
    maxSubmitRequests: rateLimit.maxSubmitRequests ?? 60,
    maxStatusRequests: rateLimit.maxStatusRequests ?? 300,
  };
}

function assertOptionalOwnFields(value: object, fields: readonly string[], path: string): void {
  for (const field of fields) {
    if (field in value && !Object.prototype.hasOwnProperty.call(value, field)) {
      throw new Error(`buildServer ${path}.${field} must be an own field when provided`);
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readCorsAllowedOrigins(): string[] {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  const configured = readOwnEnvValue(env, "RFQ_CORS_ALLOWED_ORIGINS");
  if (!configured || configured.trim().length === 0) {
    return defaultCorsAllowedOrigins;
  }

  const origins = configured
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
  if (origins.length === 0) {
    throw invalidCorsAllowedOriginsError();
  }

  return normalizeCorsAllowedOrigins(origins);
}

function normalizeCorsAllowedOrigins(origins: readonly string[]): string[] {
  if (!Array.isArray(origins)) {
    throw invalidCorsAllowedOriginsError();
  }

  return Array.from(new Set(origins.map(normalizeCorsOrigin)));
}

function normalizeCorsOrigin(origin: string): string {
  if (typeof origin !== "string" || origin.trim().length === 0) {
    throw invalidCorsAllowedOriginsError();
  }

  const trimmed = origin.trim();
  if (trimmed.includes("*")) {
    throw invalidCorsAllowedOriginsError();
  }
  const schemeSeparatorIndex = trimmed.indexOf("://");
  if (schemeSeparatorIndex <= 0) {
    throw invalidCorsAllowedOriginsError();
  }
  const afterScheme = trimmed.slice(schemeSeparatorIndex + 3);
  if (/[/?#]/.test(afterScheme)) {
    throw invalidCorsAllowedOriginsError();
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw invalidCorsAllowedOriginsError();
  }

  if (
    !["http:", "https:"].includes(parsed.protocol) ||
    parsed.username.length > 0 ||
    parsed.password.length > 0 ||
    parsed.pathname !== "/" ||
    parsed.search.length > 0 ||
    parsed.hash.length > 0
  ) {
    throw invalidCorsAllowedOriginsError();
  }

  return parsed.origin;
}

function invalidCorsAllowedOriginsError(): Error {
  return new Error(
    "RFQ_CORS_ALLOWED_ORIGINS must be a comma-separated list of HTTP(S) URL origins without path, query, fragment, credentials, or wildcards",
  );
}

function readEnableHsts(): boolean {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  const configured = readOwnEnvValue(env, "RFQ_ENABLE_HSTS");
  if (!configured || configured.trim().length === 0) {
    return defaultEnableHsts;
  }

  const normalized = configured.trim().toLowerCase();
  if (normalized === "true") {
    return true;
  }
  if (normalized === "false") {
    return false;
  }

  throw new Error("RFQ_ENABLE_HSTS must be true or false");
}

function readTrustProxy(): boolean {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  const configured = readOwnEnvValue(env, "RFQ_TRUST_PROXY");
  if (!configured || configured.trim().length === 0) {
    return defaultTrustProxy;
  }

  const normalized = configured.trim().toLowerCase();
  if (normalized === "true") {
    return true;
  }
  if (normalized === "false") {
    return false;
  }

  throw new Error("RFQ_TRUST_PROXY must be true or false");
}

export function installGracefulShutdown(
  server: Pick<FastifyInstance, "close">,
  processLike: RuntimeProcess | undefined = runtimeProcess(),
  logger: ShutdownLogger = console,
): void {
  if (!processLike?.on) {
    return;
  }

  let closing = false;
  const shutdown = () => {
    if (closing) {
      return;
    }
    closing = true;

    server.close()
      .then(() => {
        processLike.exitCode = 0;
      })
      .catch((error: unknown) => {
        logger.error(error);
        processLike.exitCode = 1;
      });
  };

  processLike.on("SIGTERM", shutdown);
  processLike.on("SIGINT", shutdown);
}

export function readServerListenConfig(processLike: RuntimeProcess | undefined = runtimeProcess()) {
  const env = processLike?.env;
  return {
    host: readListenHost(readOwnEnvValue(env, "HOST")),
    port: readListenPort(readOwnEnvValue(env, "PORT")),
  };
}

function readOwnEnvValue(env: Record<string, string | undefined> | undefined, name: string): string | undefined {
  if (!env || !Object.prototype.hasOwnProperty.call(env, name)) {
    return undefined;
  }

  return env[name];
}

function readListenHost(configured: string | undefined): string {
  if (!configured || configured.trim().length === 0) {
    return defaultListenHost;
  }

  const host = configured.trim();
  if (/\s/.test(host)) {
    throw new Error("HOST must be a non-empty hostname or IP address without whitespace");
  }

  return host;
}

function readListenPort(configured: string | undefined): number {
  return readDecimalIntegerConfig(configured, {
    defaultValue: defaultListenPort,
    max: 65_535,
    min: 1,
    name: "PORT",
  });
}

export async function startServer() {
  const server = buildServer();
  const processLike = runtimeProcess();
  const { host, port } = readServerListenConfig(processLike);
  await server.listen({ host, port });
  installGracefulShutdown(server, processLike);
  return server;
}

function runtimeProcess(): RuntimeProcess | undefined {
  return (globalThis as { process?: RuntimeProcess }).process;
}

function readDefaultMarketDataRuntime(): DefaultMarketDataRuntime {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  const configuredProvider = readOwnEnvValue(env, "RFQ_MARKET_DATA_PROVIDER");
  const provider = configuredProvider?.trim() || "static";
  if (provider === "static") {
    return {
      service: new StaticMarketDataService(),
      defaultPairs: defaultStaticMarketDataConfig.supportedPairs.map((pair) => ({
        ...pair,
        user: "0x0000000000000000000000000000000000000001" as const,
        amountIn: "1",
        slippageBps: 50,
      })),
      maxSnapshotAgeMs: defaultQuoteServiceConfig.maxSnapshotAgeMs,
    };
  }
  if (provider !== "chainlink") {
    throw new Error("RFQ_MARKET_DATA_PROVIDER must be static or chainlink");
  }

  const serializedConfig = readOwnEnvValue(env, "RFQ_CHAINLINK_CONFIG_JSON");
  if (!serializedConfig) throw new Error("RFQ_CHAINLINK_CONFIG_JSON is required when RFQ_MARKET_DATA_PROVIDER=chainlink");
  const config: ChainlinkMarketDataConfig = parseChainlinkMarketDataConfig(serializedConfig);
  return {
    service: new ChainlinkMarketDataService(config),
    defaultPairs: chainlinkConfiguredPairs(config),
    maxSnapshotAgeMs: config.maxPriceAgeMs,
  };
}

function readTokenRegistry(): TokenRegistry {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  const serializedConfig = readOwnEnvValue(env, "RFQ_TOKEN_REGISTRY_JSON");
  return new ConfiguredTokenRegistry(
    serializedConfig === undefined ? defaultTokenRegistryConfig : parseTokenRegistryConfig(serializedConfig),
  );
}

function resolvePricingRuntime(
  configuredPricingEngine: PricingEngine | undefined,
  configuredTokenRegistry: TokenRegistry | undefined,
  pricingPairs: readonly { chainId: number; tokenIn: `0x${string}`; tokenOut: `0x${string}` }[],
  cexPairs: readonly OrderBookPairConfig[],
): PricingRuntime {
  if (configuredPricingEngine !== undefined && cexPairs.length === 0) return { engine: configuredPricingEngine };
  const tokenRegistry = configuredTokenRegistry ?? readTokenRegistry();
  assertCexPairsSupported(tokenRegistry, cexPairs);
  if (configuredPricingEngine !== undefined) {
    return { engine: configuredPricingEngine, tokenRegistry };
  }
  assertPricingPairsSupported(tokenRegistry, pricingPairs);
  return {
    engine: new FormulaPricingEngine(defaultFormulaPricingConfig, tokenRegistry),
    tokenRegistry,
  };
}

function buildMarketReadinessConfig(
  pair: { chainId: number; tokenIn: `0x${string}`; tokenOut: `0x${string}`; user: `0x${string}` },
  tokenRegistry: TokenRegistry | undefined,
  maxSnapshotAgeMs: number,
): ReadinessServiceConfig {
  const amountIn = tokenRegistry
    ? (100n * 10n ** BigInt(
        requireTokenMetadata(tokenRegistry, pair.chainId, pair.tokenIn, "Readiness tokenIn").decimals,
      )).toString()
    : defaultReadinessServiceConfig.probeRequest.amountIn;
  return {
    ...defaultReadinessServiceConfig,
    maxSnapshotAgeMs,
    probeRequest: {
      chainId: pair.chainId,
      user: pair.user,
      tokenIn: pair.tokenIn,
      tokenOut: pair.tokenOut,
      amountIn,
      slippageBps: defaultReadinessServiceConfig.probeRequest.slippageBps,
    },
    probeRoutePlan: {
      ...defaultReadinessServiceConfig.probeRoutePlan,
      routeId: "readiness_route_runtime",
      tokenIn: pair.tokenIn,
      tokenOut: pair.tokenOut,
    },
  };
}

function assertPricingPairsSupported(
  tokenRegistry: TokenRegistry,
  pricingPairs: readonly { chainId: number; tokenIn: `0x${string}`; tokenOut: `0x${string}` }[],
): void {
  const inspected = new Set<string>();
  for (const pair of pricingPairs) {
    const key = `${pair.chainId}:${pair.tokenIn.toLowerCase()}:${pair.tokenOut.toLowerCase()}`;
    if (inspected.has(key)) continue;
    inspected.add(key);
    const tokenIn = requireTokenMetadata(tokenRegistry, pair.chainId, pair.tokenIn, "Pricing tokenIn");
    const tokenOut = requireTokenMetadata(tokenRegistry, pair.chainId, pair.tokenOut, "Pricing tokenOut");
    if (!tokenIn.usdReference && !tokenOut.usdReference) {
      throw new Error(`Pricing pair ${key} requires at least one approved USD reference token`);
    }
  }
}

function assertCexPairsSupported(
  tokenRegistry: TokenRegistry,
  cexPairs: readonly OrderBookPairConfig[],
): void {
  for (const pair of cexPairs) {
    requireTokenMetadata(tokenRegistry, pair.chainId, pair.tokenIn, "CEX tokenIn");
    const tokenOut = requireTokenMetadata(tokenRegistry, pair.chainId, pair.tokenOut, "CEX tokenOut");
    if (!tokenOut.usdReference) {
      throw new Error(
        `CEX pair ${pair.chainId}:${pair.tokenIn.toLowerCase()}:${pair.tokenOut.toLowerCase()} ` +
          "requires tokenOut to be an approved USD reference token because order-book depth is expressed in USD",
      );
    }
  }
}

/**
 * Returns market data pairs for background price pre-fetching.
 * Reads RFQ_MARKET_PAIRS or falls back to the selected provider's configured pairs.
 */
function readMarketDataPairs(
  defaultPairs: DefaultMarketDataRuntime["defaultPairs"],
): DefaultMarketDataRuntime["defaultPairs"] {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  const configured = env && Object.prototype.hasOwnProperty.call(env, "RFQ_MARKET_PAIRS")
    ? env.RFQ_MARKET_PAIRS
    : undefined;

  if (configured && configured.trim().length > 0) {
    return configured.split(",").map((pairStr) => {
      const parts = pairStr.trim().split(":");
      if (parts.length !== 3) {
        throw new Error(`Invalid RFQ_MARKET_PAIRS entry: ${pairStr}. Expected format: chainId:tokenIn:tokenOut`);
      }
      const chainId = readPairChainId(parts[0], "RFQ_MARKET_PAIRS", pairStr);
      const tokenIn = readPairAddress(parts[1], "RFQ_MARKET_PAIRS", pairStr);
      const tokenOut = readPairAddress(parts[2], "RFQ_MARKET_PAIRS", pairStr);
      assertPairDistinctTokens(tokenIn, tokenOut, "RFQ_MARKET_PAIRS", pairStr);
      return {
        chainId,
        tokenIn,
        tokenOut,
        user: "0x0000000000000000000000000000000000000001" as `0x${string}`,
        amountIn: "1",
        slippageBps: 50,
      };
    });
  }

  return defaultPairs.map((pair) => ({ ...pair }));
}

/**
 * Reads CEX order book pairs from environment.
 * Format: RFQ_CEX_PAIRS=chainId:tokenIn:tokenOut:exchange:symbol,...
 * Example: RFQ_CEX_PAIRS=1:0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2:0xdAC17F958D2ee523a2206206994597C13D831ec7:binance:ETHUSDT
 */
function readCexOrderBookPairs(): OrderBookPairConfig[] {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  const configured = env && Object.prototype.hasOwnProperty.call(env, "RFQ_CEX_PAIRS")
    ? env.RFQ_CEX_PAIRS
    : undefined;

  if (!configured || configured.trim().length === 0) return [];

  return configured.split(",").map((pairStr) => {
    const parts = pairStr.trim().split(":");
    if (parts.length !== 5) {
      throw new Error(
        `Invalid RFQ_CEX_PAIRS entry: ${pairStr}. Expected format: chainId:tokenIn:tokenOut:exchange:symbol`,
      );
    }
    const chainId = readPairChainId(parts[0], "RFQ_CEX_PAIRS", pairStr);
    const tokenIn = readPairAddress(parts[1], "RFQ_CEX_PAIRS", pairStr);
    const tokenOut = readPairAddress(parts[2], "RFQ_CEX_PAIRS", pairStr);
    assertPairDistinctTokens(tokenIn, tokenOut, "RFQ_CEX_PAIRS", pairStr);
    const exchange = parts[3].trim().toLowerCase();
    if (exchange !== "binance" && exchange !== "coinbase") {
      throw new Error(`Invalid RFQ_CEX_PAIRS entry: ${pairStr}. exchange must be binance or coinbase`);
    }
    const symbol = parts[4].trim().toUpperCase();
    if (!/^[A-Z0-9._-]{3,32}$/.test(symbol)) {
      throw new Error(`Invalid RFQ_CEX_PAIRS entry: ${pairStr}. symbol must be 3-32 exchange symbol characters`);
    }

    return {
      chainId,
      tokenIn,
      tokenOut,
      exchange,
      symbol,
    };
  });
}

function readCexOrderBookConfig(pairs: OrderBookPairConfig[]) {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  const nodeEnv = readOwnEnvValue(env, "NODE_ENV");
  return {
    pairs,
    depthRangeBps: readDecimalIntegerConfig(readOwnEnvValue(env, "RFQ_CEX_DEPTH_RANGE_BPS"), {
      defaultValue: 50,
      min: 1,
      max: 10_000,
      name: "RFQ_CEX_DEPTH_RANGE_BPS",
    }),
    flushIntervalMs: readDecimalIntegerConfig(readOwnEnvValue(env, "RFQ_CEX_FLUSH_INTERVAL_MS"), {
      defaultValue: 100,
      min: 50,
      max: 60_000,
      name: "RFQ_CEX_FLUSH_INTERVAL_MS",
    }),
    volatilitySampleSize: readDecimalIntegerConfig(readOwnEnvValue(env, "RFQ_CEX_VOLATILITY_SAMPLE_SIZE"), {
      defaultValue: 10,
      min: 3,
      max: 10_000,
      name: "RFQ_CEX_VOLATILITY_SAMPLE_SIZE",
    }),
    maxSourceAgeMs: readDecimalIntegerConfig(readOwnEnvValue(env, "RFQ_CEX_MAX_SOURCE_AGE_MS"), {
      defaultValue: 2_000,
      min: 100,
      max: 60_000,
      name: "RFQ_CEX_MAX_SOURCE_AGE_MS",
    }),
    maxFutureSkewMs: readDecimalIntegerConfig(readOwnEnvValue(env, "RFQ_CEX_MAX_FUTURE_SKEW_MS"), {
      defaultValue: 1_000,
      min: 0,
      max: 60_000,
      name: "RFQ_CEX_MAX_FUTURE_SKEW_MS",
    }),
    minSources: readDecimalIntegerConfig(readOwnEnvValue(env, "RFQ_CEX_MIN_SOURCES"), {
      defaultValue: requiresExplicitSignerConfig(nodeEnv) ? 2 : 1,
      min: 1,
      max: 10,
      name: "RFQ_CEX_MIN_SOURCES",
    }),
    maxSourceDeviationBps: readDecimalIntegerConfig(readOwnEnvValue(env, "RFQ_CEX_MAX_SOURCE_DEVIATION_BPS"), {
      defaultValue: 100,
      min: 1,
      max: 10_000,
      name: "RFQ_CEX_MAX_SOURCE_DEVIATION_BPS",
    }),
    maxSpreadBps: readDecimalIntegerConfig(readOwnEnvValue(env, "RFQ_CEX_MAX_SPREAD_BPS"), {
      defaultValue: 100,
      min: 1,
      max: 10_000,
      name: "RFQ_CEX_MAX_SPREAD_BPS",
    }),
  };
}

function readPairChainId(value: string, envName: "RFQ_MARKET_PAIRS" | "RFQ_CEX_PAIRS", entry: string): number {
  if (!/^[1-9][0-9]*$/.test(value.trim())) {
    throw new Error(`Invalid ${envName} entry: ${entry}. chainId must be a positive base-10 integer`);
  }

  const chainId = Number(value);
  if (!Number.isSafeInteger(chainId) || chainId <= 0) {
    throw new Error(`Invalid ${envName} entry: ${entry}. chainId must be a positive safe integer`);
  }

  return chainId;
}

function readPairAddress(
  value: string,
  envName: "RFQ_MARKET_PAIRS" | "RFQ_CEX_PAIRS",
  entry: string,
): `0x${string}` {
  const normalized = value.trim().toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(normalized)) {
    throw new Error(`Invalid ${envName} entry: ${entry}. token addresses must be 20-byte hex addresses`);
  }

  return normalized as `0x${string}`;
}

function assertPairDistinctTokens(
  tokenIn: `0x${string}`,
  tokenOut: `0x${string}`,
  envName: "RFQ_MARKET_PAIRS" | "RFQ_CEX_PAIRS",
  entry: string,
): void {
  if (tokenIn === tokenOut) {
    throw new Error(`Invalid ${envName} entry: ${entry}. tokenIn and tokenOut must be distinct`);
  }
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
