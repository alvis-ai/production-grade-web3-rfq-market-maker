import pg from "pg";
import {
  QuoteControlConflictError,
  assertQuoteControlActor,
  assertQuoteControlState,
  normalizeQuoteControlUpdate,
  type QuoteControlState,
  type QuoteControlStore,
  type UpdateQuoteControlInput,
} from "./quote-control.store.js";

export class PostgresQuoteControlStore implements QuoteControlStore {
  constructor(private readonly pool: pg.Pool) {
    assertPool(pool);
  }

  async checkHealth(): Promise<void> {
    await this.getState();
  }

  async getState(): Promise<QuoteControlState> {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `SELECT paused, version::text AS version, reason, updated_by, updated_at
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

function assertPool(value: unknown): asserts value is pg.Pool {
  assertRecord(value, "Postgres quote control pool");
  if (typeof value.connect !== "function") throw new Error("Postgres quote control pool.connect must be a function");
}

function assertRecord(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${label} must be an object`);
}
