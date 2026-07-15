#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { readBackendGatewaySource } from "./lib/read-backend-gateway-source.mjs";
import { readSdkClientSource } from "./lib/read-sdk-client-source.mjs";

const paths = [
  "backend/src/shared/types/rfq.ts",
  "backend/src/main.ts",
  "backend/src/modules/pnl/pnl.service.ts",
  "backend/src/modules/pnl/quote-snapshot-valuation.provider.ts",
  "backend/src/modules/pnl/postgres-pnl.store.ts",
  "backend/src/modules/market-data/postgres-market-snapshot.repository.ts",
  "backend/src/db/migrations/006-quote-snapshot-pnl.sql",
  "backend/test/pnl.test.mjs",
  "backend/test/api-risk-policy-runtime.test.mjs",
  "backend/test/postgres-market-snapshot-store.test.mjs",
  "sdk/src/client.ts",
  "docs/api/openapi.yaml",
  "docs/database/schema.sql",
  "README.md",
  "docker-compose.yml",
  "infra/helm/rfq-market-maker/templates/reconciliation-worker-deployment.yaml",
];
const files = Object.fromEntries(await Promise.all(
  paths.map(async (path) => [path, await readFile(path, "utf8")]),
));
files["backend/src/main.ts"] = await readBackendGatewaySource();
files["sdk/src/client.ts"] = await readSdkClientSource();

assertContains("backend/src/shared/types/rfq.ts", [
  "quote_snapshot_edge_v1",
  "settlementEventId",
  "snapshotId",
  "fairAmountOut",
  "valuationObservedAt",
  "PnlTokenTotal",
  "totals: PnlTokenTotal[]",
]);
assertContains("backend/src/modules/pnl/pnl.service.ts", [
  "convertBaseUnitAmount",
  "fairAmountOut - BigInt(input.quote.amountOut)",
  "calculateGrossPnlBps(fairAmountOut, grossPnl)",
  "`${trade.chainId}:${tokenOut}`",
]);
assertContains("backend/src/modules/pnl/quote-snapshot-valuation.provider.ts", [
  "findBySnapshotId(input.snapshotId)",
  "market snapshot chainId must match",
  "market snapshot token pair must match",
  "requireTokenMetadata",
]);
assertContains("backend/src/main.ts", [
  "QuoteSnapshotPnlValuationProvider",
  "result.settlementEventResult.event.settlementEventId",
  "result.settlementEventResult.event.observedAt",
  "grossPnlTokenOut must match snapshot valuation",
]);
assertContains("backend/src/modules/pnl/postgres-pnl.store.ts", [
  "settlement_event_id",
  "snapshot_id",
  "fair_amount_out",
  "valuation_observed_at",
  "ON CONFLICT (quote_id, model) DO NOTHING",
]);
assertContains("backend/src/modules/market-data/postgres-market-snapshot.repository.ts", [
  "ON CONFLICT (id) DO NOTHING",
  "Postgres market snapshot conflict",
]);
assert.ok(
  !files["backend/src/modules/market-data/postgres-market-snapshot.repository.ts"].includes("ON CONFLICT (id) DO UPDATE"),
  "Postgres market snapshots must not be mutable upserts",
);
assertContains("backend/src/db/migrations/006-quote-snapshot-pnl.sql", [
  "pnl_records_legacy_simulated_v1",
  "quote_snapshot_edge_v1",
  "uq_pnl_records_settlement_model",
  "pnl.attribution.v2",
]);
assertContains("backend/test/pnl.test.mjs", [
  "normalizes cross-decimal valuation",
  'assert.equal(record.fairAmountOut, "2000000000")',
]);
assertContains("backend/test/api-risk-policy-runtime.test.mjs", [
  'url: "/submit"',
  'assert.equal(pnl.trades[0].grossPnlTokenOut, "3200000")',
]);
assertContains("backend/test/postgres-market-snapshot-store.test.mjs", [
  "inserts immutable snapshots",
  "rejects attempts to mutate an existing snapshot id",
]);
assertContains("sdk/src/client.ts", [
  "calculateFairAmountOut",
  "expectedGrossPnl",
  "expectedTotals",
  "pnlTokenKey",
]);
assertContains("docs/api/openapi.yaml", [
  "PnlTokenTotal:",
  "quote_snapshot_edge_v1",
  "fairAmountOut:",
]);
assertContains("docs/database/schema.sql", [
  "settlement_event_id TEXT NOT NULL REFERENCES settlement_events(id)",
  "snapshot_id TEXT NOT NULL REFERENCES market_snapshots(id)",
  "('006', 'quote-snapshot-pnl')",
]);
assertContains("README.md", [
  "immutable quote-time market snapshot",
  "aggregates `/pnl` totals by `(chainId, tokenOut)`",
]);
for (const path of [
  "docker-compose.yml",
  "infra/helm/rfq-market-maker/templates/reconciliation-worker-deployment.yaml",
]) {
  assertContains(path, ["RFQ_TOKEN_REGISTRY_JSON"]);
}

console.log("PnL valuation consistency check passed: snapshot-bound cross-decimal attribution");

function assertContains(path, needles) {
  for (const needle of needles) {
    assert.ok(files[path].includes(needle), `${path} must include ${needle}`);
  }
}
