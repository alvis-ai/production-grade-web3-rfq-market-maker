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
const processShutdown = sources["backend/src/runtime/process-shutdown.ts"];
const serverProcess = sources["backend/src/runtime/server-process.ts"];
const chapter = await readFile("book/Volume5-BackendEngineering/Chapter01-API-Gateway.md", "utf8");
const quoteService = await readFile("backend/src/modules/quote/quote.service.ts", "utf8");
const quoteServiceContract = await readFile(
  "backend/src/modules/quote/quote-service-contract.ts",
  "utf8",
);
const quoteServiceErrors = await readFile(
  "backend/src/modules/quote/quote-service-errors.ts",
  "utf8",
);
const quoteServiceResultValidation = await readFile(
  "backend/src/modules/quote/quote-service-result-validation.ts",
  "utf8",
);
const quoteServiceChapter = await readFile(
  "book/Volume5-BackendEngineering/Chapter02-Quote-Service.md",
  "utf8",
);

const mainLines = main.split(/\r?\n/).length;
const gatewayApplicationLines = gatewayApplication.split(/\r?\n/).length;
const quoteServiceLines = quoteService.split(/\r?\n/).length;
const quoteServiceContractLines = quoteServiceContract.split(/\r?\n/).length;
const quoteServiceErrorsLines = quoteServiceErrors.split(/\r?\n/).length;
const quoteServiceResultValidationLines = quoteServiceResultValidation.split(/\r?\n/).length;
assert.ok(mainLines <= 100, `backend/src/main.ts must remain a process entrypoint (got ${mainLines} lines)`);
assert.ok(
  gatewayApplicationLines <= 350,
  `backend/src/runtime/gateway-application.ts must remain a bounded composition root (got ${gatewayApplicationLines} lines)`,
);
assert.ok(
  quoteServiceLines <= 600,
  `backend/src/modules/quote/quote.service.ts must remain a bounded orchestrator (got ${quoteServiceLines} lines)`,
);
assert.ok(
  quoteServiceContractLines <= 250,
  `quote-service-contract.ts must remain a bounded construction boundary (got ${quoteServiceContractLines} lines)`,
);
assert.ok(
  quoteServiceErrorsLines <= 100,
  `quote-service-errors.ts must remain a bounded error boundary (got ${quoteServiceErrorsLines} lines)`,
);
assert.ok(
  quoteServiceResultValidationLines <= 500,
  `quote-service-result-validation.ts must remain a bounded validation boundary (got ${quoteServiceResultValidationLines} lines)`,
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
  "resolvePostgresPool(options, server.log)",
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
  "installBoundedShutdown",
  "readServerListenConfig",
], "server process runtime");
assertContains(processShutdown, [
  "installBoundedShutdown",
  "readShutdownTimeoutMs",
  'processLike.on("SIGTERM"',
  'processLike.on("SIGINT"',
  "PROCESS_SHUTDOWN_TIMEOUT",
  "PROCESS_SHUTDOWN_FORCED",
], "bounded process shutdown runtime");
assertContains(quoteService, [
  'from "./quote-service-contract.js"',
  'from "./quote-service-errors.js"',
  'from "./quote-service-result-validation.js"',
  "export class QuoteService",
  "async createQuote",
  "async requireSubmittableSignedQuote",
], "quote service orchestrator");
for (const extractedDefinition of [
  "function assertRoutePlan",
  "function assertPricingResult",
  "function assertRiskDecision",
  "function assertQuoteServiceDeps",
]) {
  assert.ok(
    !quoteService.includes(extractedDefinition),
    `quote service orchestrator must delegate ${extractedDefinition}`,
  );
}
assertContains(quoteServiceContract, [
  "interface QuoteServiceDeps",
  "normalizeQuoteServiceDeps",
  "normalizeQuoteServiceConfig",
  "normalizeQuoteAccessContext",
], "quote service construction boundary");
assertContains(quoteServiceResultValidation, [
  "assertRoutePlan",
  "assertPricingResult",
  "assertInventoryProjection",
  "assertQuoteExposureReservationResult",
  "assertRiskDecision",
], "quote service result validation boundary");
assertContains(quoteServiceErrors, [
  "marketDataFailure",
  "quoteStoreFailure",
  "pricingFailure",
  "routingFailure",
  "assertUsableSnapshot",
], "quote service error boundary");
assertContains(chapter, [
  "process-only entrypoint",
  "`backend/src/api/http-boundary.ts`",
  "`backend/src/api/trading-routes.ts`",
  "`backend/src/runtime/gateway-application.ts`",
  "`backend/src/runtime/gateway-market-data.ts`",
  "`backend/src/runtime/gateway-runtime.ts`",
  "`backend/src/runtime/market-runtime.ts`",
  "`backend/src/runtime/process-shutdown.ts`",
  "`make api-composition-check`",
], "API Gateway chapter");
assertContains(quoteServiceChapter, [
  "`quote.service.ts`",
  "`quote-service-contract.ts`",
  "`quote-service-errors.ts`",
  "`quote-service-result-validation.ts`",
  "`make api-composition-check`",
], "Quote Service chapter");

console.log(
  `API composition consistency check passed (main.ts ${mainLines} lines, gateway application ${gatewayApplicationLines} lines, quote service ${quoteServiceLines} lines)`,
);

function assertContains(source, needles, label) {
  for (const needle of needles) {
    assert.ok(source.includes(needle), `${label} must include ${needle}`);
  }
}
