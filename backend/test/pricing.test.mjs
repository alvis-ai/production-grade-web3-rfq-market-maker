import assert from "node:assert/strict";
import test from "node:test";
import { FormulaPricingEngine, defaultFormulaPricingConfig } from "../dist/modules/pricing/pricing.engine.js";

const baseInput = {
  request: {
    chainId: 1,
    user: "0x0000000000000000000000000000000000000001",
    tokenIn: "0x0000000000000000000000000000000000000002",
    tokenOut: "0x0000000000000000000000000000000000000003",
    amountIn: "1000000000",
    slippageBps: 50,
  },
  snapshot: {
    snapshotId: "snapshot_1",
    midPrice: "1.25",
    liquidityUsd: "10000000000000",
    volatilityBps: 25,
    observedAt: "2026-06-27T00:00:00.000Z",
  },
  routePlan: {
    routeId: "route_1",
    venue: "internal_inventory",
    tokenIn: "0x0000000000000000000000000000000000000002",
    tokenOut: "0x0000000000000000000000000000000000000003",
    expectedLiquidityUsd: "10000000000000",
  },
  inventorySkewBps: 0,
};

test("FormulaPricingEngine applies mid price, spread, size impact, volatility, and slippage", async () => {
  const pricing = await new FormulaPricingEngine().price(baseInput);

  assert.equal(pricing.amountOut, "1248000000");
  assert.equal(pricing.minAmountOut, "1241760000");
  assert.equal(pricing.spreadBps, 16);
  assert.equal(pricing.sizeImpactBps, 1);
  assert.equal(pricing.inventorySkewBps, 0);
  assert.equal(pricing.pricingVersion, "formula-v2:internal_inventory");
});

test("FormulaPricingEngine clamps toxic size impact and inventory skew into total adjustment bounds", async () => {
  const pricing = await new FormulaPricingEngine().price({
    ...baseInput,
    request: {
      ...baseInput.request,
      amountIn: "1000000000000000000",
    },
    routePlan: {
      ...baseInput.routePlan,
      expectedLiquidityUsd: "1",
    },
    inventorySkewBps: 3000,
  });

  assert.equal(pricing.spreadBps, 2500);
  assert.equal(pricing.sizeImpactBps, 250);
  assert.equal(pricing.amountOut, "937500000000000000");
});

test("FormulaPricingEngine snapshots pricing configuration at construction", async () => {
  const mutableConfig = {
    ...defaultFormulaPricingConfig,
    baseSpreadBps: 8,
    internalInventoryBufferBps: 2,
    volatilityDivisor: 5,
    maxSizeImpactBps: 250,
    maxTotalAdjustmentBps: 2500,
  };
  const engine = new FormulaPricingEngine(mutableConfig);

  mutableConfig.baseSpreadBps = 0;
  mutableConfig.internalInventoryBufferBps = 0;
  mutableConfig.volatilityDivisor = 1;
  mutableConfig.maxSizeImpactBps = 0;
  mutableConfig.maxTotalAdjustmentBps = 10_000;

  const pricing = await engine.price(baseInput);
  assert.equal(pricing.spreadBps, 16);
  assert.equal(pricing.sizeImpactBps, 1);
  assert.equal(pricing.amountOut, "1248000000");
});
