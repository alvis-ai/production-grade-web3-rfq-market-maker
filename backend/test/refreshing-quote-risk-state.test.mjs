import assert from "node:assert/strict";
import test from "node:test";
import { RefreshingHedgeRiskPenaltyView } from "../dist/modules/hedge/refreshing-hedge-risk-penalty.view.js";
import { RefreshingUsdReferenceHealthProvider } from "../dist/modules/market-data/refreshing-usd-reference-health.provider.js";
import { RefreshingQuoteControlStore } from "../dist/modules/quote-control/refreshing-quote-control.store.js";
import { RefreshingDailyLossEvidenceProvider } from "../dist/modules/risk/refreshing-daily-loss-evidence.provider.js";
import { RefreshingToxicFlowScoreStore } from "../dist/modules/risk/refreshing-toxic-flow-score.store.js";
import {
  defaultGatewayHotStateConfig,
  readGatewayHotStateConfig,
} from "../dist/runtime/gateway-hot-state.js";

const tokenA = "0x0000000000000000000000000000000000000011";
const tokenB = "0x0000000000000000000000000000000000000022";
const user = "0x0000000000000000000000000000000000000033";
const nowIso = "2026-07-18T00:00:00.000Z";

test("gateway hot-state config enforces freshness and capacity bounds", () => {
  assert.deepEqual(readGatewayHotStateConfig({}), defaultGatewayHotStateConfig);
  assert.deepEqual(readGatewayHotStateConfig({
    RFQ_HOT_STATE_REFRESH_INTERVAL_MS: "100",
    RFQ_HOT_STATE_MAX_AGE_MS: "500",
    RFQ_TOXIC_FLOW_HOT_STATE_MAX_ENTRIES: "250000",
  }), {
    refreshIntervalMs: 100,
    maxAgeMs: 500,
    maxToxicFlowEntries: 250000,
  });
  assert.throws(() => readGatewayHotStateConfig({
    RFQ_HOT_STATE_REFRESH_INTERVAL_MS: "250",
    RFQ_HOT_STATE_MAX_AGE_MS: "499",
  }), /must cover at least two refresh intervals/);
  assert.throws(() => readGatewayHotStateConfig({
    RFQ_TOXIC_FLOW_HOT_STATE_MAX_ENTRIES: "1000001",
  }), /must be a base-10 integer between 1 and 1000000/);
});

test("RefreshingQuoteControlStore serves reads from memory and preserves newer CAS writes", async () => {
  let nowMs = Date.parse(nowIso);
  let loads = 0;
  let failLoads = false;
  let state = quoteState(0, false);
  const refreshes = [];
  const source = {
    async loadSnapshot() {
      loads += 1;
      if (failLoads) throw new Error("postgres unavailable");
      return { state, pairStates: [] };
    },
    async updateState() { state = quoteState(1, true); return state; },
    async updatePairState() { throw new Error("unused"); },
  };
  const store = new RefreshingQuoteControlStore(
    source,
    { refreshIntervalMs: 10, maxAgeMs: 20 },
    undefined,
    () => nowMs,
    { recordHotStateRefresh(...observation) { refreshes.push(observation); } },
  );

  await store.refresh();
  assert.equal((await store.getState()).paused, false);
  assert.equal(await store.getPausedPairCount(), 0);
  assert.equal(loads, 1);
  const updated = await store.updateState({ paused: true, reason: "incident", expectedVersion: 0 }, "ops");
  assert.equal(updated.version, 1);
  assert.equal((await store.getState()).version, 1);
  await store.refresh();
  assert.equal((await store.getState()).version, 1);
  failLoads = true;
  await assert.rejects(store.refresh(), /postgres unavailable/);
  assert.deepEqual(refreshes, [
    ["quote_control", "success", Date.parse(nowIso)],
    ["quote_control", "success", Date.parse(nowIso)],
    ["quote_control", "failure", undefined],
  ]);
  nowMs += 21;
  await assert.rejects(store.getState(), /hot state is stale/);
});

