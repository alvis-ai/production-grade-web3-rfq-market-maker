import type { MarketSnapshot, QuoteRequest } from "../../shared/types/rfq.js";
import type { MarketDataService } from "./market-data.service.js";
import { SharedPriceCache, pairKey } from "./price-cache.js";
import type { MetricsService } from "../metrics/metrics.service.js";

/**
 * Market data service that reads from a shared in-memory cache first.
 * Falls through to the underlying service on an allowed cache miss. Keys that
 * require the primary cache fail closed before lower-priority data is read.
 * Read latency: < 1μs (Map lookup), zero network I/O on hit.
 */
export class CachedMarketDataService implements MarketDataService {
  private hits = 0;
  private misses = 0;
  private readonly requiredPrimaryCacheKeys: ReadonlySet<string>;

  constructor(
    private readonly inner: MarketDataService,
    cache: SharedPriceCache | readonly SharedPriceCache[],
    private readonly metricsService?: MetricsService,
    requiredPrimaryCacheKeys: readonly string[] = [],
  ) {
    this.caches = Array.isArray(cache) ? [...cache] : [cache as SharedPriceCache];
    if (this.caches.length === 0 || this.caches.some((entry) => !(entry instanceof SharedPriceCache))) {
      throw new Error("Cached market data service requires at least one SharedPriceCache");
    }
    if (!Array.isArray(requiredPrimaryCacheKeys) ||
        requiredPrimaryCacheKeys.some((key) => typeof key !== "string" || key.length === 0 || key.length > 256)) {
      throw new Error("Cached market data required primary keys must be bounded non-empty strings");
    }
    this.requiredPrimaryCacheKeys = new Set(requiredPrimaryCacheKeys);
  }

  private readonly caches: SharedPriceCache[];

  async getSnapshot(request: QuoteRequest): Promise<MarketSnapshot> {
    const key = pairKey(request.chainId, request.tokenIn, request.tokenOut);
    for (let index = 0; index < this.caches.length; index += 1) {
      const cached = this.caches[index].get(key);
      if (cached) {
        this.hits += 1;
        this.metricsService?.recordMarketDataCacheHit();
        return cached;
      }
      if (index === 0 && this.requiredPrimaryCacheKeys.has(key)) {
        this.recordMiss();
        throw new Error("Required live CEX order book is unavailable");
      }
    }

    this.recordMiss();
    const snapshot = await this.inner.getSnapshot(request);
    this.caches[this.caches.length - 1].set(key, snapshot);
    return snapshot;
  }

  private recordMiss(): void {
    this.misses += 1;
    this.metricsService?.recordMarketDataCacheMiss();
  }

  /** Expose cache for background updater injection and diagnostics */
  getCache(): SharedPriceCache {
    return this.caches[0];
  }

  /** Hit rate for telemetry */
  get hitRate(): number {
    const total = this.hits + this.misses;
    return total === 0 ? 1 : this.hits / total;
  }
}
