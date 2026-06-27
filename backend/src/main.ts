import Fastify from "fastify";
import { SkeletonExecutionService } from "./modules/execution/execution.service.js";
import { HedgeService } from "./modules/hedge/hedge.service.js";
import { InventoryService } from "./modules/inventory/inventory.service.js";
import { StaticMarketDataService } from "./modules/market-data/market-data.service.js";
import { MetricsService } from "./modules/metrics/metrics.service.js";
import { StaticPricingEngine } from "./modules/pricing/pricing.engine.js";
import { InMemoryQuoteRepository } from "./modules/quote/quote.repository.js";
import { QuoteService } from "./modules/quote/quote.service.js";
import { BasicRiskEngine } from "./modules/risk/risk.engine.js";
import { InternalInventoryRoutingEngine } from "./modules/routing/routing.engine.js";
import { LocalEIP712SignerService } from "./modules/signer/signer.service.js";
import { APIError, toAPIError } from "./shared/errors/api-error.js";
import { validateQuoteRequest } from "./shared/validation/quote-request.js";
import { validateSubmitQuoteRequest } from "./shared/validation/submit-request.js";

export function buildServer() {
  const server = Fastify({ logger: true });
  const hedgeService = new HedgeService();
  const inventoryService = new InventoryService();
  const executionService = new SkeletonExecutionService({
    hedgeService,
    inventoryService,
  });
  const metricsService = new MetricsService();
  const quoteService = new QuoteService({
    marketDataService: new StaticMarketDataService(),
    pricingEngine: new StaticPricingEngine(),
    quoteRepository: new InMemoryQuoteRepository(),
    riskEngine: new BasicRiskEngine(),
    routingEngine: new InternalInventoryRoutingEngine(),
    signerService: new LocalEIP712SignerService(readSignerConfig()),
  });

  server.get("/health", async () => ({ status: "ok" }));
  server.get("/metrics", async (_request, reply) => {
    return reply.type("text/plain").send(metricsService.renderPrometheus());
  });
  server.get("/quote/:quoteId", async (request, reply) => {
    const { quoteId } = request.params as { quoteId: string };
    const status = await quoteService.getQuoteStatus(quoteId);
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
      const result = await executionService.submitQuote(submitRequest);
      metricsService.recordSubmitAccepted();
      metricsService.recordSettlement();
      metricsService.recordHedgeIntent();
      const quoteId = await quoteService.getQuoteIdForSignedQuote(submitRequest.quote);
      if (quoteId) {
        await quoteService.markQuoteStatus(quoteId, "submitted", result.response.txHash);
        await quoteService.markQuoteStatus(quoteId, "settled", result.response.txHash);
      }
      return reply.code(202).send(result.response);
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
