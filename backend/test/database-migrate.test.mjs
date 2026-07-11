import assert from "node:assert/strict";
import test from "node:test";
import { migrate, migrateUpTo } from "../dist/db/migrate.js";

test("database migration runner holds one session advisory lock across discovery", async () => {
  const { pool, client } = fakePool(async (sql) => {
    if (sql.includes("SELECT version, name")) {
      return { rows: [
        { version: "001", name: "base-schema", applied_at: "2026-07-11T00:00:00.000Z" },
        { version: "002", name: "settlement-canonical", applied_at: "2026-07-11T00:00:00.000Z" },
        { version: "003", name: "hedge-worker-queue", applied_at: "2026-07-11T00:00:00.000Z" },
        { version: "004", name: "analytics-outbox", applied_at: "2026-07-11T00:00:00.000Z" },
      ] };
    }
    return { rows: [] };
  });

  await migrate(pool);

  assert.match(client.queries[0].sql, /pg_advisory_lock/);
  assert.match(client.queries.at(-1).sql, /pg_advisory_unlock/);
  assert.equal(client.released, true);
  assert.equal(client.queries.filter(({ sql }) => sql === "BEGIN").length, 0);
});

test("database migration runner applies hedge queue migration transactionally under the lock", async () => {
  const { pool, client } = fakePool(async (sql) => {
    if (sql.includes("SELECT version, name")) {
      return { rows: [
        { version: "001", name: "base-schema", applied_at: "2026-07-11T00:00:00.000Z" },
        { version: "002", name: "settlement-canonical", applied_at: "2026-07-11T00:00:00.000Z" },
      ] };
    }
    return { rows: [] };
  });
  const originalLog = console.log;
  console.log = () => {};
  try {
    await migrateUpTo(pool, "003");
  } finally {
    console.log = originalLog;
  }

  assert.equal(client.queries.some(({ sql }) => sql.includes("ADD COLUMN attempt_count")), true);
  assert.equal(client.queries.some(({ sql, params }) => sql.includes("INSERT INTO _migrations") && params[0] === "003"), true);
  assert.deepEqual(
    client.queries.filter(({ sql }) => sql === "BEGIN" || sql === "COMMIT").map(({ sql }) => sql),
    ["BEGIN", "COMMIT"],
  );
  assert.match(client.queries.at(-1).sql, /pg_advisory_unlock/);
});

test("migrateUpTo does not apply migrations beyond an already-applied target", async () => {
  const { pool, client } = fakePool(async (sql) => {
    if (sql.includes("SELECT version, name")) {
      return { rows: [
        { version: "001", name: "base-schema", applied_at: "2026-07-11T00:00:00.000Z" },
        { version: "002", name: "settlement-canonical", applied_at: "2026-07-11T00:00:00.000Z" },
      ] };
    }
    return { rows: [] };
  });

  await migrateUpTo(pool, "002");

  assert.equal(client.queries.some(({ sql }) => sql.includes("ADD COLUMN attempt_count")), false);
  assert.equal(client.queries.some(({ sql }) => sql.includes("INSERT INTO _migrations")), false);
});

test("migrateUpTo rejects an unknown target without applying migrations", async () => {
  const { pool, client } = fakePool(async (sql) => {
    if (sql.includes("SELECT version, name")) return { rows: [] };
    return { rows: [] };
  });

  await assert.rejects(migrateUpTo(pool, "999"), /Target migration does not exist/);
  assert.equal(client.queries.some(({ sql }) => sql === "BEGIN"), false);
  assert.match(client.queries.at(-1).sql, /pg_advisory_unlock/);
});

test("database migration runner applies analytics outbox after hedge queue", async () => {
  const { pool, client } = fakePool(async (sql) => {
    if (sql.includes("SELECT version, name")) {
      return { rows: [
        { version: "001", name: "base-schema", applied_at: "2026-07-11T00:00:00.000Z" },
        { version: "002", name: "settlement-canonical", applied_at: "2026-07-11T00:00:00.000Z" },
        { version: "003", name: "hedge-worker-queue", applied_at: "2026-07-11T00:00:00.000Z" },
      ] };
    }
    return { rows: [] };
  });
  const originalLog = console.log;
  console.log = () => {};
  try {
    await migrateUpTo(pool, "004");
  } finally {
    console.log = originalLog;
  }

  assert.equal(client.queries.some(({ sql }) => sql.includes("CREATE TABLE analytics_outbox")), true);
  assert.equal(client.queries.some(({ sql }) => sql.includes("enqueue_rfq_analytics_event")), true);
  assert.equal(client.queries.some(({ sql, params }) => sql.includes("INSERT INTO _migrations") && params[0] === "004"), true);
});

function fakePool(handler) {
  const client = {
    queries: [],
    released: false,
    async query(sql, params = []) {
      const normalized = sql.trim();
      this.queries.push({ sql: normalized, params });
      return handler(normalized, params);
    },
    release() { this.released = true; },
  };
  return { pool: { async connect() { return client; } }, client };
}
