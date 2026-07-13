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

test("InMemoryQuoteRepository rejects malformed quote persistence envelopes before storing", async () => {
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

  await assert.rejects(
    quoteRepository.saveRequested(undefined),
    /Requested quote input must be an object/,
  );

  await assert.rejects(
    quoteRepository.saveRequested({
      quoteId: "q_missing_request",
      snapshotId: "snapshot_1",
    }),
    /Requested quote input.request must be an own field/,
  );

  await assert.rejects(
    quoteRepository.saveRejected({
      quoteId: "q_rejected_missing_request",
      snapshotId: "snapshot_1",
      rejectCode: "RISK_REJECTED",
      request: null,
    }),
    /Rejected quote request must be an object/,
  );

  await assert.rejects(
    quoteRepository.saveSigned({
      quoteId: "q_signed_missing_quote",
      snapshotId: "snapshot_1",
      slippageBps: request.slippageBps,
      spreadBps: 8,
      sizeImpactBps: 0,
      inventorySkewBps: 0,
      volatilityPremiumBps: 0,
      hedgeCostBps: 0,
      quote: null,
      pricingVersion: "test-pricing",
      riskPolicyVersion: "test-risk",
      signature: fixedSignature(),
    }),
    /Signed quote quote must be an object/,
  );

  assert.equal(await quoteRepository.findStatus("q_missing_request"), undefined);
  assert.equal(await quoteRepository.findStatus("q_rejected_missing_request"), undefined);
  assert.equal(await quoteRepository.findSignedQuoteByChainUserNonce(1, signedQuote.user, signedQuote.nonce), undefined);
});

test("InMemoryQuoteRepository rejects inherited quote persistence fields before storing", async () => {
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

  await assert.rejects(
    quoteRepository.saveRequested(
      Object.create({
        quoteId: "q_inherited_requested",
        snapshotId: "snapshot_1",
        request,
      }),
    ),
    /Requested quote input.quoteId must be an own field/,
  );

  await assert.rejects(
    quoteRepository.saveRequested({
      quoteId: "q_inherited_request",
      snapshotId: "snapshot_1",
      request: Object.create(request),
    }),
    /Requested quote request.chainId must be an own field/,
  );

  const inheritedRiskPolicyInput = Object.create({ riskPolicyVersion: "test-risk" });
  Object.assign(inheritedRiskPolicyInput, {
    quoteId: "q_inherited_rejected_policy",
    snapshotId: "snapshot_1",
    request,
    rejectCode: "RISK_REJECTED",
  });
  await assert.rejects(
    quoteRepository.saveRejected(inheritedRiskPolicyInput),
    /Rejected quote input.riskPolicyVersion must be an own field when provided/,
  );

  await assert.rejects(
    quoteRepository.saveSigned({
      quoteId: "q_inherited_signed_quote",
      snapshotId: "snapshot_1",
      slippageBps: request.slippageBps,
      spreadBps: 8,
      sizeImpactBps: 0,
      inventorySkewBps: 0,
      volatilityPremiumBps: 0,
      hedgeCostBps: 0,
      quote: Object.create(signedQuote),
      pricingVersion: "test-pricing",
      riskPolicyVersion: "test-risk",
      signature: fixedSignature(),
    }),
    /Signed quote quote.user must be an own field/,
  );

  await assert.rejects(
    quoteRepository.saveSigned(
      Object.create({
        quoteId: "q_inherited_signed_input",
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
      }),
    ),
    /Signed quote input.quoteId must be an own field/,
  );

  assert.equal(await quoteRepository.findStatus("q_inherited_requested"), undefined);
  assert.equal(await quoteRepository.findStatus("q_inherited_rejected_policy"), undefined);
  assert.equal(await quoteRepository.findStatus("q_inherited_signed_input"), undefined);
  assert.equal(await quoteRepository.findSignedQuoteByChainUserNonce(1, signedQuote.user, signedQuote.nonce), undefined);
});

function fixedSignature() {
  return `0x${"11".repeat(64)}1b`;
}
