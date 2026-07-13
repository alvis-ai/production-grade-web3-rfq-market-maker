import assert from "node:assert/strict";
import test from "node:test";
import { BasicRiskEngine, defaultBasicRiskPolicy } from "../dist/modules/risk/risk.engine.js";

const baseRequest = {
  chainId: 1,
  user: "0x0000000000000000000000000000000000000001",
  tokenIn: "0x0000000000000000000000000000000000000002",
  tokenOut: "0x0000000000000000000000000000000000000003",
  amountIn: "1000000000",
  slippageBps: 50,
};

const basePricing = {
  amountOut: "998400000",
  minAmountOut: "993408000",
  spreadBps: 16,
  sizeImpactBps: 1,
  marketSpreadBps: 0,
  inventorySkewBps: 0,
  volatilityPremiumBps: 0,
  hedgeCostBps: 0,
  pricingVersion: "formula-v1:internal_inventory",
};

const baseSnapshot = {
  snapshotId: "risk_snapshot",
  midPrice: "1",
  liquidityUsd: "10000000",
  marketSpreadBps: 0,
  volatilityBps: 25,
  observedAt: "2026-01-01T00:00:00.000Z",
};

test("BasicRiskEngine rejects projected token-in inventory over hard limit", async () => {
  const decision = await new BasicRiskEngine().evaluate({
    request: baseRequest,
    pricing: basePricing,
    snapshot: baseSnapshot,
    inventoryProjection: {
      tokenIn: {
        chainId: 1,
        token: baseRequest.tokenIn,
        balance: 2_000_000_001n,
      },
      tokenOut: {
        chainId: 1,
        token: baseRequest.tokenOut,
        balance: -1n,
      },
    },
  });

  assert.equal(decision.status, "rejected");
  assert.equal(decision.reasonCode, "TOKEN_IN_INVENTORY_LIMIT_EXCEEDED");
  assert.equal(decision.policyVersion, "basic-risk-v1");
});
test("BasicRiskEngine rejects projected token-out inventory over hard limit", async () => {
  const decision = await new BasicRiskEngine().evaluate({
    request: baseRequest,
    pricing: basePricing,
    snapshot: baseSnapshot,
    inventoryProjection: {
      tokenIn: {
        chainId: 1,
        token: baseRequest.tokenIn,
        balance: 1n,
      },
      tokenOut: {
        chainId: 1,
        token: baseRequest.tokenOut,
        balance: -2_000_000_001n,
      },
    },
  });

  assert.equal(decision.status, "rejected");
  assert.equal(decision.reasonCode, "TOKEN_OUT_INVENTORY_LIMIT_EXCEEDED");
});

test("BasicRiskEngine rejects restricted toxic-flow users", async () => {
  const decision = await new BasicRiskEngine({
    ...defaultBasicRiskPolicy,
    restrictedUsers: [baseRequest.user],
  }).evaluate({
    request: baseRequest,
    pricing: basePricing,
    snapshot: baseSnapshot,
  });

  assert.equal(decision.status, "rejected");
  assert.equal(decision.reasonCode, "TOXIC_FLOW_RESTRICTED_USER");
  assert.equal(decision.policyVersion, "basic-risk-v1");
});

test("BasicRiskEngine rejects users above toxic-flow score threshold", async () => {
  const decision = await new BasicRiskEngine({
    ...defaultBasicRiskPolicy,
    maxToxicScoreBps: 8000,
    toxicFlowScores: [
      {
        user: baseRequest.user,
        scoreBps: 9000,
      },
    ],
  }).evaluate({
    request: baseRequest,
    pricing: basePricing,
    snapshot: baseSnapshot,
  });

  assert.equal(decision.status, "rejected");
  assert.equal(decision.reasonCode, "TOXIC_FLOW_SCORE_EXCEEDED");
  assert.equal(decision.policyVersion, "basic-risk-v1");
});

test("BasicRiskEngine rejects quoted spreads above policy limit", async () => {
  const decision = await new BasicRiskEngine({
    ...defaultBasicRiskPolicy,
    maxQuotedSpreadBps: 100,
  }).evaluate({
    request: baseRequest,
    snapshot: baseSnapshot,
    pricing: {
      ...basePricing,
      spreadBps: 101,
    },
  });

  assert.equal(decision.status, "rejected");
  assert.equal(decision.reasonCode, "QUOTED_SPREAD_TOO_WIDE");
  assert.equal(decision.policyVersion, "basic-risk-v1");
});

test("BasicRiskEngine rejects low-liquidity and extreme-volatility market regimes", async () => {
  const engine = new BasicRiskEngine();
  assert.equal((await engine.evaluate({
    request: baseRequest,
    pricing: basePricing,
    snapshot: { ...baseSnapshot, liquidityUsd: "999999" },
  })).reasonCode, "MARKET_LIQUIDITY_TOO_LOW");
  assert.equal((await engine.evaluate({
    request: baseRequest,
    pricing: basePricing,
    snapshot: { ...baseSnapshot, volatilityBps: 501 },
  })).reasonCode, "MARKET_VOLATILITY_LIMIT_EXCEEDED");
});

test("BasicRiskEngine snapshots policy configuration at construction", async () => {
  const mutablePolicy = {
    ...defaultBasicRiskPolicy,
    policyVersion: "snapshot-risk-v1",
    enabledChainIds: [1],
    tokenAllowlist: [baseRequest.tokenIn, baseRequest.tokenOut],
    restrictedUsers: [],
    toxicFlowScores: [],
    maxAmountIn: 2_000_000_000n,
    minAmountOut: 1n,
    maxSlippageBps: 100,
    maxQuotedSpreadBps: 100,
    maxAbsoluteInventory: 2_000_000_000n,
  };
  const engine = new BasicRiskEngine(mutablePolicy);

  mutablePolicy.policyVersion = "mutated-risk-v2";
  mutablePolicy.enabledChainIds.length = 0;
  mutablePolicy.tokenAllowlist.length = 0;
  mutablePolicy.restrictedUsers.push(baseRequest.user);
  mutablePolicy.toxicFlowScores.push({ user: baseRequest.user, scoreBps: 10_000 });
  mutablePolicy.maxAmountIn = 1n;
  mutablePolicy.minLiquidityUsd = 20_000_000n;
  mutablePolicy.maxVolatilityBps = 1;
  mutablePolicy.maxSlippageBps = 1;
  mutablePolicy.maxQuotedSpreadBps = 1;

  const decision = await engine.evaluate({
    request: baseRequest,
    pricing: basePricing,
    snapshot: baseSnapshot,
  });

  assert.equal(decision.status, "approved");
  assert.equal(decision.policyVersion, "snapshot-risk-v1");
});
