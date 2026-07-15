import { randomUUID } from "node:crypto";
import pg from "pg";
import type { QuoteResponse } from "../../shared/types/rfq.js";
import {
  assertQuoteIdempotencyFailure,
  assertQuoteIdempotencyKey,
  assertQuoteIdempotencyReservation,
  assertQuoteIdempotencyStoreConfig,
  assertQuoteResponse,
  type QuoteIdempotencyClaimResult,
  type QuoteIdempotencyFailure,
  type QuoteIdempotencyReservation,
  type QuoteIdempotencyStore,
  type QuoteIdempotencyStoreConfig,
} from "./quote-idempotency.store.js";
import { assertPrincipalId } from "../../shared/validation/principal-id.js";

type OwnerTokenFactory = () => string;

export class PostgresQuoteIdempotencyStore implements QuoteIdempotencyStore {
  private readonly config: QuoteIdempotencyStoreConfig;

  constructor(
    private readonly pool: pg.Pool,
    config: QuoteIdempotencyStoreConfig,
    private readonly ownerToken: OwnerTokenFactory = () => `quote_idem_${randomUUID()}`,
  ) {
    assertPool(pool);
    assertQuoteIdempotencyStoreConfig(config);
    if (typeof ownerToken !== "function") throw new Error("Postgres quote idempotency ownerToken must be a function");
    this.config = { ...config };
  }

