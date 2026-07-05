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
      quoteId: "q.bad",
    }),
    /Signed quote quoteId must contain only letters, numbers, underscore, colon, or hyphen/,
  );

  await assert.rejects(
    quoteRepository.saveSigned({
      ...input,
      snapshotId: new String("snapshot_1"),
    }),
    /Signed quote snapshotId must be a primitive string/,
  );

  await assert.rejects(
    quoteRepository.saveSigned({
      ...input,
      snapshotId: "snapshot".repeat(19),
    }),
    /Signed quote snapshotId must be 128 characters or fewer/,
  );

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
        user: new String(request.user),
      },
    }),
    /Signed quote quote.user must be a 20-byte hex address/,
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
        amountIn: 1000000000,
      },
    }),
    /Signed quote quote.amountIn must be a positive uint string/,
  );

  await assert.rejects(
    quoteRepository.saveSigned({
      ...input,
      quote: {
        ...signedQuote,
        nonce: "042",
      },
    }),
    /Signed quote quote.nonce must be a positive uint string/,
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
      signature: new String(fixedSignature()),
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
