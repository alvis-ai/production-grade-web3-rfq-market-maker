import pg from "pg";
import type { CexTradeFill } from "./binance-spot.adapter.js";
import type { Address, UIntString } from "../../shared/types/rfq.js";
import { isCanonicalUtcIsoTimestamp } from "../../shared/validation/timestamp.js";
import {
  assertCexTradeFill,
  decimalQuantitiesEqual,
  sumCexTradeQuantity,
} from "./hedge-fee-evidence.js";
import {
  calculateHedgeNetPnl,
  hedgeFillNetPnlModelDescription,
  type HedgeNetPnlCalculation,
} from "./hedge-net-pnl.js";

export interface HedgeFeeReconciliationJob {
  hedgeOrderId: string;
  chainId: number;
  token: Address;
  side: "buy" | "sell";
  amount: UIntString;
  filledAmount: UIntString;
  executedQuoteQuantity?: string;
  symbol: string;
  clientOrderId: string;
  venueOrderId?: string;
  attemptCount: number;
  createdAt: string;
}

export interface HedgeFeeStats {
  pendingCount: number;
  oldestDueAt?: string;
}

export interface HedgeFeeStore {
  checkHealth(): Promise<void>;
  stats(): Promise<HedgeFeeStats>;
  claimNext(workerId: string, leaseMs: number): Promise<HedgeFeeReconciliationJob | undefined>;
  completeReconciliation(
    hedgeOrderId: string,
    workerId: string,
    expectedFilledAmount: UIntString,
    venueOrderId: string,
    executedQuoteQuantity: string,
    fills: readonly CexTradeFill[],
  ): Promise<void>;
  releaseForRetry(hedgeOrderId: string, workerId: string, errorCode: string, retryDelayMs: number): Promise<void>;
}

const maxLeaseMs = 300_000;
const maxRetryDelayMs = 604_800_000;
const fillBatchSize = 100;

export class PostgresHedgeFeeStore implements HedgeFeeStore {
  constructor(private readonly pool: pg.Pool) {
    assertPool(pool);
  }

