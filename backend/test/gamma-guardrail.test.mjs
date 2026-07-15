import assert from "node:assert/strict";
import test from "node:test";
import {
  assertGammaGuardrailPolicy,
  evaluateGammaGuardrail,
} from "../dist/modules/risk/gamma-guardrail.js";

const policy = {
  modelVersion: "piecewise-convexity-v1",
  elevatedInventoryUtilizationBps: 6_000,
  criticalInventoryUtilizationBps: 8_500,
  largeTradeUtilizationBps: 2_500,
  blockTradeUtilizationBps: 7_000,
  elevatedVolatilityUtilizationBps: 5_000,
  extremeVolatilityUtilizationBps: 8_000,
  maxRiskMultiplierBps: 20_000,
};

test("gamma guardrail classifies bounded linear risk without rejecting", () => {
  assert.deepEqual(evaluateGammaGuardrail(input({
    inventoryBalance: 5_999n,
    notionalAmount: 2_499n,
    volatilityBps: 249,
  }), policy), {
    modelVersion: "piecewise-convexity-v1",
    limitUtilizationBps: 5_999,
    inventoryRegime: "balanced",
    sizeUtilizationBps: 2_499,
    sizeBucket: "small",
    volatilityUtilizationBps: 4_980,
    volatilityRegime: "normal",
    riskMultiplierBps: 10_000,
    reasonCode: null,
  });
});

test("gamma guardrail uses exact piecewise boundaries and the most exposed leg", () => {
  const result = evaluateGammaGuardrail({
    notionalExposures: [
      { amount: 1n, limit: 10_000n },
      { amount: 7_000n, limit: 10_000n },
    ],
    inventoryExposures: [
      { balance: 1n, hardLimit: 10_000n },
      { balance: -8_500n, hardLimit: 10_000n },
    ],
    volatilityBps: 400,
    volatilityLimitBps: 500,
  }, policy);

  assert.equal(result.limitUtilizationBps, 8_500);
  assert.equal(result.inventoryRegime, "critical");
  assert.equal(result.sizeBucket, "block");
  assert.equal(result.volatilityRegime, "extreme");
  assert.equal(result.riskMultiplierBps, 25_000);
  assert.equal(result.reasonCode, "GAMMA_GUARDRAIL_TRIGGERED");
});

test("gamma guardrail rejects only the configured nonlinear combination", () => {
  const criticalInventoryOnly = evaluateGammaGuardrail(input({ inventoryBalance: 8_500n }), policy);
  assert.equal(criticalInventoryOnly.riskMultiplierBps, 15_000);
  assert.equal(criticalInventoryOnly.reasonCode, null);

  const combined = evaluateGammaGuardrail(input({
    inventoryBalance: 8_500n,
    notionalAmount: 2_500n,
    volatilityBps: 250,
  }), policy);
  assert.equal(combined.riskMultiplierBps, 20_000);
  assert.equal(combined.reasonCode, "GAMMA_GUARDRAIL_TRIGGERED");
});

test("gamma guardrail rounds utilization conservatively and bounds over-limit evidence", () => {
  const result = evaluateGammaGuardrail(input({
    inventoryBalance: 1n,
    inventoryLimit: 3n,
    notionalAmount: 11_000n,
  }), policy);
  assert.equal(result.limitUtilizationBps, 3_334);
  assert.equal(result.sizeUtilizationBps, 10_000);
});

test("gamma guardrail rejects ambiguous policy and malformed evidence", () => {
  assert.throws(
    () => assertGammaGuardrailPolicy({ ...policy, unknown: true }),
    /unknown field unknown/,
  );
  assert.throws(
    () => assertGammaGuardrailPolicy({
      ...policy,
      criticalInventoryUtilizationBps: policy.elevatedInventoryUtilizationBps,
    }),
    /0 < elevated < critical/,
  );
  assert.throws(
    () => assertGammaGuardrailPolicy({ ...policy, maxRiskMultiplierBps: 25_001 }),
    /between 10001 and 25000/,
  );
  assert.throws(
    () => evaluateGammaGuardrail({ ...input(), inventoryExposures: [] }, policy),
    /must contain between 2 and 2 entries/,
  );
  assert.throws(
    () => evaluateGammaGuardrail({ ...input(), volatilityBps: 1, volatilityLimitBps: 0 }, policy),
    /volatility must be zero/,
  );
});

function input({
  inventoryBalance = 0n,
  inventoryLimit = 10_000n,
  notionalAmount = 0n,
  notionalLimit = 10_000n,
  volatilityBps = 0,
  volatilityLimitBps = 500,
} = {}) {
  return {
    notionalExposures: [{ amount: notionalAmount, limit: notionalLimit }],
    inventoryExposures: [
      { balance: inventoryBalance, hardLimit: inventoryLimit },
      { balance: 0n, hardLimit: inventoryLimit },
    ],
    volatilityBps,
    volatilityLimitBps,
  };
}
