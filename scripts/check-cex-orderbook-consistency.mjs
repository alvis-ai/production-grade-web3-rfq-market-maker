#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { readBackendGatewaySource } from "./lib/read-backend-gateway-source.mjs";

const [
  mainEntrySource,
  cachedMarketDataSource,
  monitorSource,
  decimalSource,
  orderBookSource,
  binanceSource,
  coinbaseSource,
  metricsSource,
  testSource,
  cacheTestSource,
  runtimeTestSource,
  routeBindingTestSource,
  envSource,
  composeSource,
  k8sSource,
  helmSource,
  alertSource,
  dashboardSource,
  marketDataChapter,
  readmeSource,
  makefileSource,
  packageSource,
  integrationSource,
  integrationTestSource,
] = await Promise.all([
  "backend/src/main.ts",
  "backend/src/modules/market-data/cached-market-data.service.ts",
  "backend/src/modules/market-data/cex-orderbook/cex-orderbook-monitor.ts",
  "backend/src/modules/market-data/cex-orderbook/decimal.ts",
  "backend/src/modules/market-data/cex-orderbook/orderbook.ts",
  "backend/src/modules/market-data/cex-orderbook/binance-connector.ts",
  "backend/src/modules/market-data/cex-orderbook/coinbase-connector.ts",
  "backend/src/modules/metrics/metrics.service.ts",
  "backend/test/cex-orderbook.test.mjs",
  "backend/test/chainlink-market-data.test.mjs",
  "backend/test/api-gateway-env.test.mjs",
  "backend/test/market-runtime.test.mjs",
  ".env.example",
  "docker-compose.yml",
  "infra/k8s/configmap.yaml",
  "infra/helm/rfq-market-maker/values.yaml",
  "infra/prometheus/rules/rfq-alerts.yml",
  "infra/grafana/provisioning/dashboards/rfq-overview.json",
  "book/Volume2-MarketData-And-Pricing/Chapter01-Market-Data.md",
  "README.md",
  "Makefile",
  "package.json",
  "scripts/cex-orderbook-integration-check.mjs",
  "backend/test/cex-orderbook-integration-script.test.mjs",
].map((path) => readFile(path, "utf8")));
const mainSource = `${mainEntrySource}\n${await readBackendGatewaySource()}`;

const tuningNames = [
  "RFQ_CEX_DEPTH_RANGE_BPS",
  "RFQ_CEX_FLUSH_INTERVAL_MS",
  "RFQ_CEX_VOLATILITY_SAMPLE_SIZE",
  "RFQ_CEX_MAX_SOURCE_AGE_MS",
  "RFQ_CEX_MAX_FUTURE_SKEW_MS",
  "RFQ_CEX_MIN_SOURCES",
  "RFQ_CEX_MAX_SOURCE_DEVIATION_BPS",
  "RFQ_CEX_MAX_SPREAD_BPS",
  "RFQ_CEX_REQUIRE_LIVE_BOOK",
];
for (const name of tuningNames) {
  for (const [label, source] of [
    ["backend runtime", mainSource],
    [".env.example", envSource],
    ["Docker Compose", composeSource],
    ["Kubernetes ConfigMap", k8sSource],
    ["Helm values", helmSource],
  ]) {
    assert.ok(source.includes(name), `${label} must declare ${name}`);
  }
}

