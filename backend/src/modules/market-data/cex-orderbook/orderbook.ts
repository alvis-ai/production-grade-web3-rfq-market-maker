import {
  cexDecimalScale,
  formatCexDecimal,
  normalizeCexDecimal,
  parseCexDecimal,
} from "./decimal.js";

// ─── Types ────────────────────────────────────────────────────────

export type PriceLevel = readonly [price: string, quantity: string];

export interface OrderBookSnapshot {
  readonly bids: readonly PriceLevel[];
  readonly asks: readonly PriceLevel[];
}

export interface OrderBookDelta {
  readonly bids: readonly PriceLevel[];
  readonly asks: readonly PriceLevel[];
}

export interface OrderBookMetrics {
  /** Mid price computed from best bid and best ask */
  midPrice: string;
  /** Best bid price */
  bestBid: string;
  /** Best ask price */
  bestAsk: string;
  /** Spread in basis points */
  spreadBps: number;
  /** Executable bid-side USD notional within the configured depth range */
  liquidityUsd: string;
  /** Number of bid levels */
  bidLevels: number;
  /** Number of ask levels */
  askLevels: number;
}

export interface OrderBookPairConfig {
  chainId: number;
  tokenIn: `0x${string}`;
  tokenOut: `0x${string}`;
  exchange: "binance" | "coinbase";
  /** Exchange-native symbol, e.g. BTCUSDT or BTC-USD. */
  symbol: string;
}

// ─── OrderBook ─────────────────────────────────────────────────────

/**
 * In-memory Level-2 order book.
 *
 * Maintains canonical price and quantity strings backed by 18-decimal fixed-point
 * arithmetic. A malformed message is rejected before any level is mutated.
 *
 * Metrics (mid, spread, depth) are computed lazily and cached until the
 * next snapshot or delta is applied.
 */
export class OrderBook {
  /** price string → quantity string (best bid = highest numeric price) */
  readonly bids = new Map<string, string>();
  /** price string → quantity string (best ask = lowest numeric price) */
  readonly asks = new Map<string, string>();

  private lastMetrics: OrderBookMetrics | undefined;
  private lastMetricsDepthRangeBps: number | undefined;

  // ── state mutations ──

  /** Replace the full book (used after connecting or on reconnect). */
  applySnapshot(snapshot: OrderBookSnapshot): void {
    const bids = normalizeLevels(snapshot?.bids, "Order book snapshot bid", 5_000);
    const asks = normalizeLevels(snapshot?.asks, "Order book snapshot ask", 5_000);
    this.bids.clear();
    this.asks.clear();

    for (const [price, qty] of bids) if (qty !== "0") this.bids.set(price, qty);
    for (const [price, qty] of asks) if (qty !== "0") this.asks.set(price, qty);

    this.invalidate();
  }

  /**
   * Apply incremental changes.
   * Exchanges send the full price level on each update.
   * Quantity "0" or "0.00000000" means remove the level.
   */
  applyDelta(delta: OrderBookDelta): void {
    const bids = normalizeLevels(delta?.bids, "Order book delta bid", 10_000);
    const asks = normalizeLevels(delta?.asks, "Order book delta ask", 10_000);
    for (const [price, qty] of bids) {
      if (qty === "0") this.bids.delete(price);
      else this.bids.set(price, qty);
    }
    for (const [price, qty] of asks) {
      if (qty === "0") this.asks.delete(price);
      else this.asks.set(price, qty);
    }

    this.invalidate();
  }

  clear(): void {
    this.bids.clear();
    this.asks.clear();
    this.invalidate();
  }

  // ── metrics ──

