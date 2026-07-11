import type { MarketSnapshot } from "../../../shared/types/rfq.js";
import { tagMarketDataSnapshot } from "../market-data.service.js";
import { SharedPriceCache, pairKey } from "../price-cache.js";
import {
  cexDeviationBps,
  formatCexDecimal,
  medianCexDecimal,
  parseCexDecimal,
} from "./decimal.js";
import { type OrderBook, type OrderBookMetrics, type OrderBookPairConfig } from "./orderbook.js";
import { BinanceConnector } from "./binance-connector.js";
import { CoinbaseConnector } from "./coinbase-connector.js";

export interface CexOrderBookConfig {
  pairs: OrderBookPairConfig[];
  depthRangeBps: number;
  flushIntervalMs: number;
  volatilitySampleSize: number;
  maxSourceAgeMs: number;
  maxFutureSkewMs: number;
  minSources: number;
  maxSourceDeviationBps: number;
  maxSpreadBps: number;
}

export interface ExchangeConnector {
  readonly name: string;
  start(): void;
  stop(): void;
  restart(): void;
  getOrderBook(): OrderBook;
  getLastUpdateAtMs(): number | undefined;
  isReady(): boolean;
}

export type ExchangeConnectorFactory = (
  exchange: OrderBookPairConfig["exchange"],
  symbol: string,
  onError: (error: Error) => void,
) => ExchangeConnector;

export interface CexOrderBookCycleObservation {
  configuredSources: number;
  readySources: number;
  staleSources: number;
  unavailableSources: number;
  usablePairs: number;
  blockedPairs: number;
  deviationRejectedSources: number;
  maxUpdateAgeSeconds: number;
}

export interface CexOrderBookObserver {
  recordCexOrderBookCycle(observation: CexOrderBookCycleObservation): void;
  recordCexOrderBookConnectorError(exchange: OrderBookPairConfig["exchange"]): void;
}

const defaultConfig: CexOrderBookConfig = {
  pairs: [],
  depthRangeBps: 50,
  flushIntervalMs: 100,
  volatilitySampleSize: 10,
  maxSourceAgeMs: 2_000,
  maxFutureSkewMs: 1_000,
  minSources: 1,
  maxSourceDeviationBps: 100,
  maxSpreadBps: 100,
};

const noopObserver: CexOrderBookObserver = {
  recordCexOrderBookCycle() {},
  recordCexOrderBookConnectorError() {},
};

interface SourceMetrics {
  connectorKey: string;
  metrics: OrderBookMetrics;
  midPriceValue: bigint;
  observedAtMs: number;
  source: OrderBookPairConfig["exchange"];
}

type SourceState = "ready" | "stale" | "unavailable";

interface InspectedSource {
  state: SourceState;
  metrics?: OrderBookMetrics;
  midPriceValue?: bigint;
  observedAtMs?: number;
  ageMs?: number;
}

export class CEXOrderBookMonitor {
  private readonly config: CexOrderBookConfig;
  private readonly cache: SharedPriceCache;
  private readonly observer: CexOrderBookObserver;
  private readonly connectorFactory: ExchangeConnectorFactory;
  private readonly connectors = new Map<string, ExchangeConnector>();
  private readonly priceHistory = new Map<string, number[]>();
  private readonly lastPublishedFingerprint = new Map<string, string>();
  private flushTimer: ReturnType<typeof setInterval> | undefined;
  private snapshotSequence = 0;

  constructor(
    cache: SharedPriceCache,
    config: Partial<CexOrderBookConfig> = {},
    observer: CexOrderBookObserver = noopObserver,
    connectorFactory: ExchangeConnectorFactory = createConnector,
  ) {
    if (!(cache instanceof SharedPriceCache)) {
      throw new Error("CEX order book monitor cache must be a SharedPriceCache");
    }
    assertObserver(observer);
    if (typeof connectorFactory !== "function") {
      throw new Error("CEX order book connectorFactory must be a function");
    }
    this.cache = cache;
    this.config = normalizeConfig(config);
    this.observer = observer;
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
    for (const key of groupPairs(this.config.pairs).keys()) this.cache.delete(key);
    this.lastPublishedFingerprint.clear();
    this.priceHistory.clear();
  }