assert.ok(
  mainSource.includes("requiresExplicitRuntimeConfig(nodeEnv) ? 2 : 1"),
  "non-local CEX runtime must default to a two-source quorum",
);
assert.ok(
    mainSource.includes("RFQ_CEX_REQUIRE_LIVE_BOOK=false requires RFQ_MARKET_DATA_PROVIDER=chainlink") &&
    mainSource.includes("buildRequiredCexCacheKeys") &&
    mainSource.includes("cexConfig?.requireLiveBook"),
  "non-local CEX runtime must require a live book or an explicit Chainlink fallback",
);
assert.ok(
  mainSource.includes("Non-local static market data requires non-empty RFQ_CEX_PAIRS") &&
    mainSource.includes("assertProductionMarketDataPolicy") &&
    runtimeTestSource.includes("rejects an unprotected static market-data provider"),
  "non-local static market data must fail startup unless a live CEX pair is mandatory",
);
for (const [label, source] of [["Kubernetes ConfigMap", k8sSource], ["Helm values", helmSource]]) {
  assert.ok(
    source.includes(":binance:ETHUSDT:hedge") && source.includes(":coinbase:ETH-USD:reference"),
    `${label} must distinguish the executable hedge source from independent reference evidence`,
  );
}
assert.ok(
  mainSource.includes("chainId:baseToken:usdQuoteToken:exchange:symbol:role") &&
    mainSource.includes("hedge role requires the supported binance execution venue"),
  "CEX runtime must validate explicit hedge/reference roles against the supported execution venue",
);
assert.ok(
  mainSource.includes("assertCexHedgeSourcesRoutable") &&
    mainSource.includes('readOwnEnvValue(env, "RFQ_HEDGE_ROUTES_JSON")') &&
    mainSource.includes("route.quoteToken.toLowerCase() !== source.tokenOut.toLowerCase()"),
  "CEX hedge sources must match the worker route table before executable depth is accepted",
);
assert.ok(
  cachedMarketDataSource.includes("requiredPrimaryCacheKeys.has(key)") &&
    cachedMarketDataSource.includes("Required live CEX order book is unavailable"),
  "required CEX pairs must fail before reading lower-priority caches or providers",
);
assert.ok(monitorSource.includes("this.cache.delete(cacheKey)"), "blocked CEX pairs must invalidate cache immediately");
assert.ok(monitorSource.includes("cexDeviationBps"), "CEX monitor must enforce cross-source deviation bounds");
assert.ok(monitorSource.includes("connector.restart()"), "stale or invalid CEX sources must actively resynchronize");
assert.ok(monitorSource.includes("Math.min(...sources.map(({ observedAtMs })"), "aggregate observedAt must use source event time");
assert.ok(monitorSource.includes("lastPublishedFingerprint"), "unchanged CEX events must not refresh snapshots");
assert.ok(
  monitorSource.includes('accepted.some(({ role }) => role === "hedge")') &&
    monitorSource.includes('.filter(({ role }) => role === "hedge")'),
  "reference sources must validate price without contributing unroutable liquidity",
);
assert.ok(decimalSource.includes("10n ** BigInt(cexDecimalScaleDigits)"), "CEX decimal math must use fixed-point BigInt");
assert.ok(orderBookSource.includes("normalizeLevels") && orderBookSource.includes("parseCexDecimal"), "order-book messages must validate atomically with fixed decimals");
assert.ok(
  orderBookSource.includes("computeBidDepth") &&
    orderBookSource.includes("computeAskDepth") &&
    monitorSource.includes("source.metrics.askLiquidityUsd"),
  "CEX order books must retain separate executable bid and ask depth",
);
assert.ok(
  orderBookSource.includes("marketSpreadBps") &&
    orderBookSource.includes("askMarketSpreadBps") &&
    monitorSource.includes("aggregateMarketSpreadBps(midPriceValue, sources)") &&
    monitorSource.includes("executablePriceValue"),
  "CEX snapshots must conservatively attribute the direction-specific executable spread",
);
assert.ok(
  monitorSource.includes("groupDirectedPairs") &&
    monitorSource.includes('direction === "quote-to-base"') &&
    monitorSource.includes("invertCexPrice"),
  "each native BASE/USD book must publish base-to-quote and quote-to-base RFQ snapshots",
);
assert.ok(binanceSource.includes("E: number") && binanceSource.includes("s: string"), "Binance updates must validate event time and symbol");
assert.ok(binanceSource.includes("bridgesUpdateId"), "Binance updates must enforce update-id continuity");
assert.ok(coinbaseSource.includes("time: string") && coinbaseSource.includes("parseCoinbaseTimestamp"), "Coinbase updates must preserve exchange event time");
for (const [exchange, source] of [["Binance", binanceSource], ["Coinbase", coinbaseSource]]) {
  assert.ok(
    source.includes("CONNECTION_TIMEOUT_MS = 10_000") &&
      source.includes("armConnectionTimeout") &&
      source.includes("clearConnectionTimer") &&
      source.includes("WebSocket connection timed out"),
    `${exchange} must bound stalled WebSocket handshakes and reconnect with clean state`,
  );
}
assert.ok(metricsSource.includes("rfq_cex_order_book_sources"), "backend metrics must expose CEX source health");
assert.ok(metricsSource.includes("rfq_cex_order_book_pairs"), "backend metrics must expose CEX pair health");

