import assert from "node:assert/strict";
import test from "node:test";
import { PostgresToxicFlowMarkoutStore } from "../dist/modules/risk/postgres-toxic-flow-markout.store.js";

const job = {
  settlementEventId: "se_1",
  quoteId: "q_1",
  chainId: 1,
  user: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  tokenIn: "0x0000000000000000000000000000000000000002",
  tokenOut: "0x0000000000000000000000000000000000000003",
  amountIn: "100000000000000000000",
  amountOut: "100000000",
  settledAt: "2026-07-14T00:00:00.000Z",
  desiredCanonical: true,
  desiredRevision: 3,
  attemptCount: 1,
};

test("PostgresToxicFlowMarkoutStore claims one eligible revision with an expiring lease", async () => {
  const { pool, client } = fakePool(async (sql) => {
    if (sql.includes("UPDATE toxic_flow_markout_jobs AS job")) {
      return { rows: [jobRow()], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  });

  assert.deepEqual(
    await new PostgresToxicFlowMarkoutStore(pool).claimNext("analyzer_1", 30_000, 300),
    job,
  );
  const claim = client.queries.find(({ sql }) => sql.includes("FOR UPDATE SKIP LOCKED"));
  assert.ok(claim);
  assert.match(claim.sql, /settled_at \+ \$3 \* interval '1 second' <= now\(\)/);
  assert.deepEqual(claim.params, ["analyzer_1", 30_000, 300]);
  assert.equal(client.released, true);
});

test("PostgresToxicFlowMarkoutStore rejects malformed claimed revision state", async () => {
  const { pool } = fakePool(async (sql) => {
    if (sql.includes("UPDATE toxic_flow_markout_jobs AS job")) {
      return { rows: [jobRow({ desired_revision: "0" })], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  });
  await assert.rejects(
    new PostgresToxicFlowMarkoutStore(pool).claimNext("analyzer_1", 30_000, 300),
    /job is invalid/,
  );
});

test("PostgresToxicFlowMarkoutStore selects the first bounded same-direction snapshot", async () => {
  const { pool, client } = fakePool(async (sql) => {
    if (sql.includes("FROM market_snapshots")) {
      return {
        rows: [{
          id: "snap_post",
          mid_price: "0.995000000000000000",
          observed_at: new Date("2026-07-14T00:05:02.000Z"),
        }],
        rowCount: 1,
      };
    }
    return { rows: [], rowCount: 0 };
  });

  const snapshot = await new PostgresToxicFlowMarkoutStore(pool)
    .findPostTradeSnapshot(job, 300, 900);

  assert.deepEqual(snapshot, {
    snapshotId: "snap_post",
    midPrice: "0.995000000000000000",
    observedAt: "2026-07-14T00:05:02.000Z",
  });
  const query = client.queries.find(({ sql }) => sql.includes("FROM market_snapshots"));
  assert.match(query.sql, /chain_id = \$1 AND lower\(token_in\) = \$2/);
  assert.match(query.sql, /ORDER BY observed_at ASC, id ASC LIMIT 1/);
  assert.deepEqual(query.params, [1, job.tokenIn, job.tokenOut, job.settledAt, 300, 900]);
});

test("PostgresToxicFlowMarkoutStore persists the policy horizon and rejects identity conflicts", async () => {
  let returnRow = true;
  const { pool, client } = fakePool(async (sql) => {
    if (sql.startsWith("INSERT INTO toxic_flow_markouts")) {
      return { rows: returnRow ? [{ settlement_event_id: job.settlementEventId }] : [], rowCount: returnRow ? 1 : 0 };
    }
    return { rows: [], rowCount: 0 };
  });
  const store = new PostgresToxicFlowMarkoutStore(pool);
  const snapshot = {
    snapshotId: "snap_post",
    midPrice: "0.995000000000000000",
    observedAt: "2026-07-14T00:05:02.000Z",
  };
  const result = {
    executionPrice: "1.000000000000000000",
    postMidPrice: "0.995000000000000000",
    postTradeDriftBps: -50,
    toxicityScoreBps: 5000,
  };

  await store.upsertMarkout(job, snapshot, result, 300, "markout-v1");
  const upsert = client.queries.find(({ sql }) => sql.startsWith("INSERT INTO toxic_flow_markouts"));
  assert.equal(upsert.params[11], 300);
  assert.equal(upsert.params[12], "markout-v1");
  assert.match(upsert.sql, /RETURNING settlement_event_id/);
  await assert.rejects(
    store.upsertMarkout(
      job,
      { ...snapshot, observedAt: "2026-07-14T00:04:59.999Z" },
      result,
      300,
      "markout-v1",
    ),
    /precedes the policy horizon/,
  );

  returnRow = false;
  await assert.rejects(
    store.upsertMarkout(job, snapshot, result, 300, "markout-v1"),
    /identity conflict/,
  );
});

test("PostgresToxicFlowMarkoutStore aggregates canonical evidence and guards lease completion", async () => {
  let leaseOwned = true;
  const { pool, client } = fakePool(async (sql) => {
    if (sql.includes("COUNT(*)::text AS sample_size")) {
      return { rows: [{
        sample_size: "5",
        average_drift_bps: "-50",
        score_bps: "5000",
        observed_at: new Date("2026-07-14T00:05:02.000Z"),
      }], rowCount: 1 };
    }
    if (sql.startsWith("UPDATE toxic_flow_markout_jobs SET")) {
      return { rows: leaseOwned ? [{ settlement_event_id: job.settlementEventId }] : [], rowCount: leaseOwned ? 1 : 0 };
    }
    return { rows: [], rowCount: 0 };
  });
  const store = new PostgresToxicFlowMarkoutStore(pool);

  assert.deepEqual(await store.aggregateUser(1, job.user, 86_400), {
    sampleSize: 5,
    averagePostTradeDriftBps: -50,
    scoreBps: 5000,
    observedAt: "2026-07-14T00:05:02.000Z",
  });
  await store.complete(job, "analyzer_1");
  const completion = client.queries.find(({ sql }) => sql.includes("processed_revision = CASE"));
  assert.match(completion.sql, /desired_revision = \$3/);
  assert.deepEqual(completion.params, [job.settlementEventId, "analyzer_1", 3]);

  leaseOwned = false;
  await assert.rejects(store.complete(job, "analyzer_1"), /lease conflict/);
});

function jobRow(overrides = {}) {
  return {
    settlement_event_id: job.settlementEventId,
    quote_id: job.quoteId,
    chain_id: "1",
    user_address: job.user,
    token_in: job.tokenIn,
    token_out: job.tokenOut,
    amount_in: job.amountIn,
    amount_out: job.amountOut,
    settled_at: job.settledAt,
    desired_canonical: true,
    desired_revision: "3",
    attempt_count: "1",
    ...overrides,
  };
}

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
