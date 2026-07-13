import type pg from "pg";
import type { TokenRegistry } from "../pricing/token-registry.js";
import {
  assertSameReservation,
  normalizeQuoteExposurePolicy,
  normalizeQuoteExposureReservation,
  type NormalizedQuoteExposureReservation,
  type QuoteExposurePolicy,
  type QuoteExposureReservationResult,
  type QuoteExposureStore,
  type ReserveQuoteExposureInput,
} from "./quote-exposure.store.js";

interface ExposureTotalsRow {
  user_open_notional_usd_e18: string;
  pair_open_notional_usd_e18: string;
}

export class PostgresQuoteExposureStore implements QuoteExposureStore {
  private readonly maxUserOpenNotionalUsdE18: bigint;
  private readonly maxPairOpenNotionalUsdE18: bigint;

  constructor(
    private readonly pool: pg.Pool,
    policy: QuoteExposurePolicy,
    private readonly tokenRegistry: TokenRegistry,
    private readonly nowSeconds: () => number = () => Math.floor(Date.now() / 1_000),
  ) {
    if (!pool || typeof pool.connect !== "function") {
      throw new Error("Postgres quote exposure pool.connect must be a function");
    }
    if (typeof nowSeconds !== "function") {
      throw new Error("Postgres quote exposure nowSeconds must be a function");
    }
    const limits = normalizeQuoteExposurePolicy(policy);
    this.maxUserOpenNotionalUsdE18 = limits.maxUserOpenNotionalUsdE18;
    this.maxPairOpenNotionalUsdE18 = limits.maxPairOpenNotionalUsdE18;
  }

