import assert from "node:assert/strict";
import test from "node:test";
import { InventoryService } from "../dist/modules/inventory/inventory.service.js";
import { StaticMarketDataService } from "../dist/modules/market-data/market-data.service.js";
import { FormulaPricingEngine } from "../dist/modules/pricing/pricing.engine.js";
import { InMemoryQuoteRepository } from "../dist/modules/quote/quote.repository.js";
import { defaultQuoteServiceConfig, QuoteService } from "../dist/modules/quote/quote.service.js";
import { BasicRiskEngine } from "../dist/modules/risk/risk.engine.js";
import { InternalInventoryRoutingEngine } from "../dist/modules/routing/routing.engine.js";
import { APIError } from "../dist/shared/errors/api-error.js";

const request = {
  chainId: 1,
  user: "0x0000000000000000000000000000000000000001",
  tokenIn: "0x0000000000000000000000000000000000000002",
  tokenOut: "0x0000000000000000000000000000000000000003",
  amountIn: "1000000000",
  slippageBps: 50,
};

test("QuoteService uses configured quote TTL when generating signed quote deadlines", async () => {
  const originalDateNow = Date.now;
  const fixedNow = originalDateNow();
  Date.now = () => fixedNow;

  try {
    const service = new QuoteService(
      {
        inventoryService: new InventoryService(),
        marketDataService: new StaticMarketDataService(),
        pricingEngine: new FormulaPricingEngine(),
        quoteRepository: new InMemoryQuoteRepository(),
        riskEngine: new BasicRiskEngine(),
        routingEngine: new InternalInventoryRoutingEngine(),
        signerService: {
          async signQuote() {
            return fixedSignature();
          },
          async verifyQuoteSignature() {
            return true;
          },
        },
      },
      {
        ...defaultQuoteServiceConfig,
        quoteTtlSeconds: 120,
      },
    );

    const quote = await service.createQuote(request);

    assert.equal(quote.deadline, Math.floor(fixedNow / 1000) + 120);
  } finally {
    Date.now = originalDateNow;
  }
});

test("QuoteService marks requested quotes as failed when signer is unavailable", async () => {
  const quoteRepository = new InMemoryQuoteRepository();
  const saveRequested = quoteRepository.saveRequested.bind(quoteRepository);
  let requestedQuoteId;
  quoteRepository.saveRequested = async (input) => {
    requestedQuoteId = input.quoteId;
    await saveRequested(input);
  };

  const service = new QuoteService({
    inventoryService: new InventoryService(),
    marketDataService: new StaticMarketDataService(),
    pricingEngine: new FormulaPricingEngine(),
    quoteRepository,
    riskEngine: new BasicRiskEngine(),
    routingEngine: new InternalInventoryRoutingEngine(),
    signerService: {
      async signQuote() {
        throw new APIError("SIGNER_UNAVAILABLE", "Signer service unavailable", 503);
      },
      async verifyQuoteSignature() {
        return false;
      },
    },
  });

  await assert.rejects(
    service.createQuote(request),
    (error) => {
      assert.equal(error.code, "SIGNER_UNAVAILABLE");
      return true;
    },
  );

  assert.match(requestedQuoteId, /^q_/);
  const status = await quoteRepository.findStatus(requestedQuoteId);
  assert.equal(status.status, "failed");
  assert.equal(status.errorCode, "SIGNER_UNAVAILABLE");
  assert.equal(status.snapshotId, "snapshot_1_00000000_00000000");
});

test("QuoteService preserves signer errors when marking failed quotes fails", async () => {
  const quoteRepository = new InMemoryQuoteRepository();
  const saveRequested = quoteRepository.saveRequested.bind(quoteRepository);
  let requestedQuoteId;
  quoteRepository.saveRequested = async (input) => {
    requestedQuoteId = input.quoteId;
    await saveRequested(input);
  };
  quoteRepository.markFailed = async () => {
    throw new Error("quote store offline");
  };

  const service = new QuoteService({
    inventoryService: new InventoryService(),
    marketDataService: new StaticMarketDataService(),
    pricingEngine: new FormulaPricingEngine(),
    quoteRepository,
    riskEngine: new BasicRiskEngine(),
    routingEngine: new InternalInventoryRoutingEngine(),
    signerService: {
      async signQuote() {
        throw new APIError("SIGNER_UNAVAILABLE", "Signer service unavailable", 503);
      },
      async verifyQuoteSignature() {
        return false;
      },
    },
  });

  await assert.rejects(
    service.createQuote(request),
    (error) => {
      assert.equal(error.code, "SIGNER_UNAVAILABLE");
      return true;
    },
  );

  assert.match(requestedQuoteId, /^q_/);
  const status = await quoteRepository.findStatus(requestedQuoteId);
  assert.equal(status.status, "requested");
  assert.equal(status.errorCode, undefined);
});

function fixedSignature() {
  return `0x${"11".repeat(65)}`;
}
