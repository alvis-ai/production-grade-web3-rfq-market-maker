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

test("InMemoryQuoteRepository clears matching settlement status after reorg removal", async () => {
  const quoteRepository = new InMemoryQuoteRepository();
  const signedQuote = {
    user: request.user,
    tokenIn: request.tokenIn,
    tokenOut: request.tokenOut,
    amountIn: request.amountIn,
    amountOut: "998400000",
    minAmountOut: "993408000",
    nonce: "42",
    deadline: 1_893_456_000,
    chainId: 1,
  };
  const txHash = `0x${"aa".repeat(32)}`;

  await quoteRepository.saveSigned({
    quoteId: "q_reorg_clear",
    principalId: "local",
    snapshotId: "snapshot_reorg_clear",
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
  await quoteRepository.markStatus("q_reorg_clear", "settled", {
    txHash,
    settlementEventId: "se_reorg_clear",
    hedgeOrderId: "h_reorg_clear",
    pnlId: "pnl_reorg_clear",
  });

  const first = await quoteRepository.clearSettlementStatus({
    quoteId: "q_reorg_clear",
    txHash: `0x${"AA".repeat(32)}`,
    settlementEventId: "se_reorg_clear",
    nowSeconds: signedQuote.deadline - 1,
  });
  const retry = await quoteRepository.clearSettlementStatus({
    quoteId: "q_reorg_clear",
    txHash,
    settlementEventId: "se_reorg_clear",
    nowSeconds: signedQuote.deadline - 1,
  });
  const status = await quoteRepository.findStatus("q_reorg_clear");
  const signedRecord = await quoteRepository.findSignedQuoteByQuoteId("q_reorg_clear");

  assert.equal(first.cleared, true);
  assert.equal(first.status.status, "signed");
  assert.equal(first.status.txHash, undefined);
  assert.equal(first.status.settlementEventId, undefined);
  assert.equal(first.status.hedgeOrderId, undefined);
  assert.equal(first.status.pnlId, undefined);
  assert.equal(retry.cleared, false);
  assert.equal(retry.status.status, "signed");
  assert.deepEqual(status, first.status);
  assert.equal(signedRecord.quoteId, "q_reorg_clear");

  await quoteRepository.markStatus("q_reorg_clear", "submitted", {
    txHash: `0x${"bb".repeat(32)}`,
    settlementEventId: "se_reorg_reapplied",
  });
  const reapplied = await quoteRepository.findStatus("q_reorg_clear");
  assert.equal(reapplied.status, "submitted");
  assert.equal(reapplied.txHash, `0x${"bb".repeat(32)}`);
  assert.equal(reapplied.settlementEventId, "se_reorg_reapplied");
});

test("InMemoryQuoteRepository expires settlement status when removed quote is past deadline", async () => {
  const quoteRepository = new InMemoryQuoteRepository();
  const signedQuote = {
    user: request.user,
    tokenIn: request.tokenIn,
    tokenOut: request.tokenOut,
    amountIn: request.amountIn,
    amountOut: "998400000",
    minAmountOut: "993408000",
    nonce: "42",
    deadline: 1_000,
    chainId: 1,
  };
  const txHash = `0x${"cc".repeat(32)}`;

  await quoteRepository.saveSigned({
    quoteId: "q_reorg_expired",
    principalId: "local",
    snapshotId: "snapshot_reorg_expired",
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
  await quoteRepository.markStatus("q_reorg_expired", "settled", {
    txHash,
    settlementEventId: "se_reorg_expired",
  });

  const cleared = await quoteRepository.clearSettlementStatus({
    quoteId: "q_reorg_expired",
    txHash,
    settlementEventId: "se_reorg_expired",
    nowSeconds: signedQuote.deadline,
  });

  assert.equal(cleared.cleared, true);
  assert.equal(cleared.status.status, "expired");
  assert.equal(cleared.status.txHash, undefined);
  assert.equal(cleared.status.settlementEventId, undefined);
});

test("InMemoryQuoteRepository rejects unsafe settlement status clearing", async () => {
  const quoteRepository = new InMemoryQuoteRepository();
  const signedQuote = {
    user: request.user,
    tokenIn: request.tokenIn,
    tokenOut: request.tokenOut,
    amountIn: request.amountIn,
    amountOut: "998400000",
    minAmountOut: "993408000",
    nonce: "42",
    deadline: 1_893_456_000,
    chainId: 1,
  };
  const txHash = `0x${"dd".repeat(32)}`;

  await quoteRepository.saveSigned({
    quoteId: "q_reorg_reject",
    principalId: "local",
    snapshotId: "snapshot_reorg_reject",
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

  assert.deepEqual(
    await quoteRepository.clearSettlementStatus({
      quoteId: "q_missing_reorg",
      txHash,
      settlementEventId: "se_missing_reorg",
      nowSeconds: 1,
    }),
    { cleared: false },
  );
  assert.deepEqual(
    await quoteRepository.clearSettlementStatus({
      quoteId: "q_reorg_reject",
      txHash,
      settlementEventId: "se_reorg_reject",
      nowSeconds: 1,
    }),
    {
      cleared: false,
      status: await quoteRepository.findStatus("q_reorg_reject"),
    },
  );

  await quoteRepository.markStatus("q_reorg_reject", "settled", {
    txHash,
    settlementEventId: "se_reorg_reject",
  });

  await assert.rejects(
    quoteRepository.clearSettlementStatus({
      quoteId: "q_reorg_reject",
      txHash: `0x${"ee".repeat(32)}`,
      settlementEventId: "se_reorg_reject",
      nowSeconds: 1,
    }),
    /Quote q_reorg_reject settlement status removal conflict/,
  );
  await assert.rejects(
    quoteRepository.clearSettlementStatus({
      quoteId: "q_reorg_reject",
      txHash,
      settlementEventId: "se_other_reorg",
      nowSeconds: 1,
    }),
    /Quote q_reorg_reject settlement status removal conflict/,
  );
  await assert.rejects(
    quoteRepository.clearSettlementStatus({
      quoteId: "q_reorg_reject",
      txHash: "0x1234",
      settlementEventId: "se_reorg_reject",
      nowSeconds: 1,
    }),
    /Clear settlement status txHash must be a 32-byte hex string/,
  );
  await assert.rejects(
    quoteRepository.clearSettlementStatus(
      Object.create({
        quoteId: "q_reorg_reject",
        txHash,
        settlementEventId: "se_reorg_reject",
      }),
    ),
    /Clear settlement status input.quoteId must be an own field/,
  );
  await assert.rejects(
    quoteRepository.clearSettlementStatus({
      quoteId: "q_reorg_reject",
      txHash,
      settlementEventId: "se_reorg_reject",
      nowSeconds: 0,
    }),
    /Clear settlement status nowSeconds must be a positive safe integer/,
  );
});

function fixedSignature() {
  return `0x${"11".repeat(64)}1b`;
}
