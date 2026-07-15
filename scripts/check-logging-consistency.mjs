#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const paths = {
  logger: "backend/src/shared/logger/structured-logger.ts",
  gateway: "backend/src/runtime/gateway-application.ts",
  boundary: "backend/src/api/http-boundary.ts",
  toxicWorker: "backend/src/modules/risk/toxic-flow-analyzer.worker.ts",
  analyticsPublisher: "backend/src/modules/analytics/analytics-outbox.publisher.ts",
  hedgeWorker: "backend/src/modules/hedge/hedge-worker.ts",
  hedgeFeeWorker: "backend/src/modules/hedge/hedge-fee-worker.ts",
  reconciliationWorker: "backend/src/modules/reconciliation/post-trade-reconciliation.worker.ts",
  cexMonitor: "backend/src/modules/market-data/cex-orderbook/cex-orderbook-monitor.ts",
  marketBackgroundLogger: "backend/src/modules/market-data/market-data-background-logger.ts",
  priceUpdater: "backend/src/modules/market-data/price-updater.ts",
  snapshotSampler: "backend/src/modules/market-data/market-snapshot-sampler.ts",
  databasePool: "backend/src/db/pool.ts",
  serverProcess: "backend/src/runtime/server-process.ts",
  loggerTest: "backend/test/structured-logger.test.mjs",
  toxicTest: "backend/test/toxic-flow-analyzer-worker.test.mjs",
  priceUpdaterTest: "backend/test/price-updater.test.mjs",
  snapshotSamplerTest: "backend/test/market-snapshot-sampler.test.mjs",
  cexMonitorTest: "backend/test/cex-orderbook.test.mjs",
  env: ".env.example",
  compose: "docker-compose.yml",
  helmValues: "infra/helm/rfq-market-maker/values.yaml",
  k8sConfig: "infra/k8s/configmap.yaml",
  readme: "README.md",
  apiDocs: "book/Volume5-BackendEngineering/Chapter01-API-Gateway.md",
  metricsDocs: "book/Volume5-BackendEngineering/Chapter08-Metrics-Service.md",
  monitoringDocs: "book/Volume7-ProductionDeployment/Chapter03-Monitoring.md",
  security: "docs/security/audit-checklist.md",
};

const files = Object.fromEntries(
  await Promise.all(Object.entries(paths).map(async ([name, path]) => [name, await readFile(path, "utf8")])),
);

for (const term of [
  'supportedLogLevels = ["debug", "info", "warn", "error"]',
  'readLogLevel(',
  'createStructuredLogger(',
  'structuredLoggerConfig(',
  'logProcessFailure(',
  'messageKey: "message"',
  'serviceNamePattern',
  'req.headers[\'x-api-key\']',
  '"*.signature"',
  '"*.privateKey"',
]) {
  assert.ok(files.logger.includes(term), `shared structured logger must include: ${term}`);
}

for (const term of [
  'structuredLoggerConfig("rfq-api")',
  "disableRequestLogging: true",
]) {
  assert.ok(files.gateway.includes(term), `gateway logging composition must include: ${term}`);
}

for (const term of [
  'request.log.debug(fields, "HTTP request completed")',
  'request.log.info(fields, "HTTP request completed")',
  'request.log.error(fields, "HTTP request failed")',
  'request.log.warn(fields, "HTTP request rejected")',
  "traceId: requestTraceId(request)",
  "route: requestRoute(request)",
  "durationMs:",
]) {
  assert.ok(files.boundary.includes(term), `HTTP logging boundary must include: ${term}`);
}

const workerEntrypoints = [
  ["hedge-worker", "backend/src/hedge-worker-main.ts"],
  ["analytics-worker", "backend/src/analytics-worker-main.ts"],
  ["reconciliation-worker", "backend/src/reconciliation-worker-main.ts"],
  ["settlement-indexer", "backend/src/settlement-indexer-main.ts"],
  ["toxic-flow-analyzer", "backend/src/toxic-flow-analyzer-main.ts"],
];
for (const [service, path] of workerEntrypoints) {
  const source = await readFile(path, "utf8");
  assert.ok(source.includes(`createStructuredLogger("${service}")`), `${path} must create its service logger`);
  assert.ok(source.includes(`logProcessFailure("${service}", error)`), `${path} must log startup failure safely`);
  assert.ok(source.includes("disableRequestLogging: true"), `${path} must disable noisy default probe logs`);
}

assert.ok(
  files.toxicWorker.includes('"toxic-flow analyzer iteration failed"') &&
    files.toxicWorker.includes("this.logger.error"),
  "toxic-flow analyzer must not silently swallow iteration failures",
);

for (const name of ["analyticsPublisher", "hedgeWorker", "hedgeFeeWorker", "reconciliationWorker"]) {
  assert.ok(
    files[name].includes("errorCode:") && !files[name].includes("logger.error({ error:"),
    `${paths[name]} must log stable errorCode fields instead of raw exception text`,
  );
}

