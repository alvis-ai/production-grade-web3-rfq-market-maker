import type { MarketSnapshot } from "../../../shared/types/rfq.js";
import { tagMarketDataSnapshot } from "../market-data.service.js";
import { SharedPriceCache, pairKey } from "../price-cache.js";
import { type OrderBook, type OrderBookMetrics, type OrderBookPairConfig } from "./orderbook.js";
import { BinanceConnector } from "./binance-connector.js";
import { CoinbaseConnector } from "./coinbase-connector.js";

export interface CexOrderBookConfig {
  pairs: OrderBookPairConfig[];
  depthRangeBps: number;
  flushIntervalMs: number;
  volatilitySampleSize: number;
}

export interface ExchangeConnector {
  readonly name: string;
  start(): void;
  stop(): void;
  getOrderBook(): OrderBook;
  isReady(): boolean;
}

export type ExchangeConnectorFactory = (
  exchange: OrderBookPairConfig["exchange"],
  symbol: string,
  onError: (error: Error) => void,
) => ExchangeConnector;

const defaultConfig: CexOrderBookConfig = {
  pairs: [],
  depthRangeBps: 50,
  flushIntervalMs: 100,
  volatilitySampleSize: 10,
};

interface SourceMetrics {
  metrics: OrderBookMetrics;
  source: OrderBookPairConfig["exchange"];
}

export class CEXOrderBookMonitor {
  private readonly config: CexOrderBookConfig;
  private readonly cache: SharedPriceCache;
  private readonly connectorFactory: ExchangeConnectorFactory;
  private readonly connectors = new Map<string, ExchangeConnector>();
  private readonly priceHistory = new Map<string, number[]>();
  private flushTimer: ReturnType<typeof setInterval> | undefined;
  private snapshotSequence = 0;

  constructor(
    cache: SharedPriceCache,
    config: Partial<CexOrderBookConfig> = {},
    connectorFactory: ExchangeConnectorFactory = createConnector,
  ) {
    this.cache = cache;
    this.config = normalizeConfig(config);
    this.connectorFactory = connectorFactory;
  }

  start(): void {
    if (this.flushTimer) return;
    for (const pair of this.config.pairs) this.startConnector(pair);
    this.flushTimer = setInterval(() => this.flushOnce(), this.config.flushIntervalMs);
    this.flushTimer.unref();
  }

  stop(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = undefined;
    }
    for (const connector of this.connectors.values()) connector.stop();
    this.connectors.clear();
  }

  getOrderBook(exchange: string, symbol: string): OrderBook | undefined {
    return this.connectors.get(connectorKey(exchange, symbol))?.getOrderBook();
  }

  flushOnce(): void {
    const groupedPairs = groupPairs(this.config.pairs);
    for (const pairs of groupedPairs.values()) {
      const sources = this.readSources(pairs);
      if (sources.length === 0) continue;

      const representative = pairs[0];
      const cacheKey = pairKey(representative.chainId, representative.tokenIn, representative.tokenOut);
      const snapshot = this.aggregateSnapshot(representative, cacheKey, sources);
      this.cache.set(cacheKey, snapshot);
    }
  }

  private startConnector(pair: OrderBookPairConfig): void {
    const key = connectorKey(pair.exchange, pair.symbol);
    if (this.connectors.has(key)) return;
    const connector = this.connectorFactory(pair.exchange, pair.symbol, (error) => {
      console.warn(`[CEX-${pair.exchange}] ${pair.symbol}: ${error.message}`);
    });
    connector.start();
    this.connectors.set(key, connector);
  }

  private readSources(pairs: readonly OrderBookPairConfig[]): SourceMetrics[] {
    const sources: SourceMetrics[] = [];
    for (const pair of pairs) {
      const connector = this.connectors.get(connectorKey(pair.exchange, pair.symbol));
      if (!connector?.isReady()) continue;
      const metrics = connector.getOrderBook().getMetrics(this.config.depthRangeBps);
      if (!isUsableMetrics(metrics)) continue;
      sources.push({ metrics, source: pair.exchange });
    }
    return sources;
  }

  private aggregateSnapshot(
    pair: OrderBookPairConfig,
    cacheKey: string,
    sources: readonly SourceMetrics[],
  ): MarketSnapshot {
    const prices = sources.map(({ metrics }) => Number(metrics.midPrice)).sort((a, b) => a - b);
    const midPrice = median(prices);
    const liquidity = sources.reduce((total, { metrics }) => total + BigInt(metrics.liquidityUsd), 0n);
    this.recordPrice(cacheKey, midPrice);
    this.snapshotSequence += 1;
    const observedAtMs = Date.now();

    return tagMarketDataSnapshot({
      snapshotId: [
        "snapshot",
        pair.chainId.toString(),
        pair.tokenIn.slice(2, 10).toLowerCase(),
        pair.tokenOut.slice(2, 10).toLowerCase(),
        observedAtMs.toString(36),
        this.snapshotSequence.toString(36),
        "cex",
      ].join("_"),
      midPrice: formatDecimal(midPrice),
      liquidityUsd: (liquidity > 0n ? liquidity : 1n).toString(),
      volatilityBps: this.estimateVolatility(cacheKey),
      observedAt: new Date(observedAtMs).toISOString(),
    }, `cex:${Array.from(new Set(sources.map(({ source }) => source))).sort().join("+")}`);
  }

  private recordPrice(key: string, price: number): void {
    const history = this.priceHistory.get(key) ?? [];
    history.push(price);
    while (history.length > this.config.volatilitySampleSize) history.shift();
    this.priceHistory.set(key, history);
  }

  private estimateVolatility(key: string): number {
    const history = this.priceHistory.get(key);
    if (!history || history.length < 3) return 10;
    const returns: number[] = [];
    for (let index = 1; index < history.length; index += 1) {
      returns.push((history[index] - history[index - 1]) / history[index - 1]);
    }
    const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
    const variance = returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (returns.length - 1);
    return Math.min(Math.max(Math.round(Math.sqrt(variance) * 10_000), 1), 10_000);
  }
}

