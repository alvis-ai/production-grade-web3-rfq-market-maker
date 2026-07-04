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
    snapshotId: "snapshot_reorg_clear",
    slippageBps: request.slippageBps,
    spreadBps: 8,
    sizeImpactBps: 0,
    inventorySkewBps: 0,
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
    snapshotId: "snapshot_reorg_expired",
    slippageBps: request.slippageBps,
    spreadBps: 8,
    sizeImpactBps: 0,
    inventorySkewBps: 0,
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
    snapshotId: "snapshot_reorg_reject",
    slippageBps: request.slippageBps,
    spreadBps: 8,
    sizeImpactBps: 0,
    inventorySkewBps: 0,
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
