import assert from "node:assert/strict";
import test from "node:test";
import { keccak256, toBytes } from "viem";
import { buildSyntheticTxHash } from "../dist/modules/execution/execution.service.js";

const request = {
  quote: {
    user: "0x0000000000000000000000000000000000000001",
    tokenIn: "0x0000000000000000000000000000000000000002",
    tokenOut: "0x0000000000000000000000000000000000000003",
    amountIn: "1000000000",
    amountOut: "998400000",
    minAmountOut: "993408000",
    nonce: "42",
    deadline: 1893456000,
    chainId: 1,
  },
  signature: `0x${"11".repeat(65)}`,
};

test("buildSyntheticTxHash returns deterministic keccak256 bytes32 hashes", () => {
  const context = { quoteId: "q_test" };
  const expectedPayload = JSON.stringify({
    quoteId: context.quoteId,
    quote: request.quote,
    signature: request.signature,
  });
  const expectedHash = keccak256(toBytes(expectedPayload));

  const txHash = buildSyntheticTxHash(request, context);

  assert.match(txHash, /^0x[0-9a-f]{64}$/);
  assert.equal(txHash, expectedHash);
});
