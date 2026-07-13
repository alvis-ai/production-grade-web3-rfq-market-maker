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
    marketSpreadBps: 0,
    inventorySkewBps: 0,
    volatilityPremiumBps: 0,
    hedgeCostBps: 0,
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
    marketSpreadBps: 0,
    inventorySkewBps: 0,
    volatilityPremiumBps: 0,
    hedgeCostBps: 0,
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
    marketSpreadBps: 0,
    inventorySkewBps: 0,
    volatilityPremiumBps: 0,
    hedgeCostBps: 0,
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
    marketSpreadBps: 0,
    inventorySkewBps: 0,
    volatilityPremiumBps: 0,
    hedgeCostBps: 0,
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
      marketSpreadBps: 0,
      inventorySkewBps: 0,
      volatilityPremiumBps: 0,
      hedgeCostBps: 0,
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
    marketSpreadBps: 0,
    inventorySkewBps: 0,
    volatilityPremiumBps: 0,
    hedgeCostBps: 0,
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
      marketSpreadBps: 0,
      inventorySkewBps: 0,
      volatilityPremiumBps: 0,
      hedgeCostBps: 0,
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
    marketSpreadBps: 0,
    inventorySkewBps: 0,
    volatilityPremiumBps: 0,
    hedgeCostBps: 0,
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
  await assert.rejects(
    quoteRepository.saveSigned({
      ...input,
      volatilityPremiumBps: 1,
    }),
    /Signed quote payload cannot be changed/,
  );
  await assert.rejects(
    quoteRepository.saveSigned({
      ...input,
      hedgeCostBps: 1,
    }),
    /Signed quote payload cannot be changed/,
  );

  const indexed = await quoteRepository.findSignedQuoteByChainUserNonce(1, request.user, "42");
  assert.equal(indexed.quoteId, "q_payload");
  assert.equal(indexed.amountOut, "998400000");
  assert.equal(indexed.snapshotId, "snapshot_1");
});

function fixedSignature() {
  return `0x${"11".repeat(64)}1b`;
}
