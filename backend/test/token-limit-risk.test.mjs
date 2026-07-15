import assert from "node:assert/strict";
import test from "node:test";
import {
  TokenLimitRiskEngine,
  defaultTokenLimitRiskPolicy,
  parseTokenLimitRiskPolicy,
} from "../dist/modules/risk/token-limit-risk.engine.js";
import { ConfiguredTokenRegistry } from "../dist/modules/pricing/token-registry.js";

const user = "0x0000000000000000000000000000000000000001";
const tokenA = "0x0000000000000000000000000000000000000002";
const tokenB = "0x0000000000000000000000000000000000000003";
const tokenC = "0x0000000000000000000000000000000000000004";
const tokenD = "0x0000000000000000000000000000000000000005";

test("TokenLimitRiskEngine scopes token authorization by chain and address", async () => {
  const engine = new TokenLimitRiskEngine(policy({
    enabledChainIds: [1, 10],
    tokenLimits: [
      limit(1, tokenA, "100", "1", "1000"),
      limit(1, tokenB, "100", "1", "1000"),
      limit(10, tokenC, "100", "1", "1000"),
      limit(10, tokenD, "100", "1", "1000"),
    ],
    portfolioVar: portfolioVarPolicy([
      { chainId: 10, tokenAddress: tokenC, usdReferenceTokenAddress: tokenD },
    ]),
  }), tokenRegistry([
    token(1, tokenA, 18, true),
    token(1, tokenB, 6, true),
    token(10, tokenC, 18, false),
    token(10, tokenD, 6, true),
  ]));

  assert.deepEqual(await engine.evaluate(riskInput({ chainId: 99 })), {
    status: "rejected",
    reasonCode: "CHAIN_NOT_ENABLED",
    policyVersion: "token-limit-test-v1",
  });
  assert.deepEqual(await engine.evaluate(riskInput({ chainId: 10 })), {
    status: "rejected",
    reasonCode: "TOKEN_NOT_ALLOWED",
    policyVersion: "token-limit-test-v1",
  });
  assert.equal((await engine.evaluate(riskInput({ chainId: 10, tokenIn: tokenC, tokenOut: tokenD }))).status, "approved");
});

test("TokenLimitRiskEngine applies input and output token-specific amount limits", async () => {
  const engine = new TokenLimitRiskEngine(policy({
    tokenLimits: [
      limit(1, tokenA, "100", "1", "1000"),
      limit(1, tokenB, "1000", "50", "2000"),
    ],
  }));

  assert.equal((await engine.evaluate(riskInput({ amountIn: "101" }))).reasonCode, "AMOUNT_IN_LIMIT_EXCEEDED");
  assert.equal((await engine.evaluate(riskInput({ amountOut: "49", minAmountOut: "49" }))).reasonCode, "AMOUNT_OUT_TOO_SMALL");
  assert.equal((await engine.evaluate(riskInput({ amountIn: "100", amountOut: "50", minAmountOut: "49" }))).status, "approved");
});

test("TokenLimitRiskEngine rejects low-liquidity and extreme-volatility snapshots", async () => {
  const engine = new TokenLimitRiskEngine(policy({
    minLiquidityUsd: "1000000",
    maxVolatilityBps: 500,
  }));

  assert.equal((await engine.evaluate(riskInput({ liquidityUsd: "999999" }))).reasonCode, "MARKET_LIQUIDITY_TOO_LOW");
  assert.equal((await engine.evaluate(riskInput({ volatilityBps: 501 }))).reasonCode, "MARKET_VOLATILITY_LIMIT_EXCEEDED");
  assert.equal((await engine.evaluate(riskInput({ liquidityUsd: "1000000", volatilityBps: 500 }))).status, "approved");
});

