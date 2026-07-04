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
      quoteId: new String("q_requested"),
      snapshotId: "snapshot_1",
      request,
    }),
    /Requested quote quoteId must be a primitive string/,
  );

  await assert.rejects(
    quoteRepository.saveRequested({
      quoteId: "q.bad",
      snapshotId: "snapshot_1",
      request,
    }),
    /Requested quote quoteId must contain only letters, numbers, underscore, colon, or hyphen/,
  );

  await assert.rejects(
    quoteRepository.saveRequested({
      quoteId: "q_bad_snapshot",
      snapshotId: "s".repeat(129),
      request,
    }),
    /Requested quote snapshotId must be 128 characters or fewer/,
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
      quoteId: "q_bad_user_object",
      snapshotId: "snapshot_1",
      request: {
        ...request,
        user: new String(request.user),
      },
    }),
    /Requested quote request.user must be a 20-byte hex address/,
  );

  await assert.rejects(
    quoteRepository.saveRequested({
      quoteId: "q_bad_amount_number",
      snapshotId: "snapshot_1",
      request: {
        ...request,
        amountIn: 1000000000,
      },
    }),
    /Requested quote request.amountIn must be a positive uint string/,
  );

  await assert.rejects(
    quoteRepository.saveRequested({
      quoteId: "q_bad_amount_leading_zero",
      snapshotId: "snapshot_1",
      request: {
        ...request,
        amountIn: "01000000000",
      },
    }),
    /Requested quote request.amountIn must be a positive uint string/,
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

  await assert.rejects(
    quoteRepository.saveRejected({
      quoteId: "q_bad_reject_pointer",
      snapshotId: "snapshot.bad",
      request,
      rejectCode: "RISK_REJECTED",
    }),
    /Rejected quote snapshotId must contain only letters, numbers, underscore, colon, or hyphen/,
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

function fixedSignature() {
  return `0x${"11".repeat(64)}1b`;
}
