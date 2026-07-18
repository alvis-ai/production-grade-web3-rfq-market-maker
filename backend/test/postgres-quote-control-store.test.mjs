import assert from "node:assert/strict";
import test from "node:test";
import { QuoteControlConflictError } from "../dist/modules/quote-control/quote-control.store.js";
import { PostgresQuoteControlStore } from "../dist/modules/quote-control/postgres-quote-control.store.js";

const stateRow = {
  paused: false,
  version: "0",
  reason: null,
  updated_by: "migration",
  updated_at: new Date("2026-07-14T00:00:00.000Z"),
};

test("PostgresQuoteControlStore loads one consistent hot-state snapshot", async () => {
  const pairRow = {
    chain_id: "8453",
    token_low: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    token_high: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    paused: true,
    version: "2",
    reason: "venue incident",
    updated_by: "institution_a:ops_key",
    updated_at: new Date("2026-07-14T00:01:00.000Z"),
  };
  const pool = fakePool([{ rows: [stateRow] }, { rows: [pairRow] }]);

  assert.deepEqual(await new PostgresQuoteControlStore(pool).loadSnapshot(), {
    state: {
      paused: false,
      version: 0,
      reason: null,
      updatedBy: "migration",
      updatedAt: "2026-07-14T00:00:00.000Z",
    },
    pairStates: [{
      chainId: 8453,
      tokenLow: pairRow.token_low,
      tokenHigh: pairRow.token_high,
      paused: true,
      version: 2,
      reason: "venue incident",
      updatedBy: "institution_a:ops_key",
      updatedAt: "2026-07-14T00:01:00.000Z",
    }],
  });
  assert.match(pool.calls[0].sql, /FROM quote_control/);
  assert.match(pool.calls[1].sql, /FROM quote_pair_control/);
  assert.match(pool.calls[1].sql, /ORDER BY chain_id, token_low, token_high/);
  assert.equal(pool.connectCount, 1);
  assert.equal(pool.releaseCount, 1);
});

test("PostgresQuoteControlStore reads and atomically audits CAS updates", async () => {
  const pool = fakePool([
    { rows: [stateRow] },
    { rows: [{
      ...stateRow,
      paused: true,
      version: "1",
      reason: "venue incident",
      updated_by: "institution_a:ops_key",
    }] },
  ]);
  const store = new PostgresQuoteControlStore(pool);

  assert.deepEqual(await store.getState(), {
    paused: false,
    version: 0,
    reason: null,
    updatedBy: "migration",
    updatedAt: "2026-07-14T00:00:00.000Z",
  });
  assert.equal((await store.updateState({
    paused: true,
    reason: "venue incident",
    expectedVersion: 0,
  }, "institution_a:ops_key")).version, 1);

  const update = pool.calls[1];
  assert.match(pool.calls[0].sql, /pair_table_probe/);
  assert.match(update.sql, /WITH updated AS/);
  assert.match(update.sql, /INSERT INTO quote_control_audit/);
  assert.match(update.sql, /version = \$4/);
  assert.deepEqual(update.params, [true, "venue incident", "institution_a:ops_key", 0]);
  assert.equal(pool.releaseCount, 2);
});

test("PostgresQuoteControlStore distinguishes CAS conflicts from missing singleton state", async () => {
  const conflictPool = fakePool([{ rows: [] }, { rows: [{ version: "2" }] }]);
  const conflictStore = new PostgresQuoteControlStore(conflictPool);
  await assert.rejects(
    conflictStore.updateState({ paused: false, reason: "stale", expectedVersion: 1 }, "institution_a:ops_key"),
    QuoteControlConflictError,
  );

  const missingPool = fakePool([{ rows: [] }, { rows: [] }]);
  await assert.rejects(
    new PostgresQuoteControlStore(missingPool).updateState(
      { paused: true, reason: "incident", expectedVersion: 0 },
      "institution_a:ops_key",
    ),
    /singleton is missing/,
  );
});

test("PostgresQuoteControlStore validates updates before opening a database connection", async () => {
  const pool = fakePool([]);
  const store = new PostgresQuoteControlStore(pool);
  await assert.rejects(
    store.updateState({ paused: true, reason: "", expectedVersion: 0 }, "institution_a:ops_key"),
    /printable characters/,
  );
  assert.equal(pool.connectCount, 0);
});

test("PostgresQuoteControlStore reads normalized pair state and atomically audits first CAS update", async () => {
  const tokenLow = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const tokenHigh = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  const pairRow = {
    chain_id: "8453",
    token_low: tokenLow,
    token_high: tokenHigh,
    paused: true,
    version: "1",
    reason: "venue incident",
    updated_by: "institution_a:ops_key",
    updated_at: new Date("2026-07-14T00:01:00.000Z"),
  };
  const pool = fakePool([{ rows: [] }, { rows: [pairRow] }, { rows: [pairRow] }]);
  const store = new PostgresQuoteControlStore(pool);
  const reverseScope = { chainId: 8453, tokenLow: tokenHigh, tokenHigh: tokenLow };

  assert.equal(await store.getPairState(reverseScope), null);
  assert.deepEqual(await store.getPairState(reverseScope), {
    chainId: 8453,
    tokenLow,
    tokenHigh,
    paused: true,
    version: 1,
    reason: "venue incident",
    updatedBy: "institution_a:ops_key",
    updatedAt: "2026-07-14T00:01:00.000Z",
  });
  assert.equal((await store.updatePairState(reverseScope, {
    paused: true,
    reason: "venue incident",
    expectedVersion: 0,
  }, "institution_a:ops_key")).version, 1);

  const update = pool.calls[2];
  assert.match(update.sql, /WITH updated AS/);
  assert.match(update.sql, /INSERT INTO quote_pair_control/);
  assert.match(update.sql, /ON CONFLICT \(chain_id, token_low, token_high\) DO NOTHING/);
  assert.match(update.sql, /INSERT INTO quote_pair_control_audit/);
  assert.deepEqual(update.params, [
    8453,
    tokenLow,
    tokenHigh,
    true,
    "venue incident",
    "institution_a:ops_key",
    0,
  ]);
});

test("PostgresQuoteControlStore reports pair CAS conflicts without creating a stale version", async () => {
  const scope = {
    chainId: 1,
    tokenLow: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    tokenHigh: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  };
  const pool = fakePool([{ rows: [] }, { rows: [{ version: "2" }] }]);
  await assert.rejects(
    new PostgresQuoteControlStore(pool).updatePairState(scope, {
      paused: false,
      reason: "stale recovery",
      expectedVersion: 1,
    }, "institution_a:ops_key"),
    QuoteControlConflictError,
  );
  assert.equal(pool.calls.length, 2);
});

test("PostgresQuoteControlStore exposes a bounded paused pair count for readiness metrics", async () => {
  const pool = fakePool([{ rows: [{ paused_count: "2" }] }]);
  assert.equal(await new PostgresQuoteControlStore(pool).getPausedPairCount(), 2);
  assert.match(pool.calls[0].sql, /WHERE paused = TRUE/);

  const malformed = fakePool([{ rows: [{ paused_count: "9007199254740992" }] }]);
  await assert.rejects(
    new PostgresQuoteControlStore(malformed).getPausedPairCount(),
    /pausedCount is invalid/,
  );
  const negative = fakePool([{ rows: [{ paused_count: -1 }] }]);
  await assert.rejects(
    new PostgresQuoteControlStore(negative).getPausedPairCount(),
    /pausedCount is invalid/,
  );
});

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
