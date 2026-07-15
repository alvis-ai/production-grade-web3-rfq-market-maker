import {
  assertOwnResponseFields,
  isAddressHex,
  isIntString,
  isIsoUtcTimestampString,
  isNonNegativeSafeInteger,
  isPositiveDecimalString,
  isPositiveSafeInteger,
  isPositiveUIntString,
  isRecord,
  isSafeIdentifier,
  isSafeInteger,
  isTokenDecimals,
  malformedFieldError,
} from "./client-response-validation.js";
import type {
  HedgeNetPnlRecord,
  HedgeNetPnlSummary,
  HedgeNetPnlTotal,
  PnlSummary,
  PnlTokenTotal,
  PnlTradeRecord,
} from "./types.js";

const pnlSummaryFields = ["status", "totalTrades", "totals", "trades", "hedgeNet"] as const;
const pnlTokenTotalFields = ["chainId", "tokenOut", "totalTrades", "grossPnlTokenOut"] as const;
const hedgeNetSummaryFields = [
  "model", "modelDescription", "totalTrades", "completeTrades", "pendingTrades", "unavailableTrades", "totals", "records",
] as const;
const hedgeNetTotalFields = [
  "chainId", "valuationToken", "valuationAsset", "totalTrades", "netPnlQuoteQuantity",
] as const;
const hedgeNetRecordCommonFields = ["quoteId", "chainId", "status", "model", "modelDescription"] as const;
const pnlTradeRecordFields = [
  "pnlId", "quoteId", "settlementEventId", "snapshotId", "chainId", "user", "tokenIn", "tokenOut", "amountIn",
  "amountOut", "minAmountOut", "nonce", "deadline", "midPrice", "tokenInDecimals", "tokenOutDecimals",
  "fairAmountOut", "valuationObservedAt", "grossPnlTokenOut", "grossPnlBps", "model", "modelDescription", "realizedAt",
] as const;

export function assertPnlSummary(payload: unknown, status: number): asserts payload is PnlSummary {
  const label = "RFQ PnL summary response";
  if (!isRecord(payload)) throw malformedFieldError(status, label, "status");
  assertOwnResponseFields(payload, pnlSummaryFields, [], status, label);
  if (payload.status !== "ok") throw malformedFieldError(status, label, "status");
  if (!isNonNegativeSafeInteger(payload.totalTrades)) throw malformedFieldError(status, label, "totalTrades");
  if (!Array.isArray(payload.totals)) throw malformedFieldError(status, label, "totals");
  if (!Array.isArray(payload.trades)) throw malformedFieldError(status, label, "trades");
  if (payload.totalTrades !== payload.trades.length) throw malformedFieldError(status, label, "totalTrades");

  const expectedTotals = new Map<string, { totalTrades: number; grossPnl: bigint }>();
  for (const trade of payload.trades) {
    assertPnlTradeRecord(trade, status);
    const key = pnlTokenKey(trade.chainId, trade.tokenOut);
    const current = expectedTotals.get(key) ?? { totalTrades: 0, grossPnl: 0n };
    current.totalTrades += 1;
    current.grossPnl += BigInt(trade.grossPnlTokenOut);
    expectedTotals.set(key, current);
  }

  if (payload.totals.length !== expectedTotals.size) throw malformedFieldError(status, label, "totals");
  const seenTotals = new Set<string>();
  for (const total of payload.totals) {
    assertPnlTokenTotal(total, status);
    const key = pnlTokenKey(total.chainId, total.tokenOut);
    if (seenTotals.has(key)) throw malformedFieldError(status, label, "totals");
    seenTotals.add(key);
    const expected = expectedTotals.get(key);
    if (!expected || total.totalTrades !== expected.totalTrades ||
        BigInt(total.grossPnlTokenOut) !== expected.grossPnl) {
      throw malformedFieldError(status, label, "totals");
    }
  }
  assertHedgeNetPnlSummary(payload.hedgeNet, payload.trades, status);
}

