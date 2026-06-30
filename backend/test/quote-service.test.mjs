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
    slippageBps: request.slippageBps,
    spreadBps: 8,
    sizeImpactBps: 0,
    inventorySkewBps: 0,
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
    slippageBps: request.slippageBps,
    spreadBps: 8,
    sizeImpactBps: 0,
    inventorySkewBps: 0,
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
  const byQuoteId = await quoteRepository.findSignedQuoteByQuoteId("q_chain_1");

  assert.equal(mainnet.quoteId, "q_chain_1");
  assert.equal(byQuoteId.quoteId, "q_chain_1");
  assert.equal(byQuoteId.nonce, "42");
  assert.equal(byQuoteId.slippageBps, request.slippageBps);
  assert.equal(byQuoteId.spreadBps, 8);
  assert.equal(byQuoteId.sizeImpactBps, 0);
  assert.equal(byQuoteId.inventorySkewBps, 0);
  assert.equal(mainnet.chainId, 1);
  assert.equal(polygon.quoteId, "q_chain_137");
  assert.equal(polygon.chainId, 137);
  assert.equal(missing, undefined);
});

test("InMemoryQuoteRepository returns defensive copies of signed quote records", async () => {
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
    quoteId: "q_copy",
    snapshotId: "snapshot_1",
    slippageBps: request.slippageBps,
    spreadBps: 8,
    sizeImpactBps: 0,
    inventorySkewBps: 0,
    quote: signedQuote,
    pricingVersion: "test-pricing",
    riskPolicyVersion: "test-risk",
    signature: fixedSignature(),
  });

  const byQuoteId = await quoteRepository.findSignedQuoteByQuoteId("q_copy");
  const byNonce = await quoteRepository.findSignedQuoteByChainUserNonce(1, request.user, "42");
  byQuoteId.amountOut = "1";
  byQuoteId.signature = `0x${"22".repeat(65)}`;
  byNonce.status = "settled";
  byNonce.txHash = `0x${"aa".repeat(32)}`;

  const reloadedByQuoteId = await quoteRepository.findSignedQuoteByQuoteId("q_copy");
  const reloadedByNonce = await quoteRepository.findSignedQuoteByChainUserNonce(1, request.user, "42");
  assert.notEqual(reloadedByQuoteId, byQuoteId);
  assert.notEqual(reloadedByNonce, byNonce);
  assert.equal(reloadedByQuoteId.amountOut, "998400000");
  assert.equal(reloadedByQuoteId.signature, fixedSignature());
  assert.equal(reloadedByNonce.status, "signed");
  assert.equal(reloadedByNonce.txHash, undefined);
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
    slippageBps: request.slippageBps,
    spreadBps: 8,
    sizeImpactBps: 0,
    inventorySkewBps: 0,
    quote: baseSignedQuote,
    pricingVersion: "test-pricing",
    riskPolicyVersion: "test-risk",
    signature: fixedSignature(),
  });

  await assert.rejects(
    quoteRepository.saveSigned({
      quoteId: "q_conflict",
      snapshotId: "snapshot_2",
      slippageBps: request.slippageBps,
      spreadBps: 8,
      sizeImpactBps: 0,
      inventorySkewBps: 0,
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
    slippageBps: request.slippageBps,
    spreadBps: 8,
    sizeImpactBps: 0,
    inventorySkewBps: 0,
    quote: baseSignedQuote,
    pricingVersion: "test-pricing",
    riskPolicyVersion: "test-risk",
    signature: fixedSignature(),
  });

  await assert.rejects(
    quoteRepository.saveSigned({
      quoteId: "q_original",
      snapshotId: "snapshot_2",
      slippageBps: request.slippageBps,
      spreadBps: 8,
      sizeImpactBps: 0,
      inventorySkewBps: 0,
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

test("InMemoryQuoteRepository rejects signed quote payload rewrites", async () => {
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
  const input = {
    quoteId: "q_payload",
    snapshotId: "snapshot_1",
    slippageBps: request.slippageBps,
    spreadBps: 8,
    sizeImpactBps: 0,
    inventorySkewBps: 0,
    quote: baseSignedQuote,
    pricingVersion: "test-pricing",
    riskPolicyVersion: "test-risk",
    signature: fixedSignature(),
  };

  await quoteRepository.saveSigned(input);
  await quoteRepository.saveSigned(input);
  await assert.rejects(
    quoteRepository.saveSigned({
      ...input,
      quote: {
        ...baseSignedQuote,
        amountOut: "997000000",
      },
    }),
    /Signed quote payload cannot be changed/,
  );
  await assert.rejects(
    quoteRepository.saveSigned({
      ...input,
      spreadBps: 9,
    }),
    /Signed quote payload cannot be changed/,
  );

  const indexed = await quoteRepository.findSignedQuoteByChainUserNonce(1, request.user, "42");
  assert.equal(indexed.quoteId, "q_payload");
  assert.equal(indexed.amountOut, "998400000");
  assert.equal(indexed.snapshotId, "snapshot_1");
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
    slippageBps: request.slippageBps,
    spreadBps: 8,
    sizeImpactBps: 0,
    inventorySkewBps: 0,
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
      slippageBps: 10_001,
    }),
    /Signed quote slippageBps must be less than or equal to 10000 bps/,
  );
  await assert.rejects(
    quoteRepository.saveSigned({
      ...input,
      spreadBps: 10_001,
    }),
    /Signed quote spreadBps must be less than or equal to 10000 bps/,
  );
  await assert.rejects(
    quoteRepository.saveSigned({
      ...input,
      inventorySkewBps: 10_001,
    }),
    /Signed quote inventorySkewBps magnitude must be less than or equal to 10000 bps/,
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

  await assert.rejects(
    quoteRepository.saveSigned({
      ...input,
      signature: `0x${"11".repeat(64)}02`,
    }),
    /Signed quote signature v value must be 27 or 28/,
  );

  await assert.rejects(
    quoteRepository.saveSigned({
      ...input,
      signature: `0x${"11".repeat(32)}${"f".repeat(64)}1b`,
    }),
    /Signed quote signature s value must be in the lower half order/,
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

test("InMemoryQuoteRepository rejects requested quote payload rewrites", async () => {
  const quoteRepository = new InMemoryQuoteRepository();
  const input = {
    quoteId: "q_requested_payload",
    snapshotId: "snapshot_1",
    request,
  };

  await quoteRepository.saveRequested(input);
  await quoteRepository.saveRequested(input);
  await assert.rejects(
    quoteRepository.saveRequested({
      ...input,
      snapshotId: "snapshot_2",
    }),
    /Requested quote payload cannot be changed/,
  );
  await assert.rejects(
    quoteRepository.saveRequested({
      ...input,
      request: {
        ...request,
        slippageBps: request.slippageBps + 1,
      },
    }),
    /Requested quote payload cannot be changed/,
  );
  await assert.rejects(
    quoteRepository.saveSigned({
      quoteId: "q_requested_payload",
      snapshotId: "snapshot_1",
      slippageBps: request.slippageBps + 1,
      spreadBps: 8,
      sizeImpactBps: 0,
      inventorySkewBps: 0,
      quote: {
        user: request.user,
        tokenIn: request.tokenIn,
        tokenOut: request.tokenOut,
        amountIn: request.amountIn,
        amountOut: "998",
        minAmountOut: "990",
        nonce: "42",
        deadline: Math.floor(Date.now() / 1000) + 30,
        chainId: request.chainId,
      },
      pricingVersion: "test-pricing",
      riskPolicyVersion: "test-risk",
      signature: fixedSignature(),
    }),
    /Signed quote request cannot differ from requested quote/,
  );
  await assert.rejects(
    quoteRepository.saveSigned({
      quoteId: "q_requested_payload",
      snapshotId: "snapshot_1",
      slippageBps: request.slippageBps,
      spreadBps: 8,
      sizeImpactBps: 0,
      inventorySkewBps: 0,
      quote: {
        user: request.user,
        tokenIn: request.tokenIn,
        tokenOut: request.tokenOut,
        amountIn: "999",
        amountOut: "998",
        minAmountOut: "990",
        nonce: "42",
        deadline: Math.floor(Date.now() / 1000) + 30,
        chainId: request.chainId,
      },
      pricingVersion: "test-pricing",
      riskPolicyVersion: "test-risk",
      signature: fixedSignature(),
    }),
    /Signed quote request cannot differ from requested quote/,
  );

  const status = await quoteRepository.findStatus("q_requested_payload");
  assert.equal(status.status, "requested");
  assert.equal(status.snapshotId, "snapshot_1");
});

test("InMemoryQuoteRepository rejects rejected quote payload rewrites", async () => {
  const quoteRepository = new InMemoryQuoteRepository();
  const requestedInput = {
    quoteId: "q_rejected_payload",
    snapshotId: "snapshot_1",
    request,
  };
  const rejectedInput = {
    ...requestedInput,
    rejectCode: "RISK_REJECTED",
    riskPolicyVersion: "test-risk",
  };

  await assert.rejects(
    quoteRepository.saveRejected({
      quoteId: "q_missing_rejected",
      snapshotId: "snapshot_1",
      request,
      rejectCode: "RISK_REJECTED",
    }),
    /cannot save rejected quote without requested state/,
  );

  await quoteRepository.saveRequested(requestedInput);
  await assert.rejects(
    quoteRepository.saveRejected({
      ...rejectedInput,
      request: {
        ...request,
        slippageBps: request.slippageBps + 1,
      },
    }),
    /Rejected quote request cannot differ from requested quote/,
  );
  await quoteRepository.saveRejected(rejectedInput);
  await quoteRepository.saveRejected(rejectedInput);
  await assert.rejects(
    quoteRepository.saveRejected({
      ...rejectedInput,
      rejectCode: "TOXIC_FLOW",
    }),
    /Rejected quote payload cannot be changed/,
  );
  await assert.rejects(
    quoteRepository.saveRequested(requestedInput),
    /cannot save requested quote from rejected/,
  );

  const status = await quoteRepository.findStatus("q_rejected_payload");
  assert.equal(status.status, "rejected");
  assert.equal(status.errorCode, "RISK_REJECTED");
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
    slippageBps: request.slippageBps,
    spreadBps: 8,
    sizeImpactBps: 0,
    inventorySkewBps: 0,
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

test("InMemoryQuoteRepository rejects conflicting quote status metadata rewrites", async () => {
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
    quoteId: "q_status_conflict",
    snapshotId: "snapshot_1",
    slippageBps: request.slippageBps,
    spreadBps: 8,
    sizeImpactBps: 0,
    inventorySkewBps: 0,
    quote: signedQuote,
    pricingVersion: "test-pricing",
    riskPolicyVersion: "test-risk",
    signature: fixedSignature(),
  });
  await quoteRepository.markStatus("q_status_conflict", "submitted", {
    txHash: `0x${"AA".repeat(32)}`,
    settlementEventId: "se_1",
  });

  await assert.rejects(
    quoteRepository.markStatus("q_status_conflict", "settled", {
      txHash: `0x${"bb".repeat(32)}`,
    }),
    /Quote status txHash cannot be changed once set/,
  );
  await assert.rejects(
    quoteRepository.markStatus("q_status_conflict", "settled", {
      settlementEventId: "se_2",
    }),
    /Quote status settlementEventId cannot be changed once set/,
  );

  await quoteRepository.markStatus("q_status_conflict", "settled", {
    txHash: `0x${"aa".repeat(32)}`,
    settlementEventId: "se_1",
    hedgeOrderId: "h_1",
    pnlId: "pnl_1",
  });
  await assert.rejects(
    quoteRepository.markStatus("q_status_conflict", "settled", {
      hedgeOrderId: "h_2",
    }),
    /Quote status hedgeOrderId cannot be changed once set/,
  );
  await assert.rejects(
    quoteRepository.markStatus("q_status_conflict", "settled", {
      pnlId: "pnl_2",
    }),
    /Quote status pnlId cannot be changed once set/,
  );

  const status = await quoteRepository.findStatus("q_status_conflict");
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

  await quoteRepository.saveRequested({
    quoteId: "q_requested",
    snapshotId: "snapshot_requested",
    request,
  });
  await assert.rejects(
    quoteRepository.markStatus("q_requested", "settled", {
      settlementEventId: "se_requested",
    }),
    /cannot transition from requested to settled through markStatus/,
  );

  await quoteRepository.saveSigned({
    quoteId: "q_settled",
    snapshotId: "snapshot_1",
    slippageBps: request.slippageBps,
    spreadBps: 8,
    sizeImpactBps: 0,
    inventorySkewBps: 0,
    quote: signedQuote,
    pricingVersion: "test-pricing",
    riskPolicyVersion: "test-risk",
    signature: fixedSignature(),
  });
  await quoteRepository.markStatus("q_settled", "submitted", {
    txHash: `0x${"aa".repeat(32)}`,
    settlementEventId: "se_1",
  });
  await assert.rejects(
    quoteRepository.markStatus("q_settled", "expired"),
    /cannot transition from submitted to expired/,
  );
  await quoteRepository.markStatus("q_settled", "settled", {
    hedgeOrderId: "h_1",
  });

  await assert.rejects(
    quoteRepository.markStatus("q_settled", "submitted"),
    /cannot transition from settled to submitted/,
  );
  await assert.rejects(
    quoteRepository.markStatus("q_settled", "expired"),
    /cannot transition from settled to expired/,
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
  await assert.rejects(
    quoteRepository.markFailed("q_rejected", "SIGNER_UNAVAILABLE"),
    /cannot transition from terminal status rejected to failed/,
  );

  await quoteRepository.saveSigned({
    quoteId: "q_failed",
    snapshotId: "snapshot_3",
    slippageBps: request.slippageBps,
    spreadBps: 8,
    sizeImpactBps: 0,
    inventorySkewBps: 0,
    quote: {
      ...signedQuote,
      nonce: "43",
    },
    pricingVersion: "test-pricing",
    riskPolicyVersion: "test-risk",
    signature: fixedSignature(),
  });
  await quoteRepository.markFailed("q_failed", "SIGNER_UNAVAILABLE");
  await quoteRepository.markFailed("q_failed", "SIGNER_UNAVAILABLE");
  await assert.rejects(
    quoteRepository.markFailed("q_failed", "SETTLEMENT_REVERTED"),
    /Failed quote errorCode cannot be changed/,
  );
  await assert.rejects(
    quoteRepository.markStatus("q_failed", "settled"),
    /cannot transition from terminal status failed to settled/,
  );
  const failed = await quoteRepository.findStatus("q_failed");
  assert.equal(failed.status, "failed");
  assert.equal(failed.errorCode, "SIGNER_UNAVAILABLE");

  await quoteRepository.saveSigned({
    quoteId: "q_expired",
    snapshotId: "snapshot_4",
    slippageBps: request.slippageBps,
    spreadBps: 8,
    sizeImpactBps: 0,
    inventorySkewBps: 0,
    quote: {
      ...signedQuote,
      nonce: "44",
    },
    pricingVersion: "test-pricing",
    riskPolicyVersion: "test-risk",
    signature: fixedSignature(),
  });
  await quoteRepository.markStatus("q_expired", "expired");
  await quoteRepository.markStatus("q_expired", "expired");
  await assert.rejects(
    quoteRepository.markStatus("q_expired", "submitted"),
    /cannot transition from terminal status expired to submitted/,
  );
  await assert.rejects(
    quoteRepository.markFailed("q_expired", "QUOTE_EXPIRED"),
    /cannot transition from expired to failed/,
  );
});

test("InMemoryQuoteRepository rejects saveSigned lifecycle regressions", async () => {
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
    quoteId: "q_save_signed_regression",
    snapshotId: "snapshot_1",
    slippageBps: request.slippageBps,
    spreadBps: 8,
    sizeImpactBps: 0,
    inventorySkewBps: 0,
    quote: signedQuote,
    pricingVersion: "test-pricing",
    riskPolicyVersion: "test-risk",
    signature: fixedSignature(),
  };

  await quoteRepository.saveSigned(input);
  await quoteRepository.markStatus("q_save_signed_regression", "submitted", {
    txHash: `0x${"aa".repeat(32)}`,
    settlementEventId: "se_save_signed_regression",
  });
  await quoteRepository.markStatus("q_save_signed_regression", "settled");

  await assert.rejects(
    quoteRepository.saveSigned(input),
    /cannot save signed quote from settled/,
  );

  const status = await quoteRepository.findStatus("q_save_signed_regression");
  assert.equal(status.status, "settled");
  assert.equal(status.settlementEventId, "se_save_signed_regression");
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
    slippageBps: request.slippageBps,
    spreadBps: 8,
    sizeImpactBps: 0,
    inventorySkewBps: 0,
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

test("InMemoryQuoteRepository rejects settlement statuses without chain pointers", async () => {
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
    quoteId: "q_missing_settlement_metadata",
    snapshotId: "snapshot_1",
    slippageBps: request.slippageBps,
    spreadBps: 8,
    sizeImpactBps: 0,
    inventorySkewBps: 0,
    quote: signedQuote,
    pricingVersion: "test-pricing",
    riskPolicyVersion: "test-risk",
    signature: fixedSignature(),
  });

  await assert.rejects(
    quoteRepository.markStatus("q_missing_settlement_metadata", "submitted"),
    /submitted status requires txHash/,
  );
  await assert.rejects(
    quoteRepository.markStatus("q_missing_settlement_metadata", "settled", {
      txHash: `0x${"aa".repeat(32)}`,
    }),
    /settled status requires settlementEventId/,
  );
  await assert.rejects(
    quoteRepository.markStatus("q_missing_settlement_metadata", "settled", {
      settlementEventId: "se_missing_tx_hash",
    }),
    /settled status requires txHash/,
  );

  const status = await quoteRepository.findStatus("q_missing_settlement_metadata");
  assert.equal(status.status, "signed");
  assert.equal(status.txHash, undefined);
  assert.equal(status.settlementEventId, undefined);
});

test("InMemoryQuoteRepository rejects non-settlement statuses with settlement pointers", async () => {
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
    quoteId: "q_expired_metadata",
    snapshotId: "snapshot_1",
    slippageBps: request.slippageBps,
    spreadBps: 8,
    sizeImpactBps: 0,
    inventorySkewBps: 0,
    quote: signedQuote,
    pricingVersion: "test-pricing",
    riskPolicyVersion: "test-risk",
    signature: fixedSignature(),
  });

  await assert.rejects(
    quoteRepository.markStatus("q_expired_metadata", "expired", {
      txHash: `0x${"aa".repeat(32)}`,
    }),
    /expired status must not include txHash/,
  );
  await assert.rejects(
    quoteRepository.markStatus("q_expired_metadata", "expired", {
      hedgeOrderId: "h_expired",
    }),
    /expired status must not include hedgeOrderId/,
  );

  const status = await quoteRepository.findStatus("q_expired_metadata");
  assert.equal(status.status, "signed");
  assert.equal(status.txHash, undefined);
  assert.equal(status.hedgeOrderId, undefined);
});

test("InMemoryQuoteRepository rejects malformed failed quote metadata", async () => {
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
    quoteId: "q_failed_metadata",
    snapshotId: "snapshot_1",
    slippageBps: request.slippageBps,
    spreadBps: 8,
    sizeImpactBps: 0,
    inventorySkewBps: 0,
    quote: signedQuote,
    pricingVersion: "test-pricing",
    riskPolicyVersion: "test-risk",
    signature: fixedSignature(),
  });

  await assert.rejects(
    quoteRepository.markFailed("q_failed_metadata", " "),
    /Failed quote errorCode must be a non-empty string/,
  );

  const status = await quoteRepository.findStatus("q_failed_metadata");
  assert.equal(status.status, "signed");
  assert.equal(status.errorCode, undefined);
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

test("QuoteService snapshots runtime configuration at construction", async () => {
  const originalDateNow = Date.now;
  const fixedNow = originalDateNow();
  Date.now = () => fixedNow;
  const mutableConfig = {
    ...defaultQuoteServiceConfig,
    maxSnapshotAgeMs: 5_000,
    maxSnapshotFutureSkewMs: 1_000,
    quoteTtlSeconds: 120,
  };

  try {
    const service = new QuoteService(
      {
        ...quoteServiceDeps(),
        marketDataService: {
          async getSnapshot() {
            return {
              snapshotId: "snapshot_mutable_config",
              midPrice: "1",
              liquidityUsd: "10000000000000",
              volatilityBps: 25,
              observedAt: new Date(fixedNow - 2_000).toISOString(),
            };
          },
        },
      },
      mutableConfig,
    );

    mutableConfig.maxSnapshotAgeMs = 1;
    mutableConfig.maxSnapshotFutureSkewMs = 1;
    mutableConfig.quoteTtlSeconds = 1;

    const quote = await service.createQuote(request);

    assert.equal(quote.deadline, Math.floor(fixedNow / 1000) + 120);
    assert.equal(quote.snapshotId, "snapshot_mutable_config");
  } finally {
    Date.now = originalDateNow;
  }
});

test("QuoteService snapshots dependency object at construction", async () => {
  const quoteRepository = new InMemoryQuoteRepository();
  const replacementQuoteRepository = new InMemoryQuoteRepository();
  const deps = {
    ...quoteServiceDeps(),
    quoteRepository,
  };
  const service = new QuoteService(deps);

  deps.marketDataService = {
    async getSnapshot() {
      throw new Error("mutated market data used");
    },
  };
  deps.pricingEngine = {
    async price() {
      throw new Error("mutated pricing engine used");
    },
  };
  deps.quoteRepository = replacementQuoteRepository;
  deps.signerService = {
    async signQuote() {
      throw new Error("mutated signer used");
    },
    async verifyQuoteSignature() {
      return false;
    },
  };

  const quote = await service.createQuote(request);

  assert.equal(quote.signature, fixedSignature());
  assert.equal(quote.snapshotId, "snapshot_1_00000000_00000000");
  assert.equal((await quoteRepository.findStatus(quote.quoteId)).status, "signed");
  assert.equal(await replacementQuoteRepository.findStatus(quote.quoteId), undefined);
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
        pricingEngine: new FormulaPricingEngine(),
        quoteRepository,
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
        pricingEngine: new FormulaPricingEngine(),
        quoteRepository,
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
  return `0x${"11".repeat(64)}1b`;
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