  getOrderBook(exchange: string, symbol: string): OrderBook | undefined {
    return this.connectors.get(connectorKey(exchange, symbol))?.getOrderBook();
  }

  flushOnce(nowMs = Date.now()): void {
    assertTimestamp(nowMs, "flush timestamp");
    const inspected = this.inspectSources(nowMs);
    const groupedPairs = groupPairs(this.config.pairs);
    let usablePairs = 0;
    let blockedPairs = 0;
    let deviationRejectedSources = 0;

    for (const [cacheKey, pairs] of groupedPairs) {
      const sources = this.readSources(pairs, inspected);
      if (sources.length < this.config.minSources) {
        this.invalidatePair(cacheKey);
        blockedPairs += 1;
        continue;
      }

      const median = medianCexDecimal(sources.map(({ midPriceValue }) => midPriceValue));
      const accepted = sources.filter(({ midPriceValue }) => {
        return cexDeviationBps(midPriceValue, median) <= this.config.maxSourceDeviationBps;
      });
      deviationRejectedSources += sources.length - accepted.length;
      if (accepted.length < this.config.minSources) {
        this.invalidatePair(cacheKey);
        blockedPairs += 1;
        continue;
      }

      usablePairs += 1;
      const fingerprint = sourceFingerprint(accepted);
      if (this.lastPublishedFingerprint.get(cacheKey) === fingerprint) continue;
      const snapshot = this.aggregateSnapshot(pairs[0], cacheKey, accepted);
      this.cache.set(cacheKey, snapshot);
      this.lastPublishedFingerprint.set(cacheKey, fingerprint);
    }

    const states = [...inspected.values()];
    this.observer.recordCexOrderBookCycle({
      configuredSources: states.length,
      readySources: states.filter(({ state }) => state === "ready").length,
      staleSources: states.filter(({ state }) => state === "stale").length,
      unavailableSources: states.filter(({ state }) => state === "unavailable").length,
      usablePairs,
      blockedPairs,
      deviationRejectedSources,
      maxUpdateAgeSeconds: Math.max(0, ...states.map(({ ageMs }) => ageMs === undefined ? 0 : ageMs / 1_000)),
    });
  }

  private startConnector(pair: OrderBookPairConfig): void {
    const key = connectorKey(pair.exchange, pair.symbol);
    if (this.connectors.has(key)) return;
    const connector = this.connectorFactory(pair.exchange, pair.symbol, (error) => {
      this.observer.recordCexOrderBookConnectorError(pair.exchange);
      console.warn(`[CEX-${pair.exchange}] ${pair.symbol}: ${error.message}`);
    });
    assertConnector(connector);
    connector.start();
    this.connectors.set(key, connector);
  }

  private inspectSources(nowMs: number): Map<string, InspectedSource> {
    const result = new Map<string, InspectedSource>();
    for (const [key, connector] of this.connectors) {
      if (!connector.isReady()) {
        result.set(key, { state: "unavailable" });
        continue;
      }

      const observedAtMs = connector.getLastUpdateAtMs();
      if (!Number.isSafeInteger(observedAtMs) || (observedAtMs as number) <= 0) {
        result.set(key, { state: "stale" });
        connector.restart();
        continue;
      }
      const ageMs = nowMs - (observedAtMs as number);
      if (ageMs > this.config.maxSourceAgeMs || ageMs < -this.config.maxFutureSkewMs) {
        result.set(key, { state: "stale", observedAtMs, ageMs: Math.max(0, ageMs) });
        connector.restart();
        continue;
      }

      try {
        const metrics = connector.getOrderBook().getMetrics(this.config.depthRangeBps);
        const midPriceValue = usableMidPrice(metrics, this.config.maxSpreadBps);
        result.set(key, { state: "ready", metrics, midPriceValue, observedAtMs, ageMs: Math.max(0, ageMs) });
      } catch {
        result.set(key, { state: "unavailable", observedAtMs, ageMs: Math.max(0, ageMs) });
        connector.restart();
      }
    }
    return result;
  }

