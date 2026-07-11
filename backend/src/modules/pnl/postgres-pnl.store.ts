import pg from "pg";
import {
  simulatedPnlModelDescription,
  type Address,
  type IntString,
  type PnlSummaryResponse,
  type PnlTradeRecord,
} from "../../shared/types/rfq.js";
import { isCanonicalUtcIsoTimestamp } from "../../shared/validation/timestamp.js";
import {
  buildPnlTradeRecord,
  clonePnlTradeRecord,
  matchesPnlInput,
  normalizeRemovePnlRecordInput,
  type PnlStore,
  type RecordPnlInput,
  type RemovePnlRecordInput,
  type RemovePnlRecordResult,
} from "./pnl.service.js";

const pnlColumns = `
  id, quote_id, chain_id, user_address, token_in, token_out,
  amount_in, amount_out, min_amount_out, nonce, deadline,
  gross_pnl_token_out, gross_pnl_bps, model, model_description, realized_at
`;

export class PostgresPnlStore implements PnlStore {
  constructor(private readonly pool: pg.Pool) {
    assertPool(pool);
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
    const expected = buildPnlTradeRecord(input);
    const client = await this.pool.connect();
    try {
      const inserted = await client.query(
        `INSERT INTO pnl_records (
           id, quote_id, chain_id, user_address, token_in, token_out,
           amount_in, amount_out, min_amount_out, nonce, deadline,
           gross_pnl_token_out, gross_pnl_bps, model, model_description, realized_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
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

  async summary(): Promise<PnlSummaryResponse> {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `SELECT ${pnlColumns} FROM pnl_records ORDER BY realized_at ASC, id ASC`,
      );
      const trades = result.rows.map(parsePnlRow);
      const grossPnl = trades.reduce((total, trade) => total + BigInt(trade.grossPnlTokenOut), 0n);
      return {
        status: "ok",
        totalTrades: trades.length,
        grossPnlTokenOut: grossPnl.toString() as IntString,
        trades: trades.map(clonePnlTradeRecord),
      };
    } finally {
      client.release();
    }
  }
}

function pnlParams(record: PnlTradeRecord): unknown[] {
  return [
    record.pnlId,
    record.quoteId,
    record.chainId,
    record.user,
    record.tokenIn,
    record.tokenOut,
    record.amountIn,
    record.amountOut,
    record.minAmountOut,
    record.nonce,
    record.deadline,
    record.grossPnlTokenOut,
    record.grossPnlBps,
    record.model,
    record.modelDescription,
    record.realizedAt,
  ];
}

function pnlAttributionMatches(left: PnlTradeRecord, right: PnlTradeRecord): boolean {
  return left.pnlId === right.pnlId &&
    left.grossPnlTokenOut === right.grossPnlTokenOut &&
    left.grossPnlBps === right.grossPnlBps &&
    left.model === right.model &&
    left.modelDescription === right.modelDescription;
}

function parsePnlRow(row: unknown): PnlTradeRecord {
  if (typeof row !== "object" || row === null || Array.isArray(row)) {
    throw new Error("Postgres PnL row must be an object");
  }
  const value = row as Record<string, unknown>;
  if (value.model !== "simulated_mid_price_v1") {
    throw new Error("Postgres PnL row model is invalid");
  }
  if (value.model_description !== simulatedPnlModelDescription) {
    throw new Error("Postgres PnL row model_description is invalid");
  }
  const record: PnlTradeRecord = {
    pnlId: parseIdentifier(value.id, "id"),
    quoteId: parseIdentifier(value.quote_id, "quote_id"),
    chainId: parsePositiveSafeInteger(value.chain_id, "chain_id"),
    user: parseAddress(value.user_address, "user_address"),
    tokenIn: parseAddress(value.token_in, "token_in"),
    tokenOut: parseAddress(value.token_out, "token_out"),
    amountIn: parsePositiveUInt(value.amount_in, "amount_in"),
    amountOut: parsePositiveUInt(value.amount_out, "amount_out"),
    minAmountOut: parsePositiveUInt(value.min_amount_out, "min_amount_out"),
    nonce: parsePositiveUInt(value.nonce, "nonce"),
    deadline: parsePositiveSafeInteger(value.deadline, "deadline"),
    grossPnlTokenOut: parseIntString(value.gross_pnl_token_out, "gross_pnl_token_out"),
    grossPnlBps: parseSafeInteger(value.gross_pnl_bps, "gross_pnl_bps"),
    model: value.model,
    modelDescription: value.model_description,
    realizedAt: parseTimestamp(value.realized_at, "realized_at"),
  };
  const expected = buildPnlTradeRecord({
    quoteId: record.quoteId,
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
  }, record.realizedAt);
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

function parsePositiveUInt(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^[1-9][0-9]*$/.test(value)) {
    throw new Error(`Postgres PnL row ${field} must be a canonical positive uint string`);
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
