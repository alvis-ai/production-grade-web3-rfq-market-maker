import pg from "pg";
import {
  QuoteControlConflictError,
  assertPairQuoteControlState,
  assertQuoteControlActor,
  assertQuoteControlState,
  normalizePairQuoteControlScope,
  normalizeQuoteControlUpdate,
  type PairQuoteControlScope,
  type PairQuoteControlState,
  type QuoteControlState,
  type QuoteControlStore,
  type UpdateQuoteControlInput,
} from "./quote-control.store.js";

export interface QuoteControlSnapshot {
  state: QuoteControlState;
  pairStates: readonly PairQuoteControlState[];
}

export class PostgresQuoteControlStore implements QuoteControlStore {
  constructor(private readonly pool: pg.Pool) {
    assertPool(pool);
  }

  async checkHealth(): Promise<void> {
    await this.getState();
  }

  async loadSnapshot(): Promise<QuoteControlSnapshot> {
    const client = await this.pool.connect();
    try {
      const stateResult = await client.query(
        `SELECT paused, version::text AS version, reason, updated_by, updated_at
         FROM quote_control
         WHERE singleton = TRUE`,
      );
      if (stateResult.rows.length !== 1) throw new Error("Postgres quote control singleton is missing");
      const pairResult = await client.query(
        `SELECT chain_id::text AS chain_id, token_low, token_high, paused,
                version::text AS version, reason, updated_by, updated_at
         FROM quote_pair_control
         ORDER BY chain_id, token_low, token_high`,
      );
      return {
        state: parseStateRow(stateResult.rows[0]),
        pairStates: pairResult.rows.map(parsePairStateRow),
      };
    } finally {
      client.release();
    }
  }

