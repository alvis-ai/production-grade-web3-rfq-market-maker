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

test("InMemoryQuoteRepository rejects unsafe signed quote persistence inputs", async () => {
  const quoteRepository = new InMemoryQuoteRepository();
  const signedQuote = {
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
  const input = {
    quoteId: "q_invalid",
    snapshotId: "snapshot_1",
    quote: signedQuote,
    pricingVersion: "test-pricing",
    riskPolicyVersion: "test-risk",
    signature: fixedSignature(),
  };

  await assert.rejects(
    quoteRepository.saveSigned({
      ...input,
      pricingVersion: " ",
    }),
    /Signed quote pricingVersion must be a non-empty string/,
  );

  await assert.rejects(
    quoteRepository.saveSigned({
      ...input,
      quote: {
        ...signedQuote,
        tokenOut: "0x00000000000000000000000000000000000000zz",
      },
    }),
    /Signed quote quote.tokenOut must be a 20-byte hex address/,
  );

  await assert.rejects(
    quoteRepository.saveSigned({
      ...input,
      quote: {
        ...signedQuote,
        amountIn: "0",
      },
    }),
    /Signed quote quote.amountIn must be a positive uint string/,
  );

  await assert.rejects(
    quoteRepository.saveSigned({
      ...input,
      quote: {
        ...signedQuote,
        amountOut: "993407999",
      },
    }),
    /Signed quote amountOut must be greater than or equal to minAmountOut/,
  );

  await assert.rejects(
    quoteRepository.saveSigned({
      ...input,
      signature: "0x11",
    }),
    /Signed quote signature must be a 65-byte hex string/,
  );

  assert.equal(await quoteRepository.findSignedQuoteByChainUserNonce(1, request.user, "42"), undefined);
});

test("InMemoryQuoteRepository rejects unsafe requested and rejected quote persistence inputs", async () => {
  const quoteRepository = new InMemoryQuoteRepository();

  await assert.rejects(
    quoteRepository.saveRequested({
      quoteId: " ",
      snapshotId: "snapshot_1",
      request,
    }),
    /Requested quote quoteId must be a non-empty string/,
  );

  await assert.rejects(
    quoteRepository.saveRequested({
      quoteId: "q_bad_request",
      snapshotId: "snapshot_1",
      request: {
        ...request,
        tokenOut: "0x00000000000000000000000000000000000000zz",
      },
    }),
    /Requested quote request.tokenOut must be a 20-byte hex address/,
  );

  await assert.rejects(
    quoteRepository.saveRequested({
      quoteId: "q_bad_slippage",
      snapshotId: "snapshot_1",
      request: {
        ...request,
        slippageBps: 10_001,
      },
    }),
    /Requested quote request.slippageBps must be less than or equal to 10000 bps/,
  );

  await assert.rejects(
    quoteRepository.saveRejected({
      quoteId: "q_bad_reject",
      snapshotId: "snapshot_1",
      request,
      rejectCode: " ",
    }),
    /Rejected quote rejectCode must be a non-empty string/,
  );

  await assert.rejects(
    quoteRepository.saveRejected({
      quoteId: "q_bad_policy",
      snapshotId: "snapshot_1",
      request,
      rejectCode: "RISK_REJECTED",
      riskPolicyVersion: "",
    }),
    /Rejected quote riskPolicyVersion must be a non-empty string/,
  );

  assert.equal(await quoteRepository.findStatus("q_bad_request"), undefined);
  assert.equal(await quoteRepository.findStatus("q_bad_reject"), undefined);
});

test("InMemoryQuoteRepository preserves settlement metadata across status updates", async () => {
  const quoteRepository = new InMemoryQuoteRepository();
  const signedQuote = {
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
    quoteId: "q_status",
    snapshotId: "snapshot_1",
    quote: signedQuote,
    pricingVersion: "test-pricing",
    riskPolicyVersion: "test-risk",
    signature: fixedSignature(),
  });

  await quoteRepository.markStatus("q_status", "submitted", {
    txHash: `0x${"aa".repeat(32)}`,
    settlementEventId: "se_1",
    hedgeOrderId: "h_1",
    pnlId: "pnl_1",
  });
  await quoteRepository.markStatus("q_status", "settled");

  const status = await quoteRepository.findStatus("q_status");
  assert.equal(status.status, "settled");
  assert.equal(status.txHash, `0x${"aa".repeat(32)}`);
  assert.equal(status.settlementEventId, "se_1");
  assert.equal(status.hedgeOrderId, "h_1");
  assert.equal(status.pnlId, "pnl_1");
});

