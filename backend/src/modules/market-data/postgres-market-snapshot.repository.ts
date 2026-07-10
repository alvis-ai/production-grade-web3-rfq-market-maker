import pg from "pg";
import type { MarketSnapshotRecord, SaveMarketSnapshotInput, MarketSnapshotStore } from "./market-snapshot.repository.js";

export class PostgresMarketSnapshotStore implements MarketSnapshotStore {
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

  async saveSnapshot(input: SaveMarketSnapshotInput): Promise<MarketSnapshotRecord> {
    const snapshotId = assertNonEmptyString(input.snapshot.snapshotId, "snapshotId");
    const chainId = input.request.chainId;
    const tokenIn = input.request.tokenIn.toLowerCase();
    const tokenOut = input.request.tokenOut.toLowerCase();
    const midPrice = input.snapshot.midPrice;
    const liquidityUsd = input.snapshot.liquidityUsd;
    const volatilityBps = input.snapshot.volatilityBps;
    const source = input.source ?? "postgres-market-data-v1";
    const observedAt = input.snapshot.observedAt;

    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `INSERT INTO market_snapshots (id, chain_id, token_in, token_out, mid_price,
          liquidity_usd, volatility_bps, source, observed_at, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
         ON CONFLICT (id) DO UPDATE SET
           chain_id = EXCLUDED.chain_id,
           token_in = EXCLUDED.token_in,
           token_out = EXCLUDED.token_out,
           mid_price = EXCLUDED.mid_price,
           liquidity_usd = EXCLUDED.liquidity_usd,
           volatility_bps = EXCLUDED.volatility_bps,
           source = EXCLUDED.source,
           observed_at = EXCLUDED.observed_at
         RETURNING id, chain_id, token_in, token_out, mid_price, liquidity_usd,
           volatility_bps, source, observed_at, created_at`,
        [snapshotId, chainId, tokenIn, tokenOut, midPrice, liquidityUsd, volatilityBps, source, observedAt],
      );

      return rowToRecord(result.rows[0]);
    } finally {
      client.release();
    }
  }

  async findBySnapshotId(snapshotId: string): Promise<MarketSnapshotRecord | undefined> {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `SELECT id, chain_id, token_in, token_out, mid_price, liquidity_usd,
          volatility_bps, source, observed_at, created_at
         FROM market_snapshots WHERE id = $1`,
        [snapshotId],
      );
      if (!result.rowCount) return undefined;

      return rowToRecord(result.rows[0]);
    } finally {
      client.release();
    }
  }
}

function rowToRecord(row: Record<string, unknown>): MarketSnapshotRecord {
  return {
    snapshotId: String(row.id),
    chainId: Number(row.chain_id),
    tokenIn: String(row.token_in) as `0x${string}`,
    tokenOut: String(row.token_out) as `0x${string}`,
    midPrice: String(row.mid_price),
    liquidityUsd: String(row.liquidity_usd),
    volatilityBps: Number(row.volatility_bps),
    source: String(row.source),
    observedAt: row.observed_at instanceof Date ? row.observed_at.toISOString() : String(row.observed_at),
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
  };
}

function assertNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Postgres market snapshot ${field} must be a non-empty string`);
  }
  return value.trim();
}
