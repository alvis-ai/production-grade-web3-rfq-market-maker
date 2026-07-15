import assert from "node:assert/strict";
import test from "node:test";
import { PostgresRiskDecisionStore } from "../dist/modules/risk/postgres-risk-decision.repository.js";

const approvedInput = {
  quoteId: "q_pg_risk",
  decision: { status: "approved", policyVersion: "risk-v1" },
};
const approvedRow = {
  id: "rd_q_pg_risk",
  quote_id: "q_pg_risk",
  decision: "approved",
  reason_code: null,
  policy_version: "risk-v1",
  created_at: new Date("2026-07-15T00:00:00.000Z"),
};

test("PostgresRiskDecisionStore inserts immutable evidence and accepts exact replay", async () => {
  const inserted = fakePool(async (sql) => {
    if (sql.startsWith("INSERT")) return { rows: [approvedRow], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  });
  const first = await new PostgresRiskDecisionStore(inserted.pool).saveDecision(approvedInput);
  assert.equal(first.riskDecisionId, approvedRow.id);
  assert.match(inserted.queries[0].sql, /ON CONFLICT \(id\) DO NOTHING/);
  assert.doesNotMatch(inserted.queries[0].sql, /DO UPDATE/);
  assert.equal(inserted.released(), true);

  const replayed = fakePool(async (sql) => {
    if (sql.startsWith("INSERT")) return { rows: [], rowCount: 0 };
    if (sql.startsWith("SELECT id")) return { rows: [approvedRow], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  });
  const replay = await new PostgresRiskDecisionStore(replayed.pool).saveDecision(approvedInput);
  assert.deepEqual(replay, first);
  assert.equal(replayed.queries.length, 2);
});

test("PostgresRiskDecisionStore rejects conflicting or malformed persisted evidence", async () => {
  const conflicting = fakePool(async (sql) => {
    if (sql.startsWith("INSERT")) return { rows: [], rowCount: 0 };
    return { rows: [{
      ...approvedRow,
      decision: "rejected",
      reason_code: "TOKEN_NOT_ALLOWED",
    }], rowCount: 1 };
  });
  await assert.rejects(
    new PostgresRiskDecisionStore(conflicting.pool).saveDecision(approvedInput),
    /Risk decision conflict for q_pg_risk/,
  );

  const malformed = fakePool(async () => ({ rows: [{ ...approvedRow, id: "rd_other" }], rowCount: 1 }));
  await assert.rejects(
    new PostgresRiskDecisionStore(malformed.pool).findByQuoteId("q_pg_risk"),
    /riskDecisionId must match quoteId/,
  );
  await assert.rejects(
    new PostgresRiskDecisionStore(malformed.pool).findByQuoteId("bad id"),
    /quoteId must contain only/,
  );
});

function fakePool(handler) {
  const queries = [];
  let wasReleased = false;
  const client = {
    async query(sql, params = []) {
      const normalized = sql.trim();
      queries.push({ sql: normalized, params });
      return handler(normalized, params);
    },
    release() { wasReleased = true; },
  };
  return {
    pool: { async connect() { return client; } },
    queries,
    released: () => wasReleased,
  };
}
