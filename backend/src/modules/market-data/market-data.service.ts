import type { MarketSnapshot, QuoteRequest } from "../../shared/types/rfq.js";

export interface MarketDataService {
  getSnapshot(request: QuoteRequest): Promise<MarketSnapshot>;
}

export class StaticMarketDataService implements MarketDataService {
  async getSnapshot(request: QuoteRequest): Promise<MarketSnapshot> {
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

export function getMarketSnapshotIssue(snapshot: MarketSnapshot, maxSnapshotAgeMs: number): string | undefined {
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
  if (ageMs <= maxSnapshotAgeMs) {
    return undefined;
  }

  if (ageMs < 0) {
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
