import assert from "node:assert/strict";
import test from "node:test";
import { ToxicFlowScoreConflictError } from "../dist/modules/risk/toxic-flow-score.store.js";
import { PostgresToxicFlowScoreStore } from "../dist/modules/risk/postgres-toxic-flow-score.store.js";

const user = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const row = {
  chain_id: "1",
  user_address: user,
  score_bps: 4200,
  post_trade_drift_bps: -35,
  sample_size: "25",
  window_seconds: 300,
  policy_version: "markout-v1",
  observed_at: new Date("2026-07-14T00:00:00.000Z"),
  version: "1",
  updated_by: "risk_analyzer:writer_key",
  updated_at: new Date("2026-07-14T00:00:01.000Z"),
};

test("PostgresToxicFlowScoreStore bulk-loads bounded hot-state scores", async () => {
  const pool = fakePool([{ rows: [row] }]);
  const scores = await new PostgresToxicFlowScoreStore(pool).listScores(100_001);

  assert.equal(scores.length, 1);
  assert.equal(scores[0].user, user);
  assert.equal(scores[0].sampleSize, 25);
  assert.match(pool.calls[0].sql, /ORDER BY chain_id, user_address/);
  assert.match(pool.calls[0].sql, /LIMIT \$1/);
  assert.deepEqual(pool.calls[0].params, [100_001]);
  assert.equal(pool.releaseCount, 1);

  const unusedPool = fakePool([]);
  await assert.rejects(
    new PostgresToxicFlowScoreStore(unusedPool).listScores(1_000_002),
    /limit must be between 1 and 1000001/,
  );
  assert.equal(unusedPool.connectCount, 0);
});

test("PostgresToxicFlowScoreStore reads and atomically audits CAS updates", async () => {
  const pool = fakePool([{ rows: [] }, { rows: [row] }, { rows: [row] }]);
  const store = new PostgresToxicFlowScoreStore(pool);
  assert.equal(await store.getScore({ chainId: 1, user }), null);
  assert.deepEqual(await store.getScore({ chainId: 1, user }), {
    chainId: 1,
    user,
    scoreBps: 4200,
    postTradeDriftBps: -35,
    sampleSize: 25,
    windowSeconds: 300,
    policyVersion: "markout-v1",
    observedAt: "2026-07-14T00:00:00.000Z",
    version: 1,
    updatedBy: "risk_analyzer:writer_key",
    updatedAt: "2026-07-14T00:00:01.000Z",
  });
  assert.equal((await store.updateScore({ chainId: 1, user }, update(), "risk_analyzer:writer_key")).version, 1);

  const call = pool.calls[2];
  assert.match(call.sql, /WITH updated AS/);
  assert.match(call.sql, /INSERT INTO toxic_flow_scores/);
  assert.match(call.sql, /ON CONFLICT \(chain_id, user_address\) DO NOTHING/);
  assert.match(call.sql, /INSERT INTO toxic_flow_score_audit/);
  assert.deepEqual(call.params, [1, user, 4200, -35, 25, 300, "markout-v1", "2026-07-14T00:00:00.000Z", "risk_analyzer:writer_key", 0]);
});

test("PostgresToxicFlowScoreStore reports stale CAS and validates before connecting", async () => {
  const conflictPool = fakePool([{ rows: [] }, { rows: [{ version: "2" }] }]);
  await assert.rejects(
    new PostgresToxicFlowScoreStore(conflictPool).updateScore(
      { chainId: 1, user },
      update({ expectedVersion: 1 }),
      "risk_analyzer:writer_key",
    ),
    ToxicFlowScoreConflictError,
  );

  const unusedPool = fakePool([]);
  await assert.rejects(
    new PostgresToxicFlowScoreStore(unusedPool).updateScore(
      { chainId: 1, user },
      update({ scoreBps: 10_001 }),
      "risk_analyzer:writer_key",
    ),
    /scoreBps must be an integer/,
  );
  assert.equal(unusedPool.connectCount, 0);
});

function update(overrides = {}) {
  return {
    scoreBps: 4200,
    postTradeDriftBps: -35,
    sampleSize: 25,
    windowSeconds: 300,
    policyVersion: "markout-v1",
    observedAt: "2026-07-14T00:00:00.000Z",
    expectedVersion: 0,
    ...overrides,
  };
}

function fakePool(results) {
  const calls = [];
  let connectCount = 0;
  let releaseCount = 0;
  return {
    calls,
    get connectCount() { return connectCount; },
    get releaseCount() { return releaseCount; },
    async connect() {
      connectCount += 1;
      return {
        async query(sql, params = []) {
          calls.push({ sql, params });
          const next = results.shift();
          if (!next) throw new Error("unexpected query");
          return next;
        },
        release() { releaseCount += 1; },
      };
    },
  };
}
