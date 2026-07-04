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

test("QuoteService rejects unsafe quote requests before dependency side effects", async () => {
  let marketDataCalls = 0;
  const quoteRepository = new InMemoryQuoteRepository();
  const service = new QuoteService({
    ...quoteServiceDeps(),
    marketDataService: {
      async getSnapshot() {
        marketDataCalls += 1;
        throw new Error("market data should not be called");
      },
    },
    quoteRepository,
  });

  await assert.rejects(
    service.createQuote({
      ...request,
      tokenOut: request.tokenIn,
    }),
    /tokenIn and tokenOut must be different/,
  );

  assert.equal(marketDataCalls, 0);
  assert.equal(await quoteRepository.findStatus("q_invalid_pair"), undefined);
});

test("QuoteService persists expired status when signed quote status is read after deadline", async () => {
  const originalDateNow = Date.now;
  let now = originalDateNow();
  Date.now = () => now;
  const quoteRepository = new InMemoryQuoteRepository();

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
            return true;
          },
        },
      },
      {
        ...defaultQuoteServiceConfig,
        quoteTtlSeconds: 1,
      },
    );

    const quote = await service.createQuote(request);
    now += 2_000;

    const status = await service.getQuoteStatus(quote.quoteId);
    const persisted = await quoteRepository.findStatus(quote.quoteId);

    assert.equal(status.status, "expired");
    assert.equal(persisted.status, "expired");
  } finally {
    Date.now = originalDateNow;
  }
});

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
    marketSnapshotStore: new InMemoryMarketSnapshotRepository(),
    pricingEngine: new FormulaPricingEngine(),
    quoteRepository,
    riskDecisionStore: new InMemoryRiskDecisionRepository(),
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
  assert.match(status.snapshotId, /^snapshot_1_00000000_00000000_[0-9a-z]+_[0-9a-z]+$/);
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
    marketSnapshotStore: new InMemoryMarketSnapshotRepository(),
    pricingEngine: new FormulaPricingEngine(),
    quoteRepository,
    riskDecisionStore: new InMemoryRiskDecisionRepository(),
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
    marketSnapshotStore: new InMemoryMarketSnapshotRepository(),
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
  });

  await service.createQuote(request);

  assert.equal(observedInventorySkewBps, 75);
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