test("TokenLimitRiskEngine enforces the smaller token USD notional limit across decimals", async () => {
  const registry = tokenRegistry([
    token(1, tokenA, 18, false),
    token(1, tokenB, 6, true),
  ]);
  const engine = new TokenLimitRiskEngine(policy({
    tokenLimits: [
      limit(1, tokenA, "10000000000000000000", "1", "100000000000000000000", "1500"),
      limit(1, tokenB, "10000000000", "1", "10000000000", "2000"),
    ],
  }), registry);

  assert.equal((await engine.evaluate(riskInput({
    amountIn: "1000000000000000000",
    amountOut: "1500000000",
    minAmountOut: "1490000000",
  }))).status, "approved");
  assert.equal((await engine.evaluate(riskInput({
    amountIn: "1000000000000000000",
    amountOut: "1500000001",
    minAmountOut: "1490000000",
  }))).reasonCode, "QUOTE_NOTIONAL_LIMIT_EXCEEDED");

  const reverse = new TokenLimitRiskEngine(policy({
    tokenLimits: [
      limit(1, tokenA, "10000000000000000000", "1", "100000000000000000000", "2000"),
      limit(1, tokenB, "10000000000", "1", "10000000000", "2000"),
    ],
  }), registry);
  assert.equal((await reverse.evaluate(riskInput({
    tokenIn: tokenB,
    tokenOut: tokenA,
    amountIn: "2000000001",
    amountOut: "1000000000000000000",
    minAmountOut: "990000000000000000",
  }))).reasonCode, "QUOTE_NOTIONAL_LIMIT_EXCEEDED");
  assert.equal((await reverse.evaluate(riskInput({
    tokenIn: tokenB,
    tokenOut: tokenA,
    amountIn: "2000000000",
    amountOut: "1000000000000000000",
    minAmountOut: "990000000000000000",
  }))).status, "approved");
});

test("TokenLimitRiskEngine fails closed at construction when VaR has no USD-reference token", () => {
  assert.throws(
    () => new TokenLimitRiskEngine(policy(), tokenRegistry([
      token(1, tokenA, 18, false),
      token(1, tokenB, 6, false),
    ])),
    /must be a USD-reference token/,
  );
});

test("TokenLimitRiskEngine applies each projected inventory limit in that token's raw units", async () => {
  const engine = new TokenLimitRiskEngine(policy({
    tokenLimits: [
      limit(1, tokenA, "1000", "1", "200"),
      limit(1, tokenB, "1000", "1", "300"),
    ],
  }));

  const tokenInRejected = await engine.evaluate(riskInput({
    inventoryProjection: projection(201n, -1n),
  }));
  assert.equal(tokenInRejected.reasonCode, "TOKEN_IN_INVENTORY_LIMIT_EXCEEDED");

  const tokenOutRejected = await engine.evaluate(riskInput({
    inventoryProjection: projection(1n, -301n),
  }));
  assert.equal(tokenOutRejected.reasonCode, "TOKEN_OUT_INVENTORY_LIMIT_EXCEEDED");

  assert.equal((await engine.evaluate(riskInput({ inventoryProjection: projection(200n, -300n) }))).status, "approved");
});

test("TokenLimitRiskEngine preserves restricted-user, toxic-flow, slippage, and spread gates", async () => {
  const restricted = new TokenLimitRiskEngine(policy({ restrictedUsers: [user] }));
  assert.equal((await restricted.evaluate(riskInput())).reasonCode, "TOXIC_FLOW_RESTRICTED_USER");

  const toxic = new TokenLimitRiskEngine(policy({
    toxicFlowScores: [{ user, scoreBps: 8001 }],
  }));
  assert.equal((await toxic.evaluate(riskInput())).reasonCode, "TOXIC_FLOW_SCORE_EXCEEDED");

  const bounded = new TokenLimitRiskEngine(policy({ maxSlippageBps: 20, maxQuotedSpreadBps: 30 }));
  assert.equal((await bounded.evaluate(riskInput({ slippageBps: 21 }))).reasonCode, "SLIPPAGE_TOO_WIDE");
  assert.equal((await bounded.evaluate(riskInput({ slippageBps: 20, spreadBps: 31 }))).reasonCode, "QUOTED_SPREAD_TOO_WIDE");
});