  async checkHealth(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("SELECT fee_reconciliation_status FROM hedge_orders LIMIT 1");
      await client.query("SELECT hedge_order_id FROM hedge_execution_fills LIMIT 1");
    } finally {
      client.release();
    }
  }

  async stats(): Promise<HedgeFeeStats> {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `SELECT COUNT(*)::text AS pending_count,
                MIN(fee_next_attempt_at) AS oldest_due_at
         FROM hedge_orders
         WHERE fee_reconciliation_status = 'pending'`,
      );
      if (result.rows.length !== 1) throw new Error("Postgres hedge fee stats returned an invalid row count");
      const row = result.rows[0] as Record<string, unknown>;
      const pendingCount = parseNonNegativeSafeInteger(row.pending_count, "pending_count");
      const oldestDueAt = parseOptionalTimestamp(row.oldest_due_at, "oldest_due_at");
      if ((pendingCount === 0) !== (oldestDueAt === undefined)) {
        throw new Error("Postgres hedge fee stats are inconsistent");
      }
      return { pendingCount, ...(oldestDueAt === undefined ? {} : { oldestDueAt }) };
    } finally {
      client.release();
    }
  }

  async claimNext(workerId: string, leaseMs: number): Promise<HedgeFeeReconciliationJob | undefined> {
    assertSafeIdentifier(workerId, "workerId");
    assertBoundedInteger(leaseMs, "leaseMs", 1_000, maxLeaseMs);
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `WITH candidate AS (
           SELECT id
           FROM hedge_orders
           WHERE fee_reconciliation_status = 'pending'
             AND fee_next_attempt_at <= now()
             AND (fee_lease_expires_at IS NULL OR fee_lease_expires_at <= now())
           ORDER BY fee_next_attempt_at ASC, created_at ASC, id ASC
           FOR UPDATE SKIP LOCKED
           LIMIT 1
         )
         UPDATE hedge_orders AS hedge
         SET fee_lease_owner = $1,
             fee_lease_expires_at = now() + $2 * interval '1 millisecond',
             fee_attempt_count = hedge.fee_attempt_count + 1,
             updated_at = now()
         FROM candidate
         WHERE hedge.id = candidate.id
         RETURNING hedge.id, hedge.chain_id, hedge.token_address, hedge.side,
                   hedge.amount::text AS amount, hedge.filled_amount::text AS filled_amount,
                   hedge.executed_quote_quantity::text AS executed_quote_quantity,
                   hedge.venue_symbol, hedge.client_order_id, hedge.venue_order_id,
                   hedge.fee_attempt_count, hedge.created_at`,
        [workerId, leaseMs],
      );
      if (result.rows.length > 1) throw new Error("Postgres hedge fee claim returned multiple jobs");
      return result.rows[0] ? parseFeeJob(result.rows[0]) : undefined;
    } finally {
      client.release();
    }
  }

  async completeReconciliation(
    hedgeOrderId: string,
    workerId: string,
    expectedFilledAmount: UIntString,
    venueOrderId: string,
    executedQuoteQuantity: string,
    fills: readonly CexTradeFill[],
  ): Promise<void> {
    assertLeaseMutation(hedgeOrderId, workerId);
    assertPositiveUInt(expectedFilledAmount, "expectedFilledAmount");
    assertVenueId(venueOrderId, "venueOrderId");
    assertPositiveDecimal(executedQuoteQuantity, 18, "executedQuoteQuantity");
    assertFillSet(fills, venueOrderId);
    if (!decimalQuantitiesEqual(sumCexTradeQuantity(fills, "quoteQuantity"), executedQuoteQuantity, 18)) {
      throw new Error("HEDGE_TRADE_FILLS_INCOMPLETE");
    }

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const selected = await client.query(
        `SELECT hedge.venue, hedge.venue_symbol, hedge.venue_order_id,
                hedge.status AS hedge_status, hedge.side, hedge.amount::text AS amount,
                hedge.filled_amount::text AS filled_amount,
                hedge.executed_quote_quantity::text AS executed_quote_quantity,
                hedge.route_accounting_version, hedge.venue_base_asset, hedge.venue_quote_asset,
                hedge.venue_quote_token_address, hedge.venue_base_decimals, hedge.venue_quote_decimals,
                quote.token_in, quote.token_out,
                quote.amount_in::text AS amount_in, quote.amount_out::text AS amount_out
         FROM hedge_orders AS hedge
         INNER JOIN quotes AS quote ON quote.id = hedge.quote_id
         WHERE hedge.id = $1 AND hedge.fee_reconciliation_status = 'pending'
           AND hedge.fee_lease_owner = $2
         FOR UPDATE OF hedge`,
        [hedgeOrderId, workerId],
      );
      if (selected.rows.length !== 1) throw new Error(`Postgres hedge fee lease conflict for ${hedgeOrderId}`);
      const row = selected.rows[0] as Record<string, unknown>;
      if (row.venue !== "binance" || typeof row.venue_symbol !== "string" ||
          row.filled_amount !== expectedFilledAmount ||
          (row.venue_order_id !== null && row.venue_order_id !== venueOrderId) ||
          (typeof row.executed_quote_quantity === "string" &&
            !decimalQuantitiesEqual(row.executed_quote_quantity, executedQuoteQuantity, 18))) {
        throw new Error(`Postgres hedge fee evidence conflict for ${hedgeOrderId}`);
      }
      const netPnl = calculateNetPnl(row, fills);

      for (let offset = 0; offset < fills.length; offset += fillBatchSize) {
        const batch = fills.slice(offset, offset + fillBatchSize);
        const { sql, params } = buildFillUpsert(hedgeOrderId, row.venue_symbol, batch);
        const inserted = await client.query(sql, params);
        if (inserted.rowCount !== batch.length) {
          throw new Error(`Postgres hedge fee fill conflict for ${hedgeOrderId}`);
        }
      }

      const aggregate = await client.query(
        `SELECT COUNT(*)::text AS fill_count,
                COALESCE(SUM(base_quantity), 0)::text AS base_quantity,
                COALESCE(SUM(quote_quantity), 0)::text AS quote_quantity
         FROM hedge_execution_fills
         WHERE hedge_order_id = $1`,
        [hedgeOrderId],
      );
      const totals = aggregate.rows[0] as Record<string, unknown> | undefined;
      if (!totals || totals.fill_count !== String(fills.length) ||
          typeof totals.base_quantity !== "string" ||
          !decimalQuantitiesEqual(totals.base_quantity, sumCexTradeQuantity(fills, "quantity"), 36) ||
          typeof totals.quote_quantity !== "string" ||
          !decimalQuantitiesEqual(totals.quote_quantity, executedQuoteQuantity, 18)) {
        throw new Error(`Postgres hedge fee aggregate conflict for ${hedgeOrderId}`);
      }

      const updated = await client.query(
        `UPDATE hedge_orders
         SET venue_order_id = $3,
             execution_evidence_version = 'base-and-quote-v2',
             executed_quote_quantity = $4,
             fee_reconciliation_status = 'complete',
             fee_next_attempt_at = NULL,
             fee_lease_owner = NULL,
             fee_lease_expires_at = NULL,
             fee_last_error_code = NULL,
             fee_reconciled_at = now(),
             hedge_net_pnl_status = COALESCE($6, hedge_net_pnl_status),
             hedge_settlement_reference_quantity = $7,
             hedge_residual_base_amount = $8,
             hedge_residual_quote_quantity = $9,
             hedge_commission_quote_quantity = $10,
             hedge_net_pnl_quote_quantity = $11,
             hedge_net_pnl_reason_code = $12,
             hedge_unvalued_commission_assets = $13::jsonb,
             hedge_net_pnl_realized_at = $14,
             updated_at = now()
         WHERE id = $1 AND fee_reconciliation_status = 'pending' AND fee_lease_owner = $2
           AND filled_amount = $5
           AND (venue_order_id IS NULL OR venue_order_id = $3)
           AND (executed_quote_quantity IS NULL OR executed_quote_quantity = $4)`,
        [
          hedgeOrderId,
          workerId,
          venueOrderId,
          executedQuoteQuantity,
          expectedFilledAmount,
          netPnl?.status ?? null,
          netPnl?.status === "complete" ? netPnl.settlementReferenceQuantity : null,
          netPnl?.status === "complete" ? netPnl.residualBaseAmount : null,
          netPnl?.status === "complete" ? netPnl.residualQuoteQuantity : null,
          netPnl?.status === "complete" ? netPnl.commissionQuoteQuantity : null,
          netPnl?.status === "complete" ? netPnl.netPnlQuoteQuantity : null,
          netPnl?.status === "unavailable" ? netPnl.reasonCode : null,
          netPnl?.status === "unavailable" ? JSON.stringify(netPnl.unvaluedCommissionAssets ?? []) : null,
          netPnl?.realizedAt ?? null,
        ],
      );
      if (updated.rowCount !== 1) throw new Error(`Postgres hedge fee lease conflict for ${hedgeOrderId}`);
      await client.query("COMMIT");
    } catch (error) {
      await rollbackBestEffort(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async releaseForRetry(
    hedgeOrderId: string,
    workerId: string,
    errorCode: string,
    retryDelayMs: number,
  ): Promise<void> {
    assertLeaseMutation(hedgeOrderId, workerId);
    assertErrorCode(errorCode);
    assertBoundedInteger(retryDelayMs, "retryDelayMs", 1, maxRetryDelayMs);
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `UPDATE hedge_orders
         SET fee_last_error_code = $3,
             fee_next_attempt_at = now() + $4 * interval '1 millisecond',
             fee_lease_owner = NULL,
             fee_lease_expires_at = NULL,
             updated_at = now()
         WHERE id = $1 AND fee_reconciliation_status = 'pending' AND fee_lease_owner = $2`,
        [hedgeOrderId, workerId, errorCode, retryDelayMs],
      );
      if (result.rowCount !== 1) throw new Error(`Postgres hedge fee lease conflict for ${hedgeOrderId}`);
    } finally {
      client.release();
    }
  }
}

