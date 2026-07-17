#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { readBackendGatewaySource } from "./lib/read-backend-gateway-source.mjs";
import { readBackendMetricsSource } from "./lib/read-backend-metrics-source.mjs";

const files = {
  main: await readBackendGatewaySource(),
  store: await readFile("backend/src/modules/execution/submit-reservation.store.ts", "utf8"),
  postgres: await readFile("backend/src/modules/execution/postgres-submit-reservation.store.ts", "utf8"),
  migration: await readFile("backend/src/db/migrations/008-submit-reservations.sql", "utf8"),
  schema: await readFile("docs/database/schema.sql", "utf8"),
  errors: await readFile("docs/api/errors.md", "utf8"),
  metrics: await readBackendMetricsSource(),
  alerts: await readFile("infra/prometheus/rules/rfq-alerts.yml", "utf8"),
  runbook: await readFile("book/Volume7-ProductionDeployment/Chapter05-Runbook.md", "utf8"),
  concurrencyTest: await readFile("backend/test/submit-concurrency.test.mjs", "utf8"),
};

assertContains(files.main, [
  "resolveSubmitReservationStore(",
  "acquireSubmitReservation(submitReservationStore, metricsService, quoteId)",
  "releaseSubmitReservationBestEffort(submitReservationStore, metricsService, submitReservation)",
  '"SUBMIT_RESERVATION_UNAVAILABLE"',
  '"RFQ_SUBMIT_RESERVATION_LEASE_MS"',
], "backend/src/main.ts");
assert.ok(!files.main.includes("inFlightSubmitQuoteIds"), "submit isolation must not use a process-local Set");

assertContains(files.store, [
  "defaultSubmitReservationLeaseMs = 900_000",
  "minSubmitReservationLeaseMs = 60_000",
  "maxSubmitReservationLeaseMs = 3_600_000",
  "ownerToken",
  "checkHealth()",
], "in-memory submit reservation store");

assertContains(files.postgres, [
  "ON CONFLICT (quote_id) DO UPDATE SET",
  "WHERE quote_submit_reservations.expires_at <= now()",
  "WHERE quote_id = $1 AND owner_token = $2",
  "RETURNING quote_id, owner_token, expires_at",
], "PostgreSQL submit reservation store");

for (const source of [files.migration, files.schema]) {
  assertContains(source, [
    "quote_submit_reservations",
    "quote_id",
    "owner_token",
    "expires_at",
    "ON DELETE CASCADE",
  ], "submit reservation schema");
}

assertContains(files.errors, ["SUBMIT_RESERVATION_UNAVAILABLE", "QUOTE_ALREADY_USED"], "API errors");
assertContains(files.metrics, [
  "rfq_submit_reservation_contention_total",
  "rfq_submit_reservation_errors_total",
], "metrics");
assertContains(files.alerts, [
  "RFQSubmitReservationErrors",
  "RFQSubmitReservationContentionSpike",
], "Prometheus alerts");
assertContains(files.runbook, [
  "RFQSubmitReservationErrors",
  "migration `008`",
  "do not bypass quote ownership",
], "runbook");
assertContains(files.concurrencyTest, [
  "shared submit reservations reject the same quote across API replicas",
  "assert.equal(verifyCalls, 1)",
  "assert.equal(firstSubmit.statusCode, 202)",
  "assert.equal(concurrentReplay.statusCode, 409)",
], "cross-replica concurrency test");

console.log("Submit reservation consistency check passed");

function assertContains(source, needles, label) {
  for (const needle of needles) {
    assert.ok(source.includes(needle), `${label} must include ${needle}`);
  }
}
