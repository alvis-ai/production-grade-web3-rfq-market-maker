import type pg from "pg";
import type { Address, IntString } from "../../shared/types/rfq.js";
import {
  DailyLossEvidenceError,
  type DailyLossEvidence,
  type DailyLossEvidenceProvider,
} from "./daily-loss-risk.engine.js";

interface DailyLossRow {
  net_pnl: unknown;
  unavailable_count: unknown;
  window_started_at: unknown;
  observed_at: unknown;
}

export class PostgresDailyLossEvidenceProvider implements DailyLossEvidenceProvider {
  constructor(private readonly pool: pg.Pool) {
    if (typeof pool !== "object" || pool === null || Array.isArray(pool) ||
        typeof (pool as unknown as Record<string, unknown>).connect !== "function") {
      throw new Error("Postgres daily loss evidence pool.connect must be a function");
    }
  }

  async getDailyLossEvidence(chainId: number, tokenAddress: Address): Promise<DailyLossEvidence> {
    assertIdentity(chainId, tokenAddress);
    let client: pg.PoolClient;
    try {
      client = await this.pool.connect();
    } catch {
      throw unavailable();
    }
    try {
      let result: pg.QueryResult<DailyLossRow>;
      try {
        result = await client.query<DailyLossRow>(
          `SELECT
             COALESCE(SUM(hedge_net_pnl_quote_quantity)
               FILTER (WHERE hedge_net_pnl_status = 'complete'), 0)::text AS net_pnl,
             COUNT(*) FILTER (WHERE hedge_net_pnl_status = 'unavailable')::text AS unavailable_count,
             date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' AS window_started_at,
             now() AS observed_at
           FROM hedge_orders
           WHERE chain_id = $1
             AND lower(venue_quote_token_address) = $2
             AND hedge_net_pnl_status IN ('complete', 'unavailable')
             AND hedge_net_pnl_realized_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
             AND hedge_net_pnl_realized_at <
               (date_trunc('day', now() AT TIME ZONE 'UTC') + interval '1 day') AT TIME ZONE 'UTC'`,
          [chainId, tokenAddress.toLowerCase()],
        );
      } catch {
        throw unavailable();
      }
      if (result.rows.length !== 1) {
        throw new DailyLossEvidenceError("EVIDENCE_INVALID", "Postgres daily loss query returned invalid row count");
      }
      const row = result.rows[0]!;
      if (parseCount(row.unavailable_count) > 0n) {
        throw new DailyLossEvidenceError(
          "EVIDENCE_INVALID",
          "Postgres daily loss evidence contains unavailable realized hedge PnL",
        );
      }
      return {
        chainId,
        tokenAddress: tokenAddress.toLowerCase() as Address,
        netPnlUsdE18: parseDecimalE18(row.net_pnl),
        windowStartedAt: parseTimestamp(row.window_started_at, "window_started_at"),
        observedAt: parseTimestamp(row.observed_at, "observed_at"),
      };
    } finally {
      client.release();
    }
  }
}

function parseCount(value: unknown): bigint {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]{0,77})$/.test(value)) {
    throw new DailyLossEvidenceError("EVIDENCE_INVALID", "Postgres daily loss unavailable_count is invalid");
  }
  return BigInt(value);
}

function parseDecimalE18(value: unknown): IntString {
  if (typeof value !== "string") {
    throw new DailyLossEvidenceError("EVIDENCE_INVALID", "Postgres daily loss net_pnl must be a decimal string");
  }
  const match = value.match(/^(-?)(0|[1-9][0-9]{0,59})(?:\.([0-9]{1,18}))?$/);
  if (!match) {
    throw new DailyLossEvidenceError("EVIDENCE_INVALID", "Postgres daily loss net_pnl must be a bounded decimal");
  }
  const scaled = BigInt(match[2]!) * 1_000_000_000_000_000_000n +
    BigInt(((match[3] ?? "") + "0".repeat(18)).slice(0, 18) || "0");
  const signed = match[1] === "-" ? -scaled : scaled;
  return signed.toString() as IntString;
}

function parseTimestamp(value: unknown, field: string): string {
  const date = value instanceof Date ? value : typeof value === "string" ? new Date(value) : undefined;
  if (!date || Number.isNaN(date.getTime())) {
    throw new DailyLossEvidenceError("EVIDENCE_INVALID", `Postgres daily loss ${field} is invalid`);
  }
  return date.toISOString();
}

function assertIdentity(chainId: number, tokenAddress: Address): void {
  if (!Number.isSafeInteger(chainId) || chainId <= 0) {
    throw new Error("Postgres daily loss chainId must be a positive safe integer");
  }
  if (typeof tokenAddress !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(tokenAddress)) {
    throw new Error("Postgres daily loss tokenAddress must be a 20-byte hex address");
  }
}

function unavailable(): DailyLossEvidenceError {
  return new DailyLossEvidenceError("STORE_UNAVAILABLE", "Postgres daily loss evidence is unavailable");
}
