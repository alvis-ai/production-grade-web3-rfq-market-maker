import pg from "pg";
import {
  quoteSnapshotPnlModelDescription,
  hedgeFillNetPnlModelDescription,
  type Address,
  type HedgeNetPnlRecord,
  type IntString,
  type PnlSummaryResponse,
  type PnlTradeRecord,
  type UIntString,
} from "../../shared/types/rfq.js";
import { isCanonicalUtcIsoTimestamp } from "../../shared/validation/timestamp.js";
import { normalizeHumanPrice } from "../pricing/price-normalization.js";
import { assertPrincipalId } from "../../shared/validation/principal-id.js";
import {
  buildPnlSummary,
  buildPnlTradeRecord,
  clonePnlTradeRecord,
  matchesPnlInput,
  normalizeRemovePnlRecordInput,
  unavailableHedgeRecord,
  type PnlStore,
  type PnlValuationProvider,
  type RecordPnlInput,
  type RemovePnlRecordInput,
  type RemovePnlRecordResult,
} from "./pnl.service.js";

const pnlColumns = `
  id, quote_id, settlement_event_id, snapshot_id, chain_id, user_address, token_in, token_out,
  amount_in, amount_out, min_amount_out, nonce, deadline,
  mid_price, token_in_decimals, token_out_decimals, fair_amount_out, valuation_observed_at,
  gross_pnl_token_out, gross_pnl_bps, model, model_description, realized_at
`;
const qualifiedPnlColumns = pnlColumns
  .split(",")
  .map((column) => `pnl.${column.trim()}`)
  .join(", ");
const hedgeNetColumns = `
  hedge.id AS hedge_order_id,
  hedge.status AS hedge_status,
  hedge.filled_amount::text AS hedge_filled_amount,
  hedge.fee_reconciliation_status AS hedge_fee_reconciliation_status,
  hedge.route_accounting_version AS hedge_route_accounting_version,
  hedge.venue_quote_asset AS hedge_valuation_asset,
  hedge.venue_quote_token_address AS hedge_valuation_token,
  hedge.hedge_net_pnl_model AS hedge_net_model,
  hedge.hedge_net_pnl_model_description AS hedge_net_model_description,
  hedge.hedge_net_pnl_status AS hedge_net_status,
  hedge.hedge_net_pnl_quote_quantity::text AS hedge_net_quantity,
  hedge.hedge_net_pnl_reason_code AS hedge_net_reason_code,
  hedge.hedge_unvalued_commission_assets AS hedge_unvalued_commission_assets,
  hedge.hedge_net_pnl_realized_at AS hedge_net_realized_at
`;

export class PostgresPnlStore implements PnlStore {
  private readonly valuationProvider: PnlValuationProvider;

  constructor(
    private readonly pool: pg.Pool,
    valuationProvider: PnlValuationProvider,
  ) {
    assertPool(pool);
    assertValuationProvider(valuationProvider);
    this.valuationProvider = { resolve: valuationProvider.resolve.bind(valuationProvider) };
  }

