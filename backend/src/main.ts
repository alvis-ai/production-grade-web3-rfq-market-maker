import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { SkeletonExecutionService } from "./modules/execution/execution.service.js";
import { HedgeService, type HedgeIntentService } from "./modules/hedge/hedge.service.js";
import { ReadinessService } from "./modules/health/readiness.service.js";
import { InventoryService } from "./modules/inventory/inventory.service.js";
import { StaticMarketDataService, type MarketDataService } from "./modules/market-data/market-data.service.js";
import { MetricsService } from "./modules/metrics/metrics.service.js";
import { PnlService, type PnlStore, type RecordPnlInput } from "./modules/pnl/pnl.service.js";
import { FormulaPricingEngine, type PricingEngine } from "./modules/pricing/pricing.engine.js";
import { InMemoryQuoteRepository, type QuoteRepository } from "./modules/quote/quote.repository.js";
import { defaultQuoteServiceConfig, QuoteService } from "./modules/quote/quote.service.js";
import { InMemoryRateLimiter, type RateLimitConfig, type RateLimitedEndpoint } from "./modules/rate-limit/rate-limit.service.js";
import { BasicRiskEngine, type RiskEngine } from "./modules/risk/risk.engine.js";
import { InternalInventoryRoutingEngine, type RoutingEngine } from "./modules/routing/routing.engine.js";
import { SettlementEventService, type SettlementEventStore } from "./modules/settlement/settlement-event.service.js";
import { LocalSettlementVerifier, type SettlementVerifier } from "./modules/settlement/settlement-verifier.service.js";
import { LocalEIP712SignerService, ObservedSignerService, type SignerService } from "./modules/signer/signer.service.js";
import { APIError, toAPIError } from "./shared/errors/api-error.js";
import { validateQuoteRequest } from "./shared/validation/quote-request.js";
import { validateSubmitQuoteRequest } from "./shared/validation/submit-request.js";
import type { PnlTradeRecord } from "./shared/types/rfq.js";

const defaultBodyLimitBytes = 32_768;
const defaultCorsAllowedOrigins = ["http://localhost:5173"];
const defaultEnableHsts = false;

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
  marketDataService?: MarketDataService;
  pricingEngine?: PricingEngine;
  quoteRepository?: QuoteRepository;
  riskEngine?: RiskEngine;
  routingEngine?: RoutingEngine;
  hedgeService?: HedgeIntentService;
  pnlService?: PnlStore;
  settlementEventService?: SettlementEventStore;
  settlementVerifier?: SettlementVerifier;
  signerService?: SignerService;
  rateLimit?: Partial<RateLimitConfig> | false;
  quoteTtlSeconds?: number;
  bodyLimitBytes?: number;
  corsAllowedOrigins?: readonly string[] | false;
  enableHsts?: boolean;
}