function assertHedgeNetPnlSummary(
  payload: unknown,
  trades: PnlTradeRecord[],
  status: number,
): asserts payload is HedgeNetPnlSummary {
  const label = "RFQ hedge net PnL summary response";
  if (!isRecord(payload)) throw malformedFieldError(status, label, "model");
  assertOwnResponseFields(payload, hedgeNetSummaryFields, [], status, label);
  assertHedgeNetModel(payload, status, label);
  for (const field of ["totalTrades", "completeTrades", "pendingTrades", "unavailableTrades"] as const) {
    if (!isNonNegativeSafeInteger(payload[field])) throw malformedFieldError(status, label, field);
  }
  if (!Array.isArray(payload.records) || !Array.isArray(payload.totals) || payload.totalTrades !== trades.length ||
      payload.records.length !== trades.length) throw malformedFieldError(status, label, "totalTrades");
  const tradeByQuote = new Map(trades.map((trade) => [trade.quoteId, trade]));
  const seen = new Set<string>();
  const counts = { complete: 0, pending: 0, unavailable: 0 };
  const expectedTotals = new Map<string, { totalTrades: number; netScaled: bigint }>();
  for (const record of payload.records) {
    assertHedgeNetPnlRecord(record, status);
    const trade = tradeByQuote.get(record.quoteId);
    if (!trade || trade.chainId !== record.chainId || seen.has(record.quoteId)) {
      throw malformedFieldError(status, label, "records");
    }
    seen.add(record.quoteId);
    counts[record.status] += 1;
    if (record.status === "complete") {
      const key = hedgeNetKey(record.chainId, record.valuationToken!, record.valuationAsset!);
      const current = expectedTotals.get(key) ?? { totalTrades: 0, netScaled: 0n };
      current.totalTrades += 1;
      current.netScaled += signedDecimalToScale18(record.netPnlQuoteQuantity!);
      expectedTotals.set(key, current);
    }
  }
  if (payload.completeTrades !== counts.complete || payload.pendingTrades !== counts.pending ||
      payload.unavailableTrades !== counts.unavailable ||
      counts.complete + counts.pending + counts.unavailable !== payload.totalTrades) {
    throw malformedFieldError(status, label, "completeTrades");
  }
  if (payload.totals.length !== expectedTotals.size) throw malformedFieldError(status, label, "totals");
  const seenTotals = new Set<string>();
  for (const total of payload.totals) {
    assertHedgeNetPnlTotal(total, status);
    const key = hedgeNetKey(total.chainId, total.valuationToken, total.valuationAsset);
    const expected = expectedTotals.get(key);
    if (!expected || seenTotals.has(key) || expected.totalTrades !== total.totalTrades ||
        expected.netScaled !== signedDecimalToScale18(total.netPnlQuoteQuantity)) {
      throw malformedFieldError(status, label, "totals");
    }
    seenTotals.add(key);
  }
}

function assertHedgeNetPnlRecord(payload: unknown, status: number): asserts payload is HedgeNetPnlRecord {
  const label = "RFQ hedge net PnL record";
  if (!isRecord(payload)) throw malformedFieldError(status, label, "quoteId");
  const required = payload.status === "pending"
    ? [...hedgeNetRecordCommonFields, "hedgeOrderId", "valuationToken", "valuationAsset"]
    : payload.status === "complete"
      ? [...hedgeNetRecordCommonFields, "hedgeOrderId", "valuationToken", "valuationAsset", "netPnlQuoteQuantity", "realizedAt"]
      : [...hedgeNetRecordCommonFields, "reasonCode"];
  const optional = payload.status === "unavailable"
    ? ["hedgeOrderId", "valuationToken", "valuationAsset", "unvaluedCommissionAssets", "realizedAt"]
    : [];
  assertOwnResponseFields(payload, required, optional, status, label);
  if (!isSafeIdentifier(payload.quoteId) || !isPositiveSafeInteger(payload.chainId)) {
    throw malformedFieldError(status, label, "quoteId");
  }
  assertHedgeNetModel(payload, status, label);
  if (payload.status !== "pending" && payload.status !== "complete" && payload.status !== "unavailable") {
    throw malformedFieldError(status, label, "status");
  }
  if (payload.hedgeOrderId !== undefined && !isSafeIdentifier(payload.hedgeOrderId)) {
    throw malformedFieldError(status, label, "hedgeOrderId");
  }
  if (payload.valuationToken !== undefined && !isAddressHex(payload.valuationToken)) {
    throw malformedFieldError(status, label, "valuationToken");
  }
  if (payload.valuationAsset !== undefined && !isVenueAsset(payload.valuationAsset)) {
    throw malformedFieldError(status, label, "valuationAsset");
  }
  if (payload.status === "pending" || payload.status === "complete") {
    if (!isSafeIdentifier(payload.hedgeOrderId) || !isAddressHex(payload.valuationToken) ||
        !isVenueAsset(payload.valuationAsset)) throw malformedFieldError(status, label, "hedgeOrderId");
  }
  if (payload.status === "complete") {
    if (!isCanonicalSignedDecimal(payload.netPnlQuoteQuantity) || !isIsoUtcTimestampString(payload.realizedAt)) {
      throw malformedFieldError(status, label, "netPnlQuoteQuantity");
    }
  }
  if (payload.status === "unavailable") {
    const reasons = new Set([
      "HEDGE_EVIDENCE_MISSING", "LEGACY_ROUTE_ACCOUNTING_UNAVAILABLE", "HEDGE_NOT_EXECUTED",
      "PARTIAL_HEDGE_UNCLOSED", "UNVALUED_COMMISSION_ASSET",
    ]);
    if (!reasons.has(String(payload.reasonCode))) throw malformedFieldError(status, label, "reasonCode");
    const assets = payload.unvaluedCommissionAssets;
    if (assets !== undefined && (!Array.isArray(assets) || assets.length === 0 || assets.length > 32 ||
        assets.some((asset) => !isVenueAsset(asset)) || new Set(assets).size !== assets.length ||
        assets.some((asset, index) => index > 0 && assets[index - 1]! > asset))) {
      throw malformedFieldError(status, label, "unvaluedCommissionAssets");
    }
    if ((payload.reasonCode === "UNVALUED_COMMISSION_ASSET") !== (assets !== undefined)) {
      throw malformedFieldError(status, label, "reasonCode");
    }
    if (payload.realizedAt !== undefined && !isIsoUtcTimestampString(payload.realizedAt)) {
      throw malformedFieldError(status, label, "realizedAt");
    }
  }
}