test("RefreshingToxicFlowScoreStore preloads bounded scores without point reads", async () => {
  let nowMs = Date.parse(nowIso);
  let listCalls = 0;
  const score = toxicScore(1);
  const source = {
    async listScores(limit) { listCalls += 1; assert.equal(limit, 3); return [score]; },
    async updateScore() { return toxicScore(2); },
  };
  const store = new RefreshingToxicFlowScoreStore(
    source,
    { refreshIntervalMs: 10, maxAgeMs: 20, maxEntries: 2 },
    undefined,
    () => nowMs,
  );

  await store.refresh();
  assert.deepEqual(await store.getScore({ chainId: 1, user }), score);
  assert.equal(await store.getScore({ chainId: 1, user: tokenA }), null);
  assert.equal(listCalls, 1);
  nowMs += 21;
  await assert.rejects(store.getScore({ chainId: 1, user }), /hot state is stale/);
});

test("RefreshingDailyLossEvidenceProvider snapshots every configured target", async () => {
  let nowMs = Date.parse(nowIso);
  let sourceCalls = 0;
  const evidence = {
    chainId: 1,
    tokenAddress: tokenB,
    netPnlUsdE18: "-1000000000000000000",
    windowStartedAt: nowIso,
    observedAt: nowIso,
  };
  const view = new RefreshingDailyLossEvidenceProvider(
    { async getDailyLossEvidence() { sourceCalls += 1; return evidence; } },
    { targets: [{ chainId: 1, tokenAddress: tokenB }], refreshIntervalMs: 10, maxAgeMs: 20 },
    undefined,
    () => nowMs,
  );

  await view.refresh();
  assert.deepEqual(await view.getDailyLossEvidence(1, tokenB), evidence);
  assert.equal(sourceCalls, 1);
  nowMs += 21;
  await assert.rejects(view.getDailyLossEvidence(1, tokenB), /hot state is stale/);
});

test("RefreshingHedgeRiskPenaltyView snapshots penalties for quote pricing", async () => {
  let nowMs = Date.parse(nowIso);
  let sourceCalls = 0;
  const view = new RefreshingHedgeRiskPenaltyView(
    { async quoteRiskPenaltyBps() { sourceCalls += 1; return 25; } },
    {
      targets: [{ chainId: 1, token: tokenA }, { chainId: 1, token: tokenB }],
      refreshIntervalMs: 10,
      maxAgeMs: 20,
    },
    undefined,
    () => nowMs,
  );

  await view.refresh();
  assert.equal(view.quoteRiskPenaltyBps({ chainId: 1, token: tokenA }), 25);
  assert.equal(view.quoteRiskPenaltyBps({ chainId: 1, token: tokenB }), 25);
  assert.equal(sourceCalls, 2);
  nowMs += 21;
  assert.throws(() => view.quoteRiskPenaltyBps({ chainId: 1, token: tokenA }), /hot state is stale/);
});

test("RefreshingUsdReferenceHealthProvider keeps Chainlink reads off the quote path", async () => {
  let nowMs = Date.parse(nowIso);
  let sourceCalls = 0;
  const evidence = {
    chainId: 1,
    tokenAddress: tokenB,
    aggregator: tokenA,
    roundId: "10",
    answer: "100000000",
    decimals: 8,
    deviationBps: 0,
    observedAt: nowIso,
    status: "healthy",
  };
  const view = new RefreshingUsdReferenceHealthProvider(
    {
      async getHealth() { sourceCalls += 1; return evidence; },
      async checkHealth() { throw new Error("quote path must not delegate"); },
    },
    { targets: [{ chainId: 1, tokenAddress: tokenB }], refreshIntervalMs: 10, maxAgeMs: 20 },
    undefined,
    () => nowMs,
  );

  await view.refresh();
  assert.deepEqual(await view.getHealth(1, tokenB), evidence);
  await view.checkHealth();
  assert.equal(sourceCalls, 1);
  nowMs += 21;
  await assert.rejects(view.getHealth(1, tokenB), /hot state is stale/);
});

function quoteState(version, paused) {
  return {
    paused,
    version,
    reason: paused ? "incident" : null,
    updatedBy: "ops",
    updatedAt: nowIso,
  };
}

function toxicScore(version) {
  return {
    chainId: 1,
    user,
    scoreBps: 4200,
    postTradeDriftBps: -10,
    sampleSize: 20,
    windowSeconds: 300,
    policyVersion: "markout-v1",
    observedAt: nowIso,
    version,
    updatedBy: "analyzer",
    updatedAt: nowIso,
  };
}
