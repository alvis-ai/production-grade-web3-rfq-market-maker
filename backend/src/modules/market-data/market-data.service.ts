import type { MarketSnapshot, QuoteRequest } from "../../shared/types/rfq.js";
import { parseCanonicalUtcIsoTimestamp } from "../../shared/validation/timestamp.js";

export interface MarketDataService {
  getSnapshot(request: QuoteRequest): Promise<MarketSnapshot>;
}

const marketDataSourceSymbol = Symbol("rfq.marketDataSource");
type SourcedMarketSnapshot = MarketSnapshot & { [marketDataSourceSymbol]?: string };

export function tagMarketDataSnapshot(snapshot: MarketSnapshot, source: string): MarketSnapshot {
  if (typeof source !== "string" || !/^[A-Za-z0-9._:+-]{1,128}$/.test(source)) {
    throw new Error("Market data source must be a bounded safe identifier");
  }
  Object.defineProperty(snapshot, marketDataSourceSymbol, {
    configurable: false,
    enumerable: false,
    value: source,
    writable: false,
  });
  return snapshot;
}

export function getMarketDataSnapshotSource(snapshot: MarketSnapshot): string | undefined {
  if (typeof snapshot !== "object" || snapshot === null) return undefined;
  const source = (snapshot as SourcedMarketSnapshot)[marketDataSourceSymbol];
  return typeof source === "string" ? source : undefined;
}

export interface StaticMarketDataPair {
  chainId: number;
  tokenIn: `0x${string}`;
  tokenOut: `0x${string}`;
}

export interface StaticMarketDataConfig {
  supportedPairs: readonly StaticMarketDataPair[];
}

export const defaultStaticMarketDataConfig: StaticMarketDataConfig = {
  supportedPairs: [
    {
      chainId: 1,
      tokenIn: "0x0000000000000000000000000000000000000002",
      tokenOut: "0x0000000000000000000000000000000000000003",
    },
    {
      chainId: 1,
      tokenIn: "0x0000000000000000000000000000000000000003",
      tokenOut: "0x0000000000000000000000000000000000000002",
    },
  ],
};
const staticMarketDataConfigFields = ["supportedPairs"] as const;
const staticMarketDataPairFields = ["chainId", "tokenIn", "tokenOut"] as const;
const quoteRequestFields = ["chainId", "user", "tokenIn", "tokenOut", "amountIn", "slippageBps"] as const;
const marketSnapshotIssueFields = ["snapshotId", "midPrice", "liquidityUsd", "volatilityBps", "observedAt"] as const;

export class StaticMarketDataService implements MarketDataService {
  private readonly supportedPairs: ReadonlySet<string>;
  private snapshotSequence = 0;

  constructor(config: StaticMarketDataConfig = defaultStaticMarketDataConfig) {
    assertStaticMarketDataConfig(config);
    const snapshotConfig = cloneStaticMarketDataConfig(config);
    this.supportedPairs = new Set(snapshotConfig.supportedPairs.map((pair) => pairKey(pair)));
  }

  async getSnapshot(request: QuoteRequest): Promise<MarketSnapshot> {
    assertQuoteRequest(request);
    if (!this.supportedPairs.has(pairKey(request))) {
      throw new Error("Market data pair is not configured");
    }

    const observedAtMs = Date.now();
    this.snapshotSequence += 1;

    return tagMarketDataSnapshot({
      snapshotId: [
        "snapshot",
        request.chainId.toString(),
        request.tokenIn.slice(2, 10).toLowerCase(),
        request.tokenOut.slice(2, 10).toLowerCase(),
        observedAtMs.toString(36),
        this.snapshotSequence.toString(36),
      ].join("_"),
      midPrice: "1",
      liquidityUsd: "10000000000000",
      volatilityBps: 25,
      observedAt: new Date(observedAtMs).toISOString(),
    }, "static-market-data-v1");
  }
}

function pairKey(pair: StaticMarketDataPair): string {
  return `${pair.chainId}:${pair.tokenIn.toLowerCase()}:${pair.tokenOut.toLowerCase()}`;
}

function cloneStaticMarketDataConfig(config: StaticMarketDataConfig): StaticMarketDataConfig {
  return {
    supportedPairs: config.supportedPairs.map((pair) => ({ ...pair })),
  };
}

function assertStaticMarketDataConfig(config: StaticMarketDataConfig): void {
  assertObject(config, "config");
  assertOwnFields(config, staticMarketDataConfigFields, "config");
  if (!Array.isArray(config.supportedPairs) || config.supportedPairs.length === 0) {
    throw new Error("Static market data supportedPairs must contain at least one pair");
  }

  const seenPairs = new Set<string>();
  for (const pair of config.supportedPairs) {
    assertObject(pair, "supportedPairs entry");
    assertOwnFields(pair, staticMarketDataPairFields, "supportedPairs entry");
    assertPositiveSafeInteger(pair.chainId, "supportedPairs.chainId");
    assertAddress(pair.tokenIn, "supportedPairs.tokenIn");
    assertAddress(pair.tokenOut, "supportedPairs.tokenOut");

    if (pair.tokenIn.toLowerCase() === pair.tokenOut.toLowerCase()) {
      throw new Error("Static market data supportedPairs must contain distinct tokens");
    }

    const key = pairKey(pair);
    if (seenPairs.has(key)) {
      throw new Error("Static market data supportedPairs must not contain duplicate pairs");
    }
    seenPairs.add(key);
  }
}

