#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { readBackendGatewaySource } from "./lib/read-backend-gateway-source.mjs";

const files = Object.fromEntries(await Promise.all([
  "backend/src/main.ts",
  "backend/src/modules/risk/risk.engine.ts",
  "backend/src/modules/risk/token-limit-risk.engine.ts",
  "backend/src/modules/risk/quote-exposure.store.ts",
  "backend/src/modules/risk/postgres-quote-exposure.store.ts",
  "backend/src/modules/risk/portfolio-var.ts",
  "backend/src/modules/risk/in-memory-portfolio-var.ts",
  "backend/src/modules/risk/postgres-portfolio-var.ts",
  "backend/src/modules/risk/treasury-liquidity.provider.ts",
  "backend/src/modules/quote/quote.service.ts",
  "backend/src/modules/health/readiness.service.ts",
  "backend/test/token-limit-risk.test.mjs",
  "backend/test/api-risk-policy-runtime.test.mjs",
  "backend/test/api-risk.test.mjs",
  "backend/test/readiness.test.mjs",
  "backend/test/quote-exposure-store.test.mjs",
  "backend/test/postgres-quote-exposure-store.test.mjs",
  "backend/test/portfolio-var.test.mjs",
  ".env.example",
  "docker-compose.yml",
  "infra/k8s/configmap.yaml",
  "infra/helm/rfq-market-maker/values.yaml",
  "README.md",
  "book/Volume3-RiskEngine/Chapter05-Position-Limits.md",
  "book/Volume3-RiskEngine/Chapter04-VaR.md",
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
    "maxUserOpenNotionalUsd",
    "maxPairOpenNotionalUsd",
    "portfolioVar",
    "maxPortfolioVarUsd",
    "confidenceMultiplierBps",
    "valuationPairs",
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
  "resolveQuoteExposureStore",
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
  "getQuoteExposurePolicy",
  "normalizePortfolioVarPolicy",
]);
assertContains("backend/src/modules/risk/quote-exposure.store.ts", [
  "class InMemoryQuoteExposureStore",
  "USER_OPEN_NOTIONAL_LIMIT_EXCEEDED",
  "PAIR_OPEN_NOTIONAL_LIMIT_EXCEEDED",
  "TREASURY_LIQUIDITY_INSUFFICIENT",
  "PORTFOLIO_VAR_LIMIT_EXCEEDED",
  "InMemoryPortfolioVarEvaluator",
  "reservedOutputAmount",
  "treasuryLiquidity.availableBalance",
  "toUsdE18",
  "tokenLow",
  "deadline",
]);
assertContains("backend/src/modules/risk/postgres-quote-exposure.store.ts", [
  "pg_advisory_xact_lock",
  "exposureLockScopes(reservation, this.portfolioVarEvaluator !== undefined).sort()",
  "for (const scope of scopes)",
  "expires_at > now()",
  "quote.status IN ('requested', 'signed', 'failed')",
  "WHERE to_timestamp($16) > now()",
  "FOR UPDATE SKIP LOCKED",
  "SUM(exposure.notional_usd_e18)",
  "SUM(amount_out)",
  "quote-liquidity:",
  "quote-exposure:portfolio:",
  "var_evaluation",
]);
assertContains("backend/src/modules/risk/portfolio-var.ts", [
  "componentVarUsdE18",
  "confidenceMultiplierBps",
  "ceilDiv",
  "preTradeVarUsdE18",
  "postTradeVarUsdE18",
  "snapshot.observedAt",
]);
assertContains("backend/src/modules/risk/postgres-portfolio-var.ts", [
  "LOCK TABLE inventory_positions IN SHARE MODE",
  "quote.status IN ('requested', 'signed', 'failed')",
  "ranked_snapshots",
  "evaluatePortfolioVar",
]);
assertContains("backend/src/modules/risk/treasury-liquidity.provider.ts", [
  "class OnchainTreasuryLiquidityProvider",
  "getBlockNumber",
  "readTreasury",
  "readTokenBalance",
  "blockNumber",
]);
assertContains("backend/test/token-limit-risk.test.mjs", [
  "scopes token authorization by chain and address",
  "input and output token-specific amount limits",
  "smaller token USD notional limit across decimals",
  "VaR has no USD-reference token",
  "low-liquidity and extreme-volatility snapshots",
  "each projected inventory limit in that token's raw units",
  "duplicate chain\\/token limits",
]);
assertContains("backend/test/api-risk-policy-runtime.test.mjs", [
  "configured chain/token limits to a cross-decimals quote",
  "cross-decimals quote above its USD notional limit",
  "unsafe market liquidity and volatility regimes",
  "cumulative user and pair open quote notional",
  "rejects portfolio VaR before invoking the signer",
  'assert.equal(decision.policyVersion, "weth-usdc-risk-v1")',
  "unknown-token, and incomplete risk policies",
]);
assertContains("backend/test/api-risk.test.mjs", [
  "observed treasury tokenOut liquidity before signing",
  "fails closed when treasury liquidity cannot be observed",
  "TREASURY_LIQUIDITY_INSUFFICIENT",
  "RISK_ENGINE_UNAVAILABLE",
]);
assertContains("backend/test/readiness.test.mjs", [
  "degrades risk when the treasury liquidity RPC is unavailable",
]);
assertContains("backend/test/quote-exposure-store.test.mjs", [
  "exact user open-notional boundaries",
  "canonicalizes pair direction",
  "stops counting expired quotes",
  "rounds sub-E18 USD reference units up",
  "serializes concurrent portfolio VaR reservations",
]);
assertContains("backend/test/postgres-quote-exposure-store.test.mjs", [
  "locks both scopes before atomically inserting",
  "rejects user and pair totals without inserting",
  "one portfolio lock",
  "replayable portfolio VaR evidence",
]);
assertContains("backend/test/portfolio-var.test.mjs", [
  "direct and reverse valuation components",
  "pre/post trade calculations",
  "rounds exposure and loss away from zero",
  "fails closed for missing, stale, future, or unconfigured valuations",
]);
assertContains("backend/src/modules/quote/quote.service.ts", [
  "risk = await this.evaluateRisk({",
  "snapshot,",
  "quoteExposureStore.reserve",
  "releaseQuoteExposureBestEffort",
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
  "maxUserOpenNotionalUsd",
  "maxPairOpenNotionalUsd",
  "quote_exposure_reservations",
]);
assertContains("book/Volume5-BackendEngineering/Chapter04-Risk-Service.md", [
  "`TokenLimitRiskEngine`",
  "`RFQ_RISK_POLICY_JSON`",
  "cross-chain address isolation",
  "policy/registry mismatch",
  "BigInt",
  "snapshot 流动性不足或波动率越界",
  "活动签名报价",
  "portfolio VaR",
]);
assertContains("book/Volume3-RiskEngine/Chapter04-VaR.md", [
  "component-sum-v1",
  "PORTFOLIO_VAR_LIMIT_EXCEEDED",
  "var_evaluation",
  "inventory_positions",
]);

console.log("Risk policy consistency check passed: market-regime, atomic exposure, treasury, and portfolio VaR limits across 5 runtime config surfaces");

function assertContains(path, needles) {
  for (const needle of needles) {
    assert.ok(files[path].includes(needle), `${path} must include ${needle}`);
  }
}