function calculateNetPnl(
  row: Record<string, unknown>,
  fills: readonly CexTradeFill[],
): HedgeNetPnlCalculation | undefined {
  if (row.route_accounting_version === null || row.route_accounting_version === undefined) return undefined;
  if (row.route_accounting_version !== "venue-assets-v1") {
    throw new Error("Postgres hedge fee route accounting version is invalid");
  }
  const side = row.side;
  if (side !== "buy" && side !== "sell") throw new Error("Postgres hedge fee side is invalid");
  const referenceToken = parseAddress(side === "sell" ? row.token_out : row.token_in);
  const routeQuoteToken = parseAddress(row.venue_quote_token_address);
  if (referenceToken.toLowerCase() !== routeQuoteToken.toLowerCase()) {
    throw new Error("Postgres hedge fee route reference token is inconsistent");
  }
  const baseAsset = parseVenueAsset(row.venue_base_asset, "venue_base_asset");
  const quoteAsset = parseVenueAsset(row.venue_quote_asset, "venue_quote_asset");
  const realizedAt = fills.reduce(
    (latest, fill) => fill.executedAt.localeCompare(latest) > 0 ? fill.executedAt : latest,
    fills[0]!.executedAt,
  );
  if (row.hedge_status === "failed") {
    return {
      status: "unavailable",
      model: "hedge_fill_net_v1",
      modelDescription: hedgeFillNetPnlModelDescription,
      valuationToken: routeQuoteToken.toLowerCase() as Address,
      valuationAsset: quoteAsset,
      reasonCode: "PARTIAL_HEDGE_UNCLOSED",
      realizedAt,
    };
  }
  if (row.hedge_status !== "filled") {
    throw new Error("Postgres hedge fee terminal status is invalid");
  }
  return calculateHedgeNetPnl({
    side,
    targetAmount: parsePositiveUInt(row.amount, "amount"),
    filledAmount: parsePositiveUInt(row.filled_amount, "filled_amount"),
    baseTokenDecimals: parseBoundedDecimals(row.venue_base_decimals, 36, "venue_base_decimals"),
    settlementReferenceAmount: parsePositiveUInt(side === "sell" ? row.amount_out : row.amount_in, "reference_amount"),
    quoteTokenDecimals: parseBoundedDecimals(row.venue_quote_decimals, 18, "venue_quote_decimals"),
    executedQuoteQuantity: parsePositiveDecimalValue(row.executed_quote_quantity, "executed_quote_quantity"),
    baseAsset,
    quoteAsset,
    quoteToken: routeQuoteToken,
    fills,
    realizedAt,
  });
}

