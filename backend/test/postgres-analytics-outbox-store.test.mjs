import assert from "node:assert/strict";
import test from "node:test";
import { PostgresAnalyticsOutboxStore } from "../dist/modules/analytics/postgres-analytics-outbox.store.js";

const row = {
  id: "7",
  topic: "rfq.analytics.v1",
  event_key: "q_analytics",
  event_type: "quote.lifecycle.v1",
  schema_version: 1,
  aggregate_type: "quote",
  aggregate_id: "q_analytics",
  payload: { quoteId: "q_analytics", amountIn: "1000" },
  attempt_count: 2,
  created_at: "2026-07-11T00:00:00.000Z",
};

test("PostgresAnalyticsOutboxStore claims ordered rows with leases and SKIP LOCKED", async () => {
  const { pool, client } = fakePool(async (sql) => {
    if (sql.includes("UPDATE analytics_outbox AS outbox")) return { rows: [row], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  });
  const store = new PostgresAnalyticsOutboxStore(pool);

  const records = await store.claimBatch("analytics_worker_1", 30000, 50);

  assert.equal(records[0].outboxId, "7");
  assert.equal(records[0].payload.amountIn, "1000");
  assert.equal(client.queries[0].sql, "BEGIN");
  assert.match(client.queries[1].sql, /FOR UPDATE SKIP LOCKED/);
  assert.match(client.queries[1].sql, /published_at IS NULL/);
  assert.equal(client.queries[2].sql, "COMMIT");
});

test("PostgresAnalyticsOutboxStore applies lease-owned publish and retry transitions", async () => {
  const { pool, client } = fakePool(async () => ({ rows: [], rowCount: 1 }));
  const store = new PostgresAnalyticsOutboxStore(pool);

  await store.markPublished("7", "analytics_worker_1");
  await store.releaseForRetry("8", "analytics_worker_1", "ANALYTICS_PUBLISH_FAILED", 1000);

  assert.match(client.queries[0].sql, /published_at = now\(\)/);
  assert.match(client.queries[0].sql, /lease_owner = \$2/);
  assert.match(client.queries[1].sql, /available_at = now\(\)/);
  assert.equal(client.queries[1].params[3], "ANALYTICS_PUBLISH_FAILED");
});

test("PostgresAnalyticsOutboxStore reports backlog and cleans only published rows", async () => {
  const { pool, client } = fakePool(async (sql) => {
    if (sql.includes("COUNT(*)")) {
      return { rows: [{
        pending_count: "3",
        oldest_created_at: new Date("2026-07-11T00:00:00.000Z"),
        cleanup_eligible_count: "2",
      }], rowCount: 1 };
    }
    if (sql.startsWith("DELETE")) return { rows: [], rowCount: 2 };
    return { rows: [], rowCount: 0 };
  });
  const store = new PostgresAnalyticsOutboxStore(pool);

  assert.deepEqual(await store.stats("2026-07-12T00:00:00.000Z"), {
    pendingCount: 3,
    cleanupEligibleCount: 2,
    oldestPendingCreatedAt: "2026-07-11T00:00:00.000Z",
  });
  assert.deepEqual(client.queries[0].params, ["2026-07-12T00:00:00.000Z"]);
  assert.equal(await store.deletePublishedBefore("2026-07-12T00:00:00.000Z", 100), 2);
  assert.match(client.queries.at(-1).sql, /published_at IS NOT NULL/);
});

test("PostgresAnalyticsOutboxStore rejects malformed rows and stale leases", async () => {
  const { pool } = fakePool(async (sql) => {
    if (sql.includes("UPDATE analytics_outbox AS outbox")) return { rows: [{ ...row, id: "01" }], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  });
  const store = new PostgresAnalyticsOutboxStore(pool);
  await assert.rejects(store.claimBatch("analytics_worker_1", 30000, 50), /positive decimal/);
  await assert.rejects(store.markPublished("7", "analytics_worker_1"), /lease conflict/);
  await assert.rejects(store.claimBatch("bad/worker", 30000, 50), /workerId/);
});

function fakePool(handler) {
  const client = {
    queries: [],
    async query(sql, params = []) {
      const normalized = sql.trim();
      this.queries.push({ sql: normalized, params });
      return handler(normalized, params);
    },
    release() {},
  };
  return { client, pool: { async connect() { return client; } } };
}
