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
    principalId: "local",
    snapshotId: "snapshot_1",
    slippageBps: request.slippageBps,
    spreadBps: 8,
    sizeImpactBps: 0,
    marketSpreadBps: 0,
    inventorySkewBps: 0,
    volatilityPremiumBps: 0,
    hedgeCostBps: 0,
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
    principalId: "local",
    snapshotId: "snapshot_1",
    slippageBps: request.slippageBps,
    spreadBps: 8,
    sizeImpactBps: 0,
    marketSpreadBps: 0,
    inventorySkewBps: 0,
    volatilityPremiumBps: 0,
    hedgeCostBps: 0,
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
    principalId: "local",
    snapshotId: "snapshot_1",
    slippageBps: request.slippageBps,
    spreadBps: 8,
    sizeImpactBps: 0,
    marketSpreadBps: 0,
    inventorySkewBps: 0,
    volatilityPremiumBps: 0,
    hedgeCostBps: 0,
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
