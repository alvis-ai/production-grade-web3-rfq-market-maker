#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { readBackendGatewaySource } from "./lib/read-backend-gateway-source.mjs";

const files = Object.fromEntries(await Promise.all([
  "backend/src/main.ts",
  "backend/src/modules/risk/risk.engine.ts",
  "backend/src/modules/risk/token-limit-risk.engine.ts",
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
    "maxAbsoluteInventory",
  ]);
}

assertContains("backend/src/main.ts", [
  'readOwnEnvValue(env, "RFQ_RISK_POLICY_JSON")',
  "buildDefaultRiskEngine",
  "Risk policy has no tokenIn limit for managed pair",
  "Risk policy has no tokenOut limit for managed pair",
  "requireTokenMetadata(tokenRegistry, limit.chainId, limit.tokenAddress, \"Risk policy\")",
]);
assertContains("backend/src/modules/risk/token-limit-risk.engine.ts", [
  "class TokenLimitRiskEngine",
  "tokenLimitKey(input.request.chainId, input.request.tokenIn)",
  "tokenLimitKey(input.request.chainId, input.request.tokenOut)",
  "tokenInLimit.maxAmountIn",
  "tokenOutLimit.minAmountOut",
  "tokenInLimit.maxAbsoluteInventory",
  "tokenOutLimit.maxAbsoluteInventory",
  "canonical positive uint256 string",
  "duplicate chain/token limits",
]);
assertContains("backend/test/token-limit-risk.test.mjs", [
  "scopes token authorization by chain and address",
  "input and output token-specific amount limits",
  "each projected inventory limit in that token's raw units",
  "duplicate chain\\/token limits",
]);
assertContains("backend/test/api-risk-policy-runtime.test.mjs", [
  "configured chain/token limits to a cross-decimals quote",
  'assert.equal(decision.policyVersion, "weth-usdc-risk-v1")',
  "unknown-token, and incomplete risk policies",
]);
assertContains("book/Volume3-RiskEngine/Chapter05-Position-Limits.md", [
  "`TokenLimitRiskPolicy`",
  "`(chainId, tokenAddress)`",
  "USDC 6 decimals",
  "WETH 18 decimals",
]);
assertContains("book/Volume5-BackendEngineering/Chapter04-Risk-Service.md", [
  "`TokenLimitRiskEngine`",
  "`RFQ_RISK_POLICY_JSON`",
  "cross-chain address isolation",
  "policy/registry mismatch",
]);

console.log("Risk policy consistency check passed: chain-scoped limits and 5 runtime config surfaces");

function assertContains(path, needles) {
  for (const needle of needles) {
    assert.ok(files[path].includes(needle), `${path} must include ${needle}`);
  }
}
