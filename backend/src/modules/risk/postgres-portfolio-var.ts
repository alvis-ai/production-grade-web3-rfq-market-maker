import type pg from "pg";
import type { Address } from "../../shared/types/rfq.js";
import type { TokenRegistry } from "../pricing/token-registry.js";
import {
  applyPortfolioDelta,
  evaluatePortfolioVar,
  normalizePortfolioVarPolicy,
  type PortfolioVarEvaluation,
  type PortfolioVarPolicy,
  type PortfolioVarPosition,
  type PortfolioVarSnapshot,
} from "./portfolio-var.js";
import type { PortfolioQuoteDelta } from "./in-memory-portfolio-var.js";

interface InventoryRow {
  token_address: unknown;
  balance: unknown;
}

interface ReservationRow {
  token_in: unknown;
  amount_in: unknown;
  token_out: unknown;
  amount_out: unknown;
}

export class PostgresPortfolioVarEvaluator {
  private readonly policy;

  constructor(
    policy: PortfolioVarPolicy,
    private readonly tokenRegistry: TokenRegistry,
    private readonly nowMilliseconds: () => number = () => Date.now(),
  ) {
    this.policy = normalizePortfolioVarPolicy(policy, tokenRegistry);
    if (typeof nowMilliseconds !== "function") {
      throw new Error("Postgres portfolio VaR nowMilliseconds must be a function");
    }
  }

  async evaluate(
    client: pg.PoolClient,
    candidate: PortfolioQuoteDelta,
  ): Promise<PortfolioVarEvaluation> {
    const nowMs = this.nowMilliseconds();
    if (!Number.isSafeInteger(nowMs) || nowMs <= 0) {
      throw new Error("Postgres portfolio VaR current time must be a positive safe integer");
    }
    await client.query("LOCK TABLE inventory_positions IN SHARE MODE");
    const inventoryResult = await client.query<InventoryRow>(
      `SELECT lower(token_address) AS token_address, balance::text AS balance
       FROM inventory_positions
       WHERE chain_id = $1
       ORDER BY token_address`,
      [candidate.chainId],
    );
    let preTradePositions: PortfolioVarPosition[] = inventoryResult.rows.map((row) => ({
      chainId: candidate.chainId,
      tokenAddress: requireAddress(row.token_address, "inventory token_address"),
      balance: parseSignedInteger(row.balance, "inventory balance"),
    }));

    const reservationResult = await client.query<ReservationRow>(
      `SELECT lower(exposure.token_in) AS token_in, exposure.amount_in::text AS amount_in,
         lower(exposure.token_out) AS token_out, exposure.amount_out::text AS amount_out
       FROM quote_exposure_reservations exposure
       JOIN quotes quote ON quote.id = exposure.quote_id
       WHERE exposure.chain_id = $1
         AND exposure.expires_at > now()
         AND quote.status IN ('requested', 'signed', 'failed')
       ORDER BY exposure.quote_id`,
      [candidate.chainId],
    );
    for (const row of reservationResult.rows) {
      preTradePositions = applyPortfolioDelta(
        preTradePositions,
        candidate.chainId,
        requireAddress(row.token_in, "reservation token_in"),
        parsePositiveInteger(row.amount_in, "reservation amount_in"),
        requireAddress(row.token_out, "reservation token_out"),
        parsePositiveInteger(row.amount_out, "reservation amount_out"),
      );
    }
    const postTradePositions = applyPortfolioDelta(
      preTradePositions,
      candidate.chainId,
      candidate.tokenIn,
      candidate.amountIn,
      candidate.tokenOut,
      candidate.amountOut,
    );
    const requiredPairs = requiredValuationPairs(
      candidate.chainId,
      preTradePositions,
      postTradePositions,
      this.policy.valuationPairs,
    );
    const snapshots = requiredPairs.length === 0
      ? []
      : await readLatestSnapshots(client, candidate.chainId, requiredPairs);
    return evaluatePortfolioVar(
      candidate.chainId,
      preTradePositions,
      postTradePositions,
      snapshots,
      this.policy,
      this.tokenRegistry,
      nowMs,
    );
  }

  exceedsLimit(evaluation: PortfolioVarEvaluation): boolean {
    return BigInt(evaluation.postTradeVarUsdE18) > this.policy.maxPortfolioVarUsdE18;
  }
}