export function buildServer(options: BuildServerOptions = {}) {
  const server = Fastify({
    logger: options.logger ?? true,
    bodyLimit: options.bodyLimitBytes ?? readBodyLimitBytes(),
  });
  const corsAllowedOrigins = options.corsAllowedOrigins === false
    ? []
    : options.corsAllowedOrigins ?? readCorsAllowedOrigins();
  const enableHsts = options.enableHsts ?? readEnableHsts();
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

  const hedgeService = options.hedgeService ?? new HedgeService();
  const marketDataService = options.marketDataService ?? new StaticMarketDataService();
  const metricsService = new MetricsService();
  const signerService = options.signerService ?? new LocalEIP712SignerService(readSignerConfig());
  const quoteRepository = options.quoteRepository ?? new InMemoryQuoteRepository();
  const inventoryService = new InventoryService();
  const settlementEventService = options.settlementEventService ?? new SettlementEventService(inventoryService);
  const executionService = new SkeletonExecutionService({
    hedgeService,
    inventoryService,
    settlementEventService,
    settlementVerifier: options.settlementVerifier ?? new LocalSettlementVerifier(),
  });
  const pnlService = options.pnlService ?? new PnlService();
  const rateLimiter = options.rateLimit === false
    ? undefined
    : new InMemoryRateLimiter({
      windowMs: options.rateLimit?.windowMs ?? 60_000,
      maxQuoteRequests: options.rateLimit?.maxQuoteRequests ?? 120,
      maxSubmitRequests: options.rateLimit?.maxSubmitRequests ?? 60,
      maxStatusRequests: options.rateLimit?.maxStatusRequests ?? 300,
  });
  const quoteService = new QuoteService({
    inventoryService,
    marketDataService,
    hedgeService,
    pricingEngine: options.pricingEngine ?? new FormulaPricingEngine(),
    quoteRepository,
    riskEngine: options.riskEngine ?? new BasicRiskEngine(),
    routingEngine: options.routingEngine ?? new InternalInventoryRoutingEngine(),
    signerService: new ObservedSignerService(signerService, metricsService),
  }, {
    ...defaultQuoteServiceConfig,
    quoteTtlSeconds: options.quoteTtlSeconds ?? readQuoteTtlSeconds(),
  });
  const readinessService = new ReadinessService({
    hedgeService,
    inventoryService,
    marketDataService,
    metricsService,
    pnlService,
    quoteRepository,
    settlementEventService,
    signerService,
  });

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
      const rateLimitResult = enforceRateLimit(rateLimiter, "status", request, reply);
      if (!rateLimitResult.allowed) {
        return rateLimitResult.response;
      }

      return pnlService.summary();
    } catch (error) {
      return sendError(reply, requestTraceId(request), pnlStoreFailure(error));
    }
  });
  server.get("/settlements/:settlementEventId", async (request, reply) => {
    try {
      const rateLimitResult = enforceRateLimit(rateLimiter, "status", request, reply);
      if (!rateLimitResult.allowed) {
        return rateLimitResult.response;
      }

      const { settlementEventId } = request.params as { settlementEventId: string };
      const status = settlementEventService.getSettlementEvent(settlementEventId);
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
      const rateLimitResult = enforceRateLimit(rateLimiter, "status", request, reply);
      if (!rateLimitResult.allowed) {
        return rateLimitResult.response;
      }

      const { quoteId } = request.params as { quoteId: string };
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
      const rateLimitResult = enforceRateLimit(rateLimiter, "status", request, reply);
      if (!rateLimitResult.allowed) {
        return rateLimitResult.response;
      }

      const { hedgeOrderId } = request.params as { hedgeOrderId: string };
      const status = hedgeService.getHedgeIntent(hedgeOrderId);
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
      const rateLimitResult = enforceRateLimit(rateLimiter, "quote", request, reply);
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
    metricsService.recordSubmitRequest();
    try {
      const rateLimitResult = enforceRateLimit(rateLimiter, "submit", request, reply);
      if (!rateLimitResult.allowed) {
        metricsService.recordSubmitError();
        return rateLimitResult.response;
      }

      const submitRequest = validateSubmitQuoteRequest(request.body);
      quoteId = await quoteService.requireSubmittableSignedQuote(submitRequest.quote, submitRequest.signature);
      const result = await executionService.submitQuote(submitRequest, { quoteId });
      const pnlRecord = result.settlementEventResult.duplicate
        ? undefined
        : recordPnlSettlementBestEffort(pnlService, metricsService, { quoteId, quote: submitRequest.quote });
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
        metricsService.recordInventoryPosition(result.inventoryPositions.tokenIn);
        metricsService.recordInventoryPosition(result.inventoryPositions.tokenOut);
      }
      await markPostSettlementQuoteStatus(quoteService, metricsService, quoteId, result.response.txHash);
      return reply.code(202).send({
        ...result.response,
        pnlId: pnlRecord?.pnlId,
      });
    } catch (error) {
      metricsService.recordSubmitError();
      const apiError = toAPIError(error);
      if (quoteId && apiError.code === "SETTLEMENT_REVERTED") {
        await markSettlementRejectedQuoteFailed(quoteService, metricsService, quoteId, apiError.code);
      }

      return sendError(reply, requestTraceId(request), apiError);
    } finally {
      metricsService.recordSubmitLatency(elapsedSeconds(startedAt));
    }
  });

  return server;
}

function enforceRateLimit(
  rateLimiter: InMemoryRateLimiter | undefined,
  endpoint: RateLimitedEndpoint,
  request: FastifyRequest,
  reply: FastifyReply,
): { allowed: true } | { allowed: false; response: FastifyReply } {
  if (!rateLimiter) {
    return { allowed: true };
  }

  const decision = rateLimiter.check({
    endpoint,
    clientId: clientIdForRateLimit(request),
  });
  if (decision.allowed) {
    reply.header("x-ratelimit-remaining", decision.remaining.toString());
    return { allowed: true };
  }

  const error = new APIError("RATE_LIMITED", "Too many requests", 429);
  return {
    allowed: false,
    response: sendError(reply.header("retry-after", decision.retryAfterSeconds.toString()), requestTraceId(request), error),
  };
}