test("InMemoryQuoteRepository rejects terminal quote status regressions", async () => {
  const quoteRepository = new InMemoryQuoteRepository();
  const signedQuote = {
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
    quoteId: "q_settled",
    snapshotId: "snapshot_1",
    quote: signedQuote,
    pricingVersion: "test-pricing",
    riskPolicyVersion: "test-risk",
    signature: fixedSignature(),
  });
  await quoteRepository.markStatus("q_settled", "submitted", {
    txHash: `0x${"aa".repeat(32)}`,
    settlementEventId: "se_1",
  });
  await quoteRepository.markStatus("q_settled", "settled", {
    hedgeOrderId: "h_1",
  });

  await assert.rejects(
    quoteRepository.markStatus("q_settled", "submitted"),
    /cannot transition from settled to submitted/,
  );
  await assert.rejects(
    quoteRepository.markFailed("q_settled", "SETTLEMENT_REVERTED"),
    /cannot transition from settled to failed/,
  );

  await quoteRepository.markStatus("q_settled", "settled", {
    pnlId: "pnl_1",
  });
  const settled = await quoteRepository.findStatus("q_settled");
  assert.equal(settled.status, "settled");
  assert.equal(settled.txHash, `0x${"aa".repeat(32)}`);
  assert.equal(settled.settlementEventId, "se_1");
  assert.equal(settled.hedgeOrderId, "h_1");
  assert.equal(settled.pnlId, "pnl_1");

  await quoteRepository.saveRequested({
    quoteId: "q_rejected",
    snapshotId: "snapshot_2",
    request,
  });
  await quoteRepository.saveRejected({
    quoteId: "q_rejected",
    snapshotId: "snapshot_2",
    request,
    rejectCode: "RISK_REJECTED",
  });
  await assert.rejects(
    quoteRepository.markStatus("q_rejected", "submitted"),
    /cannot transition from terminal status rejected to submitted/,
  );

  await quoteRepository.saveSigned({
    quoteId: "q_failed",
    snapshotId: "snapshot_3",
    quote: {
      ...signedQuote,
      nonce: "43",
    },
    pricingVersion: "test-pricing",
    riskPolicyVersion: "test-risk",
    signature: fixedSignature(),
  });
  await quoteRepository.markFailed("q_failed", "SIGNER_UNAVAILABLE");
  await assert.rejects(
    quoteRepository.markStatus("q_failed", "settled"),
    /cannot transition from terminal status failed to settled/,
  );
});

test("InMemoryQuoteRepository rejects malformed quote status metadata", async () => {
  const quoteRepository = new InMemoryQuoteRepository();
  const signedQuote = {
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
    quoteId: "q_metadata",
    snapshotId: "snapshot_1",
    quote: signedQuote,
    pricingVersion: "test-pricing",
    riskPolicyVersion: "test-risk",
    signature: fixedSignature(),
  });

  await assert.rejects(
    quoteRepository.markStatus("q_metadata", "submitted", {
      txHash: "0x1234",
    }),
    /Quote status txHash must be a 32-byte hex string/,
  );
  await assert.rejects(
    quoteRepository.markStatus("q_metadata", "submitted", {
      settlementEventId: " ",
    }),
    /Quote status settlementEventId must be a non-empty string/,
  );
  await assert.rejects(
    quoteRepository.markStatus("q_metadata", "submitted", {
      hedgeOrderId: "",
    }),
    /Quote status hedgeOrderId must be a non-empty string/,
  );
  await assert.rejects(
    quoteRepository.markStatus("q_metadata", "submitted", {
      pnlId: " ",
    }),
    /Quote status pnlId must be a non-empty string/,
  );

  const status = await quoteRepository.findStatus("q_metadata");
  assert.equal(status.status, "signed");
  assert.equal(status.txHash, undefined);
  assert.equal(status.settlementEventId, undefined);
  assert.equal(status.hedgeOrderId, undefined);
  assert.equal(status.pnlId, undefined);
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

test("QuoteService rejects unsafe runtime configuration at construction", () => {
  assert.throws(
    () =>
      new QuoteService(quoteServiceDeps(), {
        ...defaultQuoteServiceConfig,
        maxSnapshotAgeMs: 0,
      }),
    /Quote service maxSnapshotAgeMs must be a positive safe integer/,
  );

  assert.throws(
    () =>
      new QuoteService(quoteServiceDeps(), {
        ...defaultQuoteServiceConfig,
        maxSnapshotFutureSkewMs: Number.MAX_SAFE_INTEGER + 1,
      }),
    /Quote service maxSnapshotFutureSkewMs must be a positive safe integer/,
  );

  assert.throws(
    () =>
      new QuoteService(quoteServiceDeps(), {
        ...defaultQuoteServiceConfig,
        quoteTtlSeconds: -1,
      }),
    /Quote service quoteTtlSeconds must be a positive safe integer/,
  );
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

function quoteServiceDeps() {
  return {
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
  };
}