function parseVenueAsset(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^[A-Z0-9._-]{1,32}$/.test(value)) {
    throw new Error(`Postgres hedge fee ${field} is invalid`);
  }
  return value;
}

function parseBoundedDecimals(value: unknown, maximum: number, field: string): number {
  const parsed = typeof value === "number" ? value :
    typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value) ? Number(value) : Number.NaN;
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > maximum) {
    throw new Error(`Postgres hedge fee ${field} is invalid`);
  }
  return parsed;
}

function parsePositiveDecimalValue(value: unknown, field: string): string {
  assertPositiveDecimal(value, 18, field);
  return value;
}

function buildFillUpsert(
  hedgeOrderId: string,
  symbol: string,
  fills: readonly CexTradeFill[],
): { sql: string; params: unknown[] } {
  const params: unknown[] = [];
  const values = fills.map((fill) => {
    const start = params.length + 1;
    params.push(
      hedgeOrderId, "binance", symbol, fill.venueOrderId, fill.venueTradeId,
      fill.price, fill.quantity, fill.quoteQuantity, fill.commissionQuantity,
      fill.commissionAsset, fill.executedAt, fill.isBuyer, fill.isMaker,
    );
    return `(${Array.from({ length: 13 }, (_, index) => `$${start + index}`).join(", ")})`;
  });
  return {
    sql: `INSERT INTO hedge_execution_fills (
            hedge_order_id, venue, venue_symbol, venue_order_id, venue_trade_id,
            price, base_quantity, quote_quantity, commission_quantity, commission_asset,
            executed_at, is_buyer, is_maker
          ) VALUES ${values.join(", ")}
          ON CONFLICT (hedge_order_id, venue_trade_id) DO UPDATE
          SET venue_trade_id = EXCLUDED.venue_trade_id
          WHERE hedge_execution_fills.venue = EXCLUDED.venue
            AND hedge_execution_fills.venue_symbol = EXCLUDED.venue_symbol
            AND hedge_execution_fills.venue_order_id = EXCLUDED.venue_order_id
            AND hedge_execution_fills.price = EXCLUDED.price
            AND hedge_execution_fills.base_quantity = EXCLUDED.base_quantity
            AND hedge_execution_fills.quote_quantity = EXCLUDED.quote_quantity
            AND hedge_execution_fills.commission_quantity = EXCLUDED.commission_quantity
            AND hedge_execution_fills.commission_asset = EXCLUDED.commission_asset
            AND hedge_execution_fills.executed_at = EXCLUDED.executed_at
            AND hedge_execution_fills.is_buyer = EXCLUDED.is_buyer
            AND hedge_execution_fills.is_maker = EXCLUDED.is_maker
          RETURNING venue_trade_id`,
    params,
  };
}

