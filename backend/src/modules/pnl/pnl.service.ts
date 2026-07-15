import { convertBaseUnitAmount, normalizeHumanPrice } from "../pricing/price-normalization.js";
import {
  quoteSnapshotPnlModelDescription,
  hedgeFillNetPnlModelDescription,
  type Address,
  type HedgeNetPnlRecord,
  type HedgeNetPnlSummary,
  type HedgeNetPnlTotal,
  type IntString,
  type PnlSummaryResponse,
  type PnlTokenTotal,
  type PnlTradeRecord,
  type SignedQuote,
  type UIntString,
} from "../../shared/types/rfq.js";
import { isCanonicalUtcIsoTimestamp } from "../../shared/validation/timestamp.js";
import { assertPrincipalId } from "../../shared/validation/principal-id.js";

const MAX_SAFE_INTEGER_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);
const MIN_SAFE_INTEGER_BIGINT = BigInt(Number.MIN_SAFE_INTEGER);
const MAX_UINT256 = (1n << 256n) - 1n;
const maxSafeIdentifierLength = 128;
const safeIdentifierPattern = /^[A-Za-z0-9_:-]+$/;
const pnlInputFields = ["quoteId", "settlementEventId", "snapshotId", "realizedAt", "quote"] as const;
const valuationFields = ["snapshotId", "midPrice", "tokenInDecimals", "tokenOutDecimals", "observedAt"] as const;
const removePnlRecordInputFields = ["quoteId"] as const;
const removePnlRecordOptionalFields = ["model"] as const;
const signedQuoteFields = [
  "user",
  "tokenIn",
  "tokenOut",
  "amountIn",
  "amountOut",
  "minAmountOut",
  "nonce",
  "deadline",
  "chainId",
] as const;

export interface RecordPnlInput {
  quoteId: string;
  settlementEventId: string;
  snapshotId: string;
  realizedAt: string;
  quote: SignedQuote;
}

export interface PnlValuation {
  snapshotId: string;
  midPrice: string;
  tokenInDecimals: number;
  tokenOutDecimals: number;
  observedAt: string;
}

export interface PnlValuationProvider {
  resolve(input: RecordPnlInput): PnlValuation | Promise<PnlValuation>;
}

export interface RemovePnlRecordInput {
  quoteId: string;
  model?: PnlTradeRecord["model"];
}

export interface RemovePnlRecordResult {
  record?: PnlTradeRecord;
  removed: boolean;
}

export interface PnlStore {
  checkHealth?(): void | Promise<void>;
  recordSettlement(input: RecordPnlInput): PnlTradeRecord | Promise<PnlTradeRecord>;
  getPnlRecordByQuoteId(quoteId: string): PnlTradeRecord | undefined | Promise<PnlTradeRecord | undefined>;
  removePnlRecord(input: RemovePnlRecordInput): RemovePnlRecordResult | Promise<RemovePnlRecordResult>;
  summary(principalId?: string): PnlSummaryResponse | Promise<PnlSummaryResponse>;
}

export interface QuoteOwnershipReader {
  findPrincipalId(quoteId: string): Promise<string | undefined>;
}

export class PnlService implements PnlStore {
  private readonly trades = new Map<string, PnlTradeRecord>();
  private readonly pnlIdsByQuoteModel = new Map<string, string>();
  private readonly valuationProvider: PnlValuationProvider;
  private readonly quoteOwnershipReader?: QuoteOwnershipReader;

  constructor(
    valuationProvider: PnlValuationProvider = missingPnlValuationProvider,
    quoteOwnershipReader?: QuoteOwnershipReader,
  ) {
    assertPnlValuationProvider(valuationProvider);
    if (quoteOwnershipReader !== undefined) assertQuoteOwnershipReader(quoteOwnershipReader);
    this.valuationProvider = { resolve: valuationProvider.resolve.bind(valuationProvider) };
    this.quoteOwnershipReader = quoteOwnershipReader;
  }

  checkHealth(): void {
    this.summary();
  }