  async checkHealth(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("SELECT 1 FROM pnl_records LIMIT 1");
    } finally {
      client.release();
    }
  }

  async recordSettlement(input: RecordPnlInput): Promise<PnlTradeRecord> {
    const expected = buildPnlTradeRecord(input, await this.valuationProvider.resolve(input));
    const client = await this.pool.connect();
    try {
      const inserted = await client.query(
        `INSERT INTO pnl_records (
           id, quote_id, settlement_event_id, snapshot_id, chain_id, user_address, token_in, token_out,
           amount_in, amount_out, min_amount_out, nonce, deadline,
           mid_price, token_in_decimals, token_out_decimals, fair_amount_out, valuation_observed_at,
           gross_pnl_token_out, gross_pnl_bps, model, model_description, realized_at
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
           $14, $15, $16, $17, $18, $19, $20, $21, $22, $23
         )
         ON CONFLICT (quote_id, model) DO NOTHING
         RETURNING ${pnlColumns}`,
        pnlParams(expected),
      );
      let record: PnlTradeRecord;
      if (inserted.rows.length === 1) {
        record = parsePnlRow(inserted.rows[0]);
      } else if (inserted.rows.length === 0) {
        const existing = await client.query(
          `SELECT ${pnlColumns} FROM pnl_records WHERE quote_id = $1 AND model = $2`,
          [expected.quoteId, expected.model],
        );
        if (existing.rows.length !== 1) throw new Error(`Postgres PnL conflict for ${expected.pnlId}`);
        record = parsePnlRow(existing.rows[0]);
      } else {
        throw new Error("Postgres PnL insert returned multiple rows");
      }
      if (!matchesPnlInput(record, input) || !pnlAttributionMatches(record, expected)) {
        throw new Error(`Postgres PnL record conflict for ${expected.pnlId}`);
      }
      return clonePnlTradeRecord(record);
    } finally {
      client.release();
    }
  }

  async getPnlRecordByQuoteId(quoteId: string): Promise<PnlTradeRecord | undefined> {
    const normalized = normalizeRemovePnlRecordInput({ quoteId });
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `SELECT ${pnlColumns} FROM pnl_records WHERE quote_id = $1 AND model = $2`,
        [normalized.quoteId, normalized.model],
      );
      if (result.rows.length > 1) throw new Error(`Postgres PnL lookup returned multiple rows for ${quoteId}`);
      return result.rows[0] ? parsePnlRow(result.rows[0]) : undefined;
    } finally {
      client.release();
    }
  }

  async removePnlRecord(input: RemovePnlRecordInput): Promise<RemovePnlRecordResult> {
    const normalized = normalizeRemovePnlRecordInput(input);
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `DELETE FROM pnl_records WHERE quote_id = $1 AND model = $2 RETURNING ${pnlColumns}`,
        [normalized.quoteId, normalized.model],
      );
      if (result.rows.length === 0) return { removed: false };
      if (result.rows.length !== 1) throw new Error("Postgres PnL removal returned multiple rows");
      return { record: parsePnlRow(result.rows[0]), removed: true };
    } finally {
      client.release();
    }
  }

  async summary(principalId?: string): Promise<PnlSummaryResponse> {
    if (principalId !== undefined) assertPrincipalId(principalId, "Postgres PnL summary principalId");
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `SELECT ${qualifiedPnlColumns}, ${hedgeNetColumns}
         FROM pnl_records pnl
         LEFT JOIN hedge_orders hedge ON hedge.quote_id = pnl.quote_id
         ${principalId === undefined ? "" : "JOIN quotes quote ON quote.id = pnl.quote_id"}
         ${principalId === undefined ? "" : "WHERE quote.principal_id = $1"}
         ORDER BY pnl.realized_at ASC, pnl.id ASC`,
        principalId === undefined ? [] : [principalId],
      );
      const trades = result.rows.map(parsePnlRow);
      return buildPnlSummary(trades, result.rows.map((row, index) => parseHedgeNetPnlRow(row, trades[index]!)));
    } finally {
      client.release();
    }
  }
}

