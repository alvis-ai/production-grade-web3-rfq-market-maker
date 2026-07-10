import type { MarketDataService } from "./market-data.service.js";
import type { MarketSnapshot, QuoteRequest } from "../../shared/types/rfq.js";
import { SharedPriceCache, pairKey } from "./price-cache.js";

export interface PriceUpdaterConfig {
  /** Token pairs to refresh in the background */
  pairs: QuoteRequest[];
  /** Refresh interval in milliseconds. Default 250ms. */
  intervalMs: number;
  /** Maximum cached price age before eviction. Default 5_000ms. */
  maxAgeMs: number;
}

export const defaultPriceUpdaterConfig: PriceUpdaterConfig = {
  pairs: [],
  intervalMs: 250,
  maxAgeMs: 5_000,
};

/**
 * Background price updater.
 *
 * Fetches prices for all configured pairs on a timer and writes them
 * into a SharedPriceCache. The request path reads from the cache —
 * it never waits for an RPC.
 *
 * Timer uses .unref() so it does not block process shutdown.
 */
export class BackgroundPriceUpdater {
  private readonly cache: SharedPriceCache;
  private readonly marketData: MarketDataService;
  private readonly pairs: QuoteRequest[];
  private readonly intervalMs: number;
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(
    marketData: MarketDataService,
    cache: SharedPriceCache,
    config: PriceUpdaterConfig = defaultPriceUpdaterConfig,
  ) {
    this.marketData = marketData;
    this.cache = cache;
    this.pairs = config.pairs.map((p) => ({ ...p }));
    this.intervalMs = config.intervalMs;
  }

  start(): void {
    this.updateAll();
    this.timer = setInterval(() => this.updateAll(), this.intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  getCache(): SharedPriceCache {
    return this.cache;
  }

  private async updateAll(): Promise<void> {
    await Promise.allSettled(this.pairs.map((pair) => this.updateOne(pair)));
  }

  private async updateOne(request: QuoteRequest): Promise<void> {
    try {
      const snapshot = await this.marketData.getSnapshot(request);
      this.cache.set(pairKey(request.chainId, request.tokenIn, request.tokenOut), snapshot);
    } catch {
      // Cache retains previous entry; next updater cycle will retry.
    }
  }
}
