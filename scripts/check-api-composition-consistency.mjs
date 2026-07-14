#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { backendGatewaySourcePaths } from "./lib/read-backend-gateway-source.mjs";

const sources = Object.fromEntries(await Promise.all(
  backendGatewaySourcePaths.map(async (path) => [path, await readFile(path, "utf8")]),
));
const main = sources["backend/src/main.ts"];
const boundary = sources["backend/src/api/http-boundary.ts"];
const routes = sources["backend/src/api/trading-routes.ts"];
const quoteControlRoutes = sources["backend/src/api/quote-control-routes.ts"];
const toxicFlowScoreRoutes = sources["backend/src/api/toxic-flow-score-routes.ts"];
const environment = sources["backend/src/runtime/environment.ts"];
const gatewayApplication = sources["backend/src/runtime/gateway-application.ts"];
const gatewayMarketData = sources["backend/src/runtime/gateway-market-data.ts"];
const gatewayRuntime = sources["backend/src/runtime/gateway-runtime.ts"];
const marketRuntime = sources["backend/src/runtime/market-runtime.ts"];
const serverProcess = sources["backend/src/runtime/server-process.ts"];
const chapter = await readFile("book/Volume5-BackendEngineering/Chapter01-API-Gateway.md", "utf8");

const mainLines = main.split(/\r?\n/).length;
const gatewayApplicationLines = gatewayApplication.split(/\r?\n/).length;
assert.ok(mainLines <= 100, `backend/src/main.ts must remain a process entrypoint (got ${mainLines} lines)`);
assert.ok(
  gatewayApplicationLines <= 350,
  `backend/src/runtime/gateway-application.ts must remain a bounded composition root (got ${gatewayApplicationLines} lines)`,
);
assertContains(main, [
  'export { buildServer } from "./runtime/gateway-application.js"',
  "export async function startServer",
  "installGracefulShutdown(server",
], "backend/src/main.ts");
assertContains(gatewayApplication, [
  "export function buildServer",
  "installGatewayBoundary(server",
  "registerTradingRoutes(server",
  "registerQuoteControlRoutes(server",
  "buildGatewayMarketDataRuntime(options.marketDataService",
  "resolvePostgresPool(options)",
], "gateway application runtime");
assertContains(gatewayMarketData, [
  "buildGatewayMarketDataRuntime",
  "readDefaultMarketDataRuntime()",
  "new BackgroundPriceUpdater",
  "new CEXOrderBookMonitor",
  "new BackgroundMarketSnapshotSampler",
  "startBackgroundTasks",
], "gateway market-data runtime");
for (const directRoute of ['server.get("', 'server.post("', 'server.options("']) {
  assert.ok(!main.includes(directRoute), `backend/src/main.ts must not register routes directly: ${directRoute}`);
  assert.ok(
    !gatewayApplication.includes(directRoute),
    `gateway application runtime must delegate route registration: ${directRoute}`,
  );
}

assertContains(boundary, [
  "installGatewayBoundary",
  'server.addHook("onRequest"',
  "requiredApiKeyScope",
  "applyCorsHeaders",
  "applySecurityHeaders",
  "frameworkErrorToAPIError",
  "enforceRateLimit",
], "HTTP boundary");
assertContains(routes, [
  "registerTradingRoutes",
  'server.post("/quote"',
  'server.post("/submit"',
  'server.get("/ready"',
  'server.get("/metrics"',
  "acquireSubmitReservation",
  "recordPnlSettlementBestEffort",
], "trading routes");
assert.ok(!routes.includes("process.env"), "trading routes must not read process environment");
assertContains(quoteControlRoutes, [
  "registerQuoteControlRoutes",
  'server.get("/admin/quote-control"',
  'server.put("/admin/quote-control"',
  'server.get("/admin/quote-control/pairs/:chainId/:tokenA/:tokenB"',
  'server.put("/admin/quote-control/pairs/:chainId/:tokenA/:tokenB"',
  "normalizePairQuoteControlScope",
  "normalizeQuoteControlUpdate",
], "quote-control routes");
assert.ok(!quoteControlRoutes.includes("process.env"), "quote-control routes must not read process environment");
assertContains(toxicFlowScoreRoutes, [
  "registerToxicFlowScoreRoutes",
  'server.get("/admin/toxic-flow/scores/:chainId/:user"',
  'server.put("/admin/toxic-flow/scores/:chainId/:user"',
  "normalizeToxicFlowScoreKey",
  "normalizeToxicFlowScoreUpdate",
], "toxic-flow score routes");
assert.ok(!toxicFlowScoreRoutes.includes("process.env"), "toxic-flow score routes must not read process environment");

assertContains(environment, [
  "readOwnEnvValue",
  "readDecimalIntegerConfig",
  "requiresExplicitRuntimeConfig",
], "runtime environment");
assertContains(gatewayRuntime, [
  "interface BuildServerOptions",
  "readGatewayServerSettings",
  "resolveApiKeyAuthenticator",
  "resolvePostgresPool",
  "resolveRateLimiter",
  "resolveSubmitReservationStore",
], "gateway runtime");
assertContains(marketRuntime, [
  "readDefaultMarketDataRuntime",
  "resolvePricingRuntime",
  "buildDefaultRiskEngine",
  "readCexOrderBookPairs",
], "market runtime");
assertContains(serverProcess, [
  "installGracefulShutdown",
  "readServerListenConfig",
  'processLike.on("SIGTERM"',
  'processLike.on("SIGINT"',
], "server process runtime");
assertContains(chapter, [
  "process-only entrypoint",
  "`backend/src/api/http-boundary.ts`",
  "`backend/src/api/trading-routes.ts`",
  "`backend/src/runtime/gateway-application.ts`",
  "`backend/src/runtime/gateway-market-data.ts`",
  "`backend/src/runtime/gateway-runtime.ts`",
  "`backend/src/runtime/market-runtime.ts`",
  "`make api-composition-check`",
], "API Gateway chapter");

console.log(
  `API composition consistency check passed (main.ts ${mainLines} lines, gateway application ${gatewayApplicationLines} lines)`,
);

function assertContains(source, needles, label) {
  for (const needle of needles) {
    assert.ok(source.includes(needle), `${label} must include ${needle}`);
  }
}
