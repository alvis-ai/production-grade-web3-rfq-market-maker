import Fastify from "fastify";
import { StaticPricingEngine } from "./modules/pricing/pricing.engine.js";
import { QuoteService } from "./modules/quote/quote.service.js";
import { AllowAllRiskEngine } from "./modules/risk/risk.engine.js";
import { PlaceholderSignerService } from "./modules/signer/signer.service.js";

export function buildServer() {
  const server = Fastify({ logger: true });
  const quoteService = new QuoteService({
    pricingEngine: new StaticPricingEngine(),
    riskEngine: new AllowAllRiskEngine(),
    signerService: new PlaceholderSignerService(),
  });

  server.get("/health", async () => ({ status: "ok" }));
  server.post("/quote", async (request) => quoteService.createQuote(request.body as never));

  return server;
}
