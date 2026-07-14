import assert from "node:assert/strict";
import test from "node:test";
import { ToxicFlowAnalyzerWorker } from "../dist/modules/risk/toxic-flow-analyzer.worker.js";
import { InMemoryToxicFlowScoreStore, ToxicFlowScoreConflictError } from "../dist/modules/risk/toxic-flow-score.store.js";
import { ConfiguredTokenRegistry } from "../dist/modules/pricing/token-registry.js";

const user = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const job = {
  settlementEventId: "se_1", quoteId: "q_1", chainId: 1, user,
  tokenIn: "0x0000000000000000000000000000000000000002",
  tokenOut: "0x0000000000000000000000000000000000000003",
  amountIn: "100000000000000000000", amountOut: "100000000",
  settledAt: "2026-07-14T00:00:00.000Z", desiredCanonical: true,
  desiredRevision: 1, attemptCount: 1,
};
const snapshot = { snapshotId: "snap_post", midPrice: "0.995", observedAt: "2026-07-14T00:05:00.000Z" };

test("ToxicFlowAnalyzerWorker persists markout, publishes aggregate, then completes", async () => {
  const calls = [];
  const markouts = store({ calls, claimed: job, snapshot, aggregate: aggregate(5) });
  const scores = new InMemoryToxicFlowScoreStore(() => Date.parse(snapshot.observedAt));
  const worker = new ToxicFlowAnalyzerWorker(markouts, scores, tokens(), config());
  assert.deepEqual(await worker.runOnce(), { status: "scored", settlementEventId: "se_1" });
  assert.deepEqual(calls.map(([name]) => name), ["claim", "snapshot", "upsert", "aggregate", "complete"]);
  assert.equal(calls.find(([name]) => name === "upsert")[4], 300);
  assert.deepEqual(pick(await scores.getScore({ chainId: 1, user })), { scoreBps: 5000, postTradeDriftBps: -50, sampleSize: 5 });
});

test("ToxicFlowAnalyzerWorker retries missing snapshots without publishing or completing", async () => {
  const calls = [];
  const worker = new ToxicFlowAnalyzerWorker(store({ calls, claimed: job }), new InMemoryToxicFlowScoreStore(), tokens(), config());
  assert.deepEqual(await worker.runOnce(), { status: "retry_scheduled", settlementEventId: "se_1", errorCode: "MARKOUT_SNAPSHOT_UNAVAILABLE" });
  assert.deepEqual(calls.map(([name]) => name), ["claim", "snapshot", "retry"]);
});

test("ToxicFlowAnalyzerWorker invalidates reorged evidence and publishes an empty clearing score", async () => {
  const calls = [];
  const removed = { ...job, desiredCanonical: false, desiredRevision: 2 };
  const markouts = store({ calls, claimed: removed, aggregate: aggregate(0) });
  const scores = new InMemoryToxicFlowScoreStore(() => Date.parse(snapshot.observedAt));
  assert.equal((await new ToxicFlowAnalyzerWorker(markouts, scores, tokens(), config()).runOnce()).status, "invalidated");
  assert.deepEqual(calls.map(([name]) => name), ["claim", "invalidate", "aggregate", "complete"]);
  assert.equal((await scores.getScore({ chainId: 1, user })).sampleSize, 0);
});

test("ToxicFlowAnalyzerWorker recomputes aggregate after score CAS conflict", async () => {
  const calls = [];
  const markouts = store({ calls, claimed: job, snapshot, aggregate: aggregate(5) });
  const delegate = new InMemoryToxicFlowScoreStore(() => Date.parse(snapshot.observedAt));
  let updates = 0;
  const scores = { checkHealth: delegate.checkHealth.bind(delegate), getScore: delegate.getScore.bind(delegate),
    async updateScore(...args) { updates += 1; if (updates === 1) throw new ToxicFlowScoreConflictError(); return delegate.updateScore(...args); } };
  assert.equal((await new ToxicFlowAnalyzerWorker(markouts, scores, tokens(), config()).runOnce()).status, "scored");
  assert.equal(calls.filter(([name]) => name === "aggregate").length, 2);
  assert.equal(updates, 2);
});

test("ToxicFlowAnalyzerWorker records and logs iteration failures without leaking raw exceptions", async () => {
  const errors = [];
  let iterationErrors = 0;
  let worker;
  const markouts = store({ calls: [] });
  markouts.claimNext = async () => {
    worker.stop();
    throw new Error("MARKOUT_STORE_UNAVAILABLE");
  };
  worker = new ToxicFlowAnalyzerWorker(
    markouts,
    new InMemoryToxicFlowScoreStore(),
    tokens(),
    { ...config(), pollIntervalMs: 10 },
    { recordResult() {}, recordIterationError() { iterationErrors += 1; } },
    { info() {}, error(fields, message) { errors.push([fields, message]); } },
  );

  await worker.run();
  assert.equal(iterationErrors, 1);
  assert.deepEqual(errors, [[
    { errorCode: "MARKOUT_STORE_UNAVAILABLE" },
    "toxic-flow analyzer iteration failed",
  ]]);
  assert.throws(
    () => new ToxicFlowAnalyzerWorker(markouts, new InMemoryToxicFlowScoreStore(), tokens(), config(), undefined, {}),
    /logger/,
  );
});

function store({ calls, claimed, snapshot: postSnapshot, aggregate: scoreAggregate }) {
  return { async checkHealth() {}, async claimNext() { calls.push(["claim"]); return claimed; },
    async findPostTradeSnapshot() { calls.push(["snapshot"]); return postSnapshot; },
    async upsertMarkout(...args) { calls.push(["upsert", ...args]); },
    async invalidateMarkout() { calls.push(["invalidate"]); },
    async aggregateUser() { calls.push(["aggregate"]); return scoreAggregate; },
    async complete() { calls.push(["complete"]); },
    async releaseForRetry(...args) { calls.push(["retry", ...args]); }, async stats() { return { pendingCount: 0 }; } };
}
function aggregate(sampleSize) { return { sampleSize, averagePostTradeDriftBps: sampleSize ? -50 : 0, scoreBps: sampleSize ? 5000 : 0, observedAt: snapshot.observedAt }; }
function pick(state) { return { scoreBps: state.scoreBps, postTradeDriftBps: state.postTradeDriftBps, sampleSize: state.sampleSize }; }
function config() { return { workerId: "analyzer_1", leaseMs: 30000, pollIntervalMs: 100, retryDelayMs: 1000, horizonSeconds: 300, maxSnapshotLagSeconds: 900, windowSeconds: 86400, scoreScale: 100, policyVersion: "markout-v1" }; }
function tokens() { return new ConfiguredTokenRegistry({ tokens: [
  { chainId: 1, tokenAddress: job.tokenIn, symbol: "WETH", decimals: 18, isWhitelisted: true, riskTier: "medium", usdReference: false },
  { chainId: 1, tokenAddress: job.tokenOut, symbol: "USDC", decimals: 6, isWhitelisted: true, riskTier: "low", usdReference: true },
] }); }
