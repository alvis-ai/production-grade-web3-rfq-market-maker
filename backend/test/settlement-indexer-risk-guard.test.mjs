import assert from "node:assert/strict";
import test from "node:test";
import {
  PostgresSettlementIndexerRiskGuard,
} from "../dist/modules/risk/settlement-indexer-risk.guard.js";

const settlementAddress = "0x0000000000000000000000000000000000000044";

test("settlement indexer risk guard enforces confirmed cursor lag boundaries", async () => {
  const fixture = guardFixture({ next_block: "101", cursor_age_ms: "500" }, 112n);

  await fixture.guard.assertQuoteSafe({ chainId: 1, observedHead: 112n });
  await fixture.guard.checkHealth();
  assert.equal(fixture.reader.chainCalls, 1);
  assert.equal(fixture.reader.headCalls, 1);
  assert.deepEqual(fixture.clients.flatMap(({ queries }) => queries).map(({ params }) => params), [[1], [1]]);

  await assert.rejects(
    fixture.guard.assertQuoteSafe({ chainId: 1, observedHead: 113n }),
    /exceeds the confirmed block lag limit/,
  );
});

test("settlement indexer risk guard rejects missing, stale, and mismatched cursor evidence", async () => {
  for (const scenario of [
    { row: null, error: /missing or duplicated/ },
    { row: { next_block: "103", cursor_age_ms: "60001" }, error: /cursor is stale/ },
    {
      row: {
        settlement_address: "0x0000000000000000000000000000000000000055",
        next_block: "103",
        cursor_age_ms: "0",
      },
      error: /contract does not match/,
    },
    { row: { next_block: "0103", cursor_age_ms: "0" }, error: /canonical non-negative integer/ },
    { row: { next_block: "103", cursor_age_ms: "-1" }, error: /canonical non-negative integer/ },
  ]) {
    const fixture = guardFixture(scenario.row);
    await assert.rejects(
      fixture.guard.assertQuoteSafe({ chainId: 1, observedHead: 112n }),
      scenario.error,
    );
    assert.equal(fixture.clients.every(({ released }) => released), true);
  }
});

test("settlement indexer risk guard verifies RPC identity and configured chains", async () => {
  const wrongChain = guardFixture(undefined, 112n, 2);
  await assert.rejects(wrongChain.guard.checkHealth(), /chain ID does not match/);
  assert.equal(wrongChain.clients.length, 0);

  const fixture = guardFixture();
  await assert.rejects(
    fixture.guard.assertQuoteSafe({ chainId: 2, observedHead: 112n }),
    /not configured for the requested chain/,
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
});

function guardFixture(row = {}, head = 112n, chainId = 1) {
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
    guard: new PostgresSettlementIndexerRiskGuard(pool, guardConfig(), () => reader),
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
