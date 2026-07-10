import type { MarketSnapshot } from "../../../shared/types/rfq.js";

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
  /** Cumulative liquidity in USD within the configured depth range */
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
  /** Trading pair symbol on the CEX, e.g. "BTCUSDT" */
  cexSymbol: string;
}

// ─── OrderBook ─────────────────────────────────────────────────────

/**
 * In-memory Level-2 order book.
 *
 * Maintains bid and ask levels as Map<priceString, quantityString>.
 * Prices are decimal strings as received from the exchange (e.g. "42123.45").
 * Numeric comparison uses float parse — sufficient for order-book precision.
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

  // ── state mutations ──

  /** Replace the full book (used after connecting or on reconnect). */
  applySnapshot(snapshot: OrderBookSnapshot): void {
    this.bids.clear();
    this.asks.clear();

    for (const [price, qty] of snapshot.bids) {
      if (!isZeroQty(qty)) this.bids.set(price, qty);
    }
    for (const [price, qty] of snapshot.asks) {
      if (!isZeroQty(qty)) this.asks.set(price, qty);
    }

    this.invalidate();
  }

  /**
   * Apply incremental changes.
   * Exchanges send the full price level on each update.
   * Quantity "0" or "0.00000000" means remove the level.
   */
  applyDelta(delta: OrderBookDelta): void {
    for (const [price, qty] of delta.bids) {
      if (isZeroQty(qty)) this.bids.delete(price);
      else this.bids.set(price, qty);
    }
    for (const [price, qty] of delta.asks) {
      if (isZeroQty(qty)) this.asks.delete(price);
      else this.asks.set(price, qty);
    }

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
    if (this.lastMetrics) return this.lastMetrics;

    const bestBidNum = this.bestBid();
    const bestAskNum = this.bestAsk();

    const bestBid = bestBidNum !== undefined ? bestBidNum.toString() : "0";
    const bestAsk = bestAskNum !== undefined ? bestAskNum.toString() : "0";
    const midPriceNum = bestBidNum !== undefined && bestAskNum !== undefined
      ? (bestBidNum + bestAskNum) / 2
      : 0;
    const midPrice = midPriceNum.toString();

    // Spread in bps
    const spreadBps = bestBidNum !== undefined && bestAskNum !== undefined && bestBidNum > 0
      ? Math.round(((bestAskNum - bestBidNum) / bestBidNum) * 10_000)
      : 0;

    // Cumulative liquidity within depthRangeBps of mid
    const liquidityUsd = this.computeDepth(midPriceNum, depthRangeBps);

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
    return entry;
  }

  /** Build a MarketSnapshot from the current order book state. */
  toMarketSnapshot(
    chainId: number,
    tokenIn: `0x${string}`,
    tokenOut: `0x${string}`,
    volatilityBps: number,
    source: string,
  ): MarketSnapshot {
    const metrics = this.getMetrics();
    const observedAtMs = Date.now();

    return {
      snapshotId: [
        "snapshot",
        chainId.toString(),
        tokenIn.slice(2, 10).toLowerCase(),
        tokenOut.slice(2, 10).toLowerCase(),
        observedAtMs.toString(36),
        "cex",
      ].join("_"),
      midPrice: metrics.midPrice,
      liquidityUsd: metrics.liquidityUsd,
      volatilityBps,
      observedAt: new Date(observedAtMs).toISOString(),
    };
  }

  // ── private helpers ──

  private invalidate(): void {
    this.lastMetrics = undefined;
  }

  /** Highest-priced bid (the best bid). */
  private bestBid(): number | undefined {
    let best: number | undefined;
    for (const price of this.bids.keys()) {
      const n = parseDecimal(price);
      if (best === undefined || n > best) best = n;
    }
    return best;
  }

  /** Lowest-priced ask (the best ask). */
  private bestAsk(): number | undefined {
    let best: number | undefined;
    for (const price of this.asks.keys()) {
      const n = parseDecimal(price);
      if (best === undefined || n < best) best = n;
    }
    return best;
  }

  /**
   * Compute total notional value (price × quantity) of all levels
   * within depthRangeBps of the mid price.
   */
  private computeDepth(mid: number, depthRangeBps: number): number {
    if (mid <= 0) return 0;

    const rangeFraction = depthRangeBps / 10_000;
    const lower = mid * (1 - rangeFraction);
    const upper = mid * (1 + rangeFraction);

    let total = 0;

    for (const [price, qty] of this.bids) {
      const p = parseDecimal(price);
      if (p >= lower && p <= upper) {
        total += p * parseDecimal(qty);
      }
    }
    for (const [price, qty] of this.asks) {
      const p = parseDecimal(price);
      if (p >= lower && p <= upper) {
        total += p * parseDecimal(qty);
      }
    }

    return total;
  }
}

// ─── helpers ───────────────────────────────────────────────────────

function parseDecimal(s: string): number {
  const n = Number(s);
  if (!Number.isFinite(n)) return 0;
  return n;
}

function isZeroQty(qty: string): boolean {
  return qty === "0" || qty === "0.00000000" || qty === "0.0" || qty === "0.00";
}
