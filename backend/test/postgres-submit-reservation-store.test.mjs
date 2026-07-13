import assert from "node:assert/strict";
import test from "node:test";
import { PostgresSubmitReservationStore } from "../dist/modules/execution/postgres-submit-reservation.store.js";

test("PostgresSubmitReservationStore atomically claims expired rows and conditionally releases ownership", async () => {
  const expiresAt = "2026-07-13T01:00:00.000Z";
  const { pool, clients } = fakePool(async (sql, params) => {
    if (sql.startsWith("INSERT INTO quote_submit_reservations")) {
      return {
        rows: [{ quote_id: params[0], owner_token: params[1], expires_at: expiresAt }],
        rowCount: 1,
      };
    }
    return { rows: [], rowCount: 1 };
  });
  const store = new PostgresSubmitReservationStore(
    pool,
    { leaseMs: 900_000 },
    () => "submit_owner_1",
  );

  const reservation = await store.acquire("q_submit_pg");
  assert.deepEqual(reservation, {
    quoteId: "q_submit_pg",
    ownerToken: "submit_owner_1",
    expiresAt,
  });
  await store.release(reservation);

  const queries = clients.flatMap((client) => client.queries);
  const acquire = queries.find(({ sql }) => sql.startsWith("INSERT INTO quote_submit_reservations"));
  assert.match(acquire.sql, /ON CONFLICT \(quote_id\) DO UPDATE/);
  assert.match(acquire.sql, /expires_at <= now\(\)/);
  assert.deepEqual(acquire.params, ["q_submit_pg", "submit_owner_1", 900_000]);
  const release = queries.find(({ sql }) => sql.startsWith("DELETE FROM quote_submit_reservations"));
  assert.match(release.sql, /owner_token = \$2/);
  assert.equal(clients.every(({ released }) => released), true);
});

test("PostgresSubmitReservationStore reports contention without mutating ownership", async () => {
  const { pool } = fakePool(async () => ({ rows: [], rowCount: 0 }));
  const store = new PostgresSubmitReservationStore(
    pool,
    { leaseMs: 900_000 },
    () => "submit_owner_2",
  );
  assert.equal(await store.acquire("q_submit_busy"), undefined);
});

test("PostgresSubmitReservationStore validates dependencies and database rows", async () => {
  assert.throws(
    () => new PostgresSubmitReservationStore({}, { leaseMs: 900_000 }),
    /pool.connect must be a function/,
  );
  const { pool } = fakePool(async () => ({
    rows: [{ quote_id: "q_submit_bad", owner_token: "bad owner", expires_at: "not-a-date" }],
    rowCount: 1,
  }));
  const store = new PostgresSubmitReservationStore(
    pool,
    { leaseMs: 900_000 },
    () => "submit_owner_3",
  );
  await assert.rejects(store.acquire("q_submit_bad"), /expires_at must be a canonical UTC timestamp/);
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
