import { randomUUID } from "node:crypto";
import pg from "pg";
import { isCanonicalUtcIsoTimestamp } from "../../shared/validation/timestamp.js";
import {
  assertSubmitReservation,
  assertSubmitReservationStoreConfig,
  type SubmitReservation,
  type SubmitReservationStore,
  type SubmitReservationStoreConfig,
} from "./submit-reservation.store.js";

type OwnerTokenFactory = () => string;

export class PostgresSubmitReservationStore implements SubmitReservationStore {
  private readonly config: SubmitReservationStoreConfig;

  constructor(
    private readonly pool: pg.Pool,
    config: SubmitReservationStoreConfig,
    private readonly ownerToken: OwnerTokenFactory = () => `submit_${randomUUID()}`,
  ) {
    assertPool(pool);
    assertSubmitReservationStoreConfig(config);
    if (typeof ownerToken !== "function") {
      throw new Error("Postgres submit reservation ownerToken dependency must be a function");
    }
    this.config = { ...config };
  }

  async checkHealth(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("SELECT quote_id FROM quote_submit_reservations LIMIT 1");
    } finally {
      client.release();
    }
  }

  async acquire(quoteId: string): Promise<SubmitReservation | undefined> {
    const candidate = {
      quoteId,
      ownerToken: this.ownerToken(),
      expiresAt: new Date(0).toISOString(),
    };
    assertSubmitReservation(candidate);

    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `INSERT INTO quote_submit_reservations (
           quote_id, owner_token, acquired_at, expires_at
         ) VALUES (
           $1, $2, now(), now() + ($3::bigint * interval '1 millisecond')
         )
         ON CONFLICT (quote_id) DO UPDATE SET
           owner_token = EXCLUDED.owner_token,
           acquired_at = EXCLUDED.acquired_at,
           expires_at = EXCLUDED.expires_at
         WHERE quote_submit_reservations.expires_at <= now()
         RETURNING quote_id, owner_token, expires_at`,
        [candidate.quoteId, candidate.ownerToken, this.config.leaseMs],
      );
      if (result.rows.length === 0) return undefined;
      if (result.rows.length !== 1) {
        throw new Error("Postgres submit reservation acquire returned multiple rows");
      }
      return parseReservationRow(result.rows[0]);
    } finally {
      client.release();
    }
  }

  async release(reservation: SubmitReservation): Promise<void> {
    assertSubmitReservation(reservation);
    const client = await this.pool.connect();
    try {
      await client.query(
        `DELETE FROM quote_submit_reservations
         WHERE quote_id = $1 AND owner_token = $2`,
        [reservation.quoteId, reservation.ownerToken],
      );
    } finally {
      client.release();
    }
  }
}

function parseReservationRow(value: unknown): SubmitReservation {
  assertRecord(value, "Postgres submit reservation row");
  const expiresAt = normalizeTimestamp(value.expires_at);
  const reservation = {
    quoteId: value.quote_id,
    ownerToken: value.owner_token,
    expiresAt,
  };
  assertSubmitReservation(reservation);
  return reservation;
}

function normalizeTimestamp(value: unknown): string {
  const timestamp = value instanceof Date ? value.toISOString() : value;
  if (typeof timestamp !== "string" || !isCanonicalUtcIsoTimestamp(timestamp)) {
    throw new Error("Postgres submit reservation expires_at must be a canonical UTC timestamp");
  }
  return timestamp;
}

function assertPool(value: unknown): asserts value is pg.Pool {
  assertRecord(value, "Postgres submit reservation pool");
  if (typeof value.connect !== "function") {
    throw new Error("Postgres submit reservation pool.connect must be a function");
  }
}

function assertRecord(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
}
