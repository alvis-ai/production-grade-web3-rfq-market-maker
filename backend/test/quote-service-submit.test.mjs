import assert from "node:assert/strict";
import test from "node:test";
import { InventoryService } from "../dist/modules/inventory/inventory.service.js";
import { StaticMarketDataService } from "../dist/modules/market-data/market-data.service.js";
import { InMemoryMarketSnapshotRepository } from "../dist/modules/market-data/market-snapshot.repository.js";
import { FormulaPricingEngine } from "../dist/modules/pricing/pricing.engine.js";
import { InMemoryQuoteRepository } from "../dist/modules/quote/quote.repository.js";
import { defaultQuoteServiceConfig, QuoteService } from "../dist/modules/quote/quote.service.js";
import { InMemoryRiskDecisionRepository } from "../dist/modules/risk/risk-decision.repository.js";
import { BasicRiskEngine } from "../dist/modules/risk/risk.engine.js";
import { InternalInventoryRoutingEngine } from "../dist/modules/routing/routing.engine.js";

const request = {
  chainId: 1,
  user: "0x0000000000000000000000000000000000000001",
  tokenIn: "0x0000000000000000000000000000000000000002",
  tokenOut: "0x0000000000000000000000000000000000000003",
  amountIn: "1000000000",
  slippageBps: 50,
};

test("QuoteService rejects unsafe submit quotes before quote lookup or signature verification", async () => {
  const quoteRepository = new InMemoryQuoteRepository();
  let lookupCalls = 0;
  let verifyCalls = 0;
  quoteRepository.findSignedQuoteByChainUserNonce = async () => {
    lookupCalls += 1;
    throw new Error("quote lookup should not be called");
  };
  const service = new QuoteService({
    ...quoteServiceDeps(),
    quoteRepository,
    signerService: {
      async signQuote() {
        return fixedSignature();
      },
      async verifyQuoteSignature() {
        verifyCalls += 1;
        throw new Error("signature verification should not be called");
      },
    },
  });

  await assert.rejects(
    service.requireSubmittableSignedQuote(
      {
        user: request.user,
        tokenIn: request.tokenIn,
        tokenOut: request.tokenIn,
        amountIn: request.amountIn,
        amountOut: "998400000",
        minAmountOut: "993408000",
        nonce: "1",
        deadline: 1893456000,
        chainId: request.chainId,
      },
      fixedSignature(),
    ),
    /quote.tokenIn and quote.tokenOut must be different/,
  );

  assert.equal(lookupCalls, 0);
  assert.equal(verifyCalls, 0);
});

test("QuoteService rejects submit signatures that differ from the stored signed quote", async () => {
  const quoteRepository = new InMemoryQuoteRepository();
  let verifyCalls = 0;
  const service = new QuoteService({
    ...quoteServiceDeps(),
    quoteRepository,
    signerService: {
      async signQuote() {
        return fixedSignature();
      },
      async verifyQuoteSignature() {
        verifyCalls += 1;
        return true;
      },
    },
  });

  const quoteResponse = await service.createQuote(request);
  const signedQuote = {
    user: request.user,
    tokenIn: request.tokenIn,
    tokenOut: request.tokenOut,
    amountIn: request.amountIn,
    amountOut: quoteResponse.amountOut,
    minAmountOut: quoteResponse.minAmountOut,
    nonce: quoteResponse.nonce,
    deadline: quoteResponse.deadline,
    chainId: request.chainId,
  };

  await assert.rejects(
    service.requireSubmittableSignedQuote(signedQuote, alternateSignature()),
    (error) => {
      assert.equal(error.code, "INVALID_SIGNATURE");
      assert.equal(error.statusCode, 409);
      assert.equal(error.message, "Quote signature does not match stored signed quote");
      return true;
    },
  );

  const status = await quoteRepository.findStatus(quoteResponse.quoteId);
  assert.equal(status.status, "signed");
  assert.equal(verifyCalls, 0);
});

test("QuoteService rejects expired signed quotes before signature verification", async () => {
  const originalDateNow = Date.now;
  let now = originalDateNow();
  Date.now = () => now;
  const quoteRepository = new InMemoryQuoteRepository();
  let verifyCalls = 0;

  try {
    const service = new QuoteService(
      {
        inventoryService: new InventoryService(),
        marketDataService: new StaticMarketDataService(),
        marketSnapshotStore: new InMemoryMarketSnapshotRepository(),
        pricingEngine: new FormulaPricingEngine(),
        quoteRepository,
        riskDecisionStore: new InMemoryRiskDecisionRepository(),
        riskEngine: new BasicRiskEngine(),
        routingEngine: new InternalInventoryRoutingEngine(),
        signerService: {
          async signQuote() {
            return fixedSignature();
          },
          async verifyQuoteSignature() {
            verifyCalls += 1;
            return true;
          },
        },
      },
      {
        ...defaultQuoteServiceConfig,
        quoteTtlSeconds: 1,
      },
    );

    const quoteResponse = await service.createQuote(request);
    const signedQuote = {
      user: request.user,
      tokenIn: request.tokenIn,
      tokenOut: request.tokenOut,
      amountIn: request.amountIn,
      amountOut: quoteResponse.amountOut,
      minAmountOut: quoteResponse.minAmountOut,
      nonce: quoteResponse.nonce,
      deadline: quoteResponse.deadline,
      chainId: request.chainId,
    };
    now += 2_000;

    await assert.rejects(
      service.requireSubmittableSignedQuote(signedQuote, quoteResponse.signature),
      (error) => {
        assert.equal(error.code, "QUOTE_EXPIRED");
        assert.equal(error.statusCode, 409);
        return true;
      },
    );

    const persisted = await quoteRepository.findStatus(quoteResponse.quoteId);
    assert.equal(persisted.status, "expired");
    assert.equal(verifyCalls, 0);
  } finally {
    Date.now = originalDateNow;
  }
});

function fixedSignature() {
  return `0x${"11".repeat(64)}1b`;
}

function alternateSignature() {
  return `0x${"22".repeat(64)}1c`;
}

function quoteServiceDeps() {
  return {
    inventoryService: new InventoryService(),
    marketDataService: new StaticMarketDataService(),
    marketSnapshotStore: new InMemoryMarketSnapshotRepository(),
    pricingEngine: new FormulaPricingEngine(),
    quoteRepository: new InMemoryQuoteRepository(),
    riskDecisionStore: new InMemoryRiskDecisionRepository(),
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
  };
}