  private readSources(
    pairs: readonly OrderBookPairConfig[],
    inspected: ReadonlyMap<string, InspectedSource>,
  ): SourceMetrics[] {
    const sources: SourceMetrics[] = [];
    for (const pair of pairs) {
      const key = connectorKey(pair.exchange, pair.symbol);
      const source = inspected.get(key);
      if (source?.state !== "ready" || !source.metrics ||
          source.midPriceValue === undefined || source.observedAtMs === undefined) continue;
      sources.push({
        connectorKey: key,
        metrics: source.metrics,
        midPriceValue: source.midPriceValue,
        observedAtMs: source.observedAtMs,
        source: pair.exchange,
      });
    }
    return sources;
  }

  private aggregateSnapshot(
    pair: OrderBookPairConfig,
    cacheKey: string,
    sources: readonly SourceMetrics[],
  ): MarketSnapshot {
    const midPriceValue = medianCexDecimal(sources.map(({ midPriceValue }) => midPriceValue));
    const midPrice = formatCexDecimal(midPriceValue);
    const liquidity = sources.reduce((total, { metrics }) => total + BigInt(metrics.liquidityUsd), 0n);
    const observedAtMs = Math.min(...sources.map(({ observedAtMs }) => observedAtMs));
    this.recordPrice(cacheKey, Number(midPrice));
    this.snapshotSequence += 1;

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
      midPrice,
      liquidityUsd: liquidity.toString(),
      volatilityBps: this.estimateVolatility(cacheKey),
      observedAt: new Date(observedAtMs).toISOString(),
    }, `cex:${Array.from(new Set(sources.map(({ source }) => source))).sort().join("+")}`);
  }

  private recordPrice(key: string, price: number): void {
    if (!Number.isFinite(price) || price <= 0) throw new Error("CEX aggregate price is outside numeric volatility range");
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

  private invalidatePair(cacheKey: string): void {
    this.cache.delete(cacheKey);
    this.lastPublishedFingerprint.delete(cacheKey);
  }
}

function createConnector(
  exchange: OrderBookPairConfig["exchange"],
  symbol: string,
  onError: (error: Error) => void,
): ExchangeConnector {
  return exchange === "binance"
    ? new BinanceConnector(symbol, undefined, onError)
    : new CoinbaseConnector(symbol, undefined, onError);
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
  assertInteger(config.maxSourceAgeMs, 100, 60_000, "maxSourceAgeMs");
  assertInteger(config.maxFutureSkewMs, 0, 60_000, "maxFutureSkewMs");
  assertInteger(config.minSources, 1, 10, "minSources");
  assertInteger(config.maxSourceDeviationBps, 1, 10_000, "maxSourceDeviationBps");
  assertInteger(config.maxSpreadBps, 1, 10_000, "maxSpreadBps");

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

  for (const pairs of groupPairs(config.pairs).values()) {
    if (pairs.length < config.minSources) {
      throw new Error("CEX order book each pair must configure at least minSources distinct sources");
    }
  }
}