  async getState(): Promise<QuoteControlState> {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `SELECT paused, version::text AS version, reason, updated_by, updated_at,
                (SELECT TRUE FROM quote_pair_control LIMIT 1) AS pair_table_probe
         FROM quote_control
         WHERE singleton = TRUE`,
      );
      if (result.rows.length !== 1) throw new Error("Postgres quote control singleton is missing");
      return parseStateRow(result.rows[0]);
    } finally {
      client.release();
    }
  }

  async updateState(input: UpdateQuoteControlInput, actor: string): Promise<QuoteControlState> {
    const normalized = normalizeQuoteControlUpdate(input);
    assertQuoteControlActor(actor);
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `WITH updated AS (
           UPDATE quote_control
           SET paused = $1,
               version = version + 1,
               reason = $2,
               updated_by = $3,
               updated_at = now()
           WHERE singleton = TRUE AND version = $4
           RETURNING paused, version, reason, updated_by, updated_at
         ), audited AS (
           INSERT INTO quote_control_audit (version, paused, reason, updated_by, updated_at)
           SELECT version, paused, reason, updated_by, updated_at
           FROM updated
           RETURNING paused, version::text AS version, reason, updated_by, updated_at
         )
         SELECT paused, version, reason, updated_by, updated_at
         FROM audited`,
        [normalized.paused, normalized.reason, actor, normalized.expectedVersion],
      );
      if (result.rows.length === 0) {
        const exists = await client.query("SELECT version FROM quote_control WHERE singleton = TRUE");
        if (exists.rows.length !== 1) throw new Error("Postgres quote control singleton is missing");
        throw new QuoteControlConflictError();
      }
      if (result.rows.length !== 1) throw new Error("Postgres quote control update returned multiple rows");
      return parseStateRow(result.rows[0]);
    } finally {
      client.release();
    }
  }

  async getPairState(scope: PairQuoteControlScope): Promise<PairQuoteControlState | null> {
    const normalizedScope = normalizePairQuoteControlScope(scope);
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `SELECT chain_id::text AS chain_id, token_low, token_high, paused,
                version::text AS version, reason, updated_by, updated_at
         FROM quote_pair_control
         WHERE chain_id = $1 AND token_low = $2 AND token_high = $3`,
        [normalizedScope.chainId, normalizedScope.tokenLow, normalizedScope.tokenHigh],
      );
      if (result.rows.length === 0) return null;
      if (result.rows.length !== 1) throw new Error("Postgres pair quote control read returned multiple rows");
      return parsePairStateRow(result.rows[0]);
    } finally {
      client.release();
    }
  }

  async getPausedPairCount(): Promise<number> {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `SELECT count(*)::text AS paused_count
         FROM quote_pair_control
         WHERE paused = TRUE`,
      );
      if (result.rows.length !== 1) throw new Error("Postgres pair quote control count returned invalid rows");
      assertRecord(result.rows[0], "Postgres pair quote control count row");
      const count = parseSafeInteger(result.rows[0].paused_count, "pausedCount");
      if (count < 0) throw new Error("Postgres pair quote control pausedCount is invalid");
      return count;
    } finally {
      client.release();
    }
  }

  async updatePairState(
    scope: PairQuoteControlScope,
    input: UpdateQuoteControlInput,
    actor: string,
  ): Promise<PairQuoteControlState> {
    const normalizedScope = normalizePairQuoteControlScope(scope);
    const normalized = normalizeQuoteControlUpdate(input);
    assertQuoteControlActor(actor);
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `WITH updated AS (
           UPDATE quote_pair_control
           SET paused = $4,
               version = version + 1,
               reason = $5,
               updated_by = $6,
               updated_at = now()
           WHERE chain_id = $1 AND token_low = $2 AND token_high = $3
             AND version = $7 AND $7 > 0
           RETURNING chain_id, token_low, token_high, paused, version, reason, updated_by, updated_at
         ), inserted AS (
           INSERT INTO quote_pair_control (
             chain_id, token_low, token_high, paused, version, reason, updated_by
           )
           SELECT $1, $2, $3, $4, 1, $5, $6
           WHERE $7 = 0
           ON CONFLICT (chain_id, token_low, token_high) DO NOTHING
           RETURNING chain_id, token_low, token_high, paused, version, reason, updated_by, updated_at
         ), changed AS (
           SELECT * FROM updated
           UNION ALL
           SELECT * FROM inserted
         ), audited AS (
           INSERT INTO quote_pair_control_audit (
             chain_id, token_low, token_high, version, paused, reason, updated_by, updated_at
           )
           SELECT chain_id, token_low, token_high, version, paused, reason, updated_by, updated_at
           FROM changed
           RETURNING chain_id::text AS chain_id, token_low, token_high, paused,
                     version::text AS version, reason, updated_by, updated_at
         )
         SELECT chain_id, token_low, token_high, paused, version, reason, updated_by, updated_at
         FROM audited`,
        [
          normalizedScope.chainId,
          normalizedScope.tokenLow,
          normalizedScope.tokenHigh,
          normalized.paused,
          normalized.reason,
          actor,
          normalized.expectedVersion,
        ],
      );
      if (result.rows.length === 0) {
        const exists = await client.query(
          `SELECT version FROM quote_pair_control
           WHERE chain_id = $1 AND token_low = $2 AND token_high = $3`,
          [normalizedScope.chainId, normalizedScope.tokenLow, normalizedScope.tokenHigh],
        );
        if (exists.rows.length > 1) throw new Error("Postgres pair quote control read returned multiple rows");
        throw new QuoteControlConflictError();
      }
      if (result.rows.length !== 1) throw new Error("Postgres pair quote control update returned multiple rows");
      return parsePairStateRow(result.rows[0]);
    } finally {
      client.release();
    }
  }
}

function parseStateRow(value: unknown): QuoteControlState {
  assertRecord(value, "Postgres quote control row");
  const version = typeof value.version === "string" && /^(0|[1-9][0-9]*)$/.test(value.version)
    ? Number(value.version)
    : value.version;
  const updatedAt = value.updated_at instanceof Date ? value.updated_at.toISOString() : value.updated_at;
  const state = {
    paused: value.paused,
    version,
    reason: value.reason,
    updatedBy: value.updated_by,
    updatedAt,
  };
  assertQuoteControlState(state);
  return state;
}

function parsePairStateRow(value: unknown): PairQuoteControlState {
  assertRecord(value, "Postgres pair quote control row");
  const state = {
    chainId: parseSafeInteger(value.chain_id, "chainId"),
    tokenLow: value.token_low,
    tokenHigh: value.token_high,
    paused: value.paused,
    version: parseSafeInteger(value.version, "version"),
    reason: value.reason,
    updatedBy: value.updated_by,
    updatedAt: value.updated_at instanceof Date ? value.updated_at.toISOString() : value.updated_at,
  };
  assertPairQuoteControlState(state);
  return state;
}

function parseSafeInteger(value: unknown, field: string): number {
  const parsed = typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value) ? Number(value) : value;
  if (!Number.isSafeInteger(parsed)) throw new Error(`Postgres pair quote control ${field} is invalid`);
  return Number(parsed);
}

function assertPool(value: unknown): asserts value is pg.Pool {
  assertRecord(value, "Postgres quote control pool");
  if (typeof value.connect !== "function") throw new Error("Postgres quote control pool.connect must be a function");
}

function assertRecord(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${label} must be an object`);
}
