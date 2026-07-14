import assert from "node:assert/strict";
import test from "node:test";
import { DynamicToxicFlowRiskEngine } from "../dist/modules/risk/dynamic-toxic-flow-risk.engine.js";
import { InMemoryToxicFlowScoreStore } from "../dist/modules/risk/toxic-flow-score.store.js";

const now = Date.parse("2026-07-14T12:00:00.000Z");
const user = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

test("DynamicToxicFlowRiskEngine rejects fresh, sufficiently sampled scores above threshold", async () => {
  const store = await scoreStore({ scoreBps: 8001, sampleSize: 5 });
  const engine = new DynamicToxicFlowRiskEngine(approvedBase(), store, config(), () => now);

  assert.deepEqual(await engine.evaluate(riskInput()), {
    status: "rejected",
    reasonCode: "TOXIC_FLOW_SCORE_EXCEEDED",
    policyVersion: "base-risk-v1:tf1",
  });
});

test("DynamicToxicFlowRiskEngine binds non-rejecting score versions and ignores unknown users", async () => {
  const store = await scoreStore({ scoreBps: 8001, sampleSize: 4 });
  const engine = new DynamicToxicFlowRiskEngine(approvedBase(), store, config(), () => now);
  assert.deepEqual(await engine.evaluate(riskInput()), {
    status: "approved",
    policyVersion: "base-risk-v1:tf1",
  });
  assert.deepEqual(await engine.evaluate(riskInput({ user: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" })), {
    status: "approved",
    policyVersion: "base-risk-v1",
  });
});

test("DynamicToxicFlowRiskEngine preserves deterministic base rejections without reading score storage", async () => {
  let reads = 0;
  const store = {
    checkHealth() {},
    async getScore() { reads += 1; throw new Error("must not read"); },
    async updateScore() { throw new Error("unused"); },
  };
  const engine = new DynamicToxicFlowRiskEngine({
    async evaluate() {
      return { status: "rejected", reasonCode: "TOKEN_NOT_ALLOWED", policyVersion: "base-risk-v1" };
    },
  }, store, config(), () => now);
  assert.equal((await engine.evaluate(riskInput())).reasonCode, "TOKEN_NOT_ALLOWED");
  assert.equal(reads, 0);
});

test("DynamicToxicFlowRiskEngine fails closed for stale, future, malformed, or unavailable known scores", async () => {
  const stale = await scoreStore({ observedAt: "2026-07-13T11:59:59.999Z" });
  await assert.rejects(
    new DynamicToxicFlowRiskEngine(approvedBase(), stale, config(), () => now).evaluate(riskInput()),
    /score is stale/,
  );

  const future = await scoreStore({ observedAt: "2026-07-14T12:01:00.001Z" });
  await assert.rejects(
    new DynamicToxicFlowRiskEngine(approvedBase(), future, config(), () => now).evaluate(riskInput()),
    /score is from the future/,
  );

  const malformed = {
    checkHealth() {},
    async getScore() { return { scoreBps: 9000 }; },
    async updateScore() {},
  };
  await assert.rejects(
    new DynamicToxicFlowRiskEngine(approvedBase(), malformed, config(), () => now).evaluate(riskInput()),
    /state fields are invalid/,
  );

  const unavailable = {
    checkHealth() {},
    async getScore() { throw new Error("database unavailable"); },
    async updateScore() {},
  };
  await assert.rejects(
    new DynamicToxicFlowRiskEngine(approvedBase(), unavailable, config(), () => now).evaluate(riskInput()),
    /database unavailable/,
  );
});

test("DynamicToxicFlowRiskEngine snapshots and validates dependencies and configuration", async () => {
  const mutableConfig = config();
  const store = await scoreStore({ scoreBps: 8001, sampleSize: 5 });
  const engine = new DynamicToxicFlowRiskEngine(approvedBase(), store, mutableConfig, () => now);
  mutableConfig.maxToxicScoreBps = 10_000;
  assert.equal((await engine.evaluate(riskInput())).status, "rejected");

  assert.throws(
    () => new DynamicToxicFlowRiskEngine({}, store, config(), () => now),
    /baseEngine.evaluate must be a function/,
  );
  assert.throws(
    () => new DynamicToxicFlowRiskEngine(approvedBase(), {}, config(), () => now),
    /store.checkHealth must be a function/,
  );
  assert.throws(
    () => new DynamicToxicFlowRiskEngine(approvedBase(), store, { ...config(), unknown: true }, () => now),
    /config fields are invalid/,
  );
  assert.throws(
    () => new DynamicToxicFlowRiskEngine(approvedBase(), store, { ...config(), minSampleSize: 0 }, () => now),
    /minSampleSize must be a positive safe integer/,
  );
});

async function scoreStore(overrides = {}) {
  const store = new InMemoryToxicFlowScoreStore(() => now);
  await store.updateScore({ chainId: 1, user }, {
    scoreBps: 4000,
    postTradeDriftBps: -20,
    sampleSize: 25,
    windowSeconds: 300,
    policyVersion: "markout-v1",
    observedAt: "2026-07-14T11:59:00.000Z",
    expectedVersion: 0,
    ...overrides,
  }, "risk_analyzer:writer_key");
  return store;
}

function approvedBase() {
  return {
    async evaluate() {
      return { status: "approved", policyVersion: "base-risk-v1" };
    },
  };
}

function config() {
  return {
    maxScoreAgeMs: 86_400_000,
    maxFutureSkewMs: 60_000,
    minSampleSize: 5,
    maxToxicScoreBps: 8_000,
  };
}

function riskInput(overrides = {}) {
  return {
    request: {
      chainId: 1,
      user,
      tokenIn: "0x0000000000000000000000000000000000000002",
      tokenOut: "0x0000000000000000000000000000000000000003",
      amountIn: "100",
      slippageBps: 50,
      ...overrides,
    },
    pricing: {
      amountOut: "100",
      minAmountOut: "99",
      spreadBps: 10,
      sizeImpactBps: 0,
      marketSpreadBps: 0,
      inventorySkewBps: 0,
      volatilityPremiumBps: 0,
      hedgeCostBps: 0,
      pricingVersion: "pricing-v1",
    },
    snapshot: {
      snapshotId: "snapshot_dynamic_toxic",
      midPrice: "1",
      liquidityUsd: "1000000",
      marketSpreadBps: 0,
      volatilityBps: 10,
      source: "test",
      observedAt: "2026-07-14T11:59:59.000Z",
    },
  };
}
