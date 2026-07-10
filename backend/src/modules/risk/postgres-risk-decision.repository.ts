import pg from "pg";
import type { RiskDecisionRecord, SaveRiskDecisionInput, RiskDecisionStore } from "./risk-decision.repository.js";

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
    const quoteId = assertNonEmptyString(input.quoteId, "quoteId");
    const decision = input.decision.status;
    const reasonCode = input.decision.status === "rejected" ? input.decision.reasonCode : null;
    const policyVersion = assertNonEmptyString(input.decision.policyVersion, "policyVersion");
    const riskDecisionId = `rd_${quoteId}`;

    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `INSERT INTO risk_decisions (id, quote_id, decision, reason_code, policy_version, created_at)
         VALUES ($1, $2, $3, $4, $5, now())
         ON CONFLICT (id) DO UPDATE SET
           decision = EXCLUDED.decision,
           reason_code = EXCLUDED.reason_code,
           policy_version = EXCLUDED.policy_version
         RETURNING id, quote_id, decision, reason_code, policy_version, created_at`,
        [riskDecisionId, quoteId, decision, reasonCode, policyVersion],
      );

      const row = result.rows[0];
      return {
        riskDecisionId: row.id,
        quoteId: row.quote_id,
        decision: row.decision,
        reasonCode: row.reason_code ?? undefined,
        policyVersion: row.policy_version,
        createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
      };
    } finally {
      client.release();
    }
  }

  async findByQuoteId(quoteId: string): Promise<RiskDecisionRecord | undefined> {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        "SELECT id, quote_id, decision, reason_code, policy_version, created_at FROM risk_decisions WHERE quote_id = $1",
        [quoteId],
      );
      if (!result.rowCount) return undefined;

      const row = result.rows[0];
      return {
        riskDecisionId: row.id,
        quoteId: row.quote_id,
        decision: row.decision,
        reasonCode: row.reason_code ?? undefined,
        policyVersion: row.policy_version,
        createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
      };
    } finally {
      client.release();
    }
  }
}

function assertNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Postgres risk decision ${field} must be a non-empty string`);
  }
  return value.trim();
}