function parseHedgeNetPnlRow(row: unknown, trade: PnlTradeRecord): HedgeNetPnlRecord {
  if (typeof row !== "object" || row === null || Array.isArray(row)) {
    throw new Error("Postgres hedge net PnL row must be an object");
  }
  const value = row as Record<string, unknown>;
  if (value.hedge_order_id === null || value.hedge_order_id === undefined) {
    return unavailableHedgeRecord(trade, "HEDGE_EVIDENCE_MISSING");
  }
  const hedgeOrderId = parseIdentifier(value.hedge_order_id, "hedge_order_id");
  if (value.hedge_route_accounting_version === null || value.hedge_route_accounting_version === undefined) {
    return unavailableHedgeRecord(trade, "LEGACY_ROUTE_ACCOUNTING_UNAVAILABLE", hedgeOrderId);
  }
  if (value.hedge_route_accounting_version !== "venue-assets-v1" ||
      value.hedge_net_model !== "hedge_fill_net_v1" ||
      value.hedge_net_model_description !== hedgeFillNetPnlModelDescription) {
    throw new Error("Postgres hedge net PnL accounting metadata is invalid");
  }
  const valuationToken = parseAddress(value.hedge_valuation_token, "hedge_valuation_token").toLowerCase() as Address;
  const valuationAsset = parseVenueAsset(value.hedge_valuation_asset, "hedge_valuation_asset");
  const common = {
    quoteId: trade.quoteId,
    chainId: trade.chainId,
    hedgeOrderId,
    model: "hedge_fill_net_v1" as const,
    modelDescription: hedgeFillNetPnlModelDescription,
    valuationToken,
    valuationAsset,
  };
  if (value.hedge_net_status === "pending") {
    if (value.hedge_status === "failed" &&
        (value.hedge_filled_amount === null || value.hedge_filled_amount === undefined) &&
        (value.hedge_fee_reconciliation_status === null || value.hedge_fee_reconciliation_status === undefined)) {
      return { ...common, status: "unavailable", reasonCode: "HEDGE_NOT_EXECUTED" };
    }
    return { ...common, status: "pending" };
  }
  if (value.hedge_net_status === "complete") {
    return {
      ...common,
      status: "complete",
      netPnlQuoteQuantity: normalizeSignedDecimal(value.hedge_net_quantity, "hedge_net_quantity"),
      realizedAt: parseTimestamp(value.hedge_net_realized_at, "hedge_net_realized_at"),
    };
  }
  if (value.hedge_net_status === "unavailable") {
    const reasonCode = value.hedge_net_reason_code;
    if (reasonCode !== "UNVALUED_COMMISSION_ASSET" && reasonCode !== "HEDGE_NOT_EXECUTED" &&
        reasonCode !== "PARTIAL_HEDGE_UNCLOSED") {
      throw new Error("Postgres hedge net PnL reason code is invalid");
    }
    const assets = parseStringArray(value.hedge_unvalued_commission_assets, "hedge_unvalued_commission_assets");
    if ((reasonCode === "UNVALUED_COMMISSION_ASSET") !== (assets.length > 0)) {
      throw new Error("Postgres hedge net PnL unavailable assets are inconsistent");
    }
    return {
      ...common,
      status: "unavailable",
      reasonCode,
      ...(assets.length === 0 ? {} : { unvaluedCommissionAssets: assets }),
      realizedAt: parseTimestamp(value.hedge_net_realized_at, "hedge_net_realized_at"),
    };
  }
  throw new Error("Postgres hedge net PnL status is invalid");
}

function parseVenueAsset(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^[A-Z0-9._-]{1,32}$/.test(value)) {
    throw new Error(`Postgres PnL row ${field} is invalid`);
  }
  return value;
}

function normalizeSignedDecimal(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length > 98) {
    throw new Error(`Postgres PnL row ${field} must be a signed decimal`);
  }
  const match = value.match(/^(-?)(0|[1-9][0-9]*)(?:\.([0-9]{1,18}))?$/);
  if (!match) throw new Error(`Postgres PnL row ${field} must be a signed decimal`);
  const fraction = (match[3] ?? "").replace(/0+$/, "");
  const normalized = `${match[1]}${match[2]}${fraction.length === 0 ? "" : `.${fraction}`}`;
  return normalized === "-0" ? "0" : normalized;
}

function parseStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.length > 32) throw new Error(`Postgres PnL row ${field} must be an array`);
  const result = value.map((item) => {
    if (typeof item !== "string" || !/^[A-Z0-9._-]{1,32}$/.test(item)) {
      throw new Error(`Postgres PnL row ${field} contains an invalid asset`);
    }
    return item;
  });
  if (new Set(result).size !== result.length || result.some((item, index) => index > 0 && result[index - 1]! > item)) {
    throw new Error(`Postgres PnL row ${field} must be unique and sorted`);
  }
  return result;
}

