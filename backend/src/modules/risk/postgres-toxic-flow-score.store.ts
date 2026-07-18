import pg from "pg";
import {
  ToxicFlowScoreConflictError,
  assertToxicFlowScoreActor,
  assertToxicFlowScoreState,
  normalizeToxicFlowScoreKey,
  normalizeToxicFlowScoreUpdate,
  type ToxicFlowScoreKey,
  type ToxicFlowScoreState,
  type ToxicFlowScoreStore,
  type UpdateToxicFlowScoreInput,
} from "./toxic-flow-score.store.js";

export class PostgresToxicFlowScoreStore implements ToxicFlowScoreStore {
  constructor(private readonly pool: pg.Pool) {
    assertPool(pool);
  }

  async checkHealth(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("SELECT version FROM toxic_flow_scores LIMIT 1");
    } finally {
      client.release();
    }
  }

  async listScores(limit: number): Promise<readonly ToxicFlowScoreState[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000_001) {
      throw new Error("Postgres toxic flow score limit must be between 1 and 1000001");
    }
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `SELECT chain_id::text AS chain_id, user_address, score_bps, post_trade_drift_bps,
                sample_size::text AS sample_size, window_seconds, policy_version, observed_at,
                version::text AS version, updated_by, updated_at
         FROM toxic_flow_scores
         ORDER BY chain_id, user_address
         LIMIT $1`,
        [limit],
      );
      return result.rows.map(parseScoreRow);
    } finally {
      client.release();
    }
  }

  async getScore(key: ToxicFlowScoreKey): Promise<ToxicFlowScoreState | null> {
    const normalizedKey = normalizeToxicFlowScoreKey(key);
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `SELECT chain_id::text AS chain_id, user_address, score_bps, post_trade_drift_bps,
                sample_size::text AS sample_size, window_seconds, policy_version, observed_at,
                version::text AS version, updated_by, updated_at
         FROM toxic_flow_scores
         WHERE chain_id = $1 AND user_address = $2`,
        [normalizedKey.chainId, normalizedKey.user],
      );
      if (result.rows.length === 0) return null;
      if (result.rows.length !== 1) throw new Error("Postgres toxic flow score read returned multiple rows");
      return parseScoreRow(result.rows[0]);
    } finally {
      client.release();
    }
  }

  async updateScore(
    key: ToxicFlowScoreKey,
    input: UpdateToxicFlowScoreInput,
    actor: string,
  ): Promise<ToxicFlowScoreState> {
    const normalizedKey = normalizeToxicFlowScoreKey(key);
    const normalizedInput = normalizeToxicFlowScoreUpdate(input);
    assertToxicFlowScoreActor(actor);
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `WITH updated AS (
           UPDATE toxic_flow_scores
           SET score_bps = $3,
               post_trade_drift_bps = $4,
               sample_size = $5,
               window_seconds = $6,
               policy_version = $7,
               observed_at = $8,
               version = version + 1,
               updated_by = $9,
               updated_at = now()
           WHERE chain_id = $1 AND user_address = $2
             AND version = $10 AND $10 > 0
           RETURNING *
         ), inserted AS (
           INSERT INTO toxic_flow_scores (
             chain_id, user_address, score_bps, post_trade_drift_bps, sample_size,
             window_seconds, policy_version, observed_at, version, updated_by
           )
           SELECT $1, $2, $3, $4, $5, $6, $7, $8, 1, $9
           WHERE $10 = 0
           ON CONFLICT (chain_id, user_address) DO NOTHING
           RETURNING *
         ), changed AS (
           SELECT * FROM updated
           UNION ALL
           SELECT * FROM inserted
         ), audited AS (
           INSERT INTO toxic_flow_score_audit (
             chain_id, user_address, version, score_bps, post_trade_drift_bps,
             sample_size, window_seconds, policy_version, observed_at, updated_by, updated_at
           )
           SELECT chain_id, user_address, version, score_bps, post_trade_drift_bps,
                  sample_size, window_seconds, policy_version, observed_at, updated_by, updated_at
           FROM changed
           RETURNING chain_id::text AS chain_id, user_address, score_bps, post_trade_drift_bps,
                     sample_size::text AS sample_size, window_seconds, policy_version, observed_at,
                     version::text AS version, updated_by, updated_at
         )
         SELECT * FROM audited`,
        [
          normalizedKey.chainId,
          normalizedKey.user,
          normalizedInput.scoreBps,
          normalizedInput.postTradeDriftBps,
          normalizedInput.sampleSize,
          normalizedInput.windowSeconds,
          normalizedInput.policyVersion,
          normalizedInput.observedAt,
          actor,
          normalizedInput.expectedVersion,
        ],
      );
      if (result.rows.length === 0) {
        const existing = await client.query(
          `SELECT version FROM toxic_flow_scores
           WHERE chain_id = $1 AND user_address = $2`,
          [normalizedKey.chainId, normalizedKey.user],
        );
        if (existing.rows.length > 1) throw new Error("Postgres toxic flow score read returned multiple rows");
        throw new ToxicFlowScoreConflictError();
      }
      if (result.rows.length !== 1) throw new Error("Postgres toxic flow score update returned multiple rows");
      return parseScoreRow(result.rows[0]);
    } finally {
      client.release();
    }
  }
}

function parseScoreRow(value: unknown): ToxicFlowScoreState {
  assertRecord(value, "Postgres toxic flow score row");
  const state = {
    chainId: parseSafeInteger(value.chain_id, "chainId"),
    user: value.user_address,
    scoreBps: parseSafeInteger(value.score_bps, "scoreBps"),
    postTradeDriftBps: parseSignedSafeInteger(value.post_trade_drift_bps, "postTradeDriftBps"),
    sampleSize: parseSafeInteger(value.sample_size, "sampleSize"),
    windowSeconds: parseSafeInteger(value.window_seconds, "windowSeconds"),
    policyVersion: value.policy_version,
    observedAt: timestamp(value.observed_at),
    version: parseSafeInteger(value.version, "version"),
    updatedBy: value.updated_by,
    updatedAt: timestamp(value.updated_at),
  };
  assertToxicFlowScoreState(state);
  return state;
}

function parseSafeInteger(value: unknown, field: string): number {
  const parsed = typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value) ? Number(value) : value;
  if (!Number.isSafeInteger(parsed) || Number(parsed) < 0) {
    throw new Error(`Postgres toxic flow score ${field} is invalid`);
  }
  return Number(parsed);
}

function parseSignedSafeInteger(value: unknown, field: string): number {
  const parsed = typeof value === "string" && /^(0|-?[1-9][0-9]*)$/.test(value) ? Number(value) : value;
  if (!Number.isSafeInteger(parsed)) throw new Error(`Postgres toxic flow score ${field} is invalid`);
  return Number(parsed);
}

function timestamp(value: unknown): unknown {
  return value instanceof Date ? value.toISOString() : value;
}

function assertPool(value: unknown): asserts value is pg.Pool {
  assertRecord(value, "Postgres toxic flow score pool");
  if (typeof value.connect !== "function") throw new Error("Postgres toxic flow score pool.connect must be a function");
}

function assertRecord(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${label} must be an object`);
}
