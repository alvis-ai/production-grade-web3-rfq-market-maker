#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { readBackendGatewaySource } from "./lib/read-backend-gateway-source.mjs";

const files = Object.fromEntries(await Promise.all([
  "backend/src/main.ts",
  "backend/src/modules/pricing/pricing.engine.ts",
  "backend/src/modules/pricing/price-normalization.ts",
  "backend/src/modules/pricing/token-registry.ts",
  "backend/test/price-normalization.test.mjs",
  "backend/test/api-token-registry-runtime.test.mjs",
  ".env.example",
  "docker-compose.yml",
  "infra/k8s/configmap.yaml",
  "infra/helm/rfq-market-maker/values.yaml",
  "README.md",
  "book/Volume2-MarketData-And-Pricing/Chapter02-Price-Normalization.md",
  "book/Volume2-MarketData-And-Pricing/Chapter07-Pricing-Formula.md",
].map(async (path) => [path, await readFile(path, "utf8")])));
files["backend/src/main.ts"] = await readBackendGatewaySource();

const runtimeConfigFiles = [
  ".env.example",
  "docker-compose.yml",
  "infra/k8s/configmap.yaml",
  "infra/helm/rfq-market-maker/values.yaml",
  "README.md",
];
for (const path of runtimeConfigFiles) {
  assert.ok(files[path].includes("RFQ_TOKEN_REGISTRY_JSON"), `${path} must configure RFQ_TOKEN_REGISTRY_JSON`);
  for (const field of ["tokenAddress", "decimals", "isWhitelisted", "riskTier", "usdReference"]) {
    assert.ok(files[path].includes(`\"${field}\"`), `${path} token registry must include ${field}`);
  }
}

assertContains("backend/src/main.ts", [
  'readOwnEnvValue(env, "RFQ_TOKEN_REGISTRY_JSON")',
  "assertPricingPairsSupported",
  "assertCexPairsSupported",
  "requires the exchange quote token to be an approved USD reference token",
]);
assertContains("backend/src/modules/pricing/pricing.engine.ts", [
  "convertBaseUnitAmount",
  "calculateUsdNotional",
  "formula-v4",
  "amountOut rounds to zero after decimals normalization",
]);
assertContains("backend/src/modules/pricing/price-normalization.ts", [
  "price.numerator * pow10(tokenOutDecimals)",
  "price.denominator * pow10(tokenInDecimals)",
  "maxFractionDigits = 18",
  "approved USD reference token",
]);
assertContains("backend/src/modules/pricing/token-registry.ts", [
  "chainId",
  "tokenAddress",
  "symbol",
  "decimals",
  "isWhitelisted",
  "riskTier",
  "usdReference",
]);
assertContains("backend/test/price-normalization.test.mjs", [
  "WETH 18 decimals to USDC 6 decimals",
  "inverse USDC to WETH direction",
  "rounds to zero",
  "1.0000000000000000001",
]);
assertContains("backend/test/api-token-registry-runtime.test.mjs", [
  'assert.equal(body.amountOut, "1996800000")',
  'url: "/submit"',
  'assert.equal(JSON.parse(submit.payload).status, "accepted")',
  "non-USD CEX quote assets",
  "decimals-aware readiness pricing probe",
]);
assertContains("book/Volume2-MarketData-And-Pricing/Chapter02-Price-Normalization.md", [
  "`formula-v4`",
  "`usdReference`",
  "WETH/USDC",
  "USDC/WETH",
]);
assertContains("book/Volume2-MarketData-And-Pricing/Chapter07-Pricing-Formula.md", [
  "`formula-v4`",
  "USD notional",
  "tokenOut base units",
]);

console.log("Price normalization consistency check passed: formula-v4 and 5 runtime config surfaces");

function assertContains(path, needles) {
  for (const needle of needles) {
    assert.ok(files[path].includes(needle), `${path} must include ${needle}`);
  }
}
