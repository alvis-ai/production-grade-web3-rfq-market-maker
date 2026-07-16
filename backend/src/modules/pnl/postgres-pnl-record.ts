import {
  hedgeFillNetPnlModelDescription,
  quoteSnapshotPnlModelDescription,
  type Address,
  type HedgeNetPnlRecord,
  type IntString,
  type PnlTradeRecord,
  type UIntString,
} from "../../shared/types/rfq.js";
import { isCanonicalUtcIsoTimestamp } from "../../shared/validation/timestamp.js";
import { normalizeHumanPrice } from "../pricing/price-normalization.js";
import { buildPnlTradeRecord, unavailableHedgeRecord } from "./pnl.service.js";

export function parseHedgeNetPnlRow(row: unknown, trade: PnlTradeRecord): HedgeNetPnlRecord {
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

export function parsePnlRow(row: unknown): PnlTradeRecord {
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

export function pnlAttributionMatches(left: PnlTradeRecord, right: PnlTradeRecord): boolean {
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

export function parseAddress(value: unknown, field: string): Address {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new Error(`Postgres PnL row ${field} must be a 20-byte hex address`);
  }
  return value as Address;
}

export function parseIntString(value: unknown, field: string): IntString {
  if (typeof value !== "string" || !/^(0|-?[1-9][0-9]*)$/.test(value)) {
    throw new Error(`Postgres PnL row ${field} must be a canonical integer string`);
  }
  return value as IntString;
}

export function parsePositiveSafeInteger(value: unknown, field: string): number {
  const parsed = parseSafeInteger(value, field);
  if (parsed <= 0) throw new Error(`Postgres PnL row ${field} must be positive`);
  return parsed;
}

export function parseSafeInteger(value: unknown, field: string): number {
  const parsed = typeof value === "number" ? value :
    typeof value === "string" && /^(0|-?[1-9][0-9]*)$/.test(value) ? Number(value) : Number.NaN;
  if (!Number.isSafeInteger(parsed)) throw new Error(`Postgres PnL row ${field} must be a safe integer`);
  return parsed;
}

export function parseTimestamp(value: unknown, field: string): string {
  const timestamp = value instanceof Date ? value.toISOString() : value;
  if (typeof timestamp !== "string" || !isCanonicalUtcIsoTimestamp(timestamp)) {
    throw new Error(`Postgres PnL row ${field} must be a canonical UTC ISO timestamp`);
  }
  return timestamp;
}

export function parseVenueAsset(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^[A-Z0-9._-]{1,32}$/.test(value)) {
    throw new Error(`Postgres PnL row ${field} is invalid`);
  }
  return value;
}

export function normalizeSignedDecimal(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length > 98) {
    throw new Error(`Postgres PnL row ${field} must be a signed decimal`);
  }
  const match = value.match(/^(-?)(0|[1-9][0-9]*)(?:\.([0-9]{1,18}))?$/);
  if (!match) throw new Error(`Postgres PnL row ${field} must be a signed decimal`);
  const fraction = (match[3] ?? "").replace(/0+$/, "");
  const normalized = `${match[1]}${match[2]}${fraction.length === 0 ? "" : `.${fraction}`}`;
  return normalized === "-0" ? "0" : normalized;
}

function parseIdentifier(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 128 || !/^[A-Za-z0-9_:-]+$/.test(value)) {
    throw new Error(`Postgres PnL row ${field} must be a safe identifier`);
  }
  return value;
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

function parseTokenDecimals(value: unknown, field: string): number {
  const parsed = parseSafeInteger(value, field);
  if (parsed < 0 || parsed > 36) {
    throw new Error(`Postgres PnL row ${field} must be between 0 and 36`);
  }
  return parsed;
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
