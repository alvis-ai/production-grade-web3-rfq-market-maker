import assert from "node:assert/strict";
import test from "node:test";
import { FormulaPricingEngine, defaultFormulaPricingConfig } from "../dist/modules/pricing/pricing.engine.js";

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
