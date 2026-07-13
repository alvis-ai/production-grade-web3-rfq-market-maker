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
  volatilityPremiumBps: 0,
  hedgeCostBps: 0,
  pricingVersion: "formula-v1:internal_inventory",
};

test("BasicRiskEngine rejects unsafe policy configuration at construction", () => {
  assert.throws(
    () => new BasicRiskEngine(null),
    /Basic risk policy must be an object/,
  );

  assert.throws(
    () => new BasicRiskEngine(Object.create(defaultBasicRiskPolicy)),
    /Basic risk policy.policyVersion must be an own field/,
  );

  assert.throws(
    () => new BasicRiskEngine({ ...defaultBasicRiskPolicy, enabledChainIds: undefined }),
    /Basic risk enabledChainIds must be an array/,
  );

  assert.throws(
    () => new BasicRiskEngine({ ...defaultBasicRiskPolicy, policyVersion: " " }),
    /Basic risk policyVersion must be a non-empty string/,
  );

  assert.throws(
    () => new BasicRiskEngine({ ...defaultBasicRiskPolicy, enabledChainIds: [] }),
    /Basic risk enabledChainIds must contain at least one chain id/,
  );

  assert.throws(
    () => new BasicRiskEngine({ ...defaultBasicRiskPolicy, enabledChainIds: [1, 1] }),
    /Basic risk enabledChainIds must not contain duplicate chain ids/,
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
    () =>
      new BasicRiskEngine({
        ...defaultBasicRiskPolicy,
        tokenAllowlist: [new String(baseRequest.tokenIn), baseRequest.tokenOut],
      }),
    /Basic risk tokenAllowlist entries must be 20-byte hex addresses/,
  );

  assert.throws(
    () =>
      new BasicRiskEngine({
        ...defaultBasicRiskPolicy,
        tokenAllowlist: [
          "0x0000000000000000000000000000000000000002",
          "0x0000000000000000000000000000000000000002",
        ],
      }),
    /Basic risk tokenAllowlist must not contain duplicate addresses/,
  );

  assert.throws(
    () =>
      new BasicRiskEngine({
        ...defaultBasicRiskPolicy,
        restrictedUsers: [
          "0x00000000000000000000000000000000000000aa",
          "0x00000000000000000000000000000000000000AA",
        ],
      }),
    /Basic risk restrictedUsers must not contain duplicate addresses/,
  );

  assert.throws(
    () => new BasicRiskEngine({ ...defaultBasicRiskPolicy, maxAmountIn: 0n }),
    /Basic risk maxAmountIn must be a positive bigint/,
  );

  assert.throws(
    () => new BasicRiskEngine({ ...defaultBasicRiskPolicy, minLiquidityUsd: 0n }),
    /Basic risk minLiquidityUsd must be a positive bigint/,
  );

  assert.throws(
    () => new BasicRiskEngine({ ...defaultBasicRiskPolicy, maxVolatilityBps: 10_001 }),
    /Basic risk maxVolatilityBps must be less than or equal to 10000 bps/,
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
          null,
        ],
      }),
    /Basic risk toxicFlowScores entry must be an object/,
  );

  assert.throws(
    () =>
      new BasicRiskEngine({
        ...defaultBasicRiskPolicy,
        toxicFlowScores: [
          Object.create({
            user: baseRequest.user,
            scoreBps: 100,
          }),
        ],
      }),
    /Basic risk toxicFlowScores entry.user must be an own field/,
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

  assert.throws(
    () =>
      new BasicRiskEngine({
        ...defaultBasicRiskPolicy,
        toxicFlowScores: [
          {
            user: "0x00000000000000000000000000000000000000bb",
            scoreBps: 100,
          },
          {
            user: "0x00000000000000000000000000000000000000BB",
            scoreBps: 9000,
          },
        ],
      }),
    /Basic risk toxicFlowScores must not contain duplicate users/,
  );
});