  async recordSettlement(input: RecordPnlInput): Promise<PnlTradeRecord> {
    assertPnlInput(input);

    const model = "quote_snapshot_edge_v1";
    const pnlId = buildPnlId(input.quoteId);
    const existingPnlId = this.pnlIdsByQuoteModel.get(this.quoteModelKey(input.quoteId, model));
    if (existingPnlId) {
      const existingRecord = this.trades.get(existingPnlId);
      if (!existingRecord) {
        throw new Error(`PnL record index is inconsistent for ${existingPnlId}`);
      }
      if (!matchesPnlInput(existingRecord, input)) {
        throw new Error(`PnL record conflict for ${existingPnlId}`);
      }

      return clonePnlTradeRecord(existingRecord);
    }

    const valuation = await this.valuationProvider.resolve(input);
    const record = buildPnlTradeRecord(input, valuation);

    this.trades.set(record.pnlId, record);
    this.pnlIdsByQuoteModel.set(this.quoteModelKey(input.quoteId, record.model), record.pnlId);
    return clonePnlTradeRecord(record);
  }

  getPnlRecordByQuoteId(quoteId: string): PnlTradeRecord | undefined {
    const normalized = normalizeRemovePnlRecordInput({ quoteId });
    const pnlId = this.pnlIdsByQuoteModel.get(this.quoteModelKey(normalized.quoteId, normalized.model));
    if (!pnlId) return undefined;
    const record = this.trades.get(pnlId);
    if (!record) throw new Error(`PnL record index is inconsistent for ${pnlId}`);
    return clonePnlTradeRecord(record);
  }

  removePnlRecord(input: RemovePnlRecordInput): RemovePnlRecordResult {
    const normalizedInput = normalizeRemovePnlRecordInput(input);
    const key = this.quoteModelKey(normalizedInput.quoteId, normalizedInput.model);
    const pnlId = this.pnlIdsByQuoteModel.get(key);
    if (!pnlId) {
      return { removed: false };
    }

    const record = this.trades.get(pnlId);
    if (!record) {
      throw new Error(`PnL record index is inconsistent for ${pnlId}`);
    }

    this.trades.delete(pnlId);
    this.pnlIdsByQuoteModel.delete(key);

    return {
      record: clonePnlTradeRecord(record),
      removed: true,
    };
  }

  summary(): PnlSummaryResponse;
  summary(principalId: string): Promise<PnlSummaryResponse>;
  summary(principalId?: string): PnlSummaryResponse | Promise<PnlSummaryResponse> {
    if (principalId !== undefined) return this.summaryForPrincipal(principalId);
    return buildPnlSummary([...this.trades.values()]);
  }

  private async summaryForPrincipal(principalId: string): Promise<PnlSummaryResponse> {
    assertPrincipalId(principalId, "PnL summary principalId");
    if (!this.quoteOwnershipReader) throw new Error("PnL quote ownership reader is required for principal summary");
    const owned: PnlTradeRecord[] = [];
    for (const trade of this.trades.values()) {
      if (await this.quoteOwnershipReader.findPrincipalId(trade.quoteId) === principalId) owned.push(trade);
    }
    return buildPnlSummary(owned);
  }

  private quoteModelKey(quoteId: string, model: PnlTradeRecord["model"]): string {
    return `${quoteId}:${model}`;
  }
}

const missingPnlValuationProvider: PnlValuationProvider = {
  resolve() {
    throw new Error("Pnl valuationProvider is required to record settlements");
  },
};

export function clonePnlTradeRecord(record: PnlTradeRecord): PnlTradeRecord {
  return { ...record };
}

export function buildPnlId(quoteId: string): string {
  const pnlId = `pnl_${quoteId}`;
  assertSafeIdentifier(pnlId, "pnlId");
  return pnlId;
}