function createConnector(
  exchange: OrderBookPairConfig["exchange"],
  symbol: string,
  onError: (error: Error) => void,
): ExchangeConnector {
  return exchange === "binance"
    ? new BinanceConnector(symbol, () => {}, onError)
    : new CoinbaseConnector(symbol, () => {}, onError);
}

function groupPairs(pairs: readonly OrderBookPairConfig[]): Map<string, OrderBookPairConfig[]> {
  const grouped = new Map<string, OrderBookPairConfig[]>();
  for (const pair of pairs) {
    const key = pairKey(pair.chainId, pair.tokenIn, pair.tokenOut);
    const group = grouped.get(key) ?? [];
    group.push(pair);
    grouped.set(key, group);
  }
  return grouped;
}

function assertConfig(config: CexOrderBookConfig): void {
  if (!Array.isArray(config.pairs) || config.pairs.length === 0) {
    throw new Error("CEX order book pairs must contain at least one source");
  }
  assertInteger(config.depthRangeBps, 1, 10_000, "depthRangeBps");
  assertInteger(config.flushIntervalMs, 50, 60_000, "flushIntervalMs");
  assertInteger(config.volatilitySampleSize, 3, 10_000, "volatilitySampleSize");

  const seenSources = new Set<string>();
  for (const pair of config.pairs) {
    if (!isRecord(pair)) throw new Error("CEX pair must be an object");
    assertExactFields(pair, ["chainId", "tokenIn", "tokenOut", "exchange", "symbol"], "CEX pair");
    if (!Number.isSafeInteger(pair.chainId) || pair.chainId <= 0) throw new Error("CEX pair chainId must be a positive safe integer");
    if (!/^0x[0-9a-fA-F]{40}$/.test(pair.tokenIn) || !/^0x[0-9a-fA-F]{40}$/.test(pair.tokenOut)) {
      throw new Error("CEX pair tokens must be 20-byte hex addresses");
    }
    if (pair.tokenIn.toLowerCase() === pair.tokenOut.toLowerCase()) throw new Error("CEX pair tokens must be distinct");
    if (pair.exchange !== "binance" && pair.exchange !== "coinbase") throw new Error("CEX pair exchange must be binance or coinbase");
    if (!/^[A-Za-z0-9._-]{3,32}$/.test(pair.symbol)) throw new Error("CEX pair symbol must contain 3-32 exchange symbol characters");
    const sourceKey = `${pairKey(pair.chainId, pair.tokenIn, pair.tokenOut)}:${connectorKey(pair.exchange, pair.symbol)}`;
    if (seenSources.has(sourceKey)) throw new Error("CEX order book pairs must not contain duplicate sources");
    seenSources.add(sourceKey);
  }
}

function normalizeConfig(config: unknown): CexOrderBookConfig {
  if (!isRecord(config)) throw new Error("CEX order book config must be an object");
  assertKnownFields(config, ["pairs", "depthRangeBps", "flushIntervalMs", "volatilitySampleSize"], "CEX order book config");
  if (config.pairs !== undefined && !Array.isArray(config.pairs)) {
    throw new Error("CEX order book pairs must be an array");
  }
  const normalized = {
    pairs: (config.pairs ?? defaultConfig.pairs).map((pair) => isRecord(pair) ? { ...pair } : pair),
    depthRangeBps: config.depthRangeBps ?? defaultConfig.depthRangeBps,
    flushIntervalMs: config.flushIntervalMs ?? defaultConfig.flushIntervalMs,
    volatilitySampleSize: config.volatilitySampleSize ?? defaultConfig.volatilitySampleSize,
  } as CexOrderBookConfig;
  assertConfig(normalized);
  return normalized;
}

function assertInteger(value: number, min: number, max: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`CEX order book ${field} must be an integer between ${min} and ${max}`);
  }
}

function isUsableMetrics(metrics: OrderBookMetrics): boolean {
  const midPrice = Number(metrics.midPrice);
  return Number.isFinite(midPrice) && midPrice > 0 && /^[1-9][0-9]*$/.test(metrics.liquidityUsd);
}

function connectorKey(exchange: string, symbol: string): string {
  return `${exchange.toLowerCase()}:${symbol.toLowerCase()}`;
}

function median(sorted: readonly number[]): number {
  const midpoint = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[midpoint] : (sorted[midpoint - 1] + sorted[midpoint]) / 2;
}

function formatDecimal(value: number): string {
  return value.toFixed(18).replace(/0+$/, "").replace(/\.$/, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertExactFields(value: object, fields: readonly string[], label: string): void {
  assertKnownFields(value, fields, label);
  for (const field of fields) {
    if (!Object.prototype.hasOwnProperty.call(value, field)) throw new Error(`${label}.${field} must be an own field`);
  }
}

function assertKnownFields(value: object, fields: readonly string[], label: string): void {
  const allowed = new Set(fields);
  for (const field of Object.keys(value)) {
    if (!allowed.has(field)) throw new Error(`${label} must not include unknown field ${field}`);
  }
}
