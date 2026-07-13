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
    volatilityPremiumBps: 0,
    hedgeCostBps: 0,
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
    volatilityPremiumBps: 0,
    hedgeCostBps: 0,
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

function fixedSignature() {
  return `0x${"11".repeat(64)}1b`;
}