export function buildPnlTradeRecord(input: RecordPnlInput, valuation: PnlValuation): PnlTradeRecord {
  assertPnlInput(input);
  assertPnlValuation(valuation, input);

  const fairAmountOut = convertBaseUnitAmount(
    BigInt(input.quote.amountIn),
    normalizeHumanPrice(valuation.midPrice),
    valuation.tokenInDecimals,
    valuation.tokenOutDecimals,
  );
  if (fairAmountOut <= 0n) {
    throw new Error("Pnl fairAmountOut rounds to zero after decimals normalization");
  }
  if (fairAmountOut > MAX_UINT256) {
    throw new Error("Pnl fairAmountOut must fit uint256");
  }

  const grossPnl = fairAmountOut - BigInt(input.quote.amountOut);
  return {
    pnlId: buildPnlId(input.quoteId),
    quoteId: input.quoteId,
    settlementEventId: input.settlementEventId,
    snapshotId: input.snapshotId,
    chainId: input.quote.chainId,
    user: input.quote.user,
    tokenIn: input.quote.tokenIn,
    tokenOut: input.quote.tokenOut,
    amountIn: input.quote.amountIn,
    amountOut: input.quote.amountOut,
    minAmountOut: input.quote.minAmountOut,
    nonce: input.quote.nonce,
    deadline: input.quote.deadline,
    midPrice: valuation.midPrice,
    tokenInDecimals: valuation.tokenInDecimals,
    tokenOutDecimals: valuation.tokenOutDecimals,
    fairAmountOut: fairAmountOut.toString() as UIntString,
    valuationObservedAt: valuation.observedAt,
    grossPnlTokenOut: grossPnl.toString() as IntString,
    grossPnlBps: calculateGrossPnlBps(fairAmountOut, grossPnl),
    model: "quote_snapshot_edge_v1",
    modelDescription: quoteSnapshotPnlModelDescription,
    realizedAt: input.realizedAt,
  };
}

export function buildPnlSummary(
  records: readonly PnlTradeRecord[],
  hedgeNetRecords?: readonly HedgeNetPnlRecord[],
): PnlSummaryResponse {
  const trades = records
    .map(clonePnlTradeRecord)
    .sort((left, right) => left.realizedAt.localeCompare(right.realizedAt) || left.pnlId.localeCompare(right.pnlId));
  const totalsByToken = new Map<string, { chainId: number; tokenOut: Address; totalTrades: number; grossPnl: bigint }>();

  for (const trade of trades) {
    const tokenOut = trade.tokenOut.toLowerCase() as Address;
    const key = `${trade.chainId}:${tokenOut}`;
    const current = totalsByToken.get(key);
    if (current) {
      current.totalTrades += 1;
      current.grossPnl += BigInt(trade.grossPnlTokenOut);
    } else {
      totalsByToken.set(key, {
        chainId: trade.chainId,
        tokenOut,
        totalTrades: 1,
        grossPnl: BigInt(trade.grossPnlTokenOut),
      });
    }
  }

  const totals: PnlTokenTotal[] = [...totalsByToken.values()]
    .sort((left, right) => left.chainId - right.chainId || left.tokenOut.localeCompare(right.tokenOut))
    .map((total) => ({
      chainId: total.chainId,
      tokenOut: total.tokenOut,
      totalTrades: total.totalTrades,
      grossPnlTokenOut: total.grossPnl.toString() as IntString,
    }));

  return {
    status: "ok",
    totalTrades: trades.length,
    totals,
    trades,
    hedgeNet: buildHedgeNetPnlSummary(trades, hedgeNetRecords),
  };
}

