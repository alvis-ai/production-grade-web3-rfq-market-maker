import type { MarketDataService } from "../modules/market-data/market-data.service.js";
import type { MarketSnapshotStore } from "../modules/market-data/market-snapshot.repository.js";
import { CachedMarketDataService } from "../modules/market-data/cached-market-data.service.js";
import { CEXOrderBookMonitor } from "../modules/market-data/cex-orderbook/cex-orderbook-monitor.js";
import type { OrderBookPairConfig } from "../modules/market-data/cex-orderbook/orderbook.js";
import {
  BackgroundMarketSnapshotSampler,
  buildMarketSnapshotSamplingPairs,
  defaultMarketSnapshotSampleIntervalMs,
  type MarketSnapshotSamplingPair,
} from "../modules/market-data/market-snapshot-sampler.js";
import { SharedPriceCache } from "../modules/market-data/price-cache.js";
import { BackgroundPriceUpdater } from "../modules/market-data/price-updater.js";
import type { MetricsService } from "../modules/metrics/metrics.service.js";
import { defaultQuoteServiceConfig } from "../modules/quote/quote.service.js";
import type { QuoteRequest } from "../shared/types/rfq.js";
import {
  buildRequiredCexCacheKeys,
  readCexOrderBookConfig,
  readCexOrderBookPairs,
  readDefaultMarketDataRuntime,
  readMarketDataPairs,
} from "./market-runtime.js";

export interface GatewayMarketDataRuntime {
  cexPairs: readonly OrderBookPairConfig[];
  managedRiskPairs: readonly MarketSnapshotSamplingPair[];
  marketDataService: MarketDataService;
  maxSnapshotAgeMs: number;
  pricingPairs: readonly MarketSnapshotSamplingPair[];
  readinessPair?: QuoteRequest;
  startBackgroundTasks(
    marketSnapshotStore: MarketSnapshotStore,
    persistSnapshots: boolean,
  ): (() => void) | undefined;
}

export function buildGatewayMarketDataRuntime(
  configuredService: MarketDataService | undefined,
  metricsService: MetricsService,
): GatewayMarketDataRuntime {
  const defaultMarketData = configuredService ? undefined : readDefaultMarketDataRuntime();
  const rawMarketDataService = configuredService ?? defaultMarketData!.service;
  const cexPairs = defaultMarketData ? readCexOrderBookPairs() : [];
  const cexConfig = cexPairs.length > 0 ? readCexOrderBookConfig(cexPairs) : undefined;
  const priceUpdaterPairs = defaultMarketData ? readMarketDataPairs(defaultMarketData.defaultPairs) : [];
  const defaultPairs = defaultMarketData?.defaultPairs ?? [];
  const basePriceCache = defaultMarketData ? new SharedPriceCache(5_000) : undefined;
  const cexPriceCache = cexConfig ? new SharedPriceCache(cexConfig.monitor.maxSourceAgeMs) : undefined;
  const requiredCexCacheKeys = buildRequiredCexCacheKeys(
    cexPairs,
    cexConfig?.requireLiveBook ?? false,
  );
  const marketDataService = defaultMarketData && basePriceCache
    ? new CachedMarketDataService(
        rawMarketDataService,
        cexPriceCache ? [cexPriceCache, basePriceCache] : [basePriceCache],
        metricsService,
        requiredCexCacheKeys,
      )
    : rawMarketDataService;
  const readinessPair = cexConfig?.requireLiveBook && cexPairs[0]
    ? { ...cexPairs[0], user: samplerUser, amountIn: "1", slippageBps: 50 }
    : priceUpdaterPairs[0];

  return {
    cexPairs,
    managedRiskPairs: [...defaultPairs, ...priceUpdaterPairs, ...cexPairs],
    marketDataService,
    maxSnapshotAgeMs: defaultMarketData?.maxSnapshotAgeMs ?? defaultQuoteServiceConfig.maxSnapshotAgeMs,
    pricingPairs: [...defaultPairs, ...priceUpdaterPairs],
    readinessPair,
    startBackgroundTasks(marketSnapshotStore, persistSnapshots) {
      const priceUpdater = defaultMarketData && basePriceCache && priceUpdaterPairs.length > 0
        ? new BackgroundPriceUpdater(rawMarketDataService, basePriceCache, {
            pairs: priceUpdaterPairs,
            intervalMs: 250,
            maxAgeMs: 5_000,
          })
        : undefined;
      const cexMonitor = defaultMarketData && cexPriceCache && cexConfig
        ? new CEXOrderBookMonitor(cexPriceCache, cexConfig.monitor, metricsService)
        : undefined;
      const snapshotSamplerCaches = cexPriceCache && basePriceCache
        ? [cexPriceCache, basePriceCache]
        : basePriceCache ? [basePriceCache] : [];
      const snapshotSampler = defaultMarketData && persistSnapshots && snapshotSamplerCaches.length > 0
        ? new BackgroundMarketSnapshotSampler(marketSnapshotStore, {
            pairs: buildMarketSnapshotSamplingPairs(priceUpdaterPairs, cexPairs),
            caches: snapshotSamplerCaches,
            requiredPrimaryCacheKeys: requiredCexCacheKeys,
            intervalMs: defaultMarketSnapshotSampleIntervalMs,
          })
        : undefined;

      priceUpdater?.start();
      cexMonitor?.start();
      snapshotSampler?.start();
      if (!priceUpdater && !cexMonitor && !snapshotSampler) return undefined;
      return () => {
        priceUpdater?.stop();
        cexMonitor?.stop();
        snapshotSampler?.stop();
      };
    },
  };
}

const samplerUser = "0x0000000000000000000000000000000000000001" as const;
