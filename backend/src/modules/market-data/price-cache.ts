import type { MarketSnapshot } from "../../shared/types/rfq.js";

export interface PriceCacheEntry {
  snapshot: MarketSnapshot;
  updatedAt: number;
}

/**
 * Shared in-memory price cache.
 * Single writer (background updater), many concurrent readers.
 * Map reads are atomic in V8 — no locks needed.
 */
export class SharedPriceCache {
  private readonly entries = new Map<string, PriceCacheEntry>();
  private readonly maxAgeMs: number;

  constructor(maxAgeMs = 5_000) {
    this.maxAgeMs = maxAgeMs;
  }

  /** Store a snapshot under its pair key */
  set(pairKey: string, snapshot: MarketSnapshot): void {
    this.entries.set(pairKey, {
      snapshot,
      updatedAt: Date.now(),
    });
  }

  /** Retrieve a snapshot if it's not stale. Returns undefined on miss or expiry. */
  get(pairKey: string): MarketSnapshot | undefined {
    const entry = this.entries.get(pairKey);
    if (!entry) return undefined;
    if (Date.now() - entry.updatedAt > this.maxAgeMs) {
      this.entries.delete(pairKey);
      return undefined;
    }
    return entry.snapshot;
  }

  delete(pairKey: string): boolean {
    return this.entries.delete(pairKey);
  }

  /** Number of cached entries (for metrics) */
  get size(): number {
    return this.entries.size;
  }
}

export function pairKey(chainId: number, tokenIn: string, tokenOut: string): string {
  return `${chainId}:${tokenIn.toLowerCase()}:${tokenOut.toLowerCase()}`;
}
