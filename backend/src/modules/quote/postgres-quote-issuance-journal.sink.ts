import type pg from "pg";
import { PostgresQuoteIssuanceStore } from "./postgres-quote-issuance.store.js";
import {
  parseRedisQuoteIssuanceEvent,
  type RedisQuoteIdempotencyRecord,
  type RedisQuoteIssuanceEvent,
} from "./redis-quote-issuance.protocol.js";

export interface QuoteIssuanceJournalMirrorResult {
  inserted: boolean;
  applied: boolean;
}

interface StreamPosition {
  epoch: string;
  milliseconds: bigint;
  sequence: bigint;
}

export class PostgresQuoteIssuanceJournalSink {
  constructor(
    private readonly pool: pg.Pool,
    private readonly queryTimeoutMs: number,
  ) {
    if (typeof pool !== "object" || pool === null || typeof pool.connect !== "function") {
      throw new Error("Postgres quote issuance journal pool must expose connect");
    }
    if (!Number.isSafeInteger(queryTimeoutMs) || queryTimeoutMs < 100 || queryTimeoutMs > 10_000) {
      throw new Error("Postgres quote issuance journal queryTimeoutMs must be between 100 and 10000");
    }
  }

  async applyMirrored(
    input: RedisQuoteIssuanceEvent,
    sourceStreamId: string,
  ): Promise<QuoteIssuanceJournalMirrorResult> {
    const event = parseRedisQuoteIssuanceEvent(JSON.stringify(input));
    const position = parseStreamPosition(sourceStreamId);
    const lockIdentity = event.quote?.quoteId ??
      `${event.idempotency!.principalId}:${event.idempotency!.key}`;
    const client = await this.pool.connect();
    let transactionOpen = false;
    try {
      await client.query("BEGIN");
      transactionOpen = true;
      await client.query(this.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        [lockIdentity],
      ));
      const duplicate = await client.query(this.query(
        "SELECT 1 FROM quote_issuance_journal_events WHERE source_stream_id = $1",
        [sourceStreamId],
      ));
      if (duplicate.rowCount && duplicate.rowCount > 0) {
        await client.query("COMMIT");
        transactionOpen = false;
        return { inserted: false, applied: false };
      }

      let applied = true;
      if (event.quote) {
        applied = await this.applyQuoteProjection(client, event, position);
      } else if (event.idempotency) {
        await projectIdempotency(client, event.idempotency, this.queryTimeoutMs);
      }

      const inserted = await client.query(this.query(
        `INSERT INTO quote_issuance_journal_events (
           source_stream_id, event_type, quote_id, principal_id, payload
         ) VALUES ($1, $2, $3, $4, $5::jsonb)`,
        [
          sourceStreamId,
          event.eventType,
          event.quote?.quoteId ?? null,
          event.quote?.principalId ?? event.idempotency?.principalId ?? null,
          JSON.stringify(event),
        ],
      ));
      if (inserted.rowCount !== 1) {
        throw new Error("Postgres quote issuance journal event insert failed");
      }
      await client.query("COMMIT");
      transactionOpen = false;
      return { inserted: true, applied };
    } catch (error) {
      if (transactionOpen) await rollbackBestEffort(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async checkHealth(): Promise<void> {
    const result = await this.pool.query(this.query(
      `SELECT
         to_regclass('public.quote_issuance_journal_events') IS NOT NULL AS events,
         to_regclass('public.quote_issuance_projection_versions') IS NOT NULL AS projections`,
      [],
    ));
    const row = result.rows[0] as Record<string, unknown> | undefined;
    if (!row || row.events !== true || row.projections !== true) {
      throw new Error("Postgres quote issuance journal schema is unavailable");
    }
  }

  private async applyQuoteProjection(
    client: pg.PoolClient,
    event: RedisQuoteIssuanceEvent,
    position: StreamPosition,
  ): Promise<boolean> {
    const quote = event.quote!;
    const currentResult = await client.query(this.query(
      `SELECT source_epoch, stream_milliseconds::text, stream_sequence::text, event_type
       FROM quote_issuance_projection_versions
       WHERE quote_id = $1
       FOR UPDATE`,
      [quote.quoteId],
    ));
    let currentStageRank = 0;
    if (currentResult.rowCount && currentResult.rowCount > 0) {
      const current = currentResult.rows[0] as Record<string, unknown>;
      if (current.source_epoch !== position.epoch) {
        throw new Error("Postgres quote issuance epoch conflicts with active projection");
      }
      const milliseconds = parseNonNegativeInteger(current.stream_milliseconds, "stream_milliseconds");
      const sequence = parseNonNegativeInteger(current.stream_sequence, "stream_sequence");
      if (comparePosition(position, milliseconds, sequence) <= 0) return false;
      currentStageRank = eventTypeRank(current.event_type);
      if (eventTypeRank(event.eventType) < currentStageRank) {
        throw new Error("Postgres quote issuance projection cannot regress lifecycle stage");
      }
    }

    const issuance = new PostgresQuoteIssuanceStore(client as unknown as pg.Pool);
    if (currentStageRank < eventTypeRank("prepared")) await issuance.prepare(quote.preparation);
    if (quote.authorization && currentStageRank < eventTypeRank("authorized")) {
      await issuance.authorize(quote.authorization.input);
    }
    if (quote.finalization && currentStageRank < eventTypeRank("finalized")) {
      await issuance.finalize(quote.finalization);
    }
    if (quote.stage === "failed" && currentStageRank < eventTypeRank("failed")) {
      const failed = await client.query(this.query(
        `UPDATE quotes
         SET status = 'failed', reject_code = $2, updated_at = now()
         WHERE id = $1 AND status IN ('requested', 'signed')`,
        [quote.quoteId, quote.failure!.code],
      ));
      if (failed.rowCount !== 1) {
        throw new Error(`Postgres quote issuance failed projection could not update ${quote.quoteId}`);
      }
    }
    if (event.idempotency) {
      await projectIdempotency(client, event.idempotency, this.queryTimeoutMs);
    }
    await client.query(this.query(
      `INSERT INTO quote_issuance_projection_versions (
         quote_id, source_epoch, stream_milliseconds, stream_sequence, event_type, updated_at
       ) VALUES ($1, $2, $3, $4, $5, now())
       ON CONFLICT (quote_id) DO UPDATE SET
         source_epoch = EXCLUDED.source_epoch,
         stream_milliseconds = EXCLUDED.stream_milliseconds,
         stream_sequence = EXCLUDED.stream_sequence,
         event_type = EXCLUDED.event_type,
         updated_at = now()`,
      [
        quote.quoteId,
        position.epoch,
        position.milliseconds.toString(),
        position.sequence.toString(),
        event.eventType,
      ],
    ));
    return true;
  }

  private query(text: string, values: unknown[]): pg.QueryConfig & { query_timeout: number } {
    return { text, values, query_timeout: this.queryTimeoutMs };
  }
}

async function projectIdempotency(
  client: pg.PoolClient,
  record: RedisQuoteIdempotencyRecord,
  queryTimeoutMs: number,
): Promise<void> {
  const statement = record.state === "processing"
    ? processingIdempotencySql()
    : record.state === "succeeded"
      ? succeededIdempotencySql()
      : failedIdempotencySql();
  const values = record.state === "processing"
    ? [
        record.principalId, record.key, record.requestHash, record.ownerToken,
        record.leaseExpiresAtMs, record.quoteId ?? null, record.createdAtMs, record.updatedAtMs,
      ]
    : record.state === "succeeded"
      ? [
          record.principalId, record.key, record.requestHash, record.quoteId,
          JSON.stringify(record.response), record.createdAtMs, record.updatedAtMs,
        ]
      : [
          record.principalId, record.key, record.requestHash, record.quoteId ?? null,
          record.error!.code, record.error!.message, record.error!.statusCode,
          record.createdAtMs, record.updatedAtMs,
        ];
  const query: pg.QueryConfig & { query_timeout: number } = {
    text: statement,
    values,
    query_timeout: queryTimeoutMs,
  };
  const result = await client.query(query);
  if (result.rowCount === 1) return;
  if (record.state === "processing") {
    const current = await client.query({
      text: `SELECT request_hash, state
             FROM quote_idempotency_requests
             WHERE principal_id = $1 AND idempotency_key = $2`,
      values: [record.principalId, record.key],
      query_timeout: queryTimeoutMs,
    } as pg.QueryConfig & { query_timeout: number });
    const row = current.rows[0] as Record<string, unknown> | undefined;
    if (current.rowCount === 1 && row?.request_hash === record.requestHash &&
        (row.state === "succeeded" || row.state === "failed")) {
      return;
    }
  }
  if (result.rowCount !== 1) {
    throw new Error("Postgres quote issuance idempotency projection conflicted with durable state");
  }
}

function processingIdempotencySql(): string {
  return `INSERT INTO quote_idempotency_requests (
      principal_id, idempotency_key, request_hash, state, owner_token,
      lease_expires_at, quote_id, created_at, updated_at
    ) VALUES (
      $1, $2, $3, 'processing', $4, to_timestamp($5::double precision / 1000), $6,
      to_timestamp($7::double precision / 1000), to_timestamp($8::double precision / 1000)
    )
    ON CONFLICT (principal_id, idempotency_key) DO UPDATE SET
      quote_id = COALESCE(EXCLUDED.quote_id, quote_idempotency_requests.quote_id),
      updated_at = GREATEST(quote_idempotency_requests.updated_at, EXCLUDED.updated_at)
    WHERE quote_idempotency_requests.request_hash = EXCLUDED.request_hash
      AND quote_idempotency_requests.state = 'processing'
      AND quote_idempotency_requests.owner_token = EXCLUDED.owner_token
    RETURNING principal_id`;
}

function succeededIdempotencySql(): string {
  return `INSERT INTO quote_idempotency_requests (
      principal_id, idempotency_key, request_hash, state, quote_id, response,
      completed_at, created_at, updated_at
    ) VALUES (
      $1, $2, $3, 'succeeded', $4, $5::jsonb,
      to_timestamp($7::double precision / 1000),
      to_timestamp($6::double precision / 1000), to_timestamp($7::double precision / 1000)
    )
    ON CONFLICT (principal_id, idempotency_key) DO UPDATE SET
      state = 'succeeded', quote_id = EXCLUDED.quote_id, response = EXCLUDED.response,
      owner_token = NULL, lease_expires_at = NULL, completed_at = EXCLUDED.completed_at,
      updated_at = GREATEST(quote_idempotency_requests.updated_at, EXCLUDED.updated_at)
    WHERE quote_idempotency_requests.request_hash = EXCLUDED.request_hash
      AND (
        quote_idempotency_requests.state = 'processing'
        OR (
          quote_idempotency_requests.state = 'succeeded'
          AND quote_idempotency_requests.quote_id = EXCLUDED.quote_id
          AND quote_idempotency_requests.response = EXCLUDED.response
        )
      )
    RETURNING principal_id`;
}

function failedIdempotencySql(): string {
  return `INSERT INTO quote_idempotency_requests (
      principal_id, idempotency_key, request_hash, state, quote_id,
      error_code, error_message, error_status_code,
      completed_at, created_at, updated_at
    ) VALUES (
      $1, $2, $3, 'failed', $4, $5, $6, $7,
      to_timestamp($9::double precision / 1000),
      to_timestamp($8::double precision / 1000), to_timestamp($9::double precision / 1000)
    )
    ON CONFLICT (principal_id, idempotency_key) DO UPDATE SET
      state = 'failed', quote_id = COALESCE(EXCLUDED.quote_id, quote_idempotency_requests.quote_id),
      error_code = EXCLUDED.error_code, error_message = EXCLUDED.error_message,
      error_status_code = EXCLUDED.error_status_code,
      owner_token = NULL, lease_expires_at = NULL, completed_at = EXCLUDED.completed_at,
      updated_at = GREATEST(quote_idempotency_requests.updated_at, EXCLUDED.updated_at)
    WHERE quote_idempotency_requests.request_hash = EXCLUDED.request_hash
      AND (
        quote_idempotency_requests.state = 'processing'
        OR (
          quote_idempotency_requests.state = 'failed'
          AND quote_idempotency_requests.error_code = EXCLUDED.error_code
          AND quote_idempotency_requests.error_message = EXCLUDED.error_message
          AND quote_idempotency_requests.error_status_code = EXCLUDED.error_status_code
        )
      )
    RETURNING principal_id`;
}

function parseStreamPosition(sourceStreamId: string): StreamPosition {
  if (typeof sourceStreamId !== "string") {
    throw new Error("Postgres quote issuance sourceStreamId must be a string");
  }
  const match = /^([A-Za-z][A-Za-z0-9_-]{0,63}):([0-9]+)-([0-9]+)$/.exec(sourceStreamId);
  if (!match) throw new Error("Postgres quote issuance sourceStreamId must be an epoch and Redis stream id");
  return { epoch: match[1], milliseconds: BigInt(match[2]), sequence: BigInt(match[3]) };
}

function parseNonNegativeInteger(value: unknown, field: string): bigint {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/.test(value)) {
    throw new Error(`Postgres quote issuance ${field} must be a non-negative integer`);
  }
  return BigInt(value);
}

function comparePosition(position: StreamPosition, milliseconds: bigint, sequence: bigint): number {
  if (position.milliseconds < milliseconds) return -1;
  if (position.milliseconds > milliseconds) return 1;
  if (position.sequence < sequence) return -1;
  if (position.sequence > sequence) return 1;
  return 0;
}

function eventTypeRank(value: unknown): number {
  if (value === "prepared") return 1;
  if (value === "authorized") return 2;
  if (value === "failed") return 3;
  if (value === "finalized") return 4;
  throw new Error("Postgres quote issuance projection event type is invalid");
}

async function rollbackBestEffort(client: pg.PoolClient): Promise<void> {
  try { await client.query("ROLLBACK"); } catch {}
}
