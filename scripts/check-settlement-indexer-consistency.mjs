#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const paths = [
  "backend/package.json",
  "backend/src/db/migrations/007-settlement-indexer.sql",
  "backend/src/settlement-indexer-main.ts",
  "backend/src/modules/indexer/settlement-indexer.reader.ts",
  "backend/src/modules/indexer/postgres-settlement-indexer.store.ts",
  "backend/src/modules/indexer/settlement-indexer.worker.ts",
  "backend/src/modules/indexer/settlement-indexer.metrics.ts",
  "backend/test/settlement-indexer.test.mjs",
  "backend/test/postgres-settlement-indexer-store.test.mjs",
  "docs/adr/ADR-0006-Use-Independent-Settlement-Indexer.md",
  "docs/database/schema.sql",
  "docs/diagrams/submit-sequence.md",
  "infra/prometheus/prometheus.yml",
  "infra/prometheus/rules/rfq-alerts.yml",
  "infra/k8s/settlement-indexer-deployment.yaml",
  "infra/k8s/settlement-indexer-secret.yaml",
  "infra/k8s/settlement-indexer-network-policy.yaml",
  "infra/helm/rfq-market-maker/values.yaml",
  "infra/helm/rfq-market-maker/templates/settlement-indexer-deployment.yaml",
  "README.md",
];
const files = Object.fromEntries(await Promise.all(
  paths.map(async (path) => [path, await readFile(path, "utf8")]),
));

assertContains("backend/package.json", ["start:settlement-indexer"]);
assertContains("backend/src/db/migrations/007-settlement-indexer.sql", [
  "CREATE TABLE settlement_indexer_cursors",
  "CREATE TABLE settlement_indexer_checkpoints",
  "idx_settlement_events_canonical_chain_block",
]);
assertContains("backend/src/modules/indexer/settlement-indexer.reader.ts", [
  "getQuoteSettledLogs",
  "strict: true",
  "reorgLookbackBlocks",
  "requestTimeoutMs",
]);
assertContains("backend/src/modules/indexer/postgres-settlement-indexer.store.ts", [
  "lease_expires_at > now()",
  "revision = $4",
  "next_block = $5",
  "SettlementIndexerLeaseError",
  "DELETE FROM settlement_indexer_checkpoints",
]);
assertContains("backend/src/modules/indexer/settlement-indexer.worker.ts", [
  "findSignedQuoteByChainUserNonce",
  "hashSettlementQuote(quote)",
  "removeOrphanedUncheckpointedEvents",
  "rollbackReorgIfNeeded",
  'SettlementIndexerError("DEEP_REORG")',
]);
assertContains("backend/src/modules/indexer/settlement-indexer.metrics.ts", [
  "rfq_settlement_indexer_lag_blocks",
  "rfq_settlement_indexer_errors_total",
  "DEEP_REORG",
]);
assertContains("backend/test/settlement-indexer.test.mjs", [
  "ingests confirmed matching logs",
  "orphaned events left by a crash before cursor commit",
  "fails closed when a reorg exceeds",
]);
assertContains("backend/test/postgres-settlement-indexer-store.test.mjs", [
  "advances checkpoint and cursor in one CAS transaction",
  "fails closed when cursor CAS loses the lease",
]);
assertContains("docs/adr/ADR-0006-Use-Independent-Settlement-Indexer.md", [
  "Browser Callback Only",
  "Backend Transaction Relay",
  "Independent Confirmed-Log Indexer",
]);
assertContains("docs/database/schema.sql", [
  "settlement_indexer_cursors",
  "settlement_indexer_checkpoints",
  "('007', 'settlement-indexer')",
]);
assertContains("docs/diagrams/submit-sequence.md", [
  "Callback is lost or delayed",
  "claim chain cursor lease",
  "CAS advance next block + checkpoint",
]);
assertContains("infra/prometheus/prometheus.yml", ["job_name: rfq-settlement-indexer"]);
assertContains("infra/prometheus/rules/rfq-alerts.yml", [
  "RFQSettlementIndexerDown",
  "RFQSettlementIndexerLagHigh",
  "RFQSettlementIndexerDeepReorg",
]);
assertContains("infra/k8s/settlement-indexer-deployment.yaml", [
  "replicas: 2",
  "backend/dist/settlement-indexer-main.js",
  "rfq-settlement-indexer-secrets",
]);
assertContains("infra/k8s/settlement-indexer-secret.yaml", [
  "DATABASE_URL:",
  "RFQ_SETTLEMENT_INDEXER_CONFIG_JSON:",
]);
for (const forbidden of ["RFQ_AWS_KMS_KEY_ID", "RFQ_SIGNER_PRIVATE_KEY", "RFQ_BINANCE_API_KEY"]) {
  assert.ok(!files["infra/k8s/settlement-indexer-secret.yaml"].includes(forbidden), `indexer Secret must exclude ${forbidden}`);
}
assertContains("infra/k8s/settlement-indexer-network-policy.yaml", [
  "port: 5432",
  "port: 443",
]);
assertContains("infra/helm/rfq-market-maker/values.yaml", [
  "settlementIndexer:",
  "configJsonKey: RFQ_SETTLEMENT_INDEXER_CONFIG_JSON",
]);
assertContains("infra/helm/rfq-market-maker/templates/settlement-indexer-deployment.yaml", [
  ".Values.settlementIndexer.enabled",
  ".Values.settlementIndexer.secret.configJsonKey",
]);
assertContains("README.md", [
  "does not depend on the browser successfully calling `/submit`",
  "An unknown quote or a reorg deeper than `reorgLookbackBlocks` stops that chain",
]);

console.log("Settlement indexer consistency check passed: durable callback recovery and reorg rollback");

function assertContains(path, needles) {
  for (const needle of needles) {
    assert.ok(files[path].includes(needle), `${path} must include ${needle}`);
  }
}
