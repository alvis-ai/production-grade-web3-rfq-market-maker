import assert from "node:assert/strict";
import test from "node:test";
import { FormulaPricingEngine } from "../dist/modules/pricing/pricing.engine.js";

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