export function buildHedgeNetPnlSummary(
  trades: readonly PnlTradeRecord[],
  suppliedRecords?: readonly HedgeNetPnlRecord[],
): HedgeNetPnlSummary {
  const tradeByQuote = new Map(trades.map((trade) => [trade.quoteId, trade]));
  const records = suppliedRecords === undefined
    ? trades.map((trade): HedgeNetPnlRecord => unavailableHedgeRecord(trade, "HEDGE_EVIDENCE_MISSING"))
    : suppliedRecords.map(cloneHedgeNetPnlRecord);
  if (records.length !== trades.length) throw new Error("Hedge net PnL records must match PnL trades one-to-one");
  const seen = new Set<string>();
  for (const record of records) {
    const trade = tradeByQuote.get(record.quoteId);
    if (!trade || trade.chainId !== record.chainId || seen.has(record.quoteId)) {
      throw new Error("Hedge net PnL record identity is inconsistent");
    }
    seen.add(record.quoteId);
  }
  records.sort((left, right) => {
    const leftTrade = tradeByQuote.get(left.quoteId)!;
    const rightTrade = tradeByQuote.get(right.quoteId)!;
    return leftTrade.realizedAt.localeCompare(rightTrade.realizedAt) || left.quoteId.localeCompare(right.quoteId);
  });

  const totalsByAsset = new Map<string, {
    chainId: number;
    valuationToken: Address;
    valuationAsset: string;
    totalTrades: number;
    netScaled: bigint;
  }>();
  for (const record of records) {
    if (record.status !== "complete") continue;
    const valuationToken = record.valuationToken.toLowerCase() as Address;
    const key = `${record.chainId}:${valuationToken}:${record.valuationAsset}`;
    const current = totalsByAsset.get(key) ?? {
      chainId: record.chainId,
      valuationToken,
      valuationAsset: record.valuationAsset,
      totalTrades: 0,
      netScaled: 0n,
    };
    current.totalTrades += 1;
    current.netScaled += parseSignedDecimalToScale18(record.netPnlQuoteQuantity);
    totalsByAsset.set(key, current);
  }
  const totals: HedgeNetPnlTotal[] = [...totalsByAsset.values()]
    .sort((left, right) => left.chainId - right.chainId ||
      left.valuationToken.localeCompare(right.valuationToken) || left.valuationAsset.localeCompare(right.valuationAsset))
    .map((total) => ({
      chainId: total.chainId,
      valuationToken: total.valuationToken,
      valuationAsset: total.valuationAsset,
      totalTrades: total.totalTrades,
      netPnlQuoteQuantity: formatScale18(total.netScaled),
    }));
  return {
    model: "hedge_fill_net_v1",
    modelDescription: hedgeFillNetPnlModelDescription,
    totalTrades: records.length,
    completeTrades: records.filter((record) => record.status === "complete").length,
    pendingTrades: records.filter((record) => record.status === "pending").length,
    unavailableTrades: records.filter((record) => record.status === "unavailable").length,
    totals,
    records,
  };
}

export function unavailableHedgeRecord(
  trade: PnlTradeRecord,
  reasonCode: "HEDGE_EVIDENCE_MISSING" | "LEGACY_ROUTE_ACCOUNTING_UNAVAILABLE",
  hedgeOrderId?: string,
): HedgeNetPnlRecord {
  return {
    quoteId: trade.quoteId,
    chainId: trade.chainId,
    status: "unavailable",
    model: "hedge_fill_net_v1",
    modelDescription: hedgeFillNetPnlModelDescription,
    reasonCode,
    ...(hedgeOrderId === undefined ? {} : { hedgeOrderId }),
  };
}

function cloneHedgeNetPnlRecord(record: HedgeNetPnlRecord): HedgeNetPnlRecord {
  return {
    ...record,
    ...(record.status === "unavailable" && record.unvaluedCommissionAssets !== undefined
      ? { unvaluedCommissionAssets: [...record.unvaluedCommissionAssets] }
      : {}),
  };
}

function parseSignedDecimalToScale18(value: string): bigint {
  if (value.length > 98) throw new Error("Hedge net PnL quantity must be a canonical signed decimal");
  const match = value.match(/^(-?)(0|[1-9][0-9]*)(?:\.([0-9]{0,17}[1-9]))?$/);
  if (!match || value === "-0") throw new Error("Hedge net PnL quantity must be a canonical signed decimal");
  const fraction = match[3] ?? "";
  const scaled = BigInt(match[2]) * 10n ** 18n + BigInt((fraction + "0".repeat(18)).slice(0, 18));
  return match[1] === "-" ? -scaled : scaled;
}

