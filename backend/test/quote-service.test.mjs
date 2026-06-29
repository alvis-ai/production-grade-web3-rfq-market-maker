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

test("InMemoryQuoteRepository indexes signed quotes by chain, user, and nonce", async () => {
  const quoteRepository = new InMemoryQuoteRepository();
  const baseSignedQuote = {
    user: request.user,
    tokenIn: request.tokenIn,
    tokenOut: request.tokenOut,
    amountIn: request.amountIn,
    amountOut: "998400000",
    minAmountOut: "993408000",
    nonce: "42",
    deadline: Math.floor(Date.now() / 1000) + 30,
  };

  await quoteRepository.saveSigned({
    quoteId: "q_chain_1",
    snapshotId: "snapshot_1",
    quote: {
      ...baseSignedQuote,
      chainId: 1,
    },
    pricingVersion: "test-pricing",
    riskPolicyVersion: "test-risk",
    signature: fixedSignature(),
  });
  await quoteRepository.saveSigned({
    quoteId: "q_chain_137",
    snapshotId: "snapshot_137",
    quote: {
      ...baseSignedQuote,
      chainId: 137,
    },
    pricingVersion: "test-pricing",
    riskPolicyVersion: "test-risk",
    signature: fixedSignature(),
  });

  const mainnet = await quoteRepository.findSignedQuoteByChainUserNonce(1, request.user, "42");
  const polygon = await quoteRepository.findSignedQuoteByChainUserNonce(137, request.user, "42");
  const missing = await quoteRepository.findSignedQuoteByChainUserNonce(10, request.user, "42");

  assert.equal(mainnet.quoteId, "q_chain_1");
  assert.equal(mainnet.chainId, 1);
  assert.equal(polygon.quoteId, "q_chain_137");
  assert.equal(polygon.chainId, 137);
  assert.equal(missing, undefined);
});

test("InMemoryQuoteRepository rejects signed quote nonce key conflicts", async () => {
  const quoteRepository = new InMemoryQuoteRepository();
  const baseSignedQuote = {
    user: request.user,
    tokenIn: request.tokenIn,
    tokenOut: request.tokenOut,
    amountIn: request.amountIn,
    amountOut: "998400000",
    minAmountOut: "993408000",
    nonce: "42",
    deadline: Math.floor(Date.now() / 1000) + 30,
    chainId: 1,
  };

  await quoteRepository.saveSigned({
    quoteId: "q_original",
    snapshotId: "snapshot_1",
    quote: baseSignedQuote,
    pricingVersion: "test-pricing",
    riskPolicyVersion: "test-risk",
    signature: fixedSignature(),
  });

  await assert.rejects(
    quoteRepository.saveSigned({
      quoteId: "q_conflict",
      snapshotId: "snapshot_2",
      quote: {
        ...baseSignedQuote,
        amountOut: "997000000",
      },
      pricingVersion: "test-pricing",
      riskPolicyVersion: "test-risk",
      signature: fixedSignature(),
    }),
    /Signed quote nonce key already exists/,
  );

  const indexed = await quoteRepository.findSignedQuoteByChainUserNonce(1, request.user, "42");
  assert.equal(indexed.quoteId, "q_original");
  assert.equal(indexed.amountOut, "998400000");
});

test("InMemoryQuoteRepository rejects signed quote identity rewrites", async () => {
  const quoteRepository = new InMemoryQuoteRepository();
  const baseSignedQuote = {
    user: request.user,
    tokenIn: request.tokenIn,
    tokenOut: request.tokenOut,
    amountIn: request.amountIn,
    amountOut: "998400000",
    minAmountOut: "993408000",
    nonce: "42",
    deadline: Math.floor(Date.now() / 1000) + 30,
    chainId: 1,
  };

  await quoteRepository.saveSigned({
    quoteId: "q_original",
    snapshotId: "snapshot_1",
    quote: baseSignedQuote,
    pricingVersion: "test-pricing",
    riskPolicyVersion: "test-risk",
    signature: fixedSignature(),
  });

  await assert.rejects(
    quoteRepository.saveSigned({
      quoteId: "q_original",
      snapshotId: "snapshot_2",
      quote: {
        ...baseSignedQuote,
        nonce: "43",
      },
      pricingVersion: "test-pricing",
      riskPolicyVersion: "test-risk",
      signature: fixedSignature(),
    }),
    /Signed quote identity cannot be changed/,
  );

  assert.equal(await quoteRepository.findQuoteIdByChainUserNonce(1, request.user, "43"), undefined);
  const indexed = await quoteRepository.findSignedQuoteByChainUserNonce(1, request.user, "42");
  assert.equal(indexed.quoteId, "q_original");
});

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

test("QuoteService includes hedge risk penalty in pricing input", async () => {
  let observedInventorySkewBps;
  const service = new QuoteService({
    inventoryService: new InventoryService(),
    marketDataService: new StaticMarketDataService(),
    pricingEngine: {
      async price(input) {
        observedInventorySkewBps = input.inventorySkewBps;
        return {
          amountOut: "998400000",
          minAmountOut: "993408000",
          spreadBps: input.inventorySkewBps,
          sizeImpactBps: 1,
          inventorySkewBps: input.inventorySkewBps,
          pricingVersion: "test-pricing",
        };
      },
    },
    hedgeService: {
      createHedgeIntent() {
        throw new Error("unused");
      },
      getHedgeIntent() {
        return undefined;
      },
      quoteRiskPenaltyBps() {
        return 75;
      },
    },
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
  });

  await service.createQuote(request);

  assert.equal(observedInventorySkewBps, 75);
});

function fixedSignature() {
  return `0x${"11".repeat(65)}`;
}