function parseFeeJob(row: unknown): HedgeFeeReconciliationJob {
  if (typeof row !== "object" || row === null || Array.isArray(row)) {
    throw new Error("Postgres hedge fee job row must be an object");
  }
  const value = row as Record<string, unknown>;
  const side = value.side;
  if (side !== "buy" && side !== "sell") throw new Error("Postgres hedge fee job side is invalid");
  const symbol = value.venue_symbol;
  if (typeof symbol !== "string" || !/^[A-Z0-9._-]{3,32}$/.test(symbol)) {
    throw new Error("Postgres hedge fee job venue_symbol is invalid");
  }
  const clientOrderId = value.client_order_id;
  if (typeof clientOrderId !== "string" || !/^[A-Za-z0-9._-]{1,36}$/.test(clientOrderId)) {
    throw new Error("Postgres hedge fee job client_order_id is invalid");
  }
  const venueOrderId = value.venue_order_id;
  if (venueOrderId !== null && venueOrderId !== undefined) assertVenueId(venueOrderId, "venue_order_id");
  const executedQuoteQuantity = value.executed_quote_quantity;
  if (executedQuoteQuantity !== null && executedQuoteQuantity !== undefined) {
    assertPositiveDecimal(executedQuoteQuantity, 18, "executed_quote_quantity");
  }
  return {
    hedgeOrderId: parseIdentifier(value.id, "id"),
    chainId: parsePositiveSafeInteger(value.chain_id, "chain_id"),
    token: parseAddress(value.token_address),
    side,
    amount: parsePositiveUInt(value.amount, "amount"),
    filledAmount: parsePositiveUInt(value.filled_amount, "filled_amount"),
    ...(typeof executedQuoteQuantity === "string" ? { executedQuoteQuantity } : {}),
    symbol,
    clientOrderId,
    ...(typeof venueOrderId === "string" ? { venueOrderId } : {}),
    attemptCount: parseNonNegativeSafeInteger(value.fee_attempt_count, "fee_attempt_count"),
    createdAt: parseTimestamp(value.created_at),
  };
}

function assertFillSet(fills: readonly CexTradeFill[], venueOrderId: string): void {
  if (!Array.isArray(fills) || fills.length === 0 || fills.length > 100_000) {
    throw new Error("HEDGE_TRADE_FILLS_INCOMPLETE");
  }
  const tradeIds = new Set<string>();
  for (const fill of fills) {
    assertCexTradeFill(fill);
    if (fill.venueOrderId !== venueOrderId || tradeIds.has(fill.venueTradeId)) {
      throw new Error("HEDGE_TRADE_FILL_INVALID");
    }
    tradeIds.add(fill.venueTradeId);
  }
}

