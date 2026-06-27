import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import { SkeletonExecutionService } from "./modules/execution/execution.service.js";
import { HedgeService } from "./modules/hedge/hedge.service.js";
import { ReadinessService } from "./modules/health/readiness.service.js";
import { InventoryService } from "./modules/inventory/inventory.service.js";
import { StaticMarketDataService, type MarketDataService } from "./modules/market-data/market-data.service.js";
import { MetricsService } from "./modules/metrics/metrics.service.js";
import { PnlService } from "./modules/pnl/pnl.service.js";
import { FormulaPricingEngine } from "./modules/pricing/pricing.engine.js";
import { InMemoryQuoteRepository } from "./modules/quote/quote.repository.js";
import { QuoteService } from "./modules/quote/quote.service.js";
import { InMemoryRateLimiter, type RateLimitConfig, type RateLimitedEndpoint } from "./modules/rate-limit/rate-limit.service.js";
import { BasicRiskEngine, type RiskEngine } from "./modules/risk/risk.engine.js";
import { InternalInventoryRoutingEngine } from "./modules/routing/routing.engine.js";
import { SettlementEventService } from "./modules/settlement/settlement-event.service.js";
import { LocalSettlementVerifier, type SettlementVerifier } from "./modules/settlement/settlement-verifier.service.js";
import { LocalEIP712SignerService, ObservedSignerService, type SignerService } from "./modules/signer/signer.service.js";
import { APIError, toAPIError } from "./shared/errors/api-error.js";
import { validateQuoteRequest } from "./shared/validation/quote-request.js";
import { validateSubmitQuoteRequest } from "./shared/validation/submit-request.js";

export interface BuildServerOptions {
  logger?: boolean;
  marketDataService?: MarketDataService;
  riskEngine?: RiskEngine;
  settlementVerifier?: SettlementVerifier;
  signerService?: SignerService;
  rateLimit?: Partial<RateLimitConfig> | false;
}

export function buildServer(options: BuildServerOptions = {}) {
  const server = Fastify({ logger: options.logger ?? true });
  const hedgeService = new HedgeService();
  const marketDataService = options.marketDataService ?? new StaticMarketDataService();
  const readinessService = new ReadinessService({ marketDataService });
  const inventoryService = new InventoryService();
  const settlementEventService = new SettlementEventService(inventoryService);
  const executionService = new SkeletonExecutionService({
    hedgeService,
    inventoryService,
    settlementEventService,
    settlementVerifier: options.settlementVerifier ?? new LocalSettlementVerifier(),
  });
  const metricsService = new MetricsService();
  const pnlService = new PnlService();
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
    pricingEngine: new FormulaPricingEngine(),
    quoteRepository: new InMemoryQuoteRepository(),
    riskEngine: options.riskEngine ?? new BasicRiskEngine(),
    routingEngine: new InternalInventoryRoutingEngine(),
    signerService: new ObservedSignerService(
      options.signerService ?? new LocalEIP712SignerService(readSignerConfig()),
      metricsService,
    ),
  });

  server.get("/health", async () => ({ status: "ok" }));
  server.get("/ready", async (_request, reply) => {
    const readiness = await readinessService.check();
    if (readiness.status === "degraded") {
      return reply.code(503).send(readiness);
    }

    return readiness;
  });
  server.get("/metrics", async (_request, reply) => {
    return reply.type("text/plain").send(metricsService.renderPrometheus());
  });
  server.get("/pnl", async (request, reply) => {
    const rateLimitResult = enforceRateLimit(rateLimiter, "status", request, reply);
    if (!rateLimitResult.allowed) {
      return rateLimitResult.response;
    }

    return pnlService.summary();
  });
  server.get("/settlements/:settlementEventId", async (request, reply) => {
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
  server.get("/hedges/:hedgeOrderId", async (request, reply) => {
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
      const pnlRecord = pnlService.recordSettlement({ quoteId, quote: submitRequest.quote });
      metricsService.recordSubmitAccepted();
      metricsService.recordSettlement();
      metricsService.recordHedgeIntent();
      metricsService.recordPnlTrade(pnlRecord);
      metricsService.recordInventoryPosition(result.inventoryPositions.tokenIn);
      metricsService.recordInventoryPosition(result.inventoryPositions.tokenOut);
      await quoteService.markQuoteStatus(quoteId, "submitted", result.response.txHash);
      await quoteService.markQuoteStatus(quoteId, "settled", result.response.txHash);
      return reply.code(202).send({
        ...result.response,
        pnlId: pnlRecord.pnlId,
      });
    } catch (error) {
      metricsService.recordSubmitError();
      const apiError = toAPIError(error);
      if (quoteId && apiError.code === "SETTLEMENT_REVERTED") {
        await quoteService.markQuoteFailed(quoteId, apiError.code);
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
