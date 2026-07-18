import assert from "node:assert/strict";
import test from "node:test";
import { HealthGatedQuoteExposureStore } from "../dist/modules/risk/health-gated-quote-exposure.store.js";

test("health-gated quote exposure blocks reserves but permits risk-reducing releases", async () => {
  const calls = [];
  let healthy = false;
  const delegate = {
    async checkHealth() { calls.push("store-health"); },
    async reserve() {
      calls.push("reserve");
      return { status: "reserved", notionalUsdE18: "1" };
    },
    async release(quoteId) { calls.push(`release:${quoteId}`); },
  };
  const store = new HealthGatedQuoteExposureStore(delegate, {
    assertHealthy() {
      calls.push("gate");
      if (!healthy) throw new Error("mirror unhealthy");
    },
  });

  await assert.rejects(store.reserve({}), /mirror unhealthy/);
  await store.release("q_release");
  assert.deepEqual(calls, ["gate", "release:q_release"]);

  healthy = true;
  assert.equal((await store.reserve({})).status, "reserved");
  await store.checkHealth();
  assert.deepEqual(calls.slice(2), ["gate", "reserve", "gate", "store-health"]);
});