test("TokenLimitRiskEngine snapshots policy and returns defensive token limits", async () => {
  const mutable = policy();
  const engine = new TokenLimitRiskEngine(mutable);
  mutable.policyVersion = "mutated";
  mutable.enabledChainIds.length = 0;
  mutable.tokenLimits[0].maxAmountIn = "1";
  mutable.tokenLimits[0].maxNotionalUsd = "1";
  mutable.restrictedUsers.push(user);

  const exposed = engine.getTokenLimit(1, tokenA);
  exposed.maxAmountIn = "1";
  exposed.maxNotionalUsd = "1";
  assert.equal(engine.getTokenLimit(1, tokenA).maxAmountIn, "1000");
  assert.equal(engine.getTokenLimit(1, tokenA).maxNotionalUsd, "1000000");
  assert.deepEqual(engine.getQuoteExposurePolicy(), {
    maxUserOpenNotionalUsd: "2000000",
    maxPairOpenNotionalUsd: "5000000",
    portfolioVar: portfolioVarPolicy(),
    portfolioDelta: portfolioDeltaPolicy(),
  });
  assert.deepEqual(await engine.evaluate(riskInput()), {
    status: "approved",
    policyVersion: "token-limit-test-v1",
  });
});

test("parseTokenLimitRiskPolicy rejects ambiguous and unsafe runtime configuration", () => {
  const valid = policy();
  assert.deepEqual(parseTokenLimitRiskPolicy(JSON.stringify(valid)), valid);
  assert.throws(() => parseTokenLimitRiskPolicy("{"), /must contain valid JSON/);
  assert.throws(
    () => parseTokenLimitRiskPolicy(JSON.stringify({ ...valid, unknown: true })),
    /unknown field unknown/,
  );
  assert.throws(
    () => parseTokenLimitRiskPolicy(JSON.stringify({
      ...valid,
      tokenLimits: [valid.tokenLimits[0], {
        ...valid.tokenLimits[0],
        tokenAddress: tokenA.toUpperCase().replace("0X", "0x"),
      }],
    })),
    /duplicate chain\/token limits/,
  );
  assert.throws(
    () => parseTokenLimitRiskPolicy(JSON.stringify({
      ...valid,
      tokenLimits: [{ ...valid.tokenLimits[0], chainId: 10 }],
    })),
    /chainId must be present in enabledChainIds/,
  );
  assert.throws(
    () => parseTokenLimitRiskPolicy(JSON.stringify({
      ...valid,
      enabledChainIds: [1, 10],
    })),
    /enabled chain 10 must have at least one token limit/,
  );
  assert.throws(
    () => parseTokenLimitRiskPolicy(JSON.stringify({
      ...valid,
      tokenLimits: [{ ...valid.tokenLimits[0], maxAmountIn: "01000" }],
    })),
    /canonical positive uint256 string/,
  );
  assert.throws(
    () => parseTokenLimitRiskPolicy(JSON.stringify({
      ...valid,
      tokenLimits: [{ ...valid.tokenLimits[0], maxAmountIn: (1n << 256n).toString() }],
    })),
    /canonical positive uint256 string/,
  );
  assert.throws(
    () => parseTokenLimitRiskPolicy(JSON.stringify({
      ...valid,
      tokenLimits: [{ ...valid.tokenLimits[0], maxNotionalUsd: "01" }],
    })),
    /maxNotionalUsd must be a canonical positive uint256 string/,
  );
  assert.throws(
    () => parseTokenLimitRiskPolicy(JSON.stringify({ ...valid, minLiquidityUsd: "0" })),
    /minLiquidityUsd must be a canonical positive uint256 string/,
  );
  assert.throws(
    () => parseTokenLimitRiskPolicy(JSON.stringify({ ...valid, maxUserOpenNotionalUsd: "0" })),
    /maxUserOpenNotionalUsd must be a canonical positive uint256 string/,
  );
  assert.throws(
    () => parseTokenLimitRiskPolicy(JSON.stringify({ ...valid, maxVolatilityBps: 10001 })),
    /maxVolatilityBps must be an integer between 0 and 10000/,
  );
  assert.throws(
    () => new TokenLimitRiskEngine(Object.create(defaultTokenLimitRiskPolicy)),
    /policyVersion must be an own field/,
  );
});

