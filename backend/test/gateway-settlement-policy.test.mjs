import assert from "node:assert/strict";
import test from "node:test";
import { buildDefaultSettlementVerifierPolicy } from "../dist/runtime/gateway-runtime.js";

const signerConfig = {
  mode: "external",
  settlementAddress: "0x4000000000000000000000000000000000000004",
  trustedSignerAddress: "0x5000000000000000000000000000000000000005",
  trustedSignerOverlapAddresses: [],
};
const tokenA = "0x1000000000000000000000000000000000000001";
const tokenB = "0x2000000000000000000000000000000000000002";
const tokenC = "0x3000000000000000000000000000000000000003";

test("default settlement policy derives chain and token allowlists from managed pairs", () => {
  const policy = buildDefaultSettlementVerifierPolicy(signerConfig, [
    { chainId: 31337, tokenIn: tokenA, tokenOut: tokenB },
    { chainId: 31337, tokenIn: tokenB.toUpperCase().replace("0X", "0x"), tokenOut: tokenC },
    { chainId: 8453, tokenIn: tokenA, tokenOut: tokenC },
  ]);

  assert.deepEqual(policy.enabledChainIds, [31337, 8453]);
  assert.deepEqual(policy.tokenWhitelist, [tokenA, tokenB, tokenC]);
  assert.equal(policy.settlementAddress, signerConfig.settlementAddress);
  assert.equal(policy.trustedSignerAddress, signerConfig.trustedSignerAddress);
});

test("default settlement policy preserves compatibility defaults without managed pairs", () => {
  const policy = buildDefaultSettlementVerifierPolicy(signerConfig);
  assert.deepEqual(policy.enabledChainIds, [1, 8453, 42161]);
  assert.deepEqual(policy.tokenWhitelist, [
    "0x0000000000000000000000000000000000000002",
    "0x0000000000000000000000000000000000000003",
  ]);
});

test("default settlement policy rejects malformed managed pairs", () => {
  assert.throws(
    () => buildDefaultSettlementVerifierPolicy(signerConfig, [{ chainId: 0, tokenIn: tokenA, tokenOut: tokenB }]),
    /chainId/,
  );
  assert.throws(
    () => buildDefaultSettlementVerifierPolicy(signerConfig, [{ chainId: 1, tokenIn: tokenA, tokenOut: tokenA }]),
    /distinct tokens/,
  );
});
