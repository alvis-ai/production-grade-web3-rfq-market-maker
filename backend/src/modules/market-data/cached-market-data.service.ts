import type { MarketSnapshot, QuoteRequest } from "../../shared/types/rfq.js";
import type { MarketDataService } from "./market-data.service.js";
import { SharedPriceCache, pairKey } from "./price-cache.js";
import type { MetricsService } from "../metrics/metrics.service.js";

/**
 * Market data service that reads from a shared in-memory cache first.
 * Falls through to the underlying service on cache miss (cold start).
 * Read latency: < 1μs (Map lookup), zero network I/O on hit.
 */
export class CachedMarketDataService implements MarketDataService {
  private hits = 0;
  private misses = 0;

  constructor(
    private readonly inner: MarketDataService,
    private readonly cache: SharedPriceCache,
    private readonly metricsService?: MetricsService,
  ) {}

  async getSnapshot(request: QuoteRequest): Promise<MarketSnapshot> {
    const key = pairKey(request.chainId, request.tokenIn, request.tokenOut);
    const cached = this.cache.get(key);
    if (cached) {
      this.hits += 1;
      this.metricsService?.recordMarketDataCacheHit();
      return cached;
    }

    this.misses += 1;
    this.metricsService?.recordMarketDataCacheMiss();
    const snapshot = await this.inner.getSnapshot(request);
    this.cache.set(key, snapshot);
    return snapshot;
  }

  /** Expose cache for background updater injection and diagnostics */
  getCache(): SharedPriceCache {
    return this.cache;
  }

  /** Hit rate for telemetry */
  get hitRate(): number {
    const total = this.hits + this.misses;
    return total === 0 ? 1 : this.hits / total;
  }
}