function assertHedgeNetPnlTotal(payload: unknown, status: number): asserts payload is HedgeNetPnlTotal {
  const label = "RFQ hedge net PnL total";
  if (!isRecord(payload)) throw malformedFieldError(status, label, "chainId");
  assertOwnResponseFields(payload, hedgeNetTotalFields, [], status, label);
  if (!isPositiveSafeInteger(payload.chainId) || !isAddressHex(payload.valuationToken) ||
      !isVenueAsset(payload.valuationAsset) || !isPositiveSafeInteger(payload.totalTrades) ||
      !isCanonicalSignedDecimal(payload.netPnlQuoteQuantity)) {
    throw malformedFieldError(status, label, "netPnlQuoteQuantity");
  }
}

function assertHedgeNetModel(payload: Record<string, unknown>, status: number, label: string): void {
  if (payload.model !== "hedge_fill_net_v1" || payload.modelDescription !==
      "Net hedge execution PnL in the route quote asset using exact fills, quote/base commissions, and conservatively marked sub-step residual; third-asset commissions are unavailable") {
    throw malformedFieldError(status, label, "model");
  }
}

function assertPnlTokenTotal(payload: unknown, status: number): asserts payload is PnlTokenTotal {
  const label = "RFQ PnL summary response total";
  if (!isRecord(payload)) throw malformedFieldError(status, label, "chainId");
  assertOwnResponseFields(payload, pnlTokenTotalFields, [], status, label);
  if (!isPositiveSafeInteger(payload.chainId)) throw malformedFieldError(status, label, "chainId");
  if (!isAddressHex(payload.tokenOut)) throw malformedFieldError(status, label, "tokenOut");
  if (!isPositiveSafeInteger(payload.totalTrades)) throw malformedFieldError(status, label, "totalTrades");
  if (!isIntString(payload.grossPnlTokenOut)) throw malformedFieldError(status, label, "grossPnlTokenOut");
}

