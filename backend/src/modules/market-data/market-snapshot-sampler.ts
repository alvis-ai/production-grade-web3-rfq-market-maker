import type { QuoteRequest } from "../../shared/types/rfq.js";
import { validateQuoteRequest } from "../../shared/validation/quote-request.js";
import { getMarketDataSnapshotSource } from "./market-data.service.js";
import type { MarketSnapshotStore } from "./market-snapshot.repository.js";
import { pairKey, SharedPriceCache } from "./price-cache.js";

export interface MarketSnapshotSamplingPair {
  chainId: number;
  tokenIn: `0x${string}`;
  tokenOut: `0x${string}`;
}

export interface MarketSnapshotSamplerConfig {
  pairs: readonly QuoteRequest[];
  caches: readonly SharedPriceCache[];
  requiredPrimaryCacheKeys: readonly string[];
  intervalMs: number;
}

export interface MarketSnapshotSampleResult {
  saved: number;
  unchanged: number;
  unavailable: number;
  failed: number;
}

export const defaultMarketSnapshotSampleIntervalMs = 5_000;
const samplerUser = "0x0000000000000000000000000000000000000001" as const;

export class BackgroundMarketSnapshotSampler {
  private readonly pairs: QuoteRequest[];
  private readonly caches: readonly SharedPriceCache[];
  private readonly requiredPrimaryCacheKeys: ReadonlySet<string>;
  private readonly intervalMs: number;
  private readonly lastSavedSnapshotIds = new Map<string, string>();
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly store: MarketSnapshotStore,
    config: MarketSnapshotSamplerConfig,
  ) {
    assertStore(store);
    assertConfig(config);
    this.pairs = config.pairs.map((pair) => validateQuoteRequest(pair));
    this.caches = [...config.caches];
    this.requiredPrimaryCacheKeys = new Set(config.requiredPrimaryCacheKeys);
    this.intervalMs = config.intervalMs;
  }

  start(): void {
    if (this.timer) return;
    void this.sampleOnce();
    this.timer = setInterval(() => void this.sampleOnce(), this.intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = undefined;
  }

  async sampleOnce(): Promise<MarketSnapshotSampleResult> {
    const results = await Promise.all(this.pairs.map((pair) => this.samplePair(pair)));
    return results.reduce<MarketSnapshotSampleResult>((total, outcome) => {
      total[outcome] += 1;
      return total;
    }, { saved: 0, unchanged: 0, unavailable: 0, failed: 0 });
  }

  private async samplePair(
    request: QuoteRequest,
  ): Promise<keyof MarketSnapshotSampleResult> {
    const key = pairKey(request.chainId, request.tokenIn, request.tokenOut);
    const snapshot = this.requiredPrimaryCacheKeys.has(key)
      ? this.caches[0]?.get(key)
      : this.caches.map((cache) => cache.get(key)).find((candidate) => candidate !== undefined);
    if (!snapshot) return "unavailable";
    if (this.lastSavedSnapshotIds.get(key) === snapshot.snapshotId) return "unchanged";

    try {
      const source = getMarketDataSnapshotSource(snapshot);
      await this.store.saveSnapshot({
        request,
        snapshot,
        ...(source === undefined ? {} : { source }),
      });
      this.lastSavedSnapshotIds.set(key, snapshot.snapshotId);
      return "saved";
    } catch {
      return "failed";
    }
  }
}

export function buildMarketSnapshotSamplingPairs(
  marketPairs: readonly MarketSnapshotSamplingPair[],
  cexPairs: readonly MarketSnapshotSamplingPair[],
): QuoteRequest[] {
  const pairs = new Map<string, QuoteRequest>();
  const add = (pair: MarketSnapshotSamplingPair) => {
    const request = validateQuoteRequest({
      chainId: pair.chainId,
      tokenIn: pair.tokenIn,
      tokenOut: pair.tokenOut,
      user: samplerUser,
      amountIn: "1",
      slippageBps: 0,
    });
    pairs.set(pairKey(request.chainId, request.tokenIn, request.tokenOut), request);
  };
  for (const pair of marketPairs) add(pair);
  for (const pair of cexPairs) {
    add(pair);
    add({ chainId: pair.chainId, tokenIn: pair.tokenOut, tokenOut: pair.tokenIn });
  }
  return [...pairs.values()];
}

function assertStore(store: MarketSnapshotStore): void {
  if (typeof store !== "object" || store === null || typeof store.saveSnapshot !== "function") {
    throw new Error("Market snapshot sampler store.saveSnapshot must be a function");
  }
}

function assertConfig(config: MarketSnapshotSamplerConfig): void {
  if (typeof config !== "object" || config === null || !Array.isArray(config.pairs) ||
      !Array.isArray(config.caches) || config.caches.length === 0 ||
      !Array.isArray(config.requiredPrimaryCacheKeys) ||
      !Number.isSafeInteger(config.intervalMs) || config.intervalMs < 1_000 ||
      config.intervalMs > 60_000) {
    throw new Error("Market snapshot sampler config is invalid");
  }
  if (config.caches.some((cache) => !(cache instanceof SharedPriceCache))) {
    throw new Error("Market snapshot sampler caches must be SharedPriceCache instances");
  }
  if (config.requiredPrimaryCacheKeys.some((key) =>
    typeof key !== "string" || !/^[1-9][0-9]*:0x[0-9a-f]{40}:0x[0-9a-f]{40}$/.test(key))) {
    throw new Error("Market snapshot sampler required cache key is invalid");
  }
}
