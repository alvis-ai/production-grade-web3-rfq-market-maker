import pg from "pg";
import {
  assertRiskDecisionInput,
  assertRiskDecisionQuoteId,
  assertRiskDecisionRecord,
  type RiskDecisionRecord,
  type SaveRiskDecisionInput,
  type RiskDecisionStore,
} from "./risk-decision.repository.js";

export class PostgresRiskDecisionStore implements RiskDecisionStore {
  private readonly pool: pg.Pool;

  constructor(pool: pg.Pool) {
    this.pool = pool;
  }

  async checkHealth(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("SELECT 1");
    } finally {
      client.release();
    }
  }

  async saveDecision(input: SaveRiskDecisionInput): Promise<RiskDecisionRecord> {
    assertRiskDecisionInput(input);
    const quoteId = input.quoteId;
    const decision = input.decision.status;
    const reasonCode = input.decision.status === "rejected" ? input.decision.reasonCode : null;
    const policyVersion = input.decision.policyVersion;
    const riskDecisionId = `rd_${quoteId}`;

    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `INSERT INTO risk_decisions (id, quote_id, decision, reason_code, policy_version, created_at)
         VALUES ($1, $2, $3, $4, $5, now())
         ON CONFLICT (id) DO NOTHING
         RETURNING id, quote_id, decision, reason_code, policy_version, created_at`,
        [riskDecisionId, quoteId, decision, reasonCode, policyVersion],
      );
      const row = result.rows[0] ?? (await client.query(
        `SELECT id, quote_id, decision, reason_code, policy_version, created_at
         FROM risk_decisions WHERE id = $1`,
        [riskDecisionId],
      )).rows[0];
      const record = parseRiskDecisionRecord(row);
      try {
        assertRiskDecisionRecord(record, input);
      } catch {
        throw new Error(`Risk decision conflict for ${quoteId}`);
      }
      return record;
    } finally {
      client.release();
    }
  }

  async findByQuoteId(quoteId: string): Promise<RiskDecisionRecord | undefined> {
    assertRiskDecisionQuoteId(quoteId);
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        "SELECT id, quote_id, decision, reason_code, policy_version, created_at FROM risk_decisions WHERE quote_id = $1",
        [quoteId],
      );
      if (!result.rowCount) return undefined;

      return parseRiskDecisionRecord(result.rows[0]);
    } finally {
      client.release();
    }
  }
}

function parseRiskDecisionRecord(row: unknown): RiskDecisionRecord {
  if (typeof row !== "object" || row === null || Array.isArray(row)) {
    throw new Error("Postgres risk decision query returned an invalid row");
  }
  const value = row as Record<string, unknown>;
  const record: RiskDecisionRecord = {
    riskDecisionId: value.id as string,
    quoteId: value.quote_id as string,
    decision: value.decision as RiskDecisionRecord["decision"],
    ...(value.reason_code == null ? {} : { reasonCode: value.reason_code as RiskDecisionRecord["reasonCode"] }),
    policyVersion: value.policy_version as string,
    createdAt: value.created_at instanceof Date ? value.created_at.toISOString() : String(value.created_at),
  };
  assertRiskDecisionRecord(record);
  return record;
}