assert.ok(
  files.cexMonitor.includes('errorCode: "CEX_ORDER_BOOK_CONNECTOR_ERROR"') &&
    files.cexMonitor.includes('errorCode: "CEX_ORDER_BOOK_CONNECTOR_RECOVERED"') &&
    files.cexMonitor.includes("failedConnectors") &&
    files.cexMonitor.includes("recordConnectorFailure") &&
    files.cexMonitor.includes("recordConnectorRecovery") &&
    files.cexMonitor.includes("this.logger[level](fields, message)") &&
    !files.cexMonitor.includes("console.warn"),
  "CEX monitor must log bounded connector failure and recovery transitions",
);
assert.ok(
  files.cexMonitorTest.includes("logs only connector failure and recovery transitions") &&
    files.cexMonitorTest.includes("isolates observer and logger failures") &&
    files.cexMonitorTest.includes("private connector detail") &&
    files.cexMonitorTest.includes("CEX_ORDER_BOOK_CONNECTOR_RECOVERED"),
  "CEX monitor tests must cover transition throttling, dependency isolation, and raw error omission",
);
for (const [name, failureCode, recoveryCode, stateSet] of [
  ["priceUpdater", "MARKET_DATA_REFRESH_FAILED", "MARKET_DATA_REFRESH_RECOVERED", "failedPairs"],
  ["snapshotSampler", "MARKET_SNAPSHOT_PERSIST_FAILED", "MARKET_SNAPSHOT_PERSIST_RECOVERED", "failedPersistencePairs"],
]) {
  assert.ok(
    files[name].includes(failureCode) && files[name].includes(recoveryCode) && files[name].includes(stateSet) &&
      files[name].includes("logMarketDataBackgroundTransition") && !files[name].includes("catch (error)"),
    `${paths[name]} must log bounded failure/recovery transitions without raw exception values`,
  );
}
assert.ok(
  files.marketBackgroundLogger.includes("try {") && files.marketBackgroundLogger.includes("logger[level](fields, message)") &&
    files.marketBackgroundLogger.includes("catch {}") &&
    files.marketBackgroundLogger.includes("MarketDataBackgroundLogCode") &&
    files.marketBackgroundLogger.includes("marketDataBackgroundLogFields"),
  "market-data background logging must not change refresh or persistence outcomes",
);
assert.ok(
  files.databasePool.includes('errorCode: "DATABASE_POOL_ERROR"') &&
    files.databasePool.includes("logger.error"),
  "database pool must emit a stable structured error",
);
assert.ok(
  files.serverProcess.includes('errorCode: "SERVER_SHUTDOWN_FAILED"'),
  "API shutdown failures must emit a stable structured error",
);

for (const term of [
  "never serializes request headers",
  "raw exception messages",
  "gateway request logs correlate route templates with trace ids",
  "structured logger redacts credentials",
]) {
  assert.ok(files.loggerTest.includes(term), `structured logger tests must cover: ${term}`);
}
assert.ok(
  files.toxicTest.includes("records and logs iteration failures"),
  "toxic-flow worker tests must cover iteration error logging",
);
for (const name of ["priceUpdaterTest", "snapshotSamplerTest"]) {
  assert.ok(
    files[name].includes("logs only") && files[name].includes("isolates and validates its logger") &&
      files[name].includes("secret") && files[name].includes("includes") && files[name].includes("false"),
    `${paths[name]} must cover transition throttling, logger isolation, and raw error omission`,
  );
}

assert.ok(files.env.includes("RFQ_LOG_LEVEL=info"), ".env.example must document RFQ_LOG_LEVEL");
assert.ok(
  count(files.compose, "RFQ_LOG_LEVEL:") >= 6,
  "Docker Compose must configure log level for API and every worker",
);
assert.ok(
  count(files.helmValues, "RFQ_LOG_LEVEL:") >= 6,
  "Helm values must configure log level for API and every worker",
);
assert.ok(files.k8sConfig.includes("RFQ_LOG_LEVEL: info"), "raw Kubernetes config must configure log level");

for (const [name, terms] of Object.entries({
  readme: ["`RFQ_LOG_LEVEL` accepts only", "service-bound JSON records", "route template", "MARKET_DATA_REFRESH_FAILED", "CEX_ORDER_BOOK_CONNECTOR_RECOVERED"],
  apiDocs: ["Pino JSON completion record", "dynamic URL", "debug|info|warn|error"],
  metricsDocs: ["Structured JSON logs complement Prometheus", "shared logger redacts", "MARKET_SNAPSHOT_PERSIST_FAILED", "CEX_ORDER_BOOK_CONNECTOR_ERROR"],
  monitoringDocs: ["Every long-running backend process writes one-line structured JSON", "must not index or retain API keys", "failure transition", "CEX_ORDER_BOOK_CONNECTOR_RECOVERED"],
  security: ["API and worker logs are structured, level-controlled, trace-correlated", "Market-data background failure logs are transition-based", "CEX connector failure logs are transition-based"],
})) {
  for (const term of terms) {
    assert.ok(files[name].includes(term), `${paths[name]} must document: ${term}`);
  }
}

console.log("Structured logging consistency check passed for API and 5 workers");

function count(source, needle) {
  return source.split(needle).length - 1;
}
