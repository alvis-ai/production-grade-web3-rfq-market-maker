#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const paths = [
  "scripts/analytics-integration-check.mjs",
  "scripts/analytics-e2e.sh",
  ".github/workflows/analytics-ci.yml",
  "docker-compose.yml",
  "Makefile",
  "package.json",
  "README.md",
  "book/Volume5-BackendEngineering/Chapter08-Metrics-Service.md",
  "book/Volume7-ProductionDeployment/Chapter04-CI-CD.md",
];
const files = Object.fromEntries(await Promise.all(
  paths.map(async (path) => [path, await readFile(path, "utf8")]),
));

assertContains("scripts/analytics-integration-check.mjs", [
  "RFQ_ANALYTICS_INTEGRATION_CONFIRM",
  "RFQ_ANALYTICS_INTEGRATION_ALLOW_REMOTE",
  "principal_id",
  "settled_at",
  "readdir(new URL(\"../backend/dist/db/migrations/\"",
  "expectedMigrationVersions",
  "operational transaction must atomically emit all eight analytics events",
  "published_at !== null",
  "uniqExact(event_id)",
  "marketSpreadBps",
  "quote.routing.v1",
  "expectedLiquidityUsd",
  "RFQ_CLICKHOUSE_USERNAME",
  "authorization: `Basic",
  "ALTER TABLE ${clickhouseTable} DELETE",
  "RFQ_ANALYTICS_INTEGRATION_TIMEOUT_MS",
  "RFQ_ANALYTICS_INTEGRATION_REQUEST_TIMEOUT_MS",
  "AbortSignal.timeout(requestTimeoutMs)",
  "Analytics integration exceeded ${integrationTimeoutMs}ms hard deadline",
  "[analytics-integration] ${message}",
]);
assert.ok(
  !files["scripts/analytics-integration-check.mjs"].includes('["001", "002"'),
  "analytics integration must discover compiled migrations instead of freezing a historical version list",
);
assertContains("scripts/analytics-e2e.sh", [
  "backend/dist/analytics-worker-main.js",
  "RFQ_ANALYTICS_E2E_READY_URL",
  'export RFQ_ANALYTICS_WORKER_HOST="$HOST"',
  'export RFQ_ANALYTICS_WORKER_PORT="$PORT"',
  "body.status === \"ok\"",
  "scripts/analytics-integration-check.mjs",
  "trap cleanup EXIT",
  "trap 'exit 130' INT",
  "trap 'exit 143' TERM",
  "RFQ_ANALYTICS_E2E_TIMEOUT_SECONDS",
  "RFQ_ANALYTICS_E2E_READY_REQUEST_TIMEOUT_MS",
  "AbortSignal.timeout(timeoutMs)",
  "kill -KILL",
  'watchdog_stop_file="${LOG_FILE}.watchdog-stop.$$"',
  "Analytics E2E exceeded ${E2E_TIMEOUT_SECONDS}s hard deadline",
]);
assertContains(".github/workflows/analytics-ci.yml", [
  "name: Analytics CI",
  "persist-credentials: false",
  'node-version: "22"',
  "docker compose up -d --wait postgres redpanda clickhouse",
  "docker compose --profile analytics run --rm redpanda-topic-init",
  "RFQ_ANALYTICS_INTEGRATION_CONFIRM: \"yes\"",
  "timeout-minutes: 10",
  "RFQ_ANALYTICS_E2E_TIMEOUT_SECONDS: \"120\"",
  "RFQ_ANALYTICS_INTEGRATION_TIMEOUT_MS: \"60000\"",
  "run: make db-migrate analytics-e2e",
  "if: failure()",
  "if: always()",
]);
assertContains("docker-compose.yml", [
  "redpandadata/redpanda:v26.1.12",
  "clickhouse/clickhouse-server:26.3.17.4",
  "CLICKHOUSE_PASSWORD: ${RFQ_CLICKHOUSE_PASSWORD:-rfq-clickhouse-dev}",
  "RFQ_CLICKHOUSE_PASSWORD: ${RFQ_CLICKHOUSE_PASSWORD:-rfq-clickhouse-dev}",
]);
assertContains("Makefile", [
  "analytics-pipeline-check:",
  "analytics-e2e: backend-build",
]);
assertContains("package.json", [
  '"analytics:pipeline:check": "make analytics-pipeline-check"',
  '"analytics:e2e": "make analytics-e2e"',
]);
assertContains("README.md", [
  "make analytics-e2e",
  "Analytics CI",
  "RFQ_ANALYTICS_E2E_TIMEOUT_SECONDS",
  "RFQ_ANALYTICS_INTEGRATION_TIMEOUT_MS",
]);
assertContains("book/Volume5-BackendEngineering/Chapter08-Metrics-Service.md", [
  "Analytics CI",
  "current compiled schema",
  "complete shell lifecycle",
]);
assertContains("book/Volume7-ProductionDeployment/Chapter04-CI-CD.md", [
  "Analytics CI",
  "PostgreSQL -> Redpanda -> ClickHouse",
  "十分钟 job",
]);

console.log("Analytics integration consistency check passed: current-schema outbox delivery is enforced end to end");

function assertContains(path, needles) {
  for (const needle of needles) {
    assert.ok(files[path].includes(needle), `${path} must include ${needle}`);
  }
}
