import assert from "node:assert/strict";
import test from "node:test";
import {
  PostgresSettlementIndexerRiskGuard,
} from "../dist/modules/risk/settlement-indexer-risk.guard.js";

const settlementAddress = "0x0000000000000000000000000000000000000044";

test("settlement indexer risk guard enforces confirmed cursor lag boundaries", async () => {
  const observations = observerFixture();
  const fixture = guardFixture({ next_block: "101", cursor_age_ms: "500" }, 112n, 1, observations.observer);

  await fixture.guard.assertQuoteSafe({ chainId: 1, observedHead: 112n });
  await fixture.guard.checkHealth();
  assert.equal(fixture.reader.chainCalls, 1);
  assert.equal(fixture.reader.headCalls, 1);
  assert.deepEqual(fixture.clients.flatMap(({ queries }) => queries).map(({ params }) => params), [[1], [1]]);

  await assert.rejects(
    fixture.guard.assertQuoteSafe({ chainId: 1, observedHead: 113n }),
    /exceeds the confirmed block lag limit/,
  );
  assert.deepEqual(observations.successes, [1, 1]);
  assert.deepEqual(observations.failures, [{ chainId: 1, reason: "BLOCK_LAG" }]);
});

test("settlement indexer risk guard rejects missing, stale, and mismatched cursor evidence", async () => {
  for (const scenario of [
    { row: null, error: /missing or duplicated/, reason: "CURSOR_MISSING" },
    { row: { next_block: "103", cursor_age_ms: "60001" }, error: /cursor is stale/, reason: "CURSOR_STALE" },
    {
      row: {
        settlement_address: "0x0000000000000000000000000000000000000055",
        next_block: "103",
        cursor_age_ms: "0",
      },
      error: /contract does not match/,
      reason: "CONTRACT_MISMATCH",
    },
    {
      row: { next_block: "0103", cursor_age_ms: "0" },
      error: /canonical non-negative integer/,
      reason: "CURSOR_INVALID",
    },
    {
      row: { next_block: "103", cursor_age_ms: "-1" },
      error: /canonical non-negative integer/,
      reason: "CURSOR_INVALID",
    },
  ]) {
    const observations = observerFixture();
    const fixture = guardFixture(scenario.row, 112n, 1, observations.observer);
    await assert.rejects(
      fixture.guard.assertQuoteSafe({ chainId: 1, observedHead: 112n }),
      scenario.error,
    );
    assert.equal(fixture.clients.every(({ released }) => released), true);
    assert.deepEqual(observations.failures, [{ chainId: 1, reason: scenario.reason }]);
  }
});

test("settlement indexer risk guard verifies RPC identity and configured chains", async () => {
  const observations = observerFixture();
  const wrongChain = guardFixture(undefined, 112n, 2, observations.observer);
  await assert.rejects(wrongChain.guard.checkHealth(), /chain ID does not match/);
  assert.equal(wrongChain.clients.length, 0);
  assert.deepEqual(observations.failures, [{ chainId: 1, reason: "RPC_UNAVAILABLE" }]);

  const unconfiguredObservations = observerFixture();
  const fixture = guardFixture(undefined, 112n, 1, unconfiguredObservations.observer);
  await assert.rejects(
    fixture.guard.assertQuoteSafe({ chainId: 2, observedHead: 112n }),
    /not configured for the requested chain/,
  );
  assert.deepEqual(
    unconfiguredObservations.failures,
    [],
  );
  await assert.rejects(
    fixture.guard.assertQuoteSafe({ chainId: 1, observedHead: 112 }),
    /must be a non-negative safe bigint/,
  );
});

test("settlement indexer risk guard validates configuration and dependencies", () => {
  const config = guardConfig();
  assert.throws(
    () => new PostgresSettlementIndexerRiskGuard({}, config),
    /pool.connect must be a function/,
  );
  assert.throws(
    () => new PostgresSettlementIndexerRiskGuard(fakePool().pool, { ...config, maxBlockLag: -1 }),
    /maxBlockLag must be an integer between 0 and 10000/,
  );
  assert.throws(
    () => new PostgresSettlementIndexerRiskGuard(fakePool().pool, { ...config, maxCursorAgeMs: 999 }),
    /maxCursorAgeMs must be an integer between 1000 and 600000/,
  );
  assert.throws(
    () => new PostgresSettlementIndexerRiskGuard(fakePool().pool, config, () => ({})),
    /reader methods are invalid/,
  );
  assert.throws(
    () => new PostgresSettlementIndexerRiskGuard(fakePool().pool, config, undefined, {}),
    /observer methods are invalid/,
  );
});

test("settlement indexer risk guard classifies store outages without trusting observer side effects", async () => {
  const { pool, clients } = fakePool(async () => { throw new Error("database unavailable"); });
  const failures = [];
  const guard = new PostgresSettlementIndexerRiskGuard(
    pool,
    guardConfig(),
    () => ({ async getChainId() { return 1; }, async getBlockNumber() { return 112n; } }),
    {
      recordSettlementIndexerRiskGuardSuccess() { throw new Error("observer failed"); },
      recordSettlementIndexerRiskGuardFailure(chainId, reason) {
        failures.push({ chainId, reason });
        throw new Error("observer failed");
      },
    },
  );

  await assert.rejects(
    guard.assertQuoteSafe({ chainId: 1, observedHead: 112n }),
    /cursor store is unavailable/,
  );
  assert.deepEqual(failures, [{ chainId: 1, reason: "CURSOR_STORE_UNAVAILABLE" }]);
  assert.equal(clients.every(({ released }) => released), true);
});

function guardFixture(row = {}, head = 112n, chainId = 1, observer = observerFixture().observer) {
  const completeRow = row === null ? undefined : {
    settlement_address: settlementAddress,
    next_block: "103",
    cursor_age_ms: "0",
    ...row,
  };
  const { pool, clients } = fakePool(async () => ({
    rows: completeRow ? [completeRow] : [],
    rowCount: completeRow ? 1 : 0,
  }));
  const reader = {
    chainCalls: 0,
    headCalls: 0,
    async getChainId() { this.chainCalls += 1; return chainId; },
    async getBlockNumber() { this.headCalls += 1; return head; },
  };
  return {
    clients,
    reader,
    guard: new PostgresSettlementIndexerRiskGuard(pool, guardConfig(), () => reader, observer),
  };
}

function observerFixture() {
  const successes = [];
  const failures = [];
  return {
    successes,
    failures,
    observer: {
      recordSettlementIndexerRiskGuardSuccess(chainId) { successes.push(chainId); },
      recordSettlementIndexerRiskGuardFailure(chainId, reason) { failures.push({ chainId, reason }); },
    },
  };
}

function guardConfig() {
  return {
    receiptConfig: {
      chains: [{
        chainId: 1,
        rpcUrl: "http://127.0.0.1:8545",
        settlementAddress,
        confirmations: 10,
        receiptTimeoutMs: 5_000,
      }],
    },
    maxCursorAgeMs: 60_000,
    maxBlockLag: 2,
  };
}

function fakePool(handler = async () => ({ rows: [], rowCount: 0 })) {
  const clients = [];
  return {
    clients,
    pool: {
      async connect() {
        const client = {
          queries: [],
          released: false,
          async query(sql, params = []) {
            this.queries.push({ sql, params });
            return handler(sql, params);
          },
          release() { this.released = true; },
        };
        clients.push(client);
        return client;
      },
    },
  };
}
