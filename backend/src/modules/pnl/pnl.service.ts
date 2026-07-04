import { simulatedPnlModelDescription } from "../../shared/types/rfq.js";
import type { IntString, PnlSummaryResponse, PnlTradeRecord, SignedQuote } from "../../shared/types/rfq.js";

const MAX_SAFE_INTEGER_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);
const MIN_SAFE_INTEGER_BIGINT = BigInt(Number.MIN_SAFE_INTEGER);
const maxSafeIdentifierLength = 128;
const safeIdentifierPattern = /^[A-Za-z0-9_:-]+$/;
const pnlInputFields = ["quoteId", "quote"] as const;
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
  quote: SignedQuote;
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
  checkHealth?(): void;
  recordSettlement(input: RecordPnlInput): PnlTradeRecord;
  removePnlRecord(input: RemovePnlRecordInput): RemovePnlRecordResult;
  summary(): PnlSummaryResponse;
}

export class PnlService implements PnlStore {
  private readonly trades = new Map<string, PnlTradeRecord>();
  private readonly pnlIdsByQuoteModel = new Map<string, string>();

  checkHealth(): void {
    this.summary();
  }

  recordSettlement(input: RecordPnlInput): PnlTradeRecord {
    assertPnlInput(input);

    const model = "simulated_mid_price_v1";
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

    const grossPnl = calculateGrossPnl(input.quote.amountIn, input.quote.amountOut);
    const record: PnlTradeRecord = {
      pnlId,
      quoteId: input.quoteId,
      chainId: input.quote.chainId,
      user: input.quote.user,
      tokenIn: input.quote.tokenIn,
      tokenOut: input.quote.tokenOut,
      amountIn: input.quote.amountIn,
      amountOut: input.quote.amountOut,
      minAmountOut: input.quote.minAmountOut,
      nonce: input.quote.nonce,
      deadline: input.quote.deadline,
      grossPnlTokenOut: grossPnl.toString() as IntString,
      grossPnlBps: calculateGrossPnlBps(input.quote.amountIn, grossPnl),
      model,
      modelDescription: simulatedPnlModelDescription,
      realizedAt: new Date().toISOString(),
    };

    this.trades.set(record.pnlId, record);
    this.pnlIdsByQuoteModel.set(this.quoteModelKey(input.quoteId, record.model), record.pnlId);
    return clonePnlTradeRecord(record);
  }

  removePnlRecord(input: RemovePnlRecordInput): RemovePnlRecordResult {
    const normalizedInput = normalizeRemovePnlRecordInput(input);
    const key = this.quoteModelKey(normalizedInput.quoteId, normalizedInput.model);
    const pnlId = this.pnlIdsByQuoteModel.get(key);
    if (!pnlId) {
      return {
        removed: false,
      };
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

  summary(): PnlSummaryResponse {
    const trades = [...this.trades.values()].sort((left, right) => left.realizedAt.localeCompare(right.realizedAt));
    const grossPnl = trades.reduce((total, trade) => total + BigInt(trade.grossPnlTokenOut), 0n);

    return {
      status: "ok",
      totalTrades: trades.length,
      grossPnlTokenOut: grossPnl.toString() as IntString,
      trades: trades.map(clonePnlTradeRecord),
    };
  }

  private quoteModelKey(quoteId: string, model: PnlTradeRecord["model"]): string {
    return `${quoteId}:${model}`;
  }
}

function calculateGrossPnl(amountIn: string, amountOut: string): bigint {
  return BigInt(amountIn) - BigInt(amountOut);
}

function clonePnlTradeRecord(record: PnlTradeRecord): PnlTradeRecord {
  return { ...record };
}

function buildPnlId(quoteId: string): string {
  const pnlId = `pnl_${quoteId}`;
  assertSafeIdentifier(pnlId, "pnlId");
  return pnlId;
}

function matchesPnlInput(record: PnlTradeRecord, input: RecordPnlInput): boolean {
  return (
    record.quoteId === input.quoteId &&
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

function calculateGrossPnlBps(amountIn: string, grossPnl: bigint): number {
  const notional = BigInt(amountIn);
  if (notional <= 0n) {
    return 0;
  }

  const grossPnlBps = (grossPnl * 10_000n) / notional;
  if (grossPnlBps < MIN_SAFE_INTEGER_BIGINT || grossPnlBps > MAX_SAFE_INTEGER_BIGINT) {
    throw new Error("Pnl grossPnlBps must be a safe integer");
  }

  return Number(grossPnlBps);
}

function assertPnlInput(input: RecordPnlInput): void {
  assertObject(input, "input");
  assertObject(input.quote, "quote");
  assertOwnFields(input, pnlInputFields, "input");
  assertOwnFields(input.quote, signedQuoteFields, "quote");
  assertSafeIdentifier(input.quoteId, "quoteId");
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

  if (BigInt(input.quote.amountOut) < BigInt(input.quote.minAmountOut)) {
    throw new Error("Pnl quote.amountOut must be greater than or equal to quote.minAmountOut");
  }
}

function normalizeRemovePnlRecordInput(input: RemovePnlRecordInput): Required<RemovePnlRecordInput> {
  assertObject(input, "remove input");
  assertOwnFields(input, removePnlRecordInputFields, "remove input");
  assertOwnOptionalFields(input, removePnlRecordOptionalFields, "remove input");
  assertSafeIdentifier(input.quoteId, "quoteId");
  if (input.model !== undefined && input.model !== "simulated_mid_price_v1") {
    throw new Error("Pnl model must be simulated_mid_price_v1");
  }

  return {
    quoteId: input.quoteId,
    model: input.model ?? "simulated_mid_price_v1",
  };
}

function assertObject(value: unknown, field: "input" | "quote" | "remove input"): void {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    if (field === "input") {
      throw new Error("Pnl input must be an object");
    }
    if (field === "quote") {
      throw new Error("Pnl quote must be an object");
    }

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
  if (typeof value !== "string") {
    throw new Error(`Pnl ${field} must be a primitive string`);
  }
  if (value.trim().length === 0) {
    throw new Error(`Pnl ${field} must be a non-empty string`);
  }
  if (value.length > maxSafeIdentifierLength) {
    throw new Error(`Pnl ${field} must be 128 characters or fewer`);
  }
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