  /**
   * Compute order book metrics.
   *
   * @param depthRangeBps - Range (in bps, 0-10000) from mid price for liquidity aggregation.
   *                        Default 50 = 0.5% on each side.
   */
  getMetrics(depthRangeBps = 50): OrderBookMetrics {
    if (!Number.isSafeInteger(depthRangeBps) || depthRangeBps < 1 || depthRangeBps > 10_000) {
      throw new Error("Order book depthRangeBps must be an integer between 1 and 10000");
    }
    if (this.lastMetrics && this.lastMetricsDepthRangeBps === depthRangeBps) return this.lastMetrics;

    const bestBidValue = this.bestBid();
    const bestAskValue = this.bestAsk();

    const validSpread = bestBidValue !== undefined && bestAskValue !== undefined && bestAskValue > bestBidValue;
    const bestBid = bestBidValue !== undefined ? formatCexDecimal(bestBidValue) : "0";
    const bestAsk = bestAskValue !== undefined ? formatCexDecimal(bestAskValue) : "0";
    const midPriceValue = validSpread ? (bestBidValue + bestAskValue) / 2n : 0n;
    const midPrice = formatCexDecimal(midPriceValue);

    const spreadValue = validSpread
      ? ((bestAskValue - bestBidValue) * 10_000n + bestBidValue / 2n) / bestBidValue
      : 0n;
    const spreadBps = spreadValue > BigInt(Number.MAX_SAFE_INTEGER)
      ? Number.MAX_SAFE_INTEGER
      : Number(spreadValue);

    // Configured CEX pairs are base tokenIn -> USD-reference tokenOut, so only
    // bids are executable hedge depth for the quoted direction.
    const liquidityUsd = this.computeBidDepth(midPriceValue, depthRangeBps);

    const entry: OrderBookMetrics = {
      midPrice,
      bestBid,
      bestAsk,
      spreadBps,
      liquidityUsd: liquidityUsd.toString(),
      bidLevels: this.bids.size,
      askLevels: this.asks.size,
    };

    this.lastMetrics = entry;
    this.lastMetricsDepthRangeBps = depthRangeBps;
    return entry;
  }

  // ── private helpers ──

  private invalidate(): void {
    this.lastMetrics = undefined;
    this.lastMetricsDepthRangeBps = undefined;
  }

  /** Highest-priced bid (the best bid). */
  private bestBid(): bigint | undefined {
    let best: bigint | undefined;
    for (const price of this.bids.keys()) {
      const value = parseCexDecimal(price, "Order book bid price", false);
      if (best === undefined || value > best) best = value;
    }
    return best;
  }

  /** Lowest-priced ask (the best ask). */
  private bestAsk(): bigint | undefined {
    let best: bigint | undefined;
    for (const price of this.asks.keys()) {
      const value = parseCexDecimal(price, "Order book ask price", false);
      if (best === undefined || value < best) best = value;
    }
    return best;
  }

  /** Compute executable bid notional (price x quantity) near the mid price. */
  private computeBidDepth(mid: bigint, depthRangeBps: number): bigint {
    if (mid <= 0n) return 0n;

    const lower = mid * BigInt(10_000 - depthRangeBps) / 10_000n;

    let totalScaled = 0n;

    for (const [price, qty] of this.bids) {
      const priceValue = parseCexDecimal(price, "Order book bid price", false);
      if (priceValue >= lower && priceValue <= mid) {
        totalScaled += priceValue * parseCexDecimal(qty, "Order book bid quantity", false) / cexDecimalScale;
      }
    }

    return totalScaled / cexDecimalScale;
  }
}

// ─── helpers ───────────────────────────────────────────────────────

function normalizeLevels(value: unknown, field: string, maxLevels: number): PriceLevel[] {
  if (!Array.isArray(value) || value.length > maxLevels) {
    throw new Error(`${field}s must be an array with at most ${maxLevels} levels`);
  }
  return value.map((level, index) => {
    if (!Array.isArray(level) || level.length !== 2) {
      throw new Error(`${field} ${index} must contain price and quantity`);
    }
    return [
      normalizeCexDecimal(level[0], `${field} ${index} price`, false),
      normalizeCexDecimal(level[1], `${field} ${index} quantity`, true),
    ] as const;
  });
}