function assertPnlTradeRecord(payload: unknown, status: number): asserts payload is PnlTradeRecord {
  const label = "RFQ PnL summary response trade";
  if (!isRecord(payload)) throw malformedFieldError(status, label, "pnlId");
  assertOwnResponseFields(payload, pnlTradeRecordFields, [], status, label);
  for (const field of ["pnlId", "quoteId", "settlementEventId", "snapshotId"] as const) {
    if (!isSafeIdentifier(payload[field])) throw malformedFieldError(status, label, field);
  }
  if (!isIsoUtcTimestampString(payload.realizedAt)) throw malformedFieldError(status, label, "realizedAt");
  if (!isPositiveSafeInteger(payload.chainId)) throw malformedFieldError(status, label, "chainId");
  if (!isAddressHex(payload.user)) throw malformedFieldError(status, label, "user");
  for (const field of ["tokenIn", "tokenOut"] as const) {
    if (!isAddressHex(payload[field])) throw malformedFieldError(status, label, field);
  }
  const tokenIn = payload.tokenIn;
  const tokenOut = payload.tokenOut;
  if (!isAddressHex(tokenIn) || !isAddressHex(tokenOut)) throw malformedFieldError(status, label, "tokenOut");
  if (tokenIn.toLowerCase() === tokenOut.toLowerCase()) throw malformedFieldError(status, label, "tokenOut");
  for (const field of ["amountIn", "amountOut", "minAmountOut", "nonce"] as const) {
    if (!isPositiveUIntString(payload[field])) throw malformedFieldError(status, label, field);
  }
  const amountIn = payload.amountIn;
  const amountOut = payload.amountOut;
  const minAmountOut = payload.minAmountOut;
  if (!isPositiveUIntString(amountOut) || !isPositiveUIntString(minAmountOut)) {
    throw malformedFieldError(status, label, "amountOut");
  }
  if (BigInt(amountOut) < BigInt(minAmountOut)) throw malformedFieldError(status, label, "amountOut");
  if (!isPositiveSafeInteger(payload.deadline)) throw malformedFieldError(status, label, "deadline");
  if (!isPositiveDecimalString(payload.midPrice)) throw malformedFieldError(status, label, "midPrice");
  if (!isTokenDecimals(payload.tokenInDecimals)) throw malformedFieldError(status, label, "tokenInDecimals");
  if (!isTokenDecimals(payload.tokenOutDecimals)) throw malformedFieldError(status, label, "tokenOutDecimals");
  if (!isPositiveUIntString(payload.fairAmountOut)) throw malformedFieldError(status, label, "fairAmountOut");
  if (!isIsoUtcTimestampString(payload.valuationObservedAt)) {
    throw malformedFieldError(status, label, "valuationObservedAt");
  }
  if (!isIntString(payload.grossPnlTokenOut)) throw malformedFieldError(status, label, "grossPnlTokenOut");
  if (!isSafeInteger(payload.grossPnlBps)) throw malformedFieldError(status, label, "grossPnlBps");
  const fairAmountOut = payload.fairAmountOut;
  const grossPnlTokenOut = payload.grossPnlTokenOut;
  if (!isPositiveUIntString(amountIn) || !isPositiveUIntString(fairAmountOut) || !isIntString(grossPnlTokenOut) ||
      !isPositiveDecimalString(payload.midPrice) || !isTokenDecimals(payload.tokenInDecimals) ||
      !isTokenDecimals(payload.tokenOutDecimals)) {
    throw malformedFieldError(status, label, "fairAmountOut");
  }
  const expectedFairAmountOut = calculateFairAmountOut(
    BigInt(amountIn), payload.midPrice, payload.tokenInDecimals, payload.tokenOutDecimals,
  );
  if (BigInt(fairAmountOut) !== expectedFairAmountOut) throw malformedFieldError(status, label, "fairAmountOut");
  const expectedGrossPnl = expectedFairAmountOut - BigInt(amountOut);
  if (BigInt(grossPnlTokenOut) !== expectedGrossPnl) {
    throw malformedFieldError(status, label, "grossPnlTokenOut");
  }
  const expectedGrossPnlBps = (expectedGrossPnl * 10_000n) / expectedFairAmountOut;
  if (expectedGrossPnlBps < BigInt(Number.MIN_SAFE_INTEGER) ||
      expectedGrossPnlBps > BigInt(Number.MAX_SAFE_INTEGER) ||
      payload.grossPnlBps !== Number(expectedGrossPnlBps)) {
    throw malformedFieldError(status, label, "grossPnlBps");
  }
  if (payload.model !== "quote_snapshot_edge_v1") throw malformedFieldError(status, label, "model");
  if (payload.modelDescription !==
      "Gross settlement PnL in tokenOut base units versus the persisted quote-time mid price, excluding fees, gas, and hedge execution") {
    throw malformedFieldError(status, label, "modelDescription");
  }
}

function hedgeNetKey(chainId: number, token: string, asset: string): string {
  return `${chainId}:${token.toLowerCase()}:${asset}`;
}

function isVenueAsset(value: unknown): value is string {
  return typeof value === "string" && /^[A-Z0-9._-]{1,32}$/.test(value);
}

function isCanonicalSignedDecimal(value: unknown): value is string {
  return typeof value === "string" && value.length <= 98 &&
    /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]{0,17}[1-9])?$/.test(value) && value !== "-0";
}

function signedDecimalToScale18(value: string): bigint {
  const [integer, fraction = ""] = value.replace("-", "").split(".");
  const scaled = BigInt(integer) * 10n ** 18n + BigInt((fraction + "0".repeat(18)).slice(0, 18));
  return value.startsWith("-") ? -scaled : scaled;
}

function pnlTokenKey(chainId: number, tokenOut: string): string {
  return `${chainId}:${tokenOut.toLowerCase()}`;
}

function calculateFairAmountOut(
  amountIn: bigint,
  midPrice: string,
  tokenInDecimals: number,
  tokenOutDecimals: number,
): bigint {
  const [whole, fraction = ""] = midPrice.split(".");
  const denominator = 10n ** BigInt(fraction.length);
  const numerator = BigInt(whole) * denominator + BigInt(fraction || "0");
  return (amountIn * numerator * 10n ** BigInt(tokenOutDecimals)) /
    (denominator * 10n ** BigInt(tokenInDecimals));
}