function formatScale18(value: bigint): string {
  const sign = value < 0n ? "-" : "";
  const absolute = value < 0n ? -value : value;
  const raw = absolute.toString().padStart(19, "0");
  const fraction = raw.slice(-18).replace(/0+$/, "");
  return `${sign}${raw.slice(0, -18)}${fraction.length === 0 ? "" : `.${fraction}`}`;
}

export function matchesPnlInput(record: PnlTradeRecord, input: RecordPnlInput): boolean {
  return (
    record.quoteId === input.quoteId &&
    record.settlementEventId === input.settlementEventId &&
    record.snapshotId === input.snapshotId &&
    record.realizedAt === input.realizedAt &&
    record.chainId === input.quote.chainId &&
    record.user.toLowerCase() === input.quote.user.toLowerCase() &&
    record.tokenIn.toLowerCase() === input.quote.tokenIn.toLowerCase() &&
    record.tokenOut.toLowerCase() === input.quote.tokenOut.toLowerCase() &&
    record.amountIn === input.quote.amountIn &&
    record.amountOut === input.quote.amountOut &&
    record.minAmountOut === input.quote.minAmountOut &&
    record.nonce === input.quote.nonce &&
    record.deadline === input.quote.deadline
  );
}

function calculateGrossPnlBps(fairAmountOut: bigint, grossPnl: bigint): number {
  const grossPnlBps = (grossPnl * 10_000n) / fairAmountOut;
  if (grossPnlBps < MIN_SAFE_INTEGER_BIGINT || grossPnlBps > MAX_SAFE_INTEGER_BIGINT) {
    throw new Error("Pnl grossPnlBps must be a safe integer");
  }

  return Number(grossPnlBps);
}

export function assertPnlInput(input: RecordPnlInput): void {
  assertObject(input, "input");
  assertObject(input.quote, "quote");
  assertOwnFields(input, pnlInputFields, "input");
  assertOwnFields(input.quote, signedQuoteFields, "quote");
  assertSafeIdentifier(input.quoteId, "quoteId");
  assertSafeIdentifier(input.settlementEventId, "settlementEventId");
  assertSafeIdentifier(input.snapshotId, "snapshotId");
  if (!isCanonicalUtcIsoTimestamp(input.realizedAt)) {
    throw new Error("Pnl realizedAt must be a canonical UTC ISO timestamp");
  }
  assertPositiveSafeInteger(input.quote.chainId, "quote.chainId");
  assertAddress(input.quote.user, "quote.user");
  assertAddress(input.quote.tokenIn, "quote.tokenIn");
  assertAddress(input.quote.tokenOut, "quote.tokenOut");

  if (input.quote.tokenIn.toLowerCase() === input.quote.tokenOut.toLowerCase()) {
    throw new Error("Pnl quote token pair must contain distinct tokens");
  }

  assertPositiveUIntString(input.quote.amountIn, "quote.amountIn");
  assertPositiveUIntString(input.quote.amountOut, "quote.amountOut");
  assertPositiveUIntString(input.quote.minAmountOut, "quote.minAmountOut");
  assertPositiveUIntString(input.quote.nonce, "quote.nonce");
  assertPositiveSafeInteger(input.quote.deadline, "quote.deadline");

  if (BigInt(input.quote.amountIn) > MAX_UINT256 || BigInt(input.quote.amountOut) > MAX_UINT256) {
    throw new Error("Pnl quote amounts must fit uint256");
  }
  if (BigInt(input.quote.amountOut) < BigInt(input.quote.minAmountOut)) {
    throw new Error("Pnl quote.amountOut must be greater than or equal to quote.minAmountOut");
  }
}

export function normalizeRemovePnlRecordInput(input: RemovePnlRecordInput): Required<RemovePnlRecordInput> {
  assertObject(input, "remove input");
  assertOwnFields(input, removePnlRecordInputFields, "remove input");
  assertOwnOptionalFields(input, removePnlRecordOptionalFields, "remove input");
  assertSafeIdentifier(input.quoteId, "quoteId");
  if (input.model !== undefined && input.model !== "quote_snapshot_edge_v1") {
    throw new Error("Pnl model must be quote_snapshot_edge_v1");
  }

  return {
    quoteId: input.quoteId,
    model: input.model ?? "quote_snapshot_edge_v1",
  };
}