function sendError(
  reply: FastifyReply,
  traceId: string,
  error: APIError,
) {
  return reply.header("x-trace-id", traceId).code(error.statusCode).send(error.toResponse(traceId));
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

  const record = error as { code?: unknown; statusCode?: unknown };
  if (record.code === "FST_ERR_CTP_BODY_TOO_LARGE" || record.statusCode === 413) {
    return new APIError("INVALID_REQUEST", "Request body too large", 413);
  }

  if (record.statusCode === 400) {
    return new APIError("INVALID_REQUEST", "Malformed JSON request body", 400);
  }

  if (record.statusCode === 415) {
    return new APIError("INVALID_REQUEST", "Request content type must be application/json", 415);
  }

  return toAPIError(error);
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

function recordPnlSettlementBestEffort(
  pnlService: PnlStore,
  metricsService: MetricsService,
  input: RecordPnlInput,
): PnlTradeRecord | undefined {
  try {
    return pnlService.recordSettlement(input);
  } catch {
    metricsService.recordPnlRecordError("PNL_RECORD_FAILED");
    return undefined;
  }
}

async function markPostSettlementQuoteStatus(
  quoteService: QuoteService,
  metricsService: MetricsService,
  quoteId: string,
  txHash?: `0x${string}`,
): Promise<void> {
  try {
    await quoteService.markQuoteStatus(quoteId, "submitted", txHash);
  } catch {
    metricsService.recordQuoteStatusUpdateError("submitted");
  }

  try {
    await quoteService.markQuoteStatus(quoteId, "settled", txHash);
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

function requestTraceId(request: FastifyRequest): string {
  return `tr_${request.id}`;
}

function elapsedSeconds(startedAt: number): number {
  return (Date.now() - startedAt) / 1000;
}

function clientIdForRateLimit(request: FastifyRequest): string {
  const forwardedFor = request.headers["x-forwarded-for"];
  if (typeof forwardedFor === "string" && forwardedFor.trim().length > 0) {
    return forwardedFor.split(",")[0]?.trim().toLowerCase() ?? request.ip;
  }

  return request.ip;
}

function readSignerConfig() {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  const isProduction = env?.NODE_ENV === "production";
  const privateKey = env?.RFQ_SIGNER_PRIVATE_KEY;
  const settlementAddress = env?.RFQ_SETTLEMENT_ADDRESS;
  if (isProduction) {
    requireProductionPrivateKey(privateKey);
    requireProductionAddress(settlementAddress, "RFQ_SETTLEMENT_ADDRESS");
  }

  return {
    privateKey: (privateKey ?? "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80") as `0x${string}`,
    settlementAddress: (settlementAddress ?? "0x0000000000000000000000000000000000000004") as `0x${string}`,
  };
}

function requireProductionEnv(value: string | undefined, name: string): string {
  if (!value || value.trim().length === 0) {
    throw new Error(`${name} is required when NODE_ENV=production`);
  }

  return value;
}

function requireProductionPrivateKey(value: string | undefined): void {
  const privateKey = requireProductionEnv(value, "RFQ_SIGNER_PRIVATE_KEY");
  if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
    throw new Error("RFQ_SIGNER_PRIVATE_KEY must be a 32-byte hex string when NODE_ENV=production");
  }
}

function requireProductionAddress(value: string | undefined, name: string): void {
  const address = requireProductionEnv(value, name);
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
    throw new Error(`${name} must be a 20-byte hex address when NODE_ENV=production`);
  }
}

function readQuoteTtlSeconds(): number {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  const configured = env?.RFQ_QUOTE_TTL_SECONDS;
  if (!configured || configured.trim().length === 0) {
    return defaultQuoteServiceConfig.quoteTtlSeconds;
  }

  const value = Number(configured);
  if (!Number.isInteger(value) || value <= 0 || value > 3600) {
    throw new Error("RFQ_QUOTE_TTL_SECONDS must be an integer between 1 and 3600");
  }

  return value;
}

function readBodyLimitBytes(): number {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  const configured = env?.RFQ_BODY_LIMIT_BYTES;
  if (!configured || configured.trim().length === 0) {
    return defaultBodyLimitBytes;
  }

  const value = Number(configured);
  if (!Number.isInteger(value) || value < 1024 || value > 1_048_576) {
    throw new Error("RFQ_BODY_LIMIT_BYTES must be an integer between 1024 and 1048576");
  }

  return value;
}

function readCorsAllowedOrigins(): string[] {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  const configured = env?.RFQ_CORS_ALLOWED_ORIGINS;
  if (!configured || configured.trim().length === 0) {
    return defaultCorsAllowedOrigins;
  }

  const origins = configured
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
  if (origins.length === 0 || origins.some((origin) => !/^https?:\/\/[^/\s]+$/.test(origin))) {
    throw new Error("RFQ_CORS_ALLOWED_ORIGINS must be a comma-separated list of HTTP(S) origins");
  }

  return origins;
}

function readEnableHsts(): boolean {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  const configured = env?.RFQ_ENABLE_HSTS;
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

export async function startServer() {
  const server = buildServer();
  const processLike = runtimeProcess();
  const port = Number(processLike?.env?.PORT ?? 3000);
  const host = processLike?.env?.HOST ?? "127.0.0.1";
  await server.listen({ host, port });
  installGracefulShutdown(server, processLike);
  return server;
}

function runtimeProcess(): RuntimeProcess | undefined {
  return (globalThis as { process?: RuntimeProcess }).process;
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
