import assert from "node:assert/strict";
import test from "node:test";
import { PostgresQuoteIdempotencyStore } from "../dist/modules/quote/postgres-quote-idempotency.store.js";

const expiresAt = "2026-07-15T01:00:00.000Z";
const response = {
  quoteId: "q_pg_idem_1",
  snapshotId: "snapshot_pg_1",
  amountOut: "998400000",
  minAmountOut: "993408000",
  deadline: 1_893_456_030,
  nonce: "42",
  signature: `0x${"11".repeat(65)}`,
};
const hash = "a".repeat(64);

test("PostgresQuoteIdempotencyStore claims, binds, and completes with owner conditions", async () => {
  const { pool, clients } = fakePool(async (sql, params) => {
    if (sql.startsWith("INSERT INTO quote_idempotency_requests")) {
      return {
        rows: [{
          principal_id: params[0],
          idempotency_key: params[1],
          request_hash: params[2],
          owner_token: params[3],
          lease_expires_at: expiresAt,
        }],
        rowCount: 1,
      };
    }
    return { rows: [], rowCount: 1 };
  });
  const store = new PostgresQuoteIdempotencyStore(pool, { leaseMs: 60_000 }, () => "quote_idem_owner_1");
  const claim = await store.acquire("principal_1", "quote_request_pg_0001", hash);
  assert.equal(claim.status, "acquired");
  await store.bindQuote(claim.reservation, response.quoteId);
  await store.complete(claim.reservation, response);

  const queries = clients.flatMap((client) => client.queries);
  const insert = queries.find(({ sql }) => sql.startsWith("INSERT INTO quote_idempotency_requests"));
  assert.match(insert.sql, /ON CONFLICT \(principal_id, idempotency_key\) DO NOTHING/);
  assert.deepEqual(insert.params, ["principal_1", "quote_request_pg_0001", hash, "quote_idem_owner_1", 60_000]);
  const bind = queries.find(({ sql }) => sql.startsWith("UPDATE quote_idempotency_requests") && sql.includes("SET quote_id"));
  assert.match(bind.sql, /owner_token = \$4/);
  const complete = queries.find(({ sql }) => sql.includes("SET state = 'succeeded'"));
  assert.match(complete.sql, /quote_id = \$6/);
  assert.equal(clients.every(({ released }) => released), true);
});

test("PostgresQuoteIdempotencyStore recovers a bound signed quote after lease expiry", async () => {
  const { pool, clients } = fakePool(async (sql) => {
    if (sql.startsWith("INSERT INTO quote_idempotency_requests")) return { rows: [], rowCount: 0 };
    if (sql.startsWith("SELECT principal_id")) {
      return { rows: [{
        principal_id: "principal_1",
        idempotency_key: "quote_request_pg_0002",
        request_hash: hash,
        state: "processing",
        owner_token: "old_owner",
        lease_expires_at: "2026-07-15T00:00:00.000Z",
        quote_id: response.quoteId,
        response: null,
        error_code: null,
        error_message: null,
        error_status_code: null,
        lease_expired: true,
      }], rowCount: 1 };
    }
    if (sql.startsWith("SELECT id AS quote_id")) {
      return { rows: [{
        quote_id: response.quoteId,
        snapshot_id: response.snapshotId,
        amount_out: response.amountOut,
        min_amount_out: response.minAmountOut,
        deadline: response.deadline,
        nonce: response.nonce,
        signature: response.signature,
      }], rowCount: 1 };
    }
    return { rows: [], rowCount: 1 };
  });
  const store = new PostgresQuoteIdempotencyStore(pool, { leaseMs: 60_000 }, () => "quote_idem_owner_2");
  assert.deepEqual(await store.acquire("principal_1", "quote_request_pg_0002", hash), {
    status: "replay",
    response,
  });
  const queries = clients[0].queries;
  assert.match(queries.find(({ sql }) => sql.startsWith("SELECT principal_id")).sql, /FOR UPDATE/);
  assert.match(queries.find(({ sql }) => sql.includes("SET state = 'succeeded'")).sql, /state = 'processing'/);
  assert.equal(queries.at(-1).sql, "COMMIT");
});

test("PostgresQuoteIdempotencyStore returns stable conflict, in-progress, and failure states", async () => {
  for (const [row, expected] of [
    [{ request_hash: "b".repeat(64) }, { status: "conflict" }],
    [{ request_hash: hash, state: "processing", lease_expired: false }, { status: "in_progress" }],
    [{
      request_hash: hash,
      state: "failed",
      error_code: "MARKET_DATA_UNAVAILABLE",
      error_message: "Market data unavailable",
      error_status_code: 503,
    }, {
      status: "failed",
      error: { code: "MARKET_DATA_UNAVAILABLE", message: "Market data unavailable", statusCode: 503 },
    }],
  ]) {
    const { pool } = fakePool(async (sql) => {
      if (sql.startsWith("INSERT INTO quote_idempotency_requests")) return { rows: [], rowCount: 0 };
      if (sql.startsWith("SELECT principal_id")) return { rows: [row], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });
    const store = new PostgresQuoteIdempotencyStore(pool, { leaseMs: 60_000 }, () => "quote_idem_owner_3");
    assert.deepEqual(await store.acquire("principal_1", "quote_request_pg_0003", hash), expected);
  }
});

test("PostgresQuoteIdempotencyStore rejects unknown persisted public error codes", async () => {
  const { pool } = fakePool(async (sql) => {
    if (sql.startsWith("INSERT INTO quote_idempotency_requests")) return { rows: [], rowCount: 0 };
    if (sql.startsWith("SELECT principal_id")) {
      return { rows: [{
        request_hash: hash,
        state: "failed",
        error_code: "DATABASE_PASSWORD_INVALID",
        error_message: "unsafe",
        error_status_code: 500,
      }], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  });
  const store = new PostgresQuoteIdempotencyStore(pool, { leaseMs: 60_000 }, () => "quote_idem_owner_4");
  await assert.rejects(
    store.acquire("principal_1", "quote_request_pg_0004", hash),
    /failure code is invalid/,
  );
});

function fakePool(handler) {
  const clients = [];
  return {
    clients,
    pool: {
      async connect() {
        const client = {
          queries: [],
          released: false,
          async query(sql, params = []) {
            const normalized = sql.trim();
            this.queries.push({ sql: normalized, params });
            return handler(normalized, params);
          },
          release() {
            this.released = true;
          },
        };
        clients.push(client);
        return client;
      },
    },
  };
}