function assertPnlValuation(valuation: PnlValuation, input: RecordPnlInput): void {
  assertObject(valuation, "valuation");
  assertOwnFields(valuation, valuationFields, "valuation");
  assertSafeIdentifier(valuation.snapshotId, "valuation.snapshotId");
  if (valuation.snapshotId !== input.snapshotId) {
    throw new Error("Pnl valuation.snapshotId must match input.snapshotId");
  }
  try {
    normalizeHumanPrice(valuation.midPrice);
  } catch {
    throw new Error("Pnl valuation.midPrice must be a positive canonical decimal");
  }
  assertTokenDecimals(valuation.tokenInDecimals, "valuation.tokenInDecimals");
  assertTokenDecimals(valuation.tokenOutDecimals, "valuation.tokenOutDecimals");
  if (!isCanonicalUtcIsoTimestamp(valuation.observedAt)) {
    throw new Error("Pnl valuation.observedAt must be a canonical UTC ISO timestamp");
  }
}

function assertPnlValuationProvider(value: unknown): asserts value is PnlValuationProvider {
  if (typeof value !== "object" || value === null || Array.isArray(value) ||
      typeof (value as Record<string, unknown>).resolve !== "function") {
    throw new Error("Pnl valuationProvider.resolve must be a function");
  }
}

function assertQuoteOwnershipReader(value: unknown): asserts value is QuoteOwnershipReader {
  if (typeof value !== "object" || value === null || Array.isArray(value) ||
      typeof (value as Record<string, unknown>).findPrincipalId !== "function") {
    throw new Error("PnL quoteOwnershipReader.findPrincipalId must be a function");
  }
}

function assertObject(value: unknown, field: "input" | "quote" | "remove input" | "valuation"): asserts value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    if (field === "input") throw new Error("Pnl input must be an object");
    if (field === "quote") throw new Error("Pnl quote must be an object");
    if (field === "valuation") throw new Error("Pnl valuation must be an object");
    throw new Error("Pnl remove input must be an object");
  }
}

function assertOwnFields(value: object, fields: readonly string[], path: string): void {
  for (const field of fields) {
    if (!Object.prototype.hasOwnProperty.call(value, field)) {
      throw new Error(`Pnl ${path}.${field} must be an own field`);
    }
  }
}

function assertOwnOptionalFields(value: object, fields: readonly string[], path: string): void {
  for (const field of fields) {
    if (field in value && !Object.prototype.hasOwnProperty.call(value, field)) {
      throw new Error(`Pnl ${path}.${field} must be an own field when provided`);
    }
  }
}

function assertSafeIdentifier(value: unknown, field: string): void {
  if (typeof value !== "string") throw new Error(`Pnl ${field} must be a primitive string`);
  if (value.trim().length === 0) throw new Error(`Pnl ${field} must be a non-empty string`);
  if (value.length > maxSafeIdentifierLength) throw new Error(`Pnl ${field} must be 128 characters or fewer`);
  if (!safeIdentifierPattern.test(value)) {
    throw new Error(`Pnl ${field} must contain only letters, numbers, underscore, colon, or hyphen`);
  }
}

function assertAddress(value: string, field: string): void {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new Error(`Pnl ${field} must be a 20-byte hex address`);
  }
}

function assertPositiveUIntString(value: string, field: string): void {
  if (typeof value !== "string" || !/^[1-9][0-9]*$/.test(value)) {
    throw new Error(`Pnl ${field} must be a positive uint string`);
  }
}

function assertPositiveSafeInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`Pnl ${field} must be a positive safe integer`);
  }
}

function assertTokenDecimals(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > 36) {
    throw new Error(`Pnl ${field} must be an integer between 0 and 36`);
  }
}
