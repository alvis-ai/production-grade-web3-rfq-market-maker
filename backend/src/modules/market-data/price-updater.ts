import type { MarketDataService } from "./market-data.service.js";
import type { MarketSnapshot, QuoteRequest } from "../../shared/types/rfq.js";
import { SharedPriceCache, pairKey } from "./price-cache.js";
import {
  assertMarketDataBackgroundLogger,
  logMarketDataBackgroundTransition,
  marketDataBackgroundLogFields,
  noOpMarketDataBackgroundLogger,
  type MarketDataBackgroundLogger,
} from "./market-data-background-logger.js";

export interface PriceUpdaterConfig {
  /** Token pairs to refresh in the background */
  pairs: QuoteRequest[];
  /** Refresh interval in milliseconds. Default 250ms. */
  intervalMs: number;
  /** Maximum cached price age before eviction. Default 5_000ms. */
  maxAgeMs: number;
}

export type MarketDataRefreshOutcome = "success" | "failure";

export interface PriceUpdaterObserver {
  recordMarketDataRefresh(outcome: MarketDataRefreshOutcome): void;
}

export const defaultPriceUpdaterConfig: PriceUpdaterConfig = {
  pairs: [],
  intervalMs: 250,
  maxAgeMs: 5_000,
};

const noOpObserver: PriceUpdaterObserver = {
  recordMarketDataRefresh() {},
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
  private readonly failedPairs = new Set<string>();
  private timer: ReturnType<typeof setInterval> | undefined;
  private activeUpdate: Promise<void> | undefined;

  constructor(
    marketData: MarketDataService,
    cache: SharedPriceCache,
    config: PriceUpdaterConfig = defaultPriceUpdaterConfig,
    private readonly observer: PriceUpdaterObserver = noOpObserver,
    private readonly logger: MarketDataBackgroundLogger = noOpMarketDataBackgroundLogger,
  ) {
    assertObserver(observer);
    assertMarketDataBackgroundLogger(logger);
    this.marketData = marketData;
    this.cache = cache;
    this.pairs = config.pairs.map((p) => ({ ...p }));
    this.intervalMs = config.intervalMs;
  }

  start(): void {
    if (this.timer) return;
    void this.refreshOnce();
    this.timer = setInterval(() => void this.refreshOnce(), this.intervalMs);
    this.timer.unref();
  }

  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    await this.activeUpdate;
  }

  getCache(): SharedPriceCache {
    return this.cache;
  }

  assertConfiguredCoverage(): void {
    for (const pair of this.pairs) {
      if (!this.cache.get(pairKey(pair.chainId, pair.tokenIn, pair.tokenOut))) {
        throw new Error("Background market data initial coverage is incomplete");
      }
    }
  }

  refreshOnce(): Promise<void> {
    if (this.activeUpdate) return this.activeUpdate;
    const update = this.updateAll();
    this.activeUpdate = update;
    void update.then(
      () => this.clearActiveUpdate(update),
      () => this.clearActiveUpdate(update),
    );
    return update;
  }

  private async updateAll(): Promise<void> {
    await Promise.allSettled(this.pairs.map((pair) => this.updateOne(pair)));
  }

  private async updateOne(request: QuoteRequest): Promise<void> {
    const key = pairKey(request.chainId, request.tokenIn, request.tokenOut);
    try {
      const snapshot = await this.marketData.getSnapshot(request);
      this.cache.set(key, snapshot);
      this.recordRefresh("success");
      this.recordRecovery(request, key);
    } catch {
      this.recordRefresh("failure");
      this.recordFailure(request, key);
      // Cache retains previous entry; next updater cycle will retry.
    }
  }

  private clearActiveUpdate(update: Promise<void>): void {
    if (this.activeUpdate === update) this.activeUpdate = undefined;
  }

  private recordRefresh(outcome: MarketDataRefreshOutcome): void {
    try {
      this.observer.recordMarketDataRefresh(outcome);
    } catch {}
  }

  private recordFailure(request: QuoteRequest, key: string): void {
    if (this.failedPairs.has(key)) return;
    this.failedPairs.add(key);
    logMarketDataBackgroundTransition(
      this.logger,
      "warn",
      marketDataBackgroundLogFields(request, "MARKET_DATA_REFRESH_FAILED"),
      "Background market data refresh failed",
    );
  }

  private recordRecovery(request: QuoteRequest, key: string): void {
    if (!this.failedPairs.delete(key)) return;
    logMarketDataBackgroundTransition(
      this.logger,
      "info",
      marketDataBackgroundLogFields(request, "MARKET_DATA_REFRESH_RECOVERED"),
      "Background market data refresh recovered",
    );
  }
}

function assertObserver(value: unknown): asserts value is PriceUpdaterObserver {
  if (typeof value !== "object" || value === null ||
      typeof (value as PriceUpdaterObserver).recordMarketDataRefresh !== "function") {
    throw new Error("Background price updater observer.recordMarketDataRefresh must be a function");
  }
}