function assertLeaseMutation(hedgeOrderId: string, workerId: string): void {
  assertSafeIdentifier(hedgeOrderId, "hedgeOrderId");
  assertSafeIdentifier(workerId, "workerId");
}

function assertSafeIdentifier(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 128 ||
      !/^[A-Za-z0-9_:-]+$/.test(value)) {
    throw new Error(`Hedge fee ${field} must be a safe identifier`);
  }
}

function assertVenueId(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || !/^[1-9][0-9]{0,15}$/.test(value) ||
      !Number.isSafeInteger(Number(value))) {
    throw new Error(`Hedge fee ${field} must be a positive safe integer string`);
  }
}

function assertPositiveDecimal(value: unknown, maxFractionDigits: number, field: string): asserts value is string {
  if (typeof value !== "string") throw new Error(`Hedge fee ${field} must be a positive decimal string`);
  const match = value.match(/^(0|[1-9][0-9]*)(?:\.([0-9]+))?$/);
  if (!match || match[1].length > 60 || (match[2]?.length ?? 0) > maxFractionDigits ||
      /^0(?:\.0+)?$/.test(value)) {
    throw new Error(`Hedge fee ${field} must be a positive decimal string`);
  }
}

function assertPositiveUInt(value: unknown, field: string): asserts value is UIntString {
  if (typeof value !== "string" || !/^[1-9][0-9]*$/.test(value)) {
    throw new Error(`Hedge fee ${field} must be a canonical positive uint string`);
  }
}

function parsePositiveUInt(value: unknown, field: string): UIntString {
  assertPositiveUInt(value, field);
  return value;
}

function parseIdentifier(value: unknown, field: string): string {
  assertSafeIdentifier(value, field);
  return value;
}

function parseAddress(value: unknown): Address {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new Error("Postgres hedge fee token_address must be a 20-byte hex address");
  }
  return value as Address;
}

function parsePositiveSafeInteger(value: unknown, field: string): number {
  const parsed = typeof value === "number" ? value :
    typeof value === "string" && /^[1-9][0-9]*$/.test(value) ? Number(value) : Number.NaN;
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`Postgres hedge fee ${field} must be a positive safe integer`);
  }
  return parsed;
}

function parseNonNegativeSafeInteger(value: unknown, field: string): number {
  const parsed = typeof value === "number" ? value :
    typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value) ? Number(value) : Number.NaN;
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`Postgres hedge fee ${field} must be a non-negative safe integer`);
  }
  return parsed;
}

function parseTimestamp(value: unknown): string {
  const timestamp = value instanceof Date ? value.toISOString() : value;
  if (typeof timestamp !== "string" || !isCanonicalUtcIsoTimestamp(timestamp)) {
    throw new Error("Postgres hedge fee created_at must be a canonical UTC ISO timestamp");
  }
  return timestamp;
}

function parseOptionalTimestamp(value: unknown, field: string): string | undefined {
  if (value === null || value === undefined) return undefined;
  const timestamp = value instanceof Date ? value.toISOString() : value;
  if (typeof timestamp !== "string" || !isCanonicalUtcIsoTimestamp(timestamp)) {
    throw new Error(`Postgres hedge fee ${field} must be a canonical UTC ISO timestamp`);
  }
  return timestamp;
}

function assertErrorCode(value: string): void {
  if (typeof value !== "string" || !/^[A-Z0-9_:-]{1,128}$/.test(value)) {
    throw new Error("Hedge fee errorCode is invalid");
  }
}

function assertBoundedInteger(value: number, field: string, min: number, max: number): void {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`Hedge fee ${field} must be a safe integer between ${min} and ${max}`);
  }
}

function assertPool(pool: unknown): asserts pool is pg.Pool {
  if (typeof pool !== "object" || pool === null || Array.isArray(pool) ||
      typeof (pool as Record<string, unknown>).connect !== "function") {
    throw new Error("Postgres hedge fee pool.connect must be a function");
  }
}

async function rollbackBestEffort(client: pg.PoolClient): Promise<void> {
  try {
    await client.query("ROLLBACK");
  } catch {}
}
