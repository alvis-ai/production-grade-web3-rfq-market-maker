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
const environment = sources["backend/src/runtime/environment.ts"];
const gatewayRuntime = sources["backend/src/runtime/gateway-runtime.ts"];
const marketRuntime = sources["backend/src/runtime/market-runtime.ts"];
const serverProcess = sources["backend/src/runtime/server-process.ts"];
const chapter = await readFile("book/Volume5-BackendEngineering/Chapter01-API-Gateway.md", "utf8");

const mainLines = main.split(/\r?\n/).length;
assert.ok(mainLines <= 500, `backend/src/main.ts must remain a thin composition root (got ${mainLines} lines)`);
assertContains(main, [
  "export function buildServer",
  "installGatewayBoundary(server",
  "registerTradingRoutes(server",
  "registerQuoteControlRoutes(server",
  "readDefaultMarketDataRuntime()",
  "resolvePostgresPool(options)",
  "export async function startServer",
], "backend/src/main.ts");
for (const directRoute of ['server.get("', 'server.post("', 'server.options("']) {
  assert.ok(!main.includes(directRoute), `backend/src/main.ts must not register routes directly: ${directRoute}`);
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
  "thin composition root",
  "`backend/src/api/http-boundary.ts`",
  "`backend/src/api/trading-routes.ts`",
  "`backend/src/runtime/gateway-runtime.ts`",
  "`backend/src/runtime/market-runtime.ts`",
  "`make api-composition-check`",
], "API Gateway chapter");

console.log(`API composition consistency check passed (main.ts ${mainLines} lines)`);

function assertContains(source, needles, label) {
  for (const needle of needles) {
    assert.ok(source.includes(needle), `${label} must include ${needle}`);
  }
}