function normalizeConfig(config: unknown): CexOrderBookConfig {
  if (!isRecord(config)) throw new Error("CEX order book config must be an object");
  assertKnownFields(config, [
    "pairs",
    "depthRangeBps",
    "flushIntervalMs",
    "volatilitySampleSize",
    "maxSourceAgeMs",
    "maxFutureSkewMs",
    "minSources",
    "maxSourceDeviationBps",
    "maxSpreadBps",
  ], "CEX order book config");
  if (config.pairs !== undefined && !Array.isArray(config.pairs)) {
    throw new Error("CEX order book pairs must be an array");
  }
  const normalized = {
    pairs: (config.pairs ?? defaultConfig.pairs).map((pair) => isRecord(pair) ? { ...pair } : pair),
    depthRangeBps: config.depthRangeBps ?? defaultConfig.depthRangeBps,
    flushIntervalMs: config.flushIntervalMs ?? defaultConfig.flushIntervalMs,
    volatilitySampleSize: config.volatilitySampleSize ?? defaultConfig.volatilitySampleSize,
    maxSourceAgeMs: config.maxSourceAgeMs ?? defaultConfig.maxSourceAgeMs,
    maxFutureSkewMs: config.maxFutureSkewMs ?? defaultConfig.maxFutureSkewMs,
    minSources: config.minSources ?? defaultConfig.minSources,
    maxSourceDeviationBps: config.maxSourceDeviationBps ?? defaultConfig.maxSourceDeviationBps,
    maxSpreadBps: config.maxSpreadBps ?? defaultConfig.maxSpreadBps,
  } as CexOrderBookConfig;
  assertConfig(normalized);
  return normalized;
}

function usableMidPrice(metrics: OrderBookMetrics, maxSpreadBps: number): bigint {
  if (!isRecord(metrics) || !Number.isSafeInteger(metrics.spreadBps) || metrics.spreadBps < 0 ||
      metrics.spreadBps > maxSpreadBps || !Number.isSafeInteger(metrics.bidLevels) || metrics.bidLevels <= 0 ||
      !Number.isSafeInteger(metrics.askLevels) || metrics.askLevels <= 0 ||
      typeof metrics.liquidityUsd !== "string" || !/^[1-9][0-9]*$/.test(metrics.liquidityUsd)) {
    throw new Error("CEX order book metrics are unusable");
  }
  const bid = parseCexDecimal(metrics.bestBid, "CEX best bid", false);
  const ask = parseCexDecimal(metrics.bestAsk, "CEX best ask", false);
  const mid = parseCexDecimal(metrics.midPrice, "CEX mid price", false);
  if (ask <= bid || mid < bid || mid > ask) throw new Error("CEX order book spread is invalid");
  return mid;
}

function sourceFingerprint(sources: readonly SourceMetrics[]): string {
  return [...sources]
    .sort((left, right) => left.connectorKey.localeCompare(right.connectorKey))
    .map(({ connectorKey: key, metrics, observedAtMs }) => {
      return `${key}:${observedAtMs}:${metrics.midPrice}:${metrics.liquidityUsd}:${metrics.spreadBps}`;
    })
    .join("|");
}

function assertInteger(value: number, min: number, max: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`CEX order book ${field} must be an integer between ${min} and ${max}`);
  }
}

function assertTimestamp(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`CEX order book ${field} must be a positive safe integer`);
}

function connectorKey(exchange: string, symbol: string): string {
  return `${exchange.toLowerCase()}:${symbol.toLowerCase()}`;
}

function assertConnector(value: unknown): asserts value is ExchangeConnector {
  if (!isRecord(value)) throw new Error("CEX order book connector must be an object");
  for (const method of ["start", "stop", "restart", "getOrderBook", "getLastUpdateAtMs", "isReady"] as const) {
    if (typeof value[method] !== "function") throw new Error(`CEX order book connector.${method} must be a function`);
  }
  if (typeof value.name !== "string" || value.name.length === 0 || value.name.length > 128) {
    throw new Error("CEX order book connector.name must be a bounded string");
  }
}

function assertObserver(value: unknown): asserts value is CexOrderBookObserver {
  if (!isRecord(value)) throw new Error("CEX order book observer must be an object");
  for (const method of ["recordCexOrderBookCycle", "recordCexOrderBookConnectorError"] as const) {
    if (typeof value[method] !== "function") throw new Error(`CEX order book observer.${method} must be a function`);
  }
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