function pnlParams(record: PnlTradeRecord): unknown[] {
  return [
    record.pnlId,
    record.quoteId,
    record.settlementEventId,
    record.snapshotId,
    record.chainId,
    record.user,
    record.tokenIn,
    record.tokenOut,
    record.amountIn,
    record.amountOut,
    record.minAmountOut,
    record.nonce,
    record.deadline,
    record.midPrice,
    record.tokenInDecimals,
    record.tokenOutDecimals,
    record.fairAmountOut,
    record.valuationObservedAt,
    record.grossPnlTokenOut,
    record.grossPnlBps,
    record.model,
    record.modelDescription,
    record.realizedAt,
  ];
}

function pnlAttributionMatches(left: PnlTradeRecord, right: PnlTradeRecord): boolean {
  return left.pnlId === right.pnlId &&
    left.settlementEventId === right.settlementEventId &&
    left.snapshotId === right.snapshotId &&
    left.midPrice === right.midPrice &&
    left.tokenInDecimals === right.tokenInDecimals &&
    left.tokenOutDecimals === right.tokenOutDecimals &&
    left.fairAmountOut === right.fairAmountOut &&
    left.valuationObservedAt === right.valuationObservedAt &&
    left.grossPnlTokenOut === right.grossPnlTokenOut &&
    left.grossPnlBps === right.grossPnlBps &&
    left.model === right.model &&
    left.modelDescription === right.modelDescription &&
    left.realizedAt === right.realizedAt;
}

function parsePnlRow(row: unknown): PnlTradeRecord {
  if (typeof row !== "object" || row === null || Array.isArray(row)) {
    throw new Error("Postgres PnL row must be an object");
  }
  const value = row as Record<string, unknown>;
  if (value.model !== "quote_snapshot_edge_v1") {
    throw new Error("Postgres PnL row model is invalid");
  }
  if (value.model_description !== quoteSnapshotPnlModelDescription) {
    throw new Error("Postgres PnL row model_description is invalid");
  }
  const record: PnlTradeRecord = {
    pnlId: parseIdentifier(value.id, "id"),
    quoteId: parseIdentifier(value.quote_id, "quote_id"),
    settlementEventId: parseIdentifier(value.settlement_event_id, "settlement_event_id"),
    snapshotId: parseIdentifier(value.snapshot_id, "snapshot_id"),
    chainId: parsePositiveSafeInteger(value.chain_id, "chain_id"),
    user: parseAddress(value.user_address, "user_address"),
    tokenIn: parseAddress(value.token_in, "token_in"),
    tokenOut: parseAddress(value.token_out, "token_out"),
    amountIn: parsePositiveUInt(value.amount_in, "amount_in"),
    amountOut: parsePositiveUInt(value.amount_out, "amount_out"),
    minAmountOut: parsePositiveUInt(value.min_amount_out, "min_amount_out"),
    nonce: parsePositiveUInt(value.nonce, "nonce"),
    deadline: parsePositiveSafeInteger(value.deadline, "deadline"),
    midPrice: parsePositiveDecimal(value.mid_price, "mid_price"),
    tokenInDecimals: parseTokenDecimals(value.token_in_decimals, "token_in_decimals"),
    tokenOutDecimals: parseTokenDecimals(value.token_out_decimals, "token_out_decimals"),
    fairAmountOut: parsePositiveUInt(value.fair_amount_out, "fair_amount_out"),
    valuationObservedAt: parseTimestamp(value.valuation_observed_at, "valuation_observed_at"),
    grossPnlTokenOut: parseIntString(value.gross_pnl_token_out, "gross_pnl_token_out"),
    grossPnlBps: parseSafeInteger(value.gross_pnl_bps, "gross_pnl_bps"),
    model: value.model,
    modelDescription: value.model_description,
    realizedAt: parseTimestamp(value.realized_at, "realized_at"),
  };
  const expected = buildPnlTradeRecord({
    quoteId: record.quoteId,
    settlementEventId: record.settlementEventId,
    snapshotId: record.snapshotId,
    realizedAt: record.realizedAt,
    quote: {
      user: record.user,
      tokenIn: record.tokenIn,
      tokenOut: record.tokenOut,
      amountIn: record.amountIn,
      amountOut: record.amountOut,
      minAmountOut: record.minAmountOut,
      nonce: record.nonce,
      deadline: record.deadline,
      chainId: record.chainId,
    },
  }, {
    snapshotId: record.snapshotId,
    midPrice: record.midPrice,
    tokenInDecimals: record.tokenInDecimals,
    tokenOutDecimals: record.tokenOutDecimals,
    observedAt: record.valuationObservedAt,
  });
  if (!pnlAttributionMatches(record, expected)) {
    throw new Error("Postgres PnL row attribution is inconsistent");
  }
  return record;
}

