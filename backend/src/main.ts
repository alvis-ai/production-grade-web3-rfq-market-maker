import Fastify from "fastify";
import { SkeletonExecutionService } from "./modules/execution/execution.service.js";
import { MetricsService } from "./modules/metrics/metrics.service.js";
import { StaticPricingEngine } from "./modules/pricing/pricing.engine.js";
import { QuoteService } from "./modules/quote/quote.service.js";
import { AllowAllRiskEngine } from "./modules/risk/risk.engine.js";
import { PlaceholderSignerService } from "./modules/signer/signer.service.js";
import type { SubmitQuoteRequest } from "./shared/types/rfq.js";

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
      return reply.code(404).send({
        code: "QUOTE_NOT_FOUND",
        message: "Quote not found",
      });
    }

    return status;
  });
  server.post("/quote", async (request) => {
    metricsService.recordQuoteRequest();
    const response = await quoteService.createQuote(request.body as never);
    metricsService.recordQuoteResponse();
    return response;
  });
  server.post("/submit", async (request) => {
    metricsService.recordSubmitRequest();
    const response = await executionService.submitQuote(request.body as SubmitQuoteRequest);
    return response;
  });

  return server;
}