async function readLatestSnapshots(
  client: pg.PoolClient,
  chainId: number,
  pairs: readonly { tokenAddress: Address; usdReferenceTokenAddress: Address }[],
): Promise<PortfolioVarSnapshot[]> {
  const serializedPairs = JSON.stringify(pairs.map((pair) => ({
    token_address: pair.tokenAddress.toLowerCase(),
    usd_reference_token_address: pair.usdReferenceTokenAddress.toLowerCase(),
  })));
  const result = await client.query(
    `WITH configured_pairs AS (
       SELECT lower(token_address) AS token_address,
         lower(usd_reference_token_address) AS usd_reference_token_address
       FROM jsonb_to_recordset($2::jsonb) AS pair(
         token_address text,
         usd_reference_token_address text
       )
     ), ranked_snapshots AS (
       SELECT pair.token_address AS valuation_token, snapshot.id,
         snapshot.chain_id, snapshot.token_in, snapshot.token_out,
         snapshot.mid_price::text AS mid_price, snapshot.volatility_bps,
         snapshot.observed_at,
         row_number() OVER (
           PARTITION BY pair.token_address
           ORDER BY snapshot.observed_at DESC, snapshot.id DESC
         ) AS snapshot_rank
       FROM configured_pairs pair
       JOIN market_snapshots snapshot ON snapshot.chain_id = $1
         AND (
           (lower(snapshot.token_in) = pair.token_address
             AND lower(snapshot.token_out) = pair.usd_reference_token_address)
           OR
           (lower(snapshot.token_in) = pair.usd_reference_token_address
             AND lower(snapshot.token_out) = pair.token_address)
         )
     )
     SELECT id, chain_id, token_in, token_out, mid_price, volatility_bps, observed_at
     FROM ranked_snapshots
     WHERE snapshot_rank = 1
     ORDER BY valuation_token`,
    [chainId, serializedPairs],
  );
  return result.rows.map((row) => ({
    snapshotId: requireSafeIdentifier(row.id, "snapshot id"),
    chainId: parsePositiveSafeInteger(row.chain_id, "snapshot chain_id"),
    tokenIn: requireAddress(row.token_in, "snapshot token_in"),
    tokenOut: requireAddress(row.token_out, "snapshot token_out"),
    midPrice: requireString(row.mid_price, "snapshot mid_price"),
    volatilityBps: parseBps(row.volatility_bps, "snapshot volatility_bps"),
    observedAt: toCanonicalTimestamp(row.observed_at),
  }));
}

function requiredValuationPairs(
  chainId: number,
  preTrade: readonly PortfolioVarPosition[],
  postTrade: readonly PortfolioVarPosition[],
  pairs: readonly { chainId: number; tokenAddress: Address; usdReferenceTokenAddress: Address }[],
) {
  const nonZero = new Set<string>();
  for (const position of [...preTrade, ...postTrade]) {
    if (position.chainId === chainId && position.balance !== 0n) {
      nonZero.add(position.tokenAddress.toLowerCase());
    }
  }
  return pairs.filter((pair) => pair.chainId === chainId && nonZero.has(pair.tokenAddress.toLowerCase()));
}

function parseSignedInteger(value: unknown, label: string): bigint {
  if (typeof value !== "string" || !/^(0|-?[1-9][0-9]*)$/.test(value)) {
    throw new Error(`Postgres portfolio VaR ${label} must be a canonical integer`);
  }
  return BigInt(value);
}

function parsePositiveInteger(value: unknown, label: string): bigint {
  if (typeof value !== "string" || !/^[1-9][0-9]*$/.test(value)) {
    throw new Error(`Postgres portfolio VaR ${label} must be a canonical positive integer`);
  }
  return BigInt(value);
}

function parsePositiveSafeInteger(value: unknown, label: string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`Postgres portfolio VaR ${label} must be a positive safe integer`);
  }
  return parsed;
}

function parseBps(value: unknown, label: string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > 10_000) {
    throw new Error(`Postgres portfolio VaR ${label} must be an integer between 0 and 10000`);
  }
  return parsed;
}

function requireAddress(value: unknown, label: string): Address {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new Error(`Postgres portfolio VaR ${label} must be a 20-byte hex address`);
  }
  return value.toLowerCase() as Address;
}

function requireSafeIdentifier(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length < 1 || value.length > 128 || !/^[A-Za-z0-9_:-]+$/.test(value)) {
    throw new Error(`Postgres portfolio VaR ${label} must be a safe identifier`);
  }
  return value;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`Postgres portfolio VaR ${label} must be a string`);
  return value;
}

function toCanonicalTimestamp(value: unknown): string {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString();
  if (typeof value === "string") {
    const timestamp = Date.parse(value);
    if (Number.isFinite(timestamp)) return new Date(timestamp).toISOString();
  }
  throw new Error("Postgres portfolio VaR snapshot observed_at must be a timestamp");
}