for (const alert of [
  "RFQCexOrderBookUnavailable",
  "RFQCexOrderBookPairBlocked",
  "RFQCexOrderBookConnectorErrors",
]) {
  assert.ok(alertSource.includes(`alert: ${alert}`), `Prometheus must define ${alert}`);
}
const dashboard = JSON.parse(dashboardSource);
assert.ok(dashboard.panels.some((panel) => panel.title === "CEX Order Book Health"), "Grafana must include CEX order-book health");
assert.ok(testSource.includes("publishes only changed fresh source events"), "tests must cover source-event freshness");
assert.ok(testSource.includes("invalidates stale and cross-venue divergent books"), "tests must cover stale and divergent source invalidation");
assert.ok(
  testSource.includes("CEX connectors reconnect when WebSocket handshakes stall") &&
    testSource.includes("CEX connectors close errored sockets before backoff") &&
    testSource.includes("CoinbaseConnector reconnects when subscription send fails"),
  "tests must cover bounded CEX connection establishment and explicit socket errors",
);
assert.ok(testSource.includes('asks: [["101", "1000"]]'), "tests must prove ask quantity cannot inflate executable liquidity");
assert.ok(testSource.includes("marketSpreadBps"), "tests must cover executable market spread attribution");
assert.ok(testSource.includes("inverseFallback"), "tests must cover inverse ask-side snapshot publication");
assert.ok(
  testSource.includes('assert.equal(snapshot.liquidityUsd, "99")') &&
    testSource.includes('assert.equal(inverseSnapshot.liquidityUsd, "100")') &&
    testSource.includes("at least one hedge source"),
  "tests must prove reference depth cannot inflate either RFQ direction",
);
assert.ok(
  testSource.includes("RFQ API prices the inverse USD-to-base direction from executable asks"),
  "tests must cover inverse CEX pricing through the signed quote API",
);
assert.ok(
  cacheTestSource.includes("fails closed when a required live CEX book is unavailable") &&
    cacheTestSource.includes("keeps fallback available for pairs without a live-book requirement"),
  "tests must cover required live-book failure and scoped fallback",
);
assert.ok(
  runtimeTestSource.includes("CEX live-book policy protects both RFQ directions for each native market") &&
    mainSource.includes("pair.tokenOut, pair.tokenIn") &&
    mainSource.includes("pair.tokenIn, pair.tokenOut"),
  "live-book policy must protect both RFQ directions",
);
assert.ok(
  routeBindingTestSource.includes("CEX hedge sources must match the worker route table exactly") &&
    routeBindingTestSource.includes("does not match its configured hedge route") &&
    routeBindingTestSource.includes("has no configured hedge route"),
  "tests must cover exact CEX source-to-hedge-route binding",
);
assert.ok(marketDataChapter.includes("developers.binance.com"), "market-data chapter must reference official Binance synchronization rules");
assert.ok(marketDataChapter.includes("docs.cdp.coinbase.com"), "market-data chapter must reference official Coinbase Level-2 rules");
assert.ok(
  marketDataChapter.includes("WebSocket handshake") && marketDataChapter.includes("10 秒"),
  "market-data chapter must document the bounded CEX connection lifecycle",
);
assert.ok(
  marketDataChapter.includes("`hedge` 或 `reference`") &&
    marketDataChapter.includes("reference quorum") &&
    readmeSource.includes("reference-only surviving quorum invalidates both directional cache entries") &&
    marketDataChapter.includes("`RFQ_HEDGE_ROUTES_JSON`") &&
    readmeSource.includes("API and Hedge Worker consume the same `RFQ_HEDGE_ROUTES_JSON`"),
  "market-data docs must bind executable liquidity to deployed hedge venues",
);
assert.ok(readmeSource.includes("make cex-orderbook-integration-check"), "README must document the live CEX check");
assert.ok(
  readmeSource.includes("WebSocket handshakes have a ten-second deadline"),
  "README must document bounded CEX connection establishment",
);
assert.ok(
  readmeSource.includes("Non-local `static` mode is accepted only") &&
    marketDataChapter.includes("non-empty `RFQ_CEX_PAIRS`"),
  "README and market-data chapter must document the non-local static-provider fail-closed policy",
);
assert.ok(makefileSource.includes("cex-orderbook-integration-check: backend-build"), "Makefile must expose the live CEX check");
assert.ok(packageSource.includes("cex:orderbook:integration:check"), "package scripts must expose the live CEX check");
assert.ok(integrationSource.includes("RFQ_CEX_INTEGRATION_CONFIRM=yes"), "live CEX check must require explicit opt-in");
assert.ok(
  integrationSource.includes("CEXOrderBookMonitor") &&
    integrationSource.includes("RFQ_CEX_INTEGRATION_BINANCE_SYMBOL") &&
    integrationSource.includes("RFQ_CEX_INTEGRATION_COINBASE_SYMBOL") &&
    integrationSource.includes("minSources: 2"),
  "live CEX check must drive the production monitor with Binance and Coinbase quorum",
);
assert.ok(
  integrationSource.includes('"cex:binance+coinbase"') &&
    integrationSource.includes("observation.readySources !== 2") &&
    integrationSource.includes("observation.usablePairs !== 2") &&
    integrationSource.includes("observation.deviationRejectedSources !== 0"),
  "live CEX check must require healthy dual-source directional aggregation",
);
assert.ok(
  integrationSource.includes("CEX aggregate must expose executable bid liquidity") &&
    integrationSource.includes("CEX aggregate must expose executable ask liquidity") &&
    integrationSource.includes("forwardSnapshot.liquidityUsd") &&
    integrationSource.includes("binance.bidLiquidityUsd") &&
    integrationSource.includes("reverseSnapshot.liquidityUsd") &&
    integrationSource.includes("binance.askLiquidityUsd"),
  "live CEX check must validate both directional hedge-only depth surfaces",
);
assert.ok(
  integrationTestSource.includes("cex-orderbook-live-globals.mjs") &&
    integrationTestSource.includes("result.quorum.readySources, 2") &&
    integrationTestSource.includes('result.aggregate.source, "cex:binance+coinbase"') &&
    integrationTestSource.includes("result.aggregate.forward.liquidityUsd, result.sources.binance.bidLiquidityUsd") &&
    integrationTestSource.includes("result.aggregate.reverse.liquidityUsd, result.sources.binance.askLiquidityUsd"),
  "tests must execute the integration script through synchronized dual-source protocol fixtures",
);

console.log(`CEX order-book consistency check passed (${tuningNames.length + 1} runtime controls)`);
