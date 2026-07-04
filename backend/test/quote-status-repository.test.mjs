import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryQuoteRepository } from "../dist/modules/quote/quote.repository.js";

const request = {
  chainId: 1,
  user: "0x0000000000000000000000000000000000000001",
  tokenIn: "0x0000000000000000000000000000000000000002",
  tokenOut: "0x0000000000000000000000000000000000000003",
  amountIn: "1000000000",
  slippageBps: 50,
};

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

  await assert.rejects(
    quoteRepository.markStatus("q_status_conflict", "submitted", {
      txHash: new String(`0x${"aa".repeat(32)}`),
      settlementEventId: "se_bad_txhash",
    }),
    /Quote status txHash must be a 32-byte hex string/,
  );

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
      settlementEventId: "se.bad",
    }),
    /Quote status settlementEventId must contain only letters, numbers, underscore, colon, or hyphen/,
  );
  await assert.rejects(
    quoteRepository.markStatus("q_metadata", "submitted", {
      hedgeOrderId: "",
    }),
    /Quote status hedgeOrderId must be a non-empty string/,
  );
  await assert.rejects(
    quoteRepository.markStatus("q_metadata", "submitted", {
      hedgeOrderId: new String("h_1"),
    }),
    /Quote status hedgeOrderId must be a primitive string/,
  );
  await assert.rejects(
    quoteRepository.markStatus("q_metadata", "submitted", {
      hedgeOrderId: "h".repeat(129),
    }),
    /Quote status hedgeOrderId must be 128 characters or fewer/,
  );
  await assert.rejects(
    quoteRepository.markStatus("q_metadata", "submitted", {
      pnlId: " ",
    }),
    /Quote status pnlId must be a non-empty string/,
  );
  await assert.rejects(
    quoteRepository.markStatus("q_metadata", "submitted", {
      pnlId: "pnl/bad",
    }),
    /Quote status pnlId must contain only letters, numbers, underscore, colon, or hyphen/,
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

function fixedSignature() {
  return `0x${"11".repeat(64)}1b`;
}