function parseIdentifier(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 128 || !/^[A-Za-z0-9_:-]+$/.test(value)) {
    throw new Error(`Postgres PnL row ${field} must be a safe identifier`);
  }
  return value;
}

function parseAddress(value: unknown, field: string): Address {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new Error(`Postgres PnL row ${field} must be a 20-byte hex address`);
  }
  return value as Address;
}

function parsePositiveUInt(value: unknown, field: string): UIntString {
  if (typeof value !== "string" || !/^[1-9][0-9]*$/.test(value)) {
    throw new Error(`Postgres PnL row ${field} must be a canonical positive uint string`);
  }
  return value as UIntString;
}

function parsePositiveDecimal(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new Error(`Postgres PnL row ${field} must be a positive canonical decimal`);
  }
  try {
    normalizeHumanPrice(value);
  } catch {
    throw new Error(`Postgres PnL row ${field} must be a positive canonical decimal`);
  }
  return value;
}

function parseIntString(value: unknown, field: string): IntString {
  if (typeof value !== "string" || !/^(0|-?[1-9][0-9]*)$/.test(value)) {
    throw new Error(`Postgres PnL row ${field} must be a canonical integer string`);
  }
  return value as IntString;
}

function parsePositiveSafeInteger(value: unknown, field: string): number {
  const parsed = parseSafeInteger(value, field);
  if (parsed <= 0) throw new Error(`Postgres PnL row ${field} must be positive`);
  return parsed;
}

function parseTokenDecimals(value: unknown, field: string): number {
  const parsed = parseSafeInteger(value, field);
  if (parsed < 0 || parsed > 36) {
    throw new Error(`Postgres PnL row ${field} must be between 0 and 36`);
  }
  return parsed;
}

function parseSafeInteger(value: unknown, field: string): number {
  const parsed = typeof value === "number" ? value :
    typeof value === "string" && /^(0|-?[1-9][0-9]*)$/.test(value) ? Number(value) : Number.NaN;
  if (!Number.isSafeInteger(parsed)) throw new Error(`Postgres PnL row ${field} must be a safe integer`);
  return parsed;
}

function parseTimestamp(value: unknown, field: string): string {
  const timestamp = value instanceof Date ? value.toISOString() : value;
  if (typeof timestamp !== "string" || !isCanonicalUtcIsoTimestamp(timestamp)) {
    throw new Error(`Postgres PnL row ${field} must be a canonical UTC ISO timestamp`);
  }
  return timestamp;
}

function assertPool(pool: unknown): asserts pool is pg.Pool {
  if (typeof pool !== "object" || pool === null || Array.isArray(pool) ||
      typeof (pool as Record<string, unknown>).connect !== "function") {
    throw new Error("Postgres PnL pool.connect must be a function");
  }
}

function assertValuationProvider(value: unknown): asserts value is PnlValuationProvider {
  if (typeof value !== "object" || value === null || Array.isArray(value) ||
      typeof (value as Record<string, unknown>).resolve !== "function") {
    throw new Error("Postgres PnL valuationProvider.resolve must be a function");
  }
}