  async checkHealth(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("SELECT principal_id FROM quote_idempotency_requests LIMIT 1");
    } finally {
      client.release();
    }
  }

  async acquire(principalId: string, key: string, requestHash: string): Promise<QuoteIdempotencyClaimResult> {
    assertPrincipalId(principalId, "Postgres quote idempotency principalId");
    assertQuoteIdempotencyKey(key);
    assertRequestHash(requestHash);
    const ownerToken = this.ownerToken();
    const candidate = {
      principalId,
      key,
      requestHash,
      ownerToken,
      expiresAt: new Date(0).toISOString(),
    };
    assertQuoteIdempotencyReservation(candidate);

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const inserted = await client.query(
        `INSERT INTO quote_idempotency_requests (
           principal_id, idempotency_key, request_hash, state, owner_token,
           lease_expires_at, created_at, updated_at
         ) VALUES (
           $1, $2, $3, 'processing', $4,
           now() + ($5::bigint * interval '1 millisecond'), now(), now()
         )
         ON CONFLICT (principal_id, idempotency_key) DO NOTHING
         RETURNING principal_id, idempotency_key, request_hash, owner_token, lease_expires_at`,
        [principalId, key, requestHash, ownerToken, this.config.leaseMs],
      );
      if (inserted.rows.length === 1) {
        await client.query("COMMIT");
        return { status: "acquired", reservation: reservationFromRow(inserted.rows[0]) };
      }

      const existing = await client.query(
        `SELECT principal_id, idempotency_key, request_hash, state, owner_token,
                lease_expires_at, quote_id, response, error_code, error_message, error_status_code,
                lease_expires_at <= now() AS lease_expired
         FROM quote_idempotency_requests
         WHERE principal_id = $1 AND idempotency_key = $2
         FOR UPDATE`,
        [principalId, key],
      );
      if (existing.rows.length !== 1) throw new Error("Postgres quote idempotency lookup returned an invalid row count");
      const row = existing.rows[0] as Record<string, unknown>;
      if (row.request_hash !== requestHash) {
        await client.query("COMMIT");
        return { status: "conflict" };
      }
      if (row.state === "succeeded") {
        const response = parseResponse(row.response);
        await client.query("COMMIT");
        return { status: "replay", response };
      }
      if (row.state === "failed") {
        const error = failureFromRow(row);
        await client.query("COMMIT");
        return { status: "failed", error };
      }
      if (row.state !== "processing") throw new Error("Postgres quote idempotency state is invalid");
      if (row.lease_expired !== true) {
        await client.query("COMMIT");
        return { status: "in_progress" };
      }

      if (row.quote_id !== null && row.quote_id !== undefined) {
        const recovered = await recoverBoundQuote(client, principalId, String(row.quote_id));
        if (recovered) {
          await completeRow(client, principalId, key, recovered);
          await client.query("COMMIT");
          return { status: "replay", response: recovered };
        }
        const failure: QuoteIdempotencyFailure = {
          code: "QUOTE_FAILED",
          message: "Idempotent quote request expired before completion",
          statusCode: 409,
        };
        await client.query(
          `UPDATE quotes SET status = 'failed', reject_code = 'IDEMPOTENCY_REQUEST_EXPIRED', updated_at = now()
           WHERE id = $1 AND principal_id = $2 AND status = 'requested'`,
          [row.quote_id, principalId],
        );
        await failRow(client, principalId, key, failure);
        await client.query("COMMIT");
        return { status: "failed", error: failure };
      }

      const reclaimed = await client.query(
        `UPDATE quote_idempotency_requests
         SET owner_token = $3,
             lease_expires_at = now() + ($4::bigint * interval '1 millisecond'),
             updated_at = now()
         WHERE principal_id = $1 AND idempotency_key = $2 AND state = 'processing'
         RETURNING principal_id, idempotency_key, request_hash, owner_token, lease_expires_at`,
        [principalId, key, ownerToken, this.config.leaseMs],
      );
      if (reclaimed.rows.length !== 1) throw new Error("Postgres quote idempotency reclaim failed");
      await client.query("COMMIT");
      return { status: "acquired", reservation: reservationFromRow(reclaimed.rows[0]) };
    } catch (error) {
      await rollbackBestEffort(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async bindQuote(reservation: QuoteIdempotencyReservation, quoteId: string): Promise<void> {
    assertQuoteIdempotencyReservation(reservation);
    assertSafeIdentifier(quoteId, "Postgres quote idempotency quoteId");
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `UPDATE quote_idempotency_requests
         SET quote_id = $5, updated_at = now()
         WHERE principal_id = $1 AND idempotency_key = $2 AND request_hash = $3
           AND owner_token = $4 AND state = 'processing'
           AND (quote_id IS NULL OR quote_id = $5)`,
        [reservation.principalId, reservation.key, reservation.requestHash, reservation.ownerToken, quoteId],
      );
      if (result.rowCount !== 1) throw new Error("Postgres quote idempotency reservation cannot bind quote");
    } finally {
      client.release();
    }
  }

  async complete(reservation: QuoteIdempotencyReservation, response: QuoteResponse): Promise<void> {
    assertQuoteIdempotencyReservation(reservation);
    assertQuoteResponse(response);
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `UPDATE quote_idempotency_requests
         SET state = 'succeeded', response = $5::jsonb,
             owner_token = NULL, lease_expires_at = NULL, completed_at = now(), updated_at = now()
         WHERE principal_id = $1 AND idempotency_key = $2 AND request_hash = $3
           AND owner_token = $4 AND quote_id = $6 AND state = 'processing'`,
        [
          reservation.principalId,
          reservation.key,
          reservation.requestHash,
          reservation.ownerToken,
          JSON.stringify(response),
          response.quoteId,
        ],
      );
      if (result.rowCount !== 1) throw new Error("Postgres quote idempotency completion lost ownership");
    } finally {
      client.release();
    }
  }

  async fail(reservation: QuoteIdempotencyReservation, error: QuoteIdempotencyFailure): Promise<void> {
    assertQuoteIdempotencyReservation(reservation);
    assertQuoteIdempotencyFailure(error);
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `UPDATE quote_idempotency_requests
         SET state = 'failed', error_code = $5, error_message = $6, error_status_code = $7,
             owner_token = NULL, lease_expires_at = NULL, completed_at = now(), updated_at = now()
         WHERE principal_id = $1 AND idempotency_key = $2 AND request_hash = $3
           AND owner_token = $4 AND state = 'processing'`,
        [
          reservation.principalId,
          reservation.key,
          reservation.requestHash,
          reservation.ownerToken,
          error.code,
          error.message,
          error.statusCode,
        ],
      );
      if (result.rowCount !== 1) throw new Error("Postgres quote idempotency failure lost ownership");
    } finally {
      client.release();
    }
  }
}