function assertQuoteRequest(request: QuoteRequest): void {
  assertObject(request, "request");
  assertOwnFields(request, quoteRequestFields, "request");
  assertPositiveSafeInteger(request.chainId, "request.chainId");
  assertAddress(request.user, "request.user");
  assertAddress(request.tokenIn, "request.tokenIn");
  assertAddress(request.tokenOut, "request.tokenOut");
  if (request.tokenIn.toLowerCase() === request.tokenOut.toLowerCase()) {
    throw new Error("Static market data request token pair must contain distinct tokens");
  }
  assertPositiveUIntString(request.amountIn, "request.amountIn");
  assertNonNegativeBps(request.slippageBps, "request.slippageBps");
}

function assertObject(value: unknown, field: "config" | "supportedPairs entry" | "request"): void {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Static market data ${field} must be an object`);
  }
}

function assertOwnFields(value: object, fields: readonly string[], path: string): void {
  for (const field of fields) {
    if (!Object.prototype.hasOwnProperty.call(value, field)) {
      throw new Error(`Static market data ${path}.${field} must be an own field`);
    }
  }
}

function assertPositiveSafeInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`Static market data ${field} must be a positive safe integer`);
  }
}

function assertAddress(value: string, field: string): void {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new Error(`Static market data ${field} must be a 20-byte hex address`);
  }
}

function assertPositiveUIntString(value: string, field: string): void {
  if (typeof value !== "string" || !/^[1-9][0-9]*$/.test(value)) {
    throw new Error(`Static market data ${field} must be a positive uint string`);
  }
}

function assertNonNegativeBps(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Static market data ${field} must be a non-negative safe integer`);
  }
  if (value > 10_000) {
    throw new Error(`Static market data ${field} must be less than or equal to 10000 bps`);
  }
}

export const defaultMaxSnapshotFutureSkewMs = 1_000;

export function getMarketSnapshotIssue(
  snapshot: MarketSnapshot,
  maxSnapshotAgeMs: number,
  maxSnapshotFutureSkewMs = defaultMaxSnapshotFutureSkewMs,
): string | undefined {
  if (!Number.isSafeInteger(maxSnapshotAgeMs) || maxSnapshotAgeMs < 0) {
    return "snapshot freshness window is invalid";
  }
  if (!Number.isSafeInteger(maxSnapshotFutureSkewMs) || maxSnapshotFutureSkewMs < 0) {
    return "snapshot future skew window is invalid";
  }
  if (!isMarketSnapshotRecord(snapshot) || !hasOwnMarketSnapshotIssueFields(snapshot)) {
    return "snapshot is invalid";
  }

  if (typeof snapshot.snapshotId !== "string" || snapshot.snapshotId.trim().length === 0) {
    return "snapshot id is missing";
  }

  if (!isPositiveDecimal(snapshot.midPrice)) {
    return "mid price is invalid";
  }

  if (!isPositiveIntegerString(snapshot.liquidityUsd)) {
    return "liquidity is invalid";
  }

  if (!Number.isSafeInteger(snapshot.volatilityBps) || snapshot.volatilityBps < 0 || snapshot.volatilityBps > 10_000) {
    return "volatility is invalid";
  }

  const observedAtMs = parseCanonicalUtcIsoTimestamp(snapshot.observedAt);
  if (observedAtMs === undefined) {
    return "snapshot timestamp is invalid";
  }

  const ageMs = Date.now() - observedAtMs;
  if (ageMs < -maxSnapshotFutureSkewMs) {
    return "snapshot timestamp is too far in the future";
  }

  if (ageMs <= maxSnapshotAgeMs) {
    return undefined;
  }

  return "snapshot is stale";
}

function isMarketSnapshotRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwnMarketSnapshotIssueFields(value: object): boolean {
  for (const field of marketSnapshotIssueFields) {
    if (!Object.prototype.hasOwnProperty.call(value, field)) {
      return false;
    }
  }

  return true;
}

function isPositiveDecimal(value: string): boolean {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(value)) {
    return false;
  }

  return parseDecimalToScaledBigInt(value) > 0n;
}

function isPositiveIntegerString(value: string): boolean {
  return typeof value === "string" && /^[1-9][0-9]*$/.test(value);
}

function parseDecimalToScaledBigInt(value: string): bigint {
  const [whole, fraction = ""] = value.split(".");
  const scaledFraction = `${fraction.slice(0, 18)}${"0".repeat(Math.max(0, 18 - fraction.length))}`;
  return BigInt(whole) * 1_000_000_000_000_000_000n + BigInt(scaledFraction);
}
