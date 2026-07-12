import assert from "node:assert/strict";
import test from "node:test";
import {
  ConfiguredTokenRegistry,
  parseTokenRegistryConfig,
  requireTokenMetadata,
} from "../dist/modules/pricing/token-registry.js";

const tokenAddress = "0x00000000000000000000000000000000000000a1";

test("ConfiguredTokenRegistry normalizes addresses and snapshots validated metadata", () => {
  const config = {
    tokens: [{
      chainId: 1,
      tokenAddress: tokenAddress.toUpperCase().replace("0X", "0x"),
      symbol: "USDC",
      decimals: 6,
      isWhitelisted: true,
      riskTier: "low",
      usdReference: true,
    }],
  };
  const registry = new ConfiguredTokenRegistry(config);
  config.tokens[0].decimals = 18;

  const metadata = requireTokenMetadata(registry, 1, tokenAddress, "Test token");
  assert.equal(metadata.tokenAddress, tokenAddress);
  assert.equal(metadata.decimals, 6);
  metadata.decimals = 12;
  assert.equal(registry.getToken(1, tokenAddress).decimals, 6);
});

test("parseTokenRegistryConfig rejects malformed, ambiguous, and unsafe metadata", () => {
  const valid = {
    tokens: [{
      chainId: 1,
      tokenAddress,
      symbol: "WETH",
      decimals: 18,
      isWhitelisted: true,
      riskTier: "medium",
      usdReference: false,
    }],
  };
  assert.deepEqual(parseTokenRegistryConfig(JSON.stringify(valid)), valid);
  assert.throws(() => parseTokenRegistryConfig("{"), /must contain valid JSON/);
  assert.throws(
    () => parseTokenRegistryConfig(JSON.stringify({ ...valid, unknown: true })),
    /unknown field unknown/,
  );
  assert.throws(
    () => parseTokenRegistryConfig(JSON.stringify({
      tokens: [valid.tokens[0], { ...valid.tokens[0], tokenAddress: tokenAddress.toUpperCase().replace("0X", "0x") }],
    })),
    /duplicate chain\/token/,
  );
  assert.throws(
    () => parseTokenRegistryConfig(JSON.stringify({ tokens: [{ ...valid.tokens[0], decimals: 37 }] })),
    /decimals must be an integer between 0 and 36/,
  );
  assert.throws(
    () => parseTokenRegistryConfig(JSON.stringify({ tokens: [{ ...valid.tokens[0], riskTier: "critical" }] })),
    /riskTier must be low, medium, or high/,
  );
});

test("requireTokenMetadata fails closed for missing and disabled tokens", () => {
  const registry = new ConfiguredTokenRegistry({
    tokens: [{
      chainId: 1,
      tokenAddress,
      symbol: "BLOCKED",
      decimals: 18,
      isWhitelisted: false,
      riskTier: "high",
      usdReference: false,
    }],
  });

  assert.throws(() => requireTokenMetadata(registry, 1, tokenAddress, "Test token"), /not whitelisted/);
  assert.throws(
    () => requireTokenMetadata(registry, 1, "0x00000000000000000000000000000000000000a2", "Test token"),
    /not configured/,
  );
});
