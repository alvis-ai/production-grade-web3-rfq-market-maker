import { SharedPriceCache, pairKey } from "../price-cache.js";
import { type OrderBook, type OrderBookPairConfig } from "./orderbook.js";
import { BinanceConnector } from "./binance-connector.js";
import { CoinbaseConnector } from "./coinbase-connector.js";

// ─── Types ────────────────────────────────────────────────────────

export interface CexOrderBookConfig {
  /** Token pairs to monitor with their CEX symbols */
  pairs: OrderBookPairConfig[];
  /** Which CEX exchanges to connect */
  exchanges: Array<"binance" | "coinbase">;
  /** Range in bps from mid price for depth aggregation. Default 50 = 0.5%. */
  depthRangeBps: number;
  /** Interval in ms to flush metrics to the price cache. Default 100ms. */
  flushIntervalMs: number;
  /** Number of consecutive mid-price samples for volatility estimation. Default 10. */
  volatilitySampleSize: number;
}

const defaultConfig: CexOrderBookConfig = {
  pairs: [],
  exchanges: ["binance", "coinbase"],
  depthRangeBps: 50,
  flushIntervalMs: 100,
  volatilitySampleSize: 10,
};

interface ExchangeConnector {
  readonly name: string;
  start(): void;
  stop(): void;
  getOrderBook(): OrderBook;
}

// ─── CEXOrderBookMonitor ──────────────────────────────────────────

/**
 * CEX order book monitor.
 *
 * Manages WebSocket connections to configured CEX exchanges,
 * maintains in-memory Level-2 order books, computes pricing metrics
 * (mid price, spread, depth), and writes MarketSnapshot objects
 * into the SharedPriceCache at regular intervals.
 *
 * The cache is shared with CachedMarketDataService, so every
 * /quote request reads CEX-derived prices with < 1μs latency.
 */
export class CEXOrderBookMonitor {
  private readonly config: CexOrderBookConfig;
  private readonly cache: SharedPriceCache;
  private readonly connectors = new Map<string, ExchangeConnector>();
  private readonly priceHistory = new Map<string, number[]>();
  private flushTimer: ReturnType<typeof setInterval> | undefined;

  constructor(cache: SharedPriceCache, config: Partial<CexOrderBookConfig> = {}) {
    this.cache = cache;
    this.config = { ...defaultConfig, ...config, exchanges: config.exchanges ?? defaultConfig.exchanges };
  }

  /** Start all exchange connections and the metrics flush timer. */
  start(): void {
    for (const pair of this.config.pairs) {
      for (const exchange of this.config.exchanges) {
        this.startConnector(exchange, pair);
      }
    }

    this.flushTimer = setInterval(() => this.flush(), this.config.flushIntervalMs);
    this.flushTimer.unref();
  }

  /** Graceful shutdown of all connections and timers. */
  stop(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = undefined;
    }
    for (const connector of this.connectors.values()) {
      connector.stop();
    }
    this.connectors.clear();
  }

  /** Expose a connector's order book for diagnostics. */
  getOrderBook(exchange: string, symbol: string): OrderBook | undefined {
    return this.connectors.get(this.connectorKey(exchange, symbol))?.getOrderBook();
  }

  // ── per-connector setup ──

  private startConnector(exchange: "binance" | "coinbase", pair: OrderBookPairConfig): void {
    const key = this.connectorKey(exchange, pair.cexSymbol);
    if (this.connectors.has(key)) return; // already connected

    const onError = (error: Error) => {
      console.warn(`[CEX-${exchange}] ${pair.cexSymbol}: ${error.message}`);
    };

    let connector: ExchangeConnector;
    if (exchange === "binance") {
      connector = new BinanceConnector(pair.cexSymbol, () => {}, onError);
    } else {
      connector = new CoinbaseConnector(pair.cexSymbol, () => {}, onError);
    }

    connector.start();
    this.connectors.set(key, connector);
  }

  // ── metrics flush ──

  private flush(): void {
    for (const pair of this.config.pairs) {
      for (const exchange of this.config.exchanges) {
        const connector = this.connectors.get(this.connectorKey(exchange, pair.cexSymbol));
        if (!connector) continue;

        const book = connector.getOrderBook();
        if (book.bids.size === 0 || book.asks.size === 0) continue;

        const metrics = book.getMetrics(this.config.depthRangeBps);
        if (metrics.midPrice === "0") continue;

        // Track price history for volatility
        const histKey = `${exchange}:${pair.cexSymbol}`;
        this.recordPrice(histKey, parseFloat(metrics.midPrice));
        const volatilityBps = this.estimateVolatility(histKey);

        // Build MarketSnapshot and write to shared cache
        const snapshot = book.toMarketSnapshot(
          pair.chainId,
          pair.tokenIn,
          pair.tokenOut,
          volatilityBps,
          `cex-${exchange}`,
        );

        this.cache.set(pairKey(pair.chainId, pair.tokenIn, pair.tokenOut), snapshot);
      }
    }
  }

  // ── volatility estimation ──

  private recordPrice(key: string, price: number): void {
    let history = this.priceHistory.get(key);
    if (!history) {
      history = [];
      this.priceHistory.set(key, history);
    }
    history.push(price);
    if (history.length > this.config.volatilitySampleSize) {
      history.shift();
    }
  }

  private estimateVolatility(key: string): number {
    const history = this.priceHistory.get(key);
    if (!history || history.length < 2) return 10;

    const returns: number[] = [];
    for (let i = 1; i < history.length; i++) {
      if (history[i - 1] !== 0) {
        returns.push((history[i] - history[i - 1]) / history[i - 1]);
      }
    }
    if (returns.length < 2) return 10;

    const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
    const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / (returns.length - 1);
    const stdDev = Math.sqrt(variance);

    return Math.min(Math.max(Math.round(stdDev * 10_000), 1), 10_000);
  }

  // ── helpers ──

  private connectorKey(exchange: string, symbol: string): string {
    return `${exchange}:${symbol.toLowerCase()}`;
  }
}
