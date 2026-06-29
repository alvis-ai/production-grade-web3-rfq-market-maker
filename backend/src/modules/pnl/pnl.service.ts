import type { IntString, PnlSummaryResponse, PnlTradeRecord, SignedQuote } from "../../shared/types/rfq.js";

export interface RecordPnlInput {
  quoteId: string;
  quote: SignedQuote;
}

export interface PnlStore {
  checkHealth?(): void;
  recordSettlement(input: RecordPnlInput): PnlTradeRecord;
  summary(): PnlSummaryResponse;
}

export class PnlService implements PnlStore {
  private readonly trades = new Map<string, PnlTradeRecord>();
  private readonly pnlIdsByQuoteModel = new Map<string, string>();

  checkHealth(): void {
    this.summary();
  }

  recordSettlement(input: RecordPnlInput): PnlTradeRecord {
    const model = "simulated_mid_price_v1";
    const existingPnlId = this.pnlIdsByQuoteModel.get(this.quoteModelKey(input.quoteId, model));
    if (existingPnlId) {
      const existingRecord = this.trades.get(existingPnlId);
      if (!existingRecord) {
        throw new Error(`PnL record index is inconsistent for ${existingPnlId}`);
      }

      return existingRecord;
    }

    const grossPnl = calculateGrossPnl(input.quote.amountIn, input.quote.amountOut);
    const record: PnlTradeRecord = {
      pnlId: `pnl_${input.quoteId}`,
      quoteId: input.quoteId,
      chainId: input.quote.chainId,
      tokenIn: input.quote.tokenIn,
      tokenOut: input.quote.tokenOut,
      amountIn: input.quote.amountIn,
      amountOut: input.quote.amountOut,
      grossPnlTokenOut: grossPnl.toString() as IntString,
      grossPnlBps: calculateGrossPnlBps(input.quote.amountIn, grossPnl),
      model,
      realizedAt: new Date().toISOString(),
    };

    this.trades.set(record.pnlId, record);
    this.pnlIdsByQuoteModel.set(this.quoteModelKey(input.quoteId, record.model), record.pnlId);
    return record;
  }

  summary(): PnlSummaryResponse {
    const trades = [...this.trades.values()].sort((left, right) => left.realizedAt.localeCompare(right.realizedAt));
    const grossPnl = trades.reduce((total, trade) => total + BigInt(trade.grossPnlTokenOut), 0n);

    return {
      status: "ok",
      totalTrades: trades.length,
      grossPnlTokenOut: grossPnl.toString() as IntString,
      trades,
    };
  }

  private quoteModelKey(quoteId: string, model: PnlTradeRecord["model"]): string {
    return `${quoteId}:${model}`;
  }
}

function calculateGrossPnl(amountIn: string, amountOut: string): bigint {
  return BigInt(amountIn) - BigInt(amountOut);
}

function calculateGrossPnlBps(amountIn: string, grossPnl: bigint): number {
  const notional = BigInt(amountIn);
  if (notional <= 0n) {
    return 0;
  }

  return Number((grossPnl * 10_000n) / notional);
}
