import assert from "node:assert/strict";
import test from "node:test";
import { calculateToxicFlowMarkout } from "../dist/modules/risk/toxic-flow-markout.js";

test("calculateToxicFlowMarkout uses cross-decimal execution price and maker-side drift", () => {
  assert.deepEqual(calculateToxicFlowMarkout(
    "100000000000000000000", "100000000", 18, 6, "0.995", 100,
  ), {
    executionPrice: "1.000000000000000000",
    postMidPrice: "0.995000000000000000",
    postTradeDriftBps: -50,
    toxicityScoreBps: 5000,
  });
  assert.equal(calculateToxicFlowMarkout("100", "100", 0, 0, "1.005", 100).toxicityScoreBps, 0);
});

test("calculateToxicFlowMarkout clamps extreme drift and rejects unsafe inputs", () => {
  assert.equal(calculateToxicFlowMarkout("100", "1", 0, 0, "100", 100).postTradeDriftBps, 10000);
  assert.equal(calculateToxicFlowMarkout("1", "100", 0, 0, "0.01", 100).postTradeDriftBps, -9999);
  assert.throws(() => calculateToxicFlowMarkout("01", "1", 0, 0, "1", 100), /canonical positive uint/);
  assert.throws(() => calculateToxicFlowMarkout("1", "1", 37, 0, "1", 100), /tokenInDecimals/);
  assert.throws(() => calculateToxicFlowMarkout("1", "1", 0, 0, "1", 0), /scoreScale/);
});
