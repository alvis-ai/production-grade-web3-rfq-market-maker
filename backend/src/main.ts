import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import { SkeletonExecutionService } from "./modules/execution/execution.service.js";
import { HedgeService } from "./modules/hedge/hedge.service.js";
import { ReadinessService } from "./modules/health/readiness.service.js";
import { InventoryService } from "./modules/inventory/inventory.service.js";
import { StaticMarketDataService } from "./modules/market-data/market-data.service.js";
import { MetricsService } from "./modules/metrics/metrics.service.js";
import { FormulaPricingEngine } from "./modules/pricing/pricing.engine.js";
import { InMemoryQuoteRepository } from "./modules/quote/quote.repository.js";
import { QuoteService } from "./modules/quote/quote.service.js";
import { InMemoryRateLimiter, type RateLimitConfig, type RateLimitedEndpoint } from "./modules/rate-limit/rate-limit.service.js";
import { BasicRiskEngine } from "./modules/risk/risk.engine.js";
import { InternalInventoryRoutingEngine } from "./modules/routing/routing.engine.js";
import { LocalEIP712SignerService } from "./modules/signer/signer.service.js";
import { APIError, toAPIError } from "./shared/errors/api-error.js";
import { validateQuoteRequest } from "./shared/validation/quote-request.js";
import { validateSubmitQuoteRequest } from "./shared/validation/submit-request.js";

export interface BuildServerOptions {
  logger?: boolean;
  rateLimit?: Partial<RateLimitConfig> | false;
}

export function buildServer(options: BuildServerOptions = {}) {
  const server = Fastify({ logger: options.logger ?? true });
  const hedgeService = new HedgeService();
  const readinessService = new ReadinessService();
  const inventoryService = new InventoryService();
  const executionService = new SkeletonExecutionService({
    hedgeService,
    inventoryService,
  });
  const metricsService = new MetricsService();
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
    marketDataService: new StaticMarketDataService(),
    pricingEngine: new FormulaPricingEngine(),
    quoteRepository: new InMemoryQuoteRepository(),
    riskEngine: new BasicRiskEngine(),
    routingEngine: new InternalInventoryRoutingEngine(),
    signerService: new LocalEIP712SignerService(readSignerConfig()),
  });

  server.get("/health", async () => ({ status: "ok" }));
  server.get("/ready", async () => readinessService.check());
  server.get("/metrics", async (_request, reply) => {
    return reply.type("text/plain").send(metricsService.renderPrometheus());
  });
  server.get("/quote/:quoteId", async (request, reply) => {
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
    metricsService.recordSubmitRequest();
    try {
      const rateLimitResult = enforceRateLimit(rateLimiter, "submit", request, reply);
      if (!rateLimitResult.allowed) {
        metricsService.recordSubmitError();
        return rateLimitResult.response;
      }

      const submitRequest = validateSubmitQuoteRequest(request.body);
      const quoteId = await quoteService.requireSubmittableSignedQuote(submitRequest.quote, submitRequest.signature);
      const result = await executionService.submitQuote(submitRequest);
      metricsService.recordSubmitAccepted();
      metricsService.recordSettlement();
      metricsService.recordHedgeIntent();
      metricsService.recordInventoryPosition(result.inventoryPositions.tokenIn);
      metricsService.recordInventoryPosition(result.inventoryPositions.tokenOut);
      await quoteService.markQuoteStatus(quoteId, "submitted", result.response.txHash);
      await quoteService.markQuoteStatus(quoteId, "settled", result.response.txHash);
      return reply.code(202).send(result.response);
    } catch (error) {
      metricsService.recordSubmitError();
      return sendError(reply, requestTraceId(request), toAPIError(error));
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
  return {
    privateKey: (env?.RFQ_SIGNER_PRIVATE_KEY ??
      "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80") as `0x${string}`,
    settlementAddress: (env?.RFQ_SETTLEMENT_ADDRESS ??
      "0x0000000000000000000000000000000000000004") as `0x${string}`,
  };
}

export async function startServer() {
  const server = buildServer();
  const processLike = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  const port = Number(processLike?.env?.PORT ?? 3000);
  const host = processLike?.env?.HOST ?? "127.0.0.1";
  await server.listen({ host, port });
  return server;
}

const processLike = (
  globalThis as {
    process?: {
      argv?: string[];
      exitCode?: number;
    };
  }
).process;

if (processLike?.argv?.[1] && import.meta.url.endsWith(processLike.argv[1])) {
  startServer().catch((error: unknown) => {
    console.error(error);
    if (processLike) {
      processLike.exitCode = 1;
    }
  });
}
