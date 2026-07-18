import type pg from "pg";
import {
  parseRedisQuoteExposureRecord,
  type RedisQuoteExposureRecord,
} from "./redis-quote-exposure.store.js";

export type QuoteExposureLedgerOperation = "reserve" | "release";

export interface QuoteExposureLedgerMirrorResult {
  inserted: boolean;
  applied: boolean;
}

interface StreamPosition {
  sourceStreamId: string;
  epoch: string;
  milliseconds: bigint;
  sequence: bigint;
}

export class PostgresQuoteExposureLedgerSink {
  constructor(
    private readonly pool: pg.Pool,
    private readonly queryTimeoutMs: number,
  ) {
    if (typeof pool !== "object" || pool === null || typeof pool.connect !== "function") {
      throw new Error("Postgres quote exposure ledger pool must expose connect");
    }
    if (!Number.isSafeInteger(queryTimeoutMs) || queryTimeoutMs < 100 || queryTimeoutMs > 10_000) {
      throw new Error("Postgres quote exposure ledger queryTimeoutMs must be between 100 and 10000");
    }
  }

  async applyMirrored(
    operation: QuoteExposureLedgerOperation,
    record: RedisQuoteExposureRecord,
    sourceStreamId: string,
  ): Promise<QuoteExposureLedgerMirrorResult> {
    assertOperation(operation);
    const normalized = parseRedisQuoteExposureRecord(JSON.stringify(record));
    const position = parseStreamPosition(sourceStreamId);
    const client = await this.pool.connect();
    let transactionOpen = false;
    try {
      await client.query("BEGIN");
      transactionOpen = true;
      const eventResult = await client.query(this.query(
        `INSERT INTO quote_exposure_ledger_events (
           source_stream_id, operation, quote_id, chain_id, payload
         ) VALUES ($1, $2, $3, $4, $5::jsonb)
         ON CONFLICT (source_stream_id) DO NOTHING
         RETURNING source_stream_id`,
        [sourceStreamId, operation, normalized.quoteId, normalized.chainId, JSON.stringify(normalized)],
      ));
      if (eventResult.rowCount !== 1) {
        await client.query("COMMIT");
        transactionOpen = false;
        return { inserted: false, applied: false };
      }

      const currentResult = await client.query(this.query(
        `SELECT source_epoch, stream_milliseconds::text, stream_sequence::text
         FROM quote_exposure_ledger_projection_versions
         WHERE quote_id = $1
         FOR UPDATE`,
        [normalized.quoteId],
      ));
      if (currentResult.rowCount && currentResult.rowCount > 0) {
        const current = currentResult.rows[0] as Record<string, unknown>;
        if (current.source_epoch !== position.epoch) {
          throw new Error("Postgres quote exposure ledger epoch conflicts with active projection");
        }
        const currentMilliseconds = parseNonNegativeInteger(
          current.stream_milliseconds,
          "projection stream_milliseconds",
        );
        const currentSequence = parseNonNegativeInteger(current.stream_sequence, "projection stream_sequence");
        if (comparePosition(position, currentMilliseconds, currentSequence) <= 0) {
          await client.query("COMMIT");
          transactionOpen = false;
          return { inserted: true, applied: false };
        }
      }

      if (operation === "reserve") {
        await upsertActiveReservation(client, normalized, this.queryTimeoutMs);
      } else {
        await client.query(this.query(
          "DELETE FROM quote_exposure_reservations WHERE quote_id = $1",
          [normalized.quoteId],
        ));
      }
      await client.query(this.query(
        `INSERT INTO quote_exposure_ledger_projection_versions (
           quote_id, source_epoch, stream_milliseconds, stream_sequence, operation, updated_at
         ) VALUES ($1, $2, $3, $4, $5, now())
         ON CONFLICT (quote_id) DO UPDATE SET
           source_epoch = EXCLUDED.source_epoch,
           stream_milliseconds = EXCLUDED.stream_milliseconds,
           stream_sequence = EXCLUDED.stream_sequence,
           operation = EXCLUDED.operation,
           updated_at = now()`,
        [
          normalized.quoteId,
          position.epoch,
          position.milliseconds.toString(),
          position.sequence.toString(),
          operation,
        ],
      ));
      await client.query("COMMIT");
      transactionOpen = false;
      return { inserted: true, applied: true };
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
         to_regclass('public.quote_exposure_reservations') IS NOT NULL AS reservations,
         to_regclass('public.quote_exposure_ledger_events') IS NOT NULL AS events,
         to_regclass('public.quote_exposure_ledger_projection_versions') IS NOT NULL AS projections,
         EXISTS (
           SELECT 1 FROM pg_attribute
           WHERE attrelid = to_regclass('public.quote_exposure_reservations')
             AND attname = 'ledger_expires_at'
             AND NOT attisdropped
         ) AS ledger_expiry`,
      [],
    ));
    const row = result.rows[0] as Record<string, unknown> | undefined;
    if (!row || row.reservations !== true || row.events !== true ||
        row.projections !== true || row.ledger_expiry !== true) {
      throw new Error("Postgres quote exposure ledger schema is unavailable");
    }
  }

  async deleteExpired(limit: number): Promise<number> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10_000) {
      throw new Error("Postgres quote exposure cleanup limit must be between 1 and 10000");
    }
    const result = await this.pool.query(this.query(
      `DELETE FROM quote_exposure_reservations
       WHERE quote_id IN (
         SELECT quote_id
         FROM quote_exposure_reservations
         WHERE ledger_expires_at <= now()
         ORDER BY ledger_expires_at ASC
         LIMIT $1
       )`,
      [limit],
    ));
    return result.rowCount ?? 0;
  }

  private query(text: string, values: unknown[]): pg.QueryConfig & { query_timeout: number } {
    return { text, values, query_timeout: this.queryTimeoutMs };
  }
}

async function upsertActiveReservation(
  client: pg.PoolClient,
  record: RedisQuoteExposureRecord,
  queryTimeoutMs: number,
): Promise<void> {
  const statement: pg.QueryConfig & { query_timeout: number } = {
    text: `INSERT INTO quote_exposure_reservations (
             quote_id, chain_id, user_address, token_low, token_high, token_in, amount_in,
             token_out, amount_out, notional_usd_e18, settlement_address, treasury_address,
             treasury_available_balance, treasury_block_number, var_evaluation, delta_evaluation,
             expires_at, ledger_expires_at
           ) VALUES (
             $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
             $15::jsonb, $16::jsonb, to_timestamp($17), to_timestamp($18)
           )
           ON CONFLICT (quote_id) DO UPDATE SET
             chain_id = EXCLUDED.chain_id,
             user_address = EXCLUDED.user_address,
             token_low = EXCLUDED.token_low,
             token_high = EXCLUDED.token_high,
             token_in = EXCLUDED.token_in,
             amount_in = EXCLUDED.amount_in,
             token_out = EXCLUDED.token_out,
             amount_out = EXCLUDED.amount_out,
             notional_usd_e18 = EXCLUDED.notional_usd_e18,
             settlement_address = EXCLUDED.settlement_address,
             treasury_address = EXCLUDED.treasury_address,
             treasury_available_balance = EXCLUDED.treasury_available_balance,
             treasury_block_number = EXCLUDED.treasury_block_number,
             var_evaluation = EXCLUDED.var_evaluation,
             delta_evaluation = EXCLUDED.delta_evaluation,
             expires_at = EXCLUDED.expires_at,
             ledger_expires_at = EXCLUDED.ledger_expires_at`,
    values: [
      record.quoteId,
      record.chainId,
      record.user,
      record.tokenLow,
      record.tokenHigh,
      record.tokenIn,
      record.amountIn,
      record.tokenOut,
      record.amountOut,
      record.notionalUsdE18,
      record.treasuryLiquidity?.settlementAddress ?? null,
      record.treasuryLiquidity?.treasuryAddress ?? null,
      record.treasuryLiquidity?.availableBalance ?? null,
      record.treasuryLiquidity?.blockNumber ?? null,
      record.portfolioVar ? JSON.stringify(record.portfolioVar) : null,
      record.portfolioDelta ? JSON.stringify(record.portfolioDelta) : null,
      record.deadline,
      record.ledgerExpiresAt,
    ],
    query_timeout: queryTimeoutMs,
  };
  const result = await client.query(statement);
  if (result.rowCount !== 1) {
    throw new Error("Postgres quote exposure ledger did not project the active reservation");
  }
}

function parseStreamPosition(sourceStreamId: string): StreamPosition {
  if (typeof sourceStreamId !== "string") {
    throw new Error("Postgres quote exposure sourceStreamId must be a string");
  }
  const match = /^([A-Za-z][A-Za-z0-9_-]{0,63}):([0-9]+)-([0-9]+)$/.exec(sourceStreamId);
  if (!match) throw new Error("Postgres quote exposure sourceStreamId must be an epoch and Redis stream id");
  return {
    sourceStreamId,
    epoch: match[1],
    milliseconds: BigInt(match[2]),
    sequence: BigInt(match[3]),
  };
}

function comparePosition(position: StreamPosition, milliseconds: bigint, sequence: bigint): number {
  if (position.milliseconds < milliseconds) return -1;
  if (position.milliseconds > milliseconds) return 1;
  if (position.sequence < sequence) return -1;
  if (position.sequence > sequence) return 1;
  return 0;
}

function parseNonNegativeInteger(value: unknown, field: string): bigint {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/.test(value)) {
    throw new Error(`Postgres quote exposure ${field} must be a non-negative integer`);
  }
  return BigInt(value);
}

function assertOperation(value: unknown): asserts value is QuoteExposureLedgerOperation {
  if (value !== "reserve" && value !== "release") {
    throw new Error("Postgres quote exposure ledger operation must be reserve or release");
  }
}

async function rollbackBestEffort(client: pg.PoolClient): Promise<void> {
  try { await client.query("ROLLBACK"); } catch {}
}
