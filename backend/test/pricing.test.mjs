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
  assert.equal(pricing.pricingVersion, "formula-v1:internal_inventory");
});

test("FormulaPricingEngine clamps toxic size impact and inventory skew into total adjustment bounds", async () => {
  const pricing = await new FormulaPricingEngine().price({
    ...baseInput,
    request: {
      ...baseInput.request,
      amountIn: "1000000000000000000",
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

test("FormulaPricingEngine rejects unsafe pricing configuration at construction", () => {
  assert.throws(
    () => new FormulaPricingEngine(null),
    /Formula pricing config must be an object/,
  );

  assert.throws(
    () => new FormulaPricingEngine({ ...defaultFormulaPricingConfig, baseSpreadBps: -1 }),
    /Formula pricing baseSpreadBps must be a non-negative safe integer/,
  );

  assert.throws(
    () => new FormulaPricingEngine({ ...defaultFormulaPricingConfig, volatilityDivisor: 0 }),
    /Formula pricing volatilityDivisor must be a positive safe integer/,
  );

  assert.throws(
    () => new FormulaPricingEngine({ ...defaultFormulaPricingConfig, maxTotalAdjustmentBps: 10_001 }),
    /Formula pricing maxTotalAdjustmentBps must be less than or equal to 10000 bps/,
  );

  assert.throws(
    () =>
      new FormulaPricingEngine({
        ...defaultFormulaPricingConfig,
        maxSizeImpactBps: 3000,
        maxTotalAdjustmentBps: 2500,
      }),
    /Formula pricing maxSizeImpactBps must be less than or equal to maxTotalAdjustmentBps/,
  );
});

test("FormulaPricingEngine rejects malformed pricing payload envelopes before quoting", async () => {
  const engine = new FormulaPricingEngine();

  await assert.rejects(
    engine.price(undefined),
    /Formula pricing input must be an object/,
  );

  await assert.rejects(
    engine.price({
      snapshot: baseInput.snapshot,
      routePlan: baseInput.routePlan,
      inventorySkewBps: 0,
    }),
    /Formula pricing request must be an object/,
  );

  await assert.rejects(
    engine.price({
      ...baseInput,
      snapshot: null,
    }),
    /Formula pricing snapshot must be an object/,
  );

  await assert.rejects(
    engine.price({
      ...baseInput,
      routePlan: [],
    }),
    /Formula pricing routePlan must be an object/,
  );
});

test("FormulaPricingEngine rejects unsafe pricing inputs before quoting", async () => {
  const engine = new FormulaPricingEngine();

  await assert.rejects(
    engine.price({
      ...baseInput,
      request: {
        ...baseInput.request,
        tokenOut: "0x1234",
      },
    }),
    /Formula pricing request.tokenOut must be a 20-byte hex address/,
  );

  await assert.rejects(
    engine.price({
      ...baseInput,
      request: {
        ...baseInput.request,
        slippageBps: 10_001,
      },
    }),
    /Formula pricing request.slippageBps must be less than or equal to 10000 bps/,
  );

  await assert.rejects(
    engine.price({
      ...baseInput,
      request: {
        ...baseInput.request,
        amountIn: "01000000000",
      },
    }),
    /Formula pricing request.amountIn must be a positive uint string/,
  );

  await assert.rejects(
    engine.price({
      ...baseInput,
      snapshot: {
        ...baseInput.snapshot,
        snapshotId: "snapshot.bad",
      },
    }),
    /Formula pricing snapshot.snapshotId must contain only letters, numbers, underscore, colon, or hyphen/,
  );

  await assert.rejects(
    engine.price({
      ...baseInput,
      snapshot: {
        ...baseInput.snapshot,
        snapshotId: "s".repeat(129),
      },
    }),
    /Formula pricing snapshot.snapshotId must be 128 characters or fewer/,
  );

  await assert.rejects(
    engine.price({
      ...baseInput,
      snapshot: {
        ...baseInput.snapshot,
        midPrice: "0",
      },
    }),
    /Formula pricing snapshot.midPrice must be a positive decimal string/,
  );

  await assert.rejects(
    engine.price({
      ...baseInput,
      snapshot: {
        ...baseInput.snapshot,
        midPrice: "01.25",
      },
    }),
    /Formula pricing snapshot.midPrice must be a positive decimal string/,
  );

  await assert.rejects(
    engine.price({
      ...baseInput,
      snapshot: {
        ...baseInput.snapshot,
        liquidityUsd: "01000000000000",
      },
    }),
    /Formula pricing snapshot.liquidityUsd must be a positive uint string/,
  );

  await assert.rejects(
    engine.price({
      ...baseInput,
      routePlan: {
        ...baseInput.routePlan,
        tokenOut: "0xC000000000000000000000000000000000000004",
      },
    }),
    /Formula pricing routePlan token pair must match request token pair/,
  );

  await assert.rejects(
    engine.price({
      ...baseInput,
      routePlan: {
        ...baseInput.routePlan,
        routeId: "route/bad",
      },
    }),
    /Formula pricing routePlan.routeId must contain only letters, numbers, underscore, colon, or hyphen/,
  );

  await assert.rejects(
    engine.price({
      ...baseInput,
      routePlan: {
        ...baseInput.routePlan,
        routeId: "r".repeat(129),
      },
    }),
    /Formula pricing routePlan.routeId must be 128 characters or fewer/,
  );

  await assert.rejects(
    engine.price({
      ...baseInput,
      routePlan: {
        ...baseInput.routePlan,
        expectedLiquidityUsd: "01000000000000",
      },
    }),
    /Formula pricing routePlan.expectedLiquidityUsd must be a positive uint string/,
  );

  await assert.rejects(
    engine.price({
      ...baseInput,
      inventorySkewBps: 10_001,
    }),
    /Formula pricing inventorySkewBps magnitude must be less than or equal to 10000 bps/,
  );
});
