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
      volatilityPremiumBps: 0,
      hedgeCostBps: 0,
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
      volatilityPremiumBps: 0,
      hedgeCostBps: 0,
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
