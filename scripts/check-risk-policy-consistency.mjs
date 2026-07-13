#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { readBackendGatewaySource } from "./lib/read-backend-gateway-source.mjs";

const files = Object.fromEntries(await Promise.all([
  "backend/src/main.ts",
  "backend/src/modules/risk/risk.engine.ts",
  "backend/src/modules/risk/token-limit-risk.engine.ts",
  "backend/src/modules/quote/quote.service.ts",
  "backend/src/modules/health/readiness.service.ts",
  "backend/test/token-limit-risk.test.mjs",
  "backend/test/api-risk-policy-runtime.test.mjs",
  ".env.example",
  "docker-compose.yml",
  "infra/k8s/configmap.yaml",
  "infra/helm/rfq-market-maker/values.yaml",
  "README.md",
  "book/Volume3-RiskEngine/Chapter05-Position-Limits.md",
  "book/Volume5-BackendEngineering/Chapter04-Risk-Service.md",
].map(async (path) => [path, await readFile(path, "utf8")])));
files["backend/src/main.ts"] = await readBackendGatewaySource();

for (const path of [
  ".env.example",
  "docker-compose.yml",
  "infra/k8s/configmap.yaml",
  "infra/helm/rfq-market-maker/values.yaml",
  "README.md",
]) {
  assertContains(path, [
    "RFQ_RISK_POLICY_JSON",
    "policyVersion",
    "enabledChainIds",
    "tokenLimits",
    "maxAmountIn",
    "minAmountOut",
    "maxNotionalUsd",
    "maxAbsoluteInventory",
    "minLiquidityUsd",
    "maxVolatilityBps",
  ]);
}

assertContains("backend/src/main.ts", [
  'readOwnEnvValue(env, "RFQ_RISK_POLICY_JSON")',
  "buildDefaultRiskEngine",
  "Risk policy has no tokenIn limit for managed pair",
  "Risk policy has no tokenOut limit for managed pair",
  "must include at least one USD-reference token",
  "requireTokenMetadata(tokenRegistry, limit.chainId, limit.tokenAddress, \"Risk policy\")",
]);
assertContains("backend/src/modules/risk/token-limit-risk.engine.ts", [
  "class TokenLimitRiskEngine",
  "tokenLimitKey(input.request.chainId, input.request.tokenIn)",
  "tokenLimitKey(input.request.chainId, input.request.tokenOut)",
  "tokenInLimit.maxAmountIn",
  "tokenOutLimit.minAmountOut",
  "min(tokenInLimit.maxNotionalUsd, tokenOutLimit.maxNotionalUsd)",
  "QUOTE_NOTIONAL_LIMIT_EXCEEDED",
  "USD_REFERENCE_REQUIRED",
  "MARKET_LIQUIDITY_TOO_LOW",
  "MARKET_VOLATILITY_LIMIT_EXCEEDED",
  "input.snapshot.liquidityUsd",
  "input.snapshot.volatilityBps",
  "10n ** BigInt(decimals)",
  "tokenInLimit.maxAbsoluteInventory",
  "tokenOutLimit.maxAbsoluteInventory",
  "canonical positive uint256 string",
  "duplicate chain/token limits",
]);
assertContains("backend/test/token-limit-risk.test.mjs", [
  "scopes token authorization by chain and address",
  "input and output token-specific amount limits",
  "smaller token USD notional limit across decimals",
  "pair has no USD-reference token",
  "low-liquidity and extreme-volatility snapshots",
  "each projected inventory limit in that token's raw units",
  "duplicate chain\\/token limits",
]);
assertContains("backend/test/api-risk-policy-runtime.test.mjs", [
  "configured chain/token limits to a cross-decimals quote",
  "cross-decimals quote above its USD notional limit",
  "unsafe market liquidity and volatility regimes",
  'assert.equal(decision.policyVersion, "weth-usdc-risk-v1")',
  "unknown-token, and incomplete risk policies",
]);
assertContains("backend/src/modules/quote/quote.service.ts", [
  "risk = await this.evaluateRisk({",
  "snapshot,",
]);
assertContains("backend/src/modules/health/readiness.service.ts", [
  "snapshot: this.config.probeSnapshot",
]);
assertContains("book/Volume3-RiskEngine/Chapter05-Position-Limits.md", [
  "`TokenLimitRiskPolicy`",
  "`(chainId, tokenAddress)`",
  "USDC 6 decimals",
  "WETH 18 decimals",
  "maxNotionalUsd",
  "minLiquidityUsd",
  "maxVolatilityBps",
]);
assertContains("book/Volume5-BackendEngineering/Chapter04-Risk-Service.md", [
  "`TokenLimitRiskEngine`",
  "`RFQ_RISK_POLICY_JSON`",
  "cross-chain address isolation",
  "policy/registry mismatch",
  "BigInt",
  "snapshot 流动性不足或波动率越界",
]);

console.log("Risk policy consistency check passed: market-regime, chain-scoped raw-unit, and USD-notional limits across 5 runtime config surfaces");

function assertContains(path, needles) {
  for (const needle of needles) {
    assert.ok(files[path].includes(needle), `${path} must include ${needle}`);
  }
}