  async checkHealth(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("SELECT 1 FROM quote_exposure_reservations LIMIT 1");
    } finally {
      client.release();
    }
  }

  async reserve(input: ReserveQuoteExposureInput): Promise<QuoteExposureReservationResult> {
    const reservation = normalizeQuoteExposureReservation(input, this.tokenRegistry, this.nowSeconds());
    const client = await this.pool.connect();
    let transactionOpen = false;
    try {
      await client.query("BEGIN");
      transactionOpen = true;
      const scopes = exposureLockScopes(reservation).sort();
      for (const scope of scopes) {
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [scope]);
      }
      await client.query(
        `DELETE FROM quote_exposure_reservations
         WHERE quote_id IN (
           SELECT quote_id
           FROM quote_exposure_reservations
           WHERE expires_at <= now()
           ORDER BY expires_at
           LIMIT 100
           FOR UPDATE SKIP LOCKED
         )`,
      );

      const existingResult = await client.query(
        `SELECT exposure.quote_id, exposure.chain_id, exposure.user_address,
          exposure.token_low, exposure.token_high, exposure.notional_usd_e18::text,
          extract(epoch FROM exposure.expires_at)::bigint::text AS deadline,
          exposure.expires_at > now() AND quote.status IN ('requested', 'signed', 'failed') AS active
         FROM quote_exposure_reservations exposure
         JOIN quotes quote ON quote.id = exposure.quote_id
         WHERE exposure.quote_id = $1
         FOR UPDATE`,
        [reservation.quoteId],
      );
      if (existingResult.rowCount && existingResult.rowCount > 0) {
        if (existingResult.rows[0].active !== true) {
          throw new Error(`Quote exposure reservation ${reservation.quoteId} is expired by database time`);
        }
        assertSameReservation(normalizeReservationRow(existingResult.rows[0]), reservation);
        await client.query("COMMIT");
        transactionOpen = false;
        return { status: "reserved", notionalUsdE18: reservation.notionalUsdE18.toString() };
      }

      const totalsResult = await client.query<ExposureTotalsRow>(
        `SELECT
          COALESCE(SUM(exposure.notional_usd_e18) FILTER (
            WHERE lower(exposure.user_address) = $2
          ), 0)::text AS user_open_notional_usd_e18,
          COALESCE(SUM(exposure.notional_usd_e18) FILTER (
            WHERE lower(exposure.token_low) = $3 AND lower(exposure.token_high) = $4
          ), 0)::text AS pair_open_notional_usd_e18
         FROM quote_exposure_reservations exposure
         JOIN quotes quote ON quote.id = exposure.quote_id
         WHERE exposure.chain_id = $1
           AND exposure.expires_at > now()
           AND quote.status IN ('requested', 'signed', 'failed')
           AND (
             lower(exposure.user_address) = $2
             OR (lower(exposure.token_low) = $3 AND lower(exposure.token_high) = $4)
           )`,
        [reservation.chainId, reservation.user, reservation.tokenLow, reservation.tokenHigh],
      );
      const totals = normalizeTotalsRow(totalsResult.rows[0]);
      if (totals.user + reservation.notionalUsdE18 > this.maxUserOpenNotionalUsdE18) {
        await client.query("ROLLBACK");
        transactionOpen = false;
        return { status: "rejected", reasonCode: "USER_OPEN_NOTIONAL_LIMIT_EXCEEDED" };
      }
      if (totals.pair + reservation.notionalUsdE18 > this.maxPairOpenNotionalUsdE18) {
        await client.query("ROLLBACK");
        transactionOpen = false;
        return { status: "rejected", reasonCode: "PAIR_OPEN_NOTIONAL_LIMIT_EXCEEDED" };
      }

      const insertResult = await client.query(
        `INSERT INTO quote_exposure_reservations (
          quote_id, chain_id, user_address, token_low, token_high, notional_usd_e18, expires_at
        )
        SELECT $1, $2, $3, $4, $5, $6, to_timestamp($7)
        WHERE to_timestamp($7) > now()
          AND EXISTS (SELECT 1 FROM quotes WHERE id = $1 AND status = 'requested')
        RETURNING quote_id`,
        [
          reservation.quoteId,
          reservation.chainId,
          reservation.user,
          reservation.tokenLow,
          reservation.tokenHigh,
          reservation.notionalUsdE18.toString(),
          reservation.deadline,
        ],
      );
      if (insertResult.rowCount !== 1) {
        throw new Error("Quote exposure reservation deadline is not active by database time");
      }
      await client.query("COMMIT");
      transactionOpen = false;
      return { status: "reserved", notionalUsdE18: reservation.notionalUsdE18.toString() };
    } catch (error) {
      if (transactionOpen) {
        try {
          await client.query("ROLLBACK");
        } catch {
          // Preserve the original database error.
        }
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async release(quoteId: string): Promise<void> {
    if (typeof quoteId !== "string" || !/^[A-Za-z0-9_:-]{1,128}$/.test(quoteId)) {
      throw new Error("Postgres quote exposure quoteId must be a safe identifier");
    }
    const client = await this.pool.connect();
    try {
      await client.query("DELETE FROM quote_exposure_reservations WHERE quote_id = $1", [quoteId]);
    } finally {
      client.release();
    }
  }
}

function exposureLockScopes(reservation: NormalizedQuoteExposureReservation): string[] {
  return [
    `quote-exposure:quote:${reservation.quoteId}`,
    `quote-exposure:user:${reservation.chainId}:${reservation.user}`,
    `quote-exposure:pair:${reservation.chainId}:${reservation.tokenLow}:${reservation.tokenHigh}`,
  ];
}

function normalizeTotalsRow(row: ExposureTotalsRow | undefined): { user: bigint; pair: bigint } {
  if (!row) throw new Error("Postgres quote exposure totals query returned no row");
  return {
    user: parseNonNegativeInteger(row.user_open_notional_usd_e18, "user total"),
    pair: parseNonNegativeInteger(row.pair_open_notional_usd_e18, "pair total"),
  };
}

function normalizeReservationRow(row: Record<string, unknown>): NormalizedQuoteExposureReservation {
  const quoteId = requireString(row.quote_id, "quote_id");
  const chainId = Number(row.chain_id);
  if (!Number.isSafeInteger(chainId) || chainId <= 0) {
    throw new Error("Postgres quote exposure row.chain_id must be a positive safe integer");
  }
  const user = requireAddress(row.user_address, "user_address");
  const tokenLow = requireAddress(row.token_low, "token_low");
  const tokenHigh = requireAddress(row.token_high, "token_high");
  const deadline = Number(row.deadline);
  if (!Number.isSafeInteger(deadline) || deadline <= 0) {
    throw new Error("Postgres quote exposure row.deadline must be a positive safe integer");
  }
  return {
    quoteId,
    chainId,
    user,
    tokenLow,
    tokenHigh,
    notionalUsdE18: parseNonNegativeInteger(row.notional_usd_e18, "notional_usd_e18"),
    deadline,
  };
}

function parseNonNegativeInteger(value: unknown, label: string): bigint {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/.test(value)) {
    throw new Error(`Postgres quote exposure ${label} must be a canonical non-negative integer`);
  }
  return BigInt(value);
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length < 1 || value.length > 128 || !/^[A-Za-z0-9_:-]+$/.test(value)) {
    throw new Error(`Postgres quote exposure row.${label} must be a safe identifier`);
  }
  return value;
}

function requireAddress(value: unknown, label: string): `0x${string}` {
  if (typeof value !== "string" || !/^0x[0-9a-f]{40}$/.test(value)) {
    throw new Error(`Postgres quote exposure row.${label} must be a normalized address`);
  }
  return value as `0x${string}`;
}