async function recoverBoundQuote(
  client: pg.PoolClient,
  principalId: string,
  quoteId: string,
): Promise<QuoteResponse | undefined> {
  const result = await client.query(
    `SELECT id AS quote_id, snapshot_id, amount_out, min_amount_out, deadline, nonce, signature
     FROM quotes
     WHERE id = $1 AND principal_id = $2
       AND status IN ('signed', 'expired', 'submitted', 'settled')
       AND snapshot_id IS NOT NULL AND amount_out IS NOT NULL AND min_amount_out IS NOT NULL
       AND deadline IS NOT NULL AND nonce IS NOT NULL AND signature IS NOT NULL`,
    [quoteId, principalId],
  );
  if (result.rows.length === 0) return undefined;
  if (result.rows.length !== 1) throw new Error("Postgres quote idempotency recovery returned multiple quotes");
  const row = result.rows[0] as Record<string, unknown>;
  const response = {
    quoteId: String(row.quote_id),
    snapshotId: String(row.snapshot_id),
    amountOut: String(row.amount_out),
    minAmountOut: String(row.min_amount_out),
    deadline: Number(row.deadline),
    nonce: String(row.nonce),
    signature: String(row.signature),
  };
  assertQuoteResponse(response);
  return response;
}

async function completeRow(
  client: pg.PoolClient,
  principalId: string,
  key: string,
  response: QuoteResponse,
): Promise<void> {
  const result = await client.query(
    `UPDATE quote_idempotency_requests
     SET state = 'succeeded', response = $3::jsonb,
         owner_token = NULL, lease_expires_at = NULL, completed_at = now(), updated_at = now()
     WHERE principal_id = $1 AND idempotency_key = $2 AND state = 'processing'`,
    [principalId, key, JSON.stringify(response)],
  );
  if (result.rowCount !== 1) throw new Error("Postgres quote idempotency recovery completion failed");
}

async function failRow(
  client: pg.PoolClient,
  principalId: string,
  key: string,
  error: QuoteIdempotencyFailure,
): Promise<void> {
  const result = await client.query(
    `UPDATE quote_idempotency_requests
     SET state = 'failed', error_code = $3, error_message = $4, error_status_code = $5,
         owner_token = NULL, lease_expires_at = NULL, completed_at = now(), updated_at = now()
     WHERE principal_id = $1 AND idempotency_key = $2 AND state = 'processing'`,
    [principalId, key, error.code, error.message, error.statusCode],
  );
  if (result.rowCount !== 1) throw new Error("Postgres quote idempotency recovery failure update failed");
}

function reservationFromRow(row: Record<string, unknown>): QuoteIdempotencyReservation {
  const reservation = {
    principalId: row.principal_id,
    key: row.idempotency_key,
    requestHash: row.request_hash,
    ownerToken: row.owner_token,
    expiresAt: normalizeTimestamp(row.lease_expires_at),
  };
  assertQuoteIdempotencyReservation(reservation);
  return reservation;
}

function failureFromRow(row: Record<string, unknown>): QuoteIdempotencyFailure {
  const failure = {
    code: row.error_code,
    message: row.error_message,
    statusCode: Number(row.error_status_code),
  };
  assertQuoteIdempotencyFailure(failure);
  return failure;
}

function parseResponse(value: unknown): QuoteResponse {
  const parsed = typeof value === "string" ? JSON.parse(value) : value;
  assertQuoteResponse(parsed);
  return { ...parsed };
}

function normalizeTimestamp(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

function assertRequestHash(value: unknown): asserts value is string {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) {
    throw new Error("Postgres quote idempotency requestHash must be a lowercase SHA-256 digest");
  }
}

function assertSafeIdentifier(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 128 || !/^[A-Za-z0-9_:-]+$/.test(value)) {
    throw new Error(`${label} must be a safe identifier`);
  }
}

function assertPool(value: unknown): asserts value is pg.Pool {
  if (typeof value !== "object" || value === null || typeof (value as Record<string, unknown>).connect !== "function") {
    throw new Error("Postgres quote idempotency pool.connect must be a function");
  }
}

async function rollbackBestEffort(client: pg.PoolClient): Promise<void> {
  try { await client.query("ROLLBACK"); } catch {}
}
