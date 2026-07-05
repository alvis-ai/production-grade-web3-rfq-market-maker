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

test("FormulaPricingEngine rejects unsafe pricing configuration at construction", () => {
  assert.throws(
    () => new FormulaPricingEngine(null),
    /Formula pricing config must be an object/,
  );

  assert.throws(
    () => new FormulaPricingEngine(Object.create(defaultFormulaPricingConfig)),
    /Formula pricing config.baseSpreadBps must be an own field/,
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
    /Formula pricing input.request must be an own field/,
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

test("FormulaPricingEngine rejects inherited pricing input fields before quoting", async () => {
  const engine = new FormulaPricingEngine();

  await assert.rejects(
    engine.price(Object.create(baseInput)),
    /Formula pricing input.request must be an own field/,
  );

  const inheritedSkewInput = Object.create({ inventorySkewBps: 0 });
  Object.assign(inheritedSkewInput, {
    request: baseInput.request,
    snapshot: baseInput.snapshot,
    routePlan: baseInput.routePlan,
  });
  await assert.rejects(
    engine.price(inheritedSkewInput),
    /Formula pricing input.inventorySkewBps must be an own field/,
  );

  await assert.rejects(
    engine.price({
      ...baseInput,
      request: Object.create(baseInput.request),
    }),
    /Formula pricing request.chainId must be an own field/,
  );

  await assert.rejects(
    engine.price({
      ...baseInput,
      snapshot: Object.create(baseInput.snapshot),
    }),
    /Formula pricing snapshot.snapshotId must be an own field/,
  );

  await assert.rejects(
    engine.price({
      ...baseInput,
      routePlan: Object.create(baseInput.routePlan),
    }),
    /Formula pricing routePlan.routeId must be an own field/,
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
        snapshotId: new String("snapshot_1"),
      },
    }),
    /Formula pricing snapshot.snapshotId must be a primitive string/,
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
        routeId: new String("route_1"),
      },
    }),
    /Formula pricing routePlan.routeId must be a primitive string/,
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
