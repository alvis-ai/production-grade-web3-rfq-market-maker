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
  inventorySkewBps: 0,
  pricingVersion: "formula-v1:internal_inventory",
};

test("BasicRiskEngine rejects projected token-in inventory over hard limit", async () => {
  const decision = await new BasicRiskEngine().evaluate({
    request: baseRequest,
    pricing: basePricing,
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
    pricing: {
      ...basePricing,
      spreadBps: 101,
    },
  });

  assert.equal(decision.status, "rejected");
  assert.equal(decision.reasonCode, "QUOTED_SPREAD_TOO_WIDE");
  assert.equal(decision.policyVersion, "basic-risk-v1");
});

test("BasicRiskEngine rejects unsafe policy configuration at construction", () => {
  assert.throws(
    () => new BasicRiskEngine({ ...defaultBasicRiskPolicy, policyVersion: " " }),
    /Basic risk policyVersion must be a non-empty string/,
  );

  assert.throws(
    () => new BasicRiskEngine({ ...defaultBasicRiskPolicy, enabledChainIds: [] }),
    /Basic risk enabledChainIds must contain at least one chain id/,
  );

  assert.throws(
    () => new BasicRiskEngine({ ...defaultBasicRiskPolicy, tokenAllowlist: [] }),
    /Basic risk tokenAllowlist must contain at least one address/,
  );

  assert.throws(
    () =>
      new BasicRiskEngine({
        ...defaultBasicRiskPolicy,
        tokenAllowlist: ["0x00000000000000000000000000000000000000zz"],
      }),
    /Basic risk tokenAllowlist entries must be 20-byte hex addresses/,
  );

  assert.throws(
    () => new BasicRiskEngine({ ...defaultBasicRiskPolicy, maxAmountIn: 0n }),
    /Basic risk maxAmountIn must be a positive bigint/,
  );

  assert.throws(
    () => new BasicRiskEngine({ ...defaultBasicRiskPolicy, maxQuotedSpreadBps: 10_001 }),
    /Basic risk maxQuotedSpreadBps must be less than or equal to 10000 bps/,
  );

  assert.throws(
    () =>
      new BasicRiskEngine({
        ...defaultBasicRiskPolicy,
        toxicFlowScores: [
          {
            user: baseRequest.user,
            scoreBps: -1,
          },
        ],
      }),
    /Basic risk toxicFlowScores.scoreBps must be a non-negative safe integer/,
  );
});
