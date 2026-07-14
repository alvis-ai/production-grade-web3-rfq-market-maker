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
