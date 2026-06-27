import assert from "node:assert/strict";
import test from "node:test";
import { BasicRiskEngine } from "../dist/modules/risk/risk.engine.js";

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
