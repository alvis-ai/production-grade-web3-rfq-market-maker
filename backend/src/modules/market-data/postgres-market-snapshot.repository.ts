import pg from "pg";
import {
  assertMarketSnapshotIdentifier,
  toMarketSnapshotRecord,
  type MarketSnapshotRecord,
  type SaveMarketSnapshotInput,
  type MarketSnapshotStore,
} from "./market-snapshot.repository.js";
import { normalizeHumanPrice } from "../pricing/price-normalization.js";

const postgresMarketSnapshotSource = "postgres-market-data-v1";

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
    const expected = toMarketSnapshotRecord(input, postgresMarketSnapshotSource);

    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `INSERT INTO market_snapshots (id, chain_id, token_in, token_out, mid_price,
          liquidity_usd, volatility_bps, source, observed_at, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
         ON CONFLICT (id) DO NOTHING
         RETURNING id, chain_id, token_in, token_out, mid_price, liquidity_usd,
           volatility_bps, source, observed_at, created_at`,
        [
          expected.snapshotId,
          expected.chainId,
          expected.tokenIn.toLowerCase(),
          expected.tokenOut.toLowerCase(),
          expected.midPrice,
          expected.liquidityUsd,
          expected.volatilityBps,
          expected.source,
          expected.observedAt,
        ],
      );
      if (result.rows.length === 1) return rowToRecord(result.rows[0]);
      if (result.rows.length !== 0) throw new Error("Postgres market snapshot insert returned multiple rows");

      const existingResult = await client.query(
        `SELECT id, chain_id, token_in, token_out, mid_price, liquidity_usd,
          volatility_bps, source, observed_at, created_at
         FROM market_snapshots WHERE id = $1`,
        [expected.snapshotId],
      );
      if (existingResult.rows.length !== 1) {
        throw new Error(`Postgres market snapshot conflict lookup failed for ${expected.snapshotId}`);
      }
      const existing = rowToRecord(existingResult.rows[0]);
      if (!matchesSnapshotRecord(existing, expected)) {
        throw new Error(`Postgres market snapshot conflict for ${expected.snapshotId}`);
      }
      return existing;
    } finally {
      client.release();
    }
  }

  async findBySnapshotId(snapshotId: string): Promise<MarketSnapshotRecord | undefined> {
    assertMarketSnapshotIdentifier(snapshotId, "snapshotId");
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

function matchesSnapshotRecord(
  record: MarketSnapshotRecord,
  expected: MarketSnapshotRecord,
): boolean {
  return record.snapshotId === expected.snapshotId &&
    record.chainId === expected.chainId &&
    record.tokenIn.toLowerCase() === expected.tokenIn.toLowerCase() &&
    record.tokenOut.toLowerCase() === expected.tokenOut.toLowerCase() &&
    equalDecimal(record.midPrice, expected.midPrice) &&
    record.liquidityUsd === expected.liquidityUsd &&
    record.volatilityBps === expected.volatilityBps &&
    record.source === expected.source &&
    record.observedAt === expected.observedAt;
}

function equalDecimal(left: string, right: string): boolean {
  const leftPrice = normalizeHumanPrice(left);
  const rightPrice = normalizeHumanPrice(right);
  return leftPrice.numerator * rightPrice.denominator === rightPrice.numerator * leftPrice.denominator;
}