function policy(overrides = {}) {
  return {
    policyVersion: "token-limit-test-v1",
    enabledChainIds: [1],
    tokenLimits: [
      limit(1, tokenA, "1000", "1", "2000"),
      limit(1, tokenB, "1000", "1", "2000"),
    ],
    restrictedUsers: [],
    toxicFlowScores: [],
    maxToxicScoreBps: 8000,
    maxUserOpenNotionalUsd: "2000000",
    maxPairOpenNotionalUsd: "5000000",
    portfolioVar: portfolioVarPolicy(),
    portfolioDelta: portfolioDeltaPolicy(),
    minLiquidityUsd: "1000000",
    maxVolatilityBps: 500,
    maxSlippageBps: 500,
    maxQuotedSpreadBps: 1000,
    ...overrides,
  };
}

function portfolioVarPolicy(valuationPairs = [{
  chainId: 1,
  tokenAddress: tokenA,
  usdReferenceTokenAddress: tokenB,
}]) {
  return {
    modelVersion: "component-sum-v1",
    maxPortfolioVarUsd: "500000",
    confidenceMultiplierBps: 23_300,
    horizonSeconds: 86_400,
    maxSnapshotAgeMs: 5_000,
    maxFutureSkewMs: 5_000,
    valuationPairs,
  };
}

function portfolioDeltaPolicy() {
  return {
    modelVersion: "gross-net-delta-v1",
    softGrossLimitUsd: "500000",
    hardGrossLimitUsd: "1000000",
    softNetLimitUsd: "250000",
    hardNetLimitUsd: "500000",
  };
}

function limit(chainId, tokenAddress, maxAmountIn, minAmountOut, maxAbsoluteInventory, maxNotionalUsd = "1000000") {
  return { chainId, tokenAddress, maxAmountIn, minAmountOut, maxNotionalUsd, maxAbsoluteInventory };
}

function tokenRegistry(tokens) {
  return new ConfiguredTokenRegistry({ tokens });
}

function token(chainId, tokenAddress, decimals, usdReference) {
  return {
    chainId,
    tokenAddress,
    symbol: `T${tokenAddress.slice(-2)}`,
    decimals,
    isWhitelisted: true,
    riskTier: "medium",
    usdReference,
  };
}

function riskInput({
  chainId = 1,
  tokenIn = tokenA,
  tokenOut = tokenB,
  amountIn = "100",
  amountOut = "99",
  minAmountOut = "98",
  slippageBps = 50,
  spreadBps = 16,
  liquidityUsd = "10000000",
  volatilityBps = 25,
  inventoryProjection,
} = {}) {
  return {
    request: { chainId, user, tokenIn, tokenOut, amountIn, slippageBps },
    pricing: {
      amountOut,
      minAmountOut,
      spreadBps,
      sizeImpactBps: 1,
      marketSpreadBps: 0,
      inventorySkewBps: 0,
      volatilityPremiumBps: 0,
      hedgeCostBps: 0,
      pricingVersion: "formula-v2:internal_inventory",
    },
    snapshot: {
      snapshotId: "risk_snapshot",
      midPrice: "1",
      liquidityUsd,
      marketSpreadBps: 0,
      volatilityBps,
      observedAt: "2026-01-01T00:00:00.000Z",
    },
    ...(inventoryProjection ? { inventoryProjection } : {}),
  };
}

function projection(tokenInBalance, tokenOutBalance) {
  return {
    tokenIn: { chainId: 1, token: tokenA, balance: tokenInBalance },
    tokenOut: { chainId: 1, token: tokenB, balance: tokenOutBalance },
  };
}
