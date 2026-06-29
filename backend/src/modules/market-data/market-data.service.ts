import type { MarketSnapshot, QuoteRequest } from "../../shared/types/rfq.js";

export interface MarketDataService {
  getSnapshot(request: QuoteRequest): Promise<MarketSnapshot>;
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

export class StaticMarketDataService implements MarketDataService {
  private readonly supportedPairs: ReadonlySet<string>;

  constructor(private readonly config: StaticMarketDataConfig = defaultStaticMarketDataConfig) {
    assertStaticMarketDataConfig(config);
    this.supportedPairs = new Set(config.supportedPairs.map((pair) => pairKey(pair)));
  }

  async getSnapshot(request: QuoteRequest): Promise<MarketSnapshot> {
    if (!this.supportedPairs.has(pairKey(request))) {
      throw new Error("Market data pair is not configured");
    }

    return {
      snapshotId: [
        "snapshot",
        request.chainId.toString(),
        request.tokenIn.slice(2, 10).toLowerCase(),
        request.tokenOut.slice(2, 10).toLowerCase(),
      ].join("_"),
      midPrice: "1",
      liquidityUsd: "10000000000000",
      volatilityBps: 25,
      observedAt: new Date().toISOString(),
    };
  }
}

function pairKey(pair: StaticMarketDataPair): string {
  return `${pair.chainId}:${pair.tokenIn.toLowerCase()}:${pair.tokenOut.toLowerCase()}`;
}

function assertStaticMarketDataConfig(config: StaticMarketDataConfig): void {
  if (!Array.isArray(config.supportedPairs) || config.supportedPairs.length === 0) {
    throw new Error("Static market data supportedPairs must contain at least one pair");
  }

  const seenPairs = new Set<string>();
  for (const pair of config.supportedPairs) {
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

export const defaultMaxSnapshotFutureSkewMs = 1_000;

export function getMarketSnapshotIssue(
  snapshot: MarketSnapshot,
  maxSnapshotAgeMs: number,
  maxSnapshotFutureSkewMs = defaultMaxSnapshotFutureSkewMs,
): string | undefined {
  if (snapshot.snapshotId.trim().length === 0) {
    return "snapshot id is missing";
  }

  if (!isPositiveDecimal(snapshot.midPrice)) {
    return "mid price is invalid";
  }

  if (!isPositiveIntegerString(snapshot.liquidityUsd)) {
    return "liquidity is invalid";
  }

  if (!Number.isInteger(snapshot.volatilityBps) || snapshot.volatilityBps < 0) {
    return "volatility is invalid";
  }

  const observedAtMs = Date.parse(snapshot.observedAt);
  if (!Number.isFinite(observedAtMs)) {
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

function isPositiveDecimal(value: string): boolean {
  if (!/^[0-9]+(\.[0-9]+)?$/.test(value)) {
    return false;
  }

  return parseDecimalToScaledBigInt(value) > 0n;
}

function isPositiveIntegerString(value: string): boolean {
  return /^[0-9]+$/.test(value) && BigInt(value) > 0n;
}

function parseDecimalToScaledBigInt(value: string): bigint {
  const [whole, fraction = ""] = value.split(".");
  const scaledFraction = `${fraction.slice(0, 18)}${"0".repeat(Math.max(0, 18 - fraction.length))}`;
  return BigInt(whole) * 1_000_000_000_000_000_000n + BigInt(scaledFraction);
}
