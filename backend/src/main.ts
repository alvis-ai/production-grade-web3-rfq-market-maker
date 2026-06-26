import Fastify from "fastify";
import { SkeletonExecutionService } from "./modules/execution/execution.service.js";
import { MetricsService } from "./modules/metrics/metrics.service.js";
import { StaticPricingEngine } from "./modules/pricing/pricing.engine.js";
import { QuoteService } from "./modules/quote/quote.service.js";
import { AllowAllRiskEngine } from "./modules/risk/risk.engine.js";
import { PlaceholderSignerService } from "./modules/signer/signer.service.js";
import { APIError, toAPIError } from "./shared/errors/api-error.js";
import { validateQuoteRequest } from "./shared/validation/quote-request.js";
import { validateSubmitQuoteRequest } from "./shared/validation/submit-request.js";

export function buildServer() {
  const server = Fastify({ logger: true });
  const executionService = new SkeletonExecutionService();
  const metricsService = new MetricsService();
  const quoteService = new QuoteService({
    pricingEngine: new StaticPricingEngine(),
    riskEngine: new AllowAllRiskEngine(),
    signerService: new PlaceholderSignerService(),
  });

  server.get("/health", async () => ({ status: "ok" }));
  server.get("/metrics", async (_request, reply) => {
    return reply.type("text/plain").send(metricsService.renderPrometheus());
  });
  server.get("/quote/:quoteId", async (request, reply) => {
    const { quoteId } = request.params as { quoteId: string };
    const status = quoteService.getQuoteStatus(quoteId);
    if (!status) {
      return sendError(reply, new APIError("QUOTE_NOT_FOUND", "Quote not found", 404));
    }

    return status;
  });
  server.post("/quote", async (request, reply) => {
    metricsService.recordQuoteRequest();
    try {
      const quoteRequest = validateQuoteRequest(request.body);
      const response = await quoteService.createQuote(quoteRequest);
      metricsService.recordQuoteResponse();
      return response;
    } catch (error) {
      metricsService.recordQuoteError();
      return sendError(reply, toAPIError(error));
    }
  });
  server.post("/submit", async (request, reply) => {
    metricsService.recordSubmitRequest();
    try {
      const submitRequest = validateSubmitQuoteRequest(request.body);
      const response = await executionService.submitQuote(submitRequest);
      return response;
    } catch (error) {
      metricsService.recordSubmitError();
      return sendError(reply, toAPIError(error));
    }
  });

  return server;
}

function sendError(
  reply: {
    code: (statusCode: number) => {
      send: (payload: unknown) => unknown;
    };
  },
  error: APIError,
) {
  return reply.code(error.statusCode).send(error.toResponse());
}

export async function startServer() {
  const server = buildServer();
  const processLike = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  const port = Number(processLike?.env?.PORT ?? 3000);
  await server.listen({ host: "0.0.0.0", port });
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
