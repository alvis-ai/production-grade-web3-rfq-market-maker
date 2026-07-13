#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { readBackendGatewaySource } from "./lib/read-backend-gateway-source.mjs";

const [
  mainEntrySource,
  monitorSource,
  decimalSource,
  orderBookSource,
  binanceSource,
  coinbaseSource,
  metricsSource,
  testSource,
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
] = await Promise.all([
  "backend/src/main.ts",
  "backend/src/modules/market-data/cex-orderbook/cex-orderbook-monitor.ts",
  "backend/src/modules/market-data/cex-orderbook/decimal.ts",
  "backend/src/modules/market-data/cex-orderbook/orderbook.ts",
  "backend/src/modules/market-data/cex-orderbook/binance-connector.ts",
  "backend/src/modules/market-data/cex-orderbook/coinbase-connector.ts",
  "backend/src/modules/metrics/metrics.service.ts",
  "backend/test/cex-orderbook.test.mjs",
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
assert.ok(monitorSource.includes("this.cache.delete(cacheKey)"), "blocked CEX pairs must invalidate cache immediately");
assert.ok(monitorSource.includes("cexDeviationBps"), "CEX monitor must enforce cross-source deviation bounds");
assert.ok(monitorSource.includes("connector.restart()"), "stale or invalid CEX sources must actively resynchronize");
assert.ok(monitorSource.includes("Math.min(...sources.map(({ observedAtMs })"), "aggregate observedAt must use source event time");
assert.ok(monitorSource.includes("lastPublishedFingerprint"), "unchanged CEX events must not refresh snapshots");
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
assert.ok(testSource.includes('asks: [["101", "1000"]]'), "tests must prove ask quantity cannot inflate executable liquidity");
assert.ok(testSource.includes("marketSpreadBps"), "tests must cover executable market spread attribution");
assert.ok(testSource.includes("inverseFallback"), "tests must cover inverse ask-side snapshot publication");
assert.ok(
  testSource.includes("RFQ API prices the inverse USD-to-base direction from executable asks"),
  "tests must cover inverse CEX pricing through the signed quote API",
);
assert.ok(marketDataChapter.includes("developers.binance.com"), "market-data chapter must reference official Binance synchronization rules");
assert.ok(marketDataChapter.includes("docs.cdp.coinbase.com"), "market-data chapter must reference official Coinbase Level-2 rules");
assert.ok(readmeSource.includes("make cex-orderbook-integration-check"), "README must document the live CEX check");
assert.ok(makefileSource.includes("cex-orderbook-integration-check: backend-build"), "Makefile must expose the live CEX check");
assert.ok(packageSource.includes("cex:orderbook:integration:check"), "package scripts must expose the live CEX check");
assert.ok(integrationSource.includes("RFQ_CEX_INTEGRATION_CONFIRM=yes"), "live CEX check must require explicit opt-in");
assert.ok(
  integrationSource.includes("executable bid liquidity") && integrationSource.includes("executable ask liquidity"),
  "live CEX check must validate both directional depth surfaces",
);

console.log(`CEX order-book consistency check passed (${tuningNames.length} runtime controls)`);
