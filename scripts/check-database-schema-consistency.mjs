#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { readBackendGatewaySource } from "./lib/read-backend-gateway-source.mjs";

const schemaSource = await readFile("docs/database/schema.sql", "utf8");
const erDiagramSource = await readFile("docs/database/er-diagram.md", "utf8");
const openapiSource = await readFile("docs/api/openapi.yaml", "utf8");
const backendTypesSource = await readFile("backend/src/shared/types/rfq.ts", "utf8");
const quoteRepositorySource = await readFile("backend/src/modules/quote/quote.repository.ts", "utf8");
const riskEngineSource = await readFile("backend/src/modules/risk/risk.engine.ts", "utf8");
const settlementEventServiceSource = await readFile(
  "backend/src/modules/settlement/settlement-event.service.ts",
  "utf8",
);
const settlementMigrationSource = await readFile("backend/src/db/migrations/002-settlement-canonical.sql", "utf8");
const hedgeWorkerMigrationSource = await readFile("backend/src/db/migrations/003-hedge-worker-queue.sql", "utf8");
const analyticsOutboxMigrationSource = await readFile("backend/src/db/migrations/004-analytics-outbox.sql", "utf8");
const postTradeMigrationSource = await readFile(
  "backend/src/db/migrations/005-post-trade-reconciliation.sql",
  "utf8",
);
const quoteSnapshotPnlMigrationSource = await readFile(
  "backend/src/db/migrations/006-quote-snapshot-pnl.sql",
  "utf8",
);
const settlementIndexerMigrationSource = await readFile(
  "backend/src/db/migrations/007-settlement-indexer.sql",
  "utf8",
);
const submitReservationMigrationSource = await readFile(
  "backend/src/db/migrations/008-submit-reservations.sql",
  "utf8",
);
const postgresSettlementSource = await readFile("backend/src/modules/settlement/postgres-settlement-event.store.ts", "utf8");
const postgresInventorySource = await readFile("backend/src/modules/inventory/postgres-inventory.service.ts", "utf8");
const postgresHedgeSource = await readFile("backend/src/modules/hedge/postgres-hedge.service.ts", "utf8");
const postgresHedgeJobSource = await readFile("backend/src/modules/hedge/postgres-hedge-job.store.ts", "utf8");
const hedgeWorkerSource = await readFile("backend/src/modules/hedge/hedge-worker.ts", "utf8");
const binanceAdapterSource = await readFile("backend/src/modules/hedge/binance-spot.adapter.ts", "utf8");
const analyticsOutboxStoreSource = await readFile("backend/src/modules/analytics/postgres-analytics-outbox.store.ts", "utf8");
const analyticsEventSource = await readFile("backend/src/modules/analytics/analytics-event.ts", "utf8");
const analyticsPublisherSource = await readFile("backend/src/modules/analytics/analytics-outbox.publisher.ts", "utf8");
const analyticsKafkaProducerSource = await readFile("backend/src/modules/analytics/kafka-analytics.producer.ts", "utf8");
const analyticsKafkaConsumerSource = await readFile("backend/src/modules/analytics/kafka-analytics.consumer.ts", "utf8");
const clickhouseAnalyticsSource = await readFile("backend/src/modules/analytics/clickhouse-analytics.sink.ts", "utf8");
const postgresPnlSource = await readFile("backend/src/modules/pnl/postgres-pnl.store.ts", "utf8");
const postTradeStoreSource = await readFile(
  "backend/src/modules/reconciliation/postgres-post-trade-reconciliation.store.ts",
  "utf8",
);
const postTradeWorkerSource = await readFile(
  "backend/src/modules/reconciliation/post-trade-reconciliation.worker.ts",
  "utf8",
);
const settlementIndexerStoreSource = await readFile(
  "backend/src/modules/indexer/postgres-settlement-indexer.store.ts",
  "utf8",
);
const settlementIndexerWorkerSource = await readFile(
  "backend/src/modules/indexer/settlement-indexer.worker.ts",
  "utf8",
);
const backendMainSource = await readBackendGatewaySource();
const maxSafeInteger = "9007199254740991";
const secp256k1HalfOrder = "7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0";
const safeIdentifierPattern = "^[A-Za-z0-9_:-]+$";

const tables = extractTables(schemaSource);

const requiredTables = {
  quotes: [
    "id",
    "chain_id",
    "user_address",
    "token_in",
    "token_out",
    "amount_in",
    "slippage_bps",
    "amount_out",
    "min_amount_out",
    "nonce",
    "deadline",
    "snapshot_id",
    "pricing_version",
    "spread_bps",
    "size_impact_bps",
    "inventory_skew_bps",
    "risk_policy_version",
    "status",
    "signature",
    "reject_code",
    "tx_hash",
    "settlement_event_id",
    "hedge_order_id",
    "pnl_id",
  ],
  market_snapshots: [
    "id",
    "chain_id",
    "token_in",
    "token_out",
    "mid_price",
    "liquidity_usd",
    "volatility_bps",
    "observed_at",
  ],
  risk_decisions: ["id", "quote_id", "decision", "reason_code", "policy_version"],
  settlement_events: [
    "id",
    "quote_id",
    "chain_id",
    "tx_hash",
    "quote_hash",
    "log_index",
    "block_number",
    "user_address",
    "token_in",
    "token_out",
    "amount_in",
    "amount_out",
    "nonce",
    "canonical",
    "removed_at",
  ],
  inventory_positions: ["id", "chain_id", "token_address", "balance", "target_balance", "max_exposure"],
  hedge_orders: [
    "id",
    "settlement_event_id",
    "quote_id",
    "chain_id",
    "token_address",
    "side",
    "amount",
    "venue",
    "status",
    "reason",
    "external_order_id",
    "attempt_count",
    "next_attempt_at",
    "lease_owner",
    "lease_expires_at",
    "venue_symbol",
    "client_order_id",
    "submission_attempted_at",
    "filled_amount",
    "last_error_code",
  ],
  pnl_records: [
    "id",
    "quote_id",
    "settlement_event_id",
    "snapshot_id",
    "chain_id",
    "user_address",
    "token_in",
    "token_out",
    "amount_in",
    "amount_out",
    "min_amount_out",
    "nonce",
    "deadline",
    "mid_price",
    "token_in_decimals",
    "token_out_decimals",
    "fair_amount_out",
    "valuation_observed_at",
    "gross_pnl_token_out",
    "gross_pnl_bps",
    "model",
    "model_description",
    "realized_at",
  ],
  analytics_outbox: [
    "id",
    "topic",
    "event_key",
    "event_type",
    "schema_version",
    "aggregate_type",
    "aggregate_id",
    "payload",
    "attempt_count",
    "available_at",
    "lease_owner",
    "lease_expires_at",
    "published_at",
    "last_error_code",
    "created_at",
  ],
  post_trade_reconciliation_jobs: [
    "quote_id",
    "desired_settlement_event_id",
    "desired_revision",
    "processed_revision",
    "attempt_count",
    "requested_at",
    "next_attempt_at",
    "lease_owner",
    "lease_expires_at",
    "last_error_code",
  ],
  settlement_indexer_cursors: [
    "chain_id",
    "settlement_address",
    "start_block",
    "next_block",
    "revision",
    "lease_owner",
    "lease_expires_at",
    "updated_at",
  ],
  settlement_indexer_checkpoints: [
    "chain_id",
    "block_number",
    "block_hash",
    "created_at",
  ],
  quote_submit_reservations: ["quote_id", "owner_token", "acquired_at", "expires_at"],
  _migrations: ["version", "name", "applied_at"],
};

for (const [tableName, columns] of Object.entries(requiredTables)) {
  const table = tables.get(tableName);
  assert.ok(table, `docs/database/schema.sql must define ${tableName}`);

  for (const column of columns) {
    assert.ok(table.columns.has(column), `${tableName} must define ${column}`);
  }
}

assert.ok(
  /UNIQUE\s*\(\s*chain_id\s*,\s*tx_hash\s*,\s*log_index\s*\)/i.test(tables.get("settlement_events").body),
  "settlement_events must keep the chain_id, tx_hash, log_index idempotency key",
);
assert.ok(
  /\bquote_id\s+TEXT\s+NOT\s+NULL\s+REFERENCES\s+quotes\s*\(\s*id\s*\)/i.test(tables.get("settlement_events").body),
  "settlement_events.quote_id must be a required quotes(id) foreign key",
);
assert.ok(
  /CREATE\s+UNIQUE\s+INDEX\s+uq_settlement_events_canonical_quote_id\s+ON\s+settlement_events\s*\(\s*quote_id\s*\)\s*WHERE\s+canonical\s*=\s*TRUE\s*;/i.test(schemaSource),
  "settlement_events must keep one canonical settlement event per quote",
);
assert.ok(
  /CREATE\s+UNIQUE\s+INDEX\s+uq_quotes_chain_user_nonce\s+ON\s+quotes\s*\(\s*chain_id\s*,\s*user_address\s*,\s*nonce\s*\)\s*WHERE\s+nonce\s+IS\s+NOT\s+NULL\s*;/i.test(schemaSource),
  "quotes must keep the chain_id, user_address, nonce signed-quote lookup key",
);
assert.ok(
  /\bsettlement_event_id\s+TEXT\s+NOT\s+NULL\s+REFERENCES\s+settlement_events\s*\(\s*id\s*\)/i.test(tables.get("hedge_orders").body),
  "hedge_orders.settlement_event_id must be a required settlement_events(id) foreign key",
);
assert.ok(
  /\bquote_id\s+TEXT\s+NOT\s+NULL\s+REFERENCES\s+quotes\s*\(\s*id\s*\)/i.test(tables.get("hedge_orders").body),
  "hedge_orders.quote_id must be a required quotes(id) foreign key",
);
assert.ok(
  /CREATE\s+UNIQUE\s+INDEX\s+uq_hedge_orders_settlement_event\s+ON\s+hedge_orders\s*\(\s*settlement_event_id\s*\)\s*;/i.test(schemaSource),
  "hedge_orders must keep one hedge intent per settlement event",
);
assert.ok(
  /UNIQUE\s*\(\s*quote_id\s*,\s*model\s*\)/i.test(tables.get("pnl_records").body),
  "pnl_records must keep one attribution record per quote and model",
);
assert.ok(
  /\bsettlement_event_id\s+TEXT\s+NOT\s+NULL\s+REFERENCES\s+settlement_events\s*\(\s*id\s*\)/i.test(
    tables.get("pnl_records").body,
  ),
  "pnl_records.settlement_event_id must reference the realized settlement event",
);
assert.ok(
  /\bsnapshot_id\s+TEXT\s+NOT\s+NULL\s+REFERENCES\s+market_snapshots\s*\(\s*id\s*\)/i.test(
    tables.get("pnl_records").body,
  ),
  "pnl_records.snapshot_id must reference the quote-time valuation snapshot",
);
assert.ok(
  hasAlterTableForeignKey("quotes", "fk_quotes_snapshot_id", "snapshot_id", "market_snapshots", "id"),
  "quotes.snapshot_id must reference market_snapshots(id)",
);
assert.ok(
  /\bsnapshot_id\s+TEXT\s+NOT\s+NULL\b/i.test(tables.get("quotes").body),
  "quotes.snapshot_id must be required for quote replay",
);
assert.ok(
  hasAlterTableForeignKey("quotes", "fk_quotes_settlement_event_id", "settlement_event_id", "settlement_events", "id"),
  "quotes.settlement_event_id must reference settlement_events(id)",
);
assert.ok(
  hasAlterTableForeignKey("quotes", "fk_quotes_hedge_order_id", "hedge_order_id", "hedge_orders", "id"),
  "quotes.hedge_order_id must reference hedge_orders(id)",
);
assert.ok(
  hasAlterTableForeignKey("quotes", "fk_quotes_pnl_id", "pnl_id", "pnl_records", "id"),
  "quotes.pnl_id must reference pnl_records(id)",
);

const requiredCheckConstraints = {
  quotes: [
    ["chk_quotes_id_safe", "quotes must constrain primary ids to safe identifiers"],
    ["chk_quotes_status", "quotes must constrain lifecycle status values"],
    ["chk_quotes_chain_id_safe", "quotes must constrain chain_id to JavaScript safe integer range"],
    ["chk_quotes_slippage_bps", "quotes must constrain requested slippage_bps to bps range"],
    ["chk_quotes_pricing_bps", "quotes must constrain signed pricing bps ranges"],
    ["chk_quotes_amounts_non_negative", "quotes must constrain unsigned quote amount fields"],
    ["chk_quotes_addresses_hex", "quotes must constrain address-shaped fields"],
    ["chk_quotes_distinct_tokens", "quotes must constrain token_in and token_out to distinct addresses"],
    ["chk_quotes_metadata_non_empty", "quotes must constrain nullable text metadata to be non-empty when present"],
    ["chk_quotes_signature_and_tx_hash_hex", "quotes must constrain signature and transaction hash shape"],
    ["chk_quotes_status_payload_consistency", "quotes must constrain lifecycle status pointer consistency"],
    ["chk_quotes_signed_payload_atomic", "quotes must constrain signed payload fields to be all present or all absent"],
    ["chk_quotes_unfilled_payload_consistency", "quotes must prevent requested and rejected quotes from carrying signed payload fields"],
    ["chk_quotes_signed_payload_consistency", "quotes must constrain signed lifecycle payload completeness"],
    ["chk_quotes_rejection_payload_consistency", "quotes must constrain rejection payload completeness"],
  ],
  market_snapshots: [
    ["chk_market_snapshots_id_safe", "market_snapshots must constrain primary ids to safe identifiers"],
    ["chk_market_snapshots_prices", "market_snapshots must constrain price and liquidity fields"],
    ["chk_market_snapshots_source_non_empty", "market_snapshots must constrain source to be non-empty"],
    ["chk_market_snapshots_chain_id_safe", "market_snapshots must constrain chain_id to JavaScript safe integer range"],
    ["chk_market_snapshots_addresses_hex", "market_snapshots must constrain token address shape"],
    ["chk_market_snapshots_distinct_tokens", "market_snapshots must constrain token pair addresses to be distinct"],
  ],
  risk_decisions: [
    ["chk_risk_decisions_id_safe", "risk_decisions must constrain primary ids to safe identifiers"],
    ["chk_risk_decisions_status", "risk_decisions must constrain decision status values"],
    ["chk_risk_decisions_limits", "risk_decisions must constrain non-negative numeric limits"],
  ],
  settlement_events: [
    ["chk_settlement_events_id_safe", "settlement_events must constrain primary ids to safe identifiers"],
    ["chk_settlement_events_chain_id_safe", "settlement_events must constrain chain_id to JavaScript safe integer range"],
    ["chk_settlement_events_hashes", "settlement_events must constrain hash-shaped fields"],
    ["chk_settlement_events_addresses_hex", "settlement_events must constrain address-shaped fields"],
    ["chk_settlement_events_distinct_tokens", "settlement_events must constrain token pair addresses to be distinct"],
    ["chk_settlement_events_amounts_positive", "settlement_events must constrain positive settlement fields"],
    ["chk_settlement_events_canonical_state", "settlement_events must constrain canonical reorg state"],
  ],
  inventory_positions: [
    ["chk_inventory_positions_id_safe", "inventory_positions must constrain primary ids to safe identifiers"],
    ["chk_inventory_positions_chain_id_safe", "inventory_positions must constrain chain_id to JavaScript safe integer range"],
    ["chk_inventory_positions_token_hex", "inventory_positions must constrain token address shape"],
    ["chk_inventory_positions_limits", "inventory_positions must constrain inventory limit fields"],
  ],
  hedge_orders: [
    ["chk_hedge_orders_id_safe", "hedge_orders must constrain primary ids to safe identifiers"],
    ["chk_hedge_orders_chain_id_safe", "hedge_orders must constrain chain_id to JavaScript safe integer range"],
    ["chk_hedge_orders_side", "hedge_orders must constrain side enum values"],
    ["chk_hedge_orders_status", "hedge_orders must constrain status enum values"],
    ["chk_hedge_orders_reason", "hedge_orders must constrain reason enum values"],
    ["chk_hedge_orders_venue_non_empty", "hedge_orders must constrain venue to be non-empty"],
    [
      "chk_hedge_orders_external_order_id_non_empty",
      "hedge_orders must constrain nullable external order ids to be non-empty when present",
    ],
    ["chk_hedge_orders_token_hex", "hedge_orders must constrain token address shape"],
    ["chk_hedge_orders_amount_positive", "hedge_orders must constrain positive hedge amounts"],
    ["chk_hedge_orders_attempt_count", "hedge_orders must constrain worker attempt counts"],
    ["chk_hedge_orders_lease_state", "hedge_orders must constrain queue lease state"],
    ["chk_hedge_orders_venue_symbol", "hedge_orders must constrain venue symbols"],
    ["chk_hedge_orders_client_order_id", "hedge_orders must constrain client order ids"],
    ["chk_hedge_orders_submission_attempt", "hedge_orders must constrain external submission evidence"],
    ["chk_hedge_orders_last_error_code", "hedge_orders must constrain worker error codes"],
    ["chk_hedge_orders_filled_amount", "hedge_orders must constrain terminal filled amounts"],
    ["chk_hedge_orders_terminal_state", "hedge_orders must clear terminal leases and require fill evidence"],
  ],
  pnl_records: [
    ["chk_pnl_records_id_safe", "pnl_records must constrain primary ids to safe identifiers"],
    ["chk_pnl_records_model", "pnl_records must constrain supported attribution models"],
    ["chk_pnl_records_model_description", "pnl_records must constrain supported attribution model descriptions"],
    ["chk_pnl_records_chain_id_safe", "pnl_records must constrain chain_id to JavaScript safe integer range"],
    ["chk_pnl_records_addresses_hex", "pnl_records must constrain token address shape"],
    ["chk_pnl_records_distinct_tokens", "pnl_records must constrain token pair addresses to be distinct"],
    ["chk_pnl_records_reference_ids_safe", "pnl_records must constrain settlement and snapshot identifiers"],
    ["chk_pnl_records_amounts_positive", "pnl_records must constrain positive trade amounts"],
    ["chk_pnl_records_valuation", "pnl_records must constrain quote-snapshot valuation inputs"],
    ["chk_pnl_records_gross_pnl_bps_safe", "pnl_records must constrain gross PnL bps to JavaScript safe integer range"],
  ],
  analytics_outbox: [
    ["chk_analytics_outbox_topic", "analytics outbox must constrain Kafka topics"],
    ["chk_analytics_outbox_event_key", "analytics outbox must constrain partition keys"],
    ["chk_analytics_outbox_event_type", "analytics outbox must constrain event types"],
    ["chk_analytics_outbox_schema_version", "analytics outbox must constrain schema versions"],
    ["chk_analytics_outbox_aggregate", "analytics outbox must constrain aggregate identity"],
    ["chk_analytics_outbox_payload", "analytics outbox must require JSON object payloads"],
    ["chk_analytics_outbox_attempt_count", "analytics outbox must constrain attempt counts"],
    ["chk_analytics_outbox_lease_state", "analytics outbox must constrain leases"],
    ["chk_analytics_outbox_published_state", "analytics outbox must clear published leases"],
    ["chk_analytics_outbox_last_error", "analytics outbox must constrain stable errors"],
  ],
  post_trade_reconciliation_jobs: [
    ["chk_post_trade_jobs_quote_id_safe", "post-trade jobs must constrain quote identifiers"],
    ["chk_post_trade_jobs_revisions", "post-trade jobs must constrain desired and processed revisions"],
    ["chk_post_trade_jobs_attempt_count", "post-trade jobs must constrain worker attempts"],
    ["chk_post_trade_jobs_lease_state", "post-trade jobs must constrain lease ownership"],
    ["chk_post_trade_jobs_last_error", "post-trade jobs must constrain stable errors"],
  ],
  settlement_indexer_cursors: [
    ["chk_settlement_indexer_cursor_chain", "settlement indexer cursors must constrain chain ids"],
    ["chk_settlement_indexer_cursor_address", "settlement indexer cursors must constrain contract addresses"],
    ["chk_settlement_indexer_cursor_blocks", "settlement indexer cursors must constrain block progress"],
    ["chk_settlement_indexer_cursor_lease", "settlement indexer cursors must constrain lease ownership"],
  ],
  settlement_indexer_checkpoints: [
    ["chk_settlement_indexer_checkpoint_block", "settlement indexer checkpoints must constrain block numbers"],
    ["chk_settlement_indexer_checkpoint_hash", "settlement indexer checkpoints must constrain block hashes"],
  ],
  quote_submit_reservations: [
    ["chk_quote_submit_reservations_owner", "submit reservations must constrain owner tokens"],
    ["chk_quote_submit_reservations_expiry", "submit reservations must constrain lease expiry"],
  ],
};

for (const [tableName, constraints] of Object.entries(requiredCheckConstraints)) {
  const table = tables.get(tableName);
  for (const [constraintName, message] of constraints) {
    assert.ok(
      new RegExp(`CONSTRAINT\\s+${constraintName}\\s+CHECK\\s*\\(`, "i").test(table.body),
      message,
    );
  }
}

for (const tableName of [
  "quotes",
  "market_snapshots",
  "risk_decisions",
  "settlement_events",
  "inventory_positions",
  "hedge_orders",
  "pnl_records",
]) {
  assertSafeIdentifierPrimaryKey(tableName);
}

for (const tableName of [
  "quotes",
  "market_snapshots",
  "settlement_events",
  "inventory_positions",
  "hedge_orders",
  "pnl_records",
]) {
  assert.ok(
    hasCheckExpression(tableName, `chain_id\\s+BETWEEN\\s+1\\s+AND\\s+${maxSafeInteger}`),
    `${tableName}.chain_id must be constrained to the JavaScript safe integer range`,
  );
}

for (const tableName of ["quotes", "market_snapshots", "settlement_events", "pnl_records"]) {
  assert.ok(
    hasCheckExpression(tableName, "lower\\s*\\(\\s*token_in\\s*\\)\\s*<>\\s*lower\\s*\\(\\s*token_out\\s*\\)"),
    `${tableName} must require distinct token_in and token_out addresses`,
  );
}

assert.ok(
  /status\s+IN\s*\(\s*'requested'\s*,\s*'rejected'\s*,\s*'signed'\s*,\s*'expired'\s*,\s*'submitted'\s*,\s*'settled'\s*,\s*'failed'\s*\)/i.test(
    tables.get("quotes").body,
  ),
  "quotes status constraint must match backend QuoteLifecycleStatus values",
);
assert.ok(
  /\bdeadline\s+BIGINT\b/i.test(tables.get("quotes").body),
  "quotes.deadline must be stored as signed quote Unix seconds",
);
assert.ok(
  /\bslippage_bps\s+INTEGER\s+NOT\s+NULL\b/i.test(tables.get("quotes").body),
  "quotes.slippage_bps must persist QuoteRequest.slippageBps for quote replay",
);
assert.ok(
  /slippage_bps\s+BETWEEN\s+0\s+AND\s+10000/i.test(tables.get("quotes").body),
  "quotes must constrain slippage_bps to the 0..10000 bps range",
);
assert.ok(
  /export\s+interface\s+SaveSignedQuoteInput\s*\{[\s\S]*?slippageBps:\s*number;/i.test(quoteRepositorySource),
  "SaveSignedQuoteInput must carry slippageBps so signed quote persistence can populate quotes.slippage_bps",
);
assert.ok(
  /assertNonNegativeBps\s*\(\s*input\.slippageBps\s*,\s*"slippageBps"\s*,\s*"Signed quote"\s*\)/i.test(
    quoteRepositorySource,
  ),
  "signed quote persistence must validate slippageBps before writing quote state",
);
assert.ok(
  /record\.slippageBps\s*===\s*input\.slippageBps/i.test(quoteRepositorySource),
  "signed quote persistence must reject slippageBps rewrites",
);
for (const columnName of ["spread_bps", "size_impact_bps", "inventory_skew_bps"]) {
  assert.ok(
    new RegExp(`\\b${columnName}\\s+INTEGER\\b`, "i").test(tables.get("quotes").body),
    `quotes.${columnName} must persist signed quote pricing bps components`,
  );
}
assert.ok(
  /spread_bps\s+IS\s+NULL\s+OR\s+spread_bps\s+BETWEEN\s+0\s+AND\s+10000/i.test(tables.get("quotes").body),
  "quotes must constrain spread_bps to the 0..10000 bps range when present",
);
assert.ok(
  /size_impact_bps\s+IS\s+NULL\s+OR\s+size_impact_bps\s+BETWEEN\s+0\s+AND\s+10000/i.test(
    tables.get("quotes").body,
  ),
  "quotes must constrain size_impact_bps to the 0..10000 bps range when present",
);
assert.ok(
  /inventory_skew_bps\s+IS\s+NULL\s+OR\s+inventory_skew_bps\s+BETWEEN\s+-10000\s+AND\s+10000/i.test(
    tables.get("quotes").body,
  ),
  "quotes must constrain inventory_skew_bps to the signed -10000..10000 bps range when present",
);
assert.ok(
  /export\s+interface\s+SaveSignedQuoteInput\s*\{[\s\S]*?spreadBps:\s*number;[\s\S]*?sizeImpactBps:\s*number;[\s\S]*?inventorySkewBps:\s*number;/i.test(
    quoteRepositorySource,
  ),
  "SaveSignedQuoteInput must carry pricing bps components for quote replay",
);
assert.ok(
  /assertNonNegativeBps\s*\(\s*input\.spreadBps\s*,\s*"spreadBps"\s*,\s*"Signed quote"\s*\)/i.test(
    quoteRepositorySource,
  ),
  "signed quote persistence must validate spreadBps before writing quote state",
);
assert.ok(
  /assertNonNegativeBps\s*\(\s*input\.sizeImpactBps\s*,\s*"sizeImpactBps"\s*,\s*"Signed quote"\s*\)/i.test(
    quoteRepositorySource,
  ),
  "signed quote persistence must validate sizeImpactBps before writing quote state",
);
assert.ok(
  /assertBpsMagnitude\s*\(\s*input\.inventorySkewBps\s*,\s*"inventorySkewBps"\s*,\s*"Signed quote"\s*\)/i.test(
    quoteRepositorySource,
  ),
  "signed quote persistence must validate inventorySkewBps before writing quote state",
);
assert.ok(
  /record\.spreadBps\s*===\s*input\.spreadBps[\s\S]*?record\.sizeImpactBps\s*===\s*input\.sizeImpactBps[\s\S]*?record\.inventorySkewBps\s*===\s*input\.inventorySkewBps/i.test(
    quoteRepositorySource,
  ),
  "signed quote persistence must reject pricing bps rewrites",
);
for (const columnName of ["spread_bps", "size_impact_bps", "inventory_skew_bps"]) {
  assert.ok(
    new RegExp(`${columnName}\\s+IS\\s+NULL[\\s\\S]*?${columnName}\\s+IS\\s+NOT\\s+NULL`, "i").test(
      tables.get("quotes").body,
    ),
    `quotes signed payload constraints must require ${columnName} to be atomic with signed quote state`,
  );
}
assert.ok(
  /signature\s+~\s+'\^0x\[0-9a-fA-F\]\{130\}\$'/i.test(tables.get("quotes").body),
  "quotes signature constraint must require 65-byte EIP-712 signatures",
);
assert.ok(
  new RegExp(
    `lower\\s*\\(\\s*substring\\s*\\(\\s*signature\\s+from\\s+67\\s+for\\s+64\\s*\\)\\s*\\)\\s*<=\\s*'${secp256k1HalfOrder}'`,
    "i",
  ).test(tables.get("quotes").body),
  "quotes signature constraint must require canonical low-s EIP-712 signatures",
);
assert.ok(
  /lower\s*\(\s*substring\s*\(\s*signature\s+from\s+131\s+for\s+2\s*\)\s*\)\s+IN\s*\(\s*'1b'\s*,\s*'1c'\s*\)/i.test(
    tables.get("quotes").body,
  ),
  "quotes signature constraint must require EIP-712 recovery id 27 or 28",
);
assert.ok(
  /tx_hash\s+IS\s+NULL\s+OR\s+tx_hash\s+~\s+'\^0x\[0-9a-fA-F\]\{64\}\$'/i.test(tables.get("quotes").body),
  "quotes tx_hash constraint must require 32-byte transaction hashes",
);
assert.ok(
  /amount_in\s*>\s*0[\s\S]*?amount_out\s+IS\s+NULL\s+OR\s+amount_out\s*>\s*0[\s\S]*?min_amount_out\s+IS\s+NULL\s+OR\s+min_amount_out\s*>\s*0[\s\S]*?nonce\s+IS\s+NULL\s+OR\s+nonce\s*>\s*0[\s\S]*?deadline\s+IS\s+NULL\s+OR\s+deadline\s+BETWEEN\s+1\s+AND\s+9007199254740991/i.test(
    tables.get("quotes").body,
  ),
  "quotes must require positive signed amount and nonce fields plus safe-integer deadlines when present",
);
assert.ok(
  /amount_out\s+IS\s+NULL\s+OR\s+min_amount_out\s+IS\s+NULL\s+OR\s+amount_out\s*>=\s*min_amount_out/i.test(
    tables.get("quotes").body,
  ),
  "quotes must require amount_out to satisfy min_amount_out when both are present",
);
assert.ok(
  /status\s+IN\s*\(\s*'submitted'\s*,\s*'settled'\s*\)[\s\S]*?tx_hash\s+IS\s+NOT\s+NULL[\s\S]*?settlement_event_id\s+IS\s+NOT\s+NULL/i.test(
    tables.get("quotes").body,
  ),
  "submitted and settled quotes must keep tx_hash and settlement_event_id pointers",
);
assert.ok(
  /status\s+IN\s*\(\s*'requested'\s*,\s*'rejected'\s*,\s*'signed'\s*,\s*'expired'\s*,\s*'failed'\s*\)[\s\S]*?tx_hash\s+IS\s+NULL[\s\S]*?settlement_event_id\s+IS\s+NULL[\s\S]*?hedge_order_id\s+IS\s+NULL[\s\S]*?pnl_id\s+IS\s+NULL/i.test(
    tables.get("quotes").body,
  ),
  "non-settlement quote statuses must not expose settlement, hedge, or PnL pointers",
);
assert.ok(
  /amount_out\s+IS\s+NULL[\s\S]*?min_amount_out\s+IS\s+NULL[\s\S]*?nonce\s+IS\s+NULL[\s\S]*?deadline\s+IS\s+NULL[\s\S]*?pricing_version\s+IS\s+NULL[\s\S]*?signature\s+IS\s+NULL[\s\S]*?amount_out\s+IS\s+NOT\s+NULL[\s\S]*?min_amount_out\s+IS\s+NOT\s+NULL[\s\S]*?nonce\s+IS\s+NOT\s+NULL[\s\S]*?deadline\s+IS\s+NOT\s+NULL[\s\S]*?pricing_version\s+IS\s+NOT\s+NULL[\s\S]*?signature\s+IS\s+NOT\s+NULL/i.test(
    tables.get("quotes").body,
  ),
  "quote signed payload fields must be all present or all absent",
);
assert.ok(
  /status\s+NOT\s+IN\s*\(\s*'requested'\s*,\s*'rejected'\s*\)[\s\S]*?amount_out\s+IS\s+NULL[\s\S]*?min_amount_out\s+IS\s+NULL[\s\S]*?nonce\s+IS\s+NULL[\s\S]*?deadline\s+IS\s+NULL[\s\S]*?pricing_version\s+IS\s+NULL[\s\S]*?signature\s+IS\s+NULL/i.test(
    tables.get("quotes").body,
  ),
  "requested and rejected quotes must not carry signed payload fields",
);
assert.ok(
  /status\s+NOT\s+IN\s*\(\s*'signed'\s*,\s*'expired'\s*,\s*'submitted'\s*,\s*'settled'\s*\)[\s\S]*?amount_out\s+IS\s+NOT\s+NULL[\s\S]*?min_amount_out\s+IS\s+NOT\s+NULL[\s\S]*?nonce\s+IS\s+NOT\s+NULL[\s\S]*?deadline\s+IS\s+NOT\s+NULL[\s\S]*?pricing_version\s+IS\s+NOT\s+NULL[\s\S]*?risk_policy_version\s+IS\s+NOT\s+NULL[\s\S]*?signature\s+IS\s+NOT\s+NULL/i.test(
    tables.get("quotes").body,
  ),
  "signed lifecycle statuses must keep complete signed quote payload metadata",
);
assert.ok(
  /status\s+IN\s*\(\s*'rejected'\s*,\s*'failed'\s*\)[\s\S]*?reject_code\s+IS\s+NOT\s+NULL[\s\S]*?status\s+NOT\s+IN\s*\(\s*'rejected'\s*,\s*'failed'\s*\)[\s\S]*?reject_code\s+IS\s+NULL/i.test(
    tables.get("quotes").body,
  ),
  "only rejected and failed quote statuses may keep reject_code",
);
for (const field of ["pricing_version", "risk_policy_version", "reject_code"]) {
  assert.ok(
    new RegExp(`${field}\\s+IS\\s+NULL\\s+OR\\s+btrim\\s*\\(\\s*${field}\\s*\\)\\s*<>\\s*''`, "i").test(
      tables.get("quotes").body,
    ),
    `quotes.${field} must reject empty values when present`,
  );
}
assert.ok(
  /decision\s+IN\s*\(\s*'approved'\s*,\s*'rejected'\s*\)/i.test(tables.get("risk_decisions").body),
  "risk decision status constraint must match backend RiskDecisionStatus values",
);
assert.ok(
  /btrim\s*\(\s*policy_version\s*\)\s*<>\s*''/i.test(tables.get("risk_decisions").body),
  "risk decision policy_version must be non-empty",
);
assert.ok(
  /decision\s*=\s*'approved'[\s\S]*?reason_code\s+IS\s+NULL[\s\S]*?decision\s*=\s*'rejected'[\s\S]*?reason_code\s+IS\s+NOT\s+NULL[\s\S]*?btrim\s*\(\s*reason_code\s*\)\s*<>\s*''/i.test(
    tables.get("risk_decisions").body,
  ),
  "risk decision reason_code must be present only for rejected decisions",
);
assert.deepEqual(
  extractColumnInValues(tables.get("risk_decisions").body, "reason_code"),
  extractStringUnionValues(riskEngineSource, "RiskRejectReasonCode"),
  "risk_decisions.reason_code constraint must match backend RiskRejectReasonCode values",
);
assert.ok(
  /\blog_index\s+BIGINT\s+NOT\s+NULL/i.test(tables.get("settlement_events").body),
  "settlement_events.log_index must be stored as a JavaScript safe-integer sized ordinal",
);
assert.ok(
  /amount_in\s*>\s*0[\s\S]*?amount_out\s*>\s*0[\s\S]*?nonce\s*>\s*0[\s\S]*?log_index\s+BETWEEN\s+0\s+AND\s+9007199254740991[\s\S]*?block_number\s+BETWEEN\s+0\s+AND\s+9007199254740991/i.test(
    tables.get("settlement_events").body,
  ),
  "settlement_events must require positive settled amount and nonce fields plus safe-integer event ordinals",
);
assert.ok(
  /bid_price\s+IS\s+NULL\s+OR\s+bid_price\s*<=\s*mid_price[\s\S]*?ask_price\s+IS\s+NULL\s+OR\s+mid_price\s*<=\s*ask_price[\s\S]*?bid_price\s+IS\s+NULL\s+OR\s+ask_price\s+IS\s+NULL\s+OR\s+bid_price\s*<=\s*ask_price/i.test(
    tables.get("market_snapshots").body,
  ),
  "market_snapshots must keep bid_price <= mid_price <= ask_price when bid or ask are present",
);
assert.ok(
  /\bliquidity_usd\s+NUMERIC\s*\(\s*78\s*,\s*0\s*\)\s+NOT\s+NULL/i.test(tables.get("market_snapshots").body),
  "market_snapshots.liquidity_usd must be stored as a required positive uint-sized value",
);
assert.ok(
  /\bliquidity_usd\s*>\s*0\b/i.test(tables.get("market_snapshots").body),
  "market_snapshots must require positive liquidity_usd",
);
assert.ok(
  /\bvolatility_bps\s+INTEGER\s+NOT\s+NULL/i.test(tables.get("market_snapshots").body),
  "market_snapshots.volatility_bps must be required because MarketSnapshot.volatilityBps is required",
);
assert.ok(
  /volatility_bps\s+BETWEEN\s+0\s+AND\s+10000/i.test(tables.get("market_snapshots").body),
  "market_snapshots must constrain volatility_bps to the 0..10000 bps range",
);
assert.ok(
  /btrim\s*\(\s*source\s*\)\s*<>\s*''/i.test(tables.get("market_snapshots").body),
  "market_snapshots must reject empty source values",
);
assert.ok(
  /side\s+IN\s*\(\s*'buy'\s*,\s*'sell'\s*\)/i.test(tables.get("hedge_orders").body),
  "hedge side constraint must match backend HedgeIntent side values",
);
assert.ok(
  arraysEqual(
    extractColumnInValues(tables.get("hedge_orders").body, "status"),
    extractInterfacePropertyEnumValues(backendTypesSource, "HedgeIntentStatusResponse", "status"),
  ),
  "hedge status constraint must match backend HedgeIntentStatusResponse status values",
);
assert.ok(
  /reason\s+IN\s*\(\s*'inventory_rebalance'\s*,\s*'risk_reduction'\s*\)/i.test(tables.get("hedge_orders").body),
  "hedge reason constraint must match backend HedgeIntent reason values",
);
assert.ok(
  /btrim\s*\(\s*venue\s*\)\s*<>\s*''/i.test(tables.get("hedge_orders").body),
  "hedge_orders must reject empty venue values",
);
assert.ok(
  /external_order_id\s+IS\s+NULL\s+OR\s+btrim\s*\(\s*external_order_id\s*\)\s*<>\s*''/i.test(
    tables.get("hedge_orders").body,
  ),
  "hedge_orders must reject empty external_order_id values when present",
);
assert.ok(
  /model\s+IN\s*\(\s*'quote_snapshot_edge_v1'\s*\)/i.test(tables.get("pnl_records").body),
  "pnl model constraint must match backend PnlTradeRecord model values",
);
assert.ok(
  /model_description\s*=\s*'Gross settlement PnL in tokenOut base units versus the persisted quote-time mid price, excluding fees, gas, and hedge execution'/i.test(
    tables.get("pnl_records").body,
  ),
  "pnl model_description constraint must match backend PnlTradeRecord modelDescription value",
);
assert.ok(
  /deadline\s+BETWEEN\s+1\s+AND\s+9007199254740991/i.test(tables.get("pnl_records").body),
  "pnl_records must require safe-integer signed attribution deadlines",
);
assert.ok(
  /\bgross_pnl_bps\s+BIGINT\s+NOT\s+NULL/i.test(tables.get("pnl_records").body),
  "pnl_records.gross_pnl_bps must be stored as a JavaScript safe-integer sized signed bps value",
);
assert.ok(
  /gross_pnl_bps\s+BETWEEN\s+-9007199254740991\s+AND\s+9007199254740991/i.test(
    tables.get("pnl_records").body,
  ),
  "pnl_records must constrain gross PnL bps to JavaScript safe integer range",
);

for (const indexName of [
  "idx_quotes_user_created_at",
  "idx_quotes_status_created_at",
  "uq_quotes_chain_user_nonce",
  "idx_quotes_snapshot_id",
  "idx_quotes_settlement_event_id",
  "idx_quotes_hedge_order_id",
  "idx_quotes_pnl_id",
  "idx_market_snapshots_pair_observed_at",
  "idx_risk_decisions_quote_id",
  "uq_settlement_events_canonical_quote_id",
  "idx_settlement_events_chain_quote_hash",
  "idx_settlement_events_canonical_block",
  "uq_hedge_orders_settlement_event",
  "idx_hedge_orders_queued_claim",
  "uq_hedge_orders_venue_client_order",
  "idx_pnl_records_realized_at",
  "idx_pnl_records_chain_pair_realized_at",
  "uq_pnl_records_settlement_model",
  "idx_pnl_records_snapshot_id",
  "idx_post_trade_jobs_pending",
]) {
  assert.ok(
    new RegExp(`CREATE\\s+(?:UNIQUE\\s+)?INDEX\\s+${indexName}\\b`, "i").test(schemaSource),
    `docs/database/schema.sql must define ${indexName}`,
  );
}

assert.ok(
  /CREATE\s+INDEX\s+idx_market_snapshots_pair_observed_at\s+ON\s+market_snapshots\s*\(\s*chain_id\s*,\s*token_in\s*,\s*token_out\s*,\s*observed_at\s+DESC\s*\)\s*;/i.test(
    schemaSource,
  ),
  "market_snapshots must support latest snapshot lookup by chain and token pair",
);
assert.ok(
  /CREATE\s+INDEX\s+idx_settlement_events_chain_quote_hash\s+ON\s+settlement_events\s*\(\s*chain_id\s*,\s*quote_hash\s*\)\s*;/i.test(
    schemaSource,
  ),
  "settlement_events must support chain-scoped quote_hash lookups from indexed QuoteSettled logs",
);
assert.ok(
  settlementEventServiceSource.includes("eventIdsByChainQuoteHash"),
  "SettlementEventService must keep a runtime mirror of the chain-scoped settlement quote_hash index",
);
assert.ok(
  settlementEventServiceSource.includes("getSettlementEventsByQuoteHash"),
  "SettlementEventService must expose chain-scoped settlement quote_hash lookup",
);
assert.ok(
  erDiagramSource.includes("SettlementEventService.getSettlementEventsByQuoteHash"),
  "ER diagram must document the runtime settlement quote_hash lookup path",
);
for (const [indexName, columnName] of [
  ["idx_quotes_snapshot_id", "snapshot_id"],
  ["idx_quotes_settlement_event_id", "settlement_event_id"],
  ["idx_quotes_hedge_order_id", "hedge_order_id"],
  ["idx_quotes_pnl_id", "pnl_id"],
]) {
  assert.ok(
    hasPartialIndex("quotes", indexName, columnName),
    `quotes.${columnName} must use a partial index for non-null status pointer joins`,
  );
}

assert.ok(
  /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+set_updated_at\s*\(\s*\)\s+RETURNS\s+trigger/i.test(schemaSource),
  "docs/database/schema.sql must define the shared set_updated_at trigger function",
);
assert.ok(
  /NEW\.updated_at\s*=\s*now\s*\(\s*\)/i.test(schemaSource),
  "set_updated_at trigger function must refresh updated_at with database time",
);

for (const tableName of ["quotes", "inventory_positions", "hedge_orders"]) {
  assert.ok(
    hasBeforeUpdateTrigger(tableName, `trg_${tableName}_set_updated_at`, "set_updated_at"),
    `${tableName} must refresh updated_at through a BEFORE UPDATE trigger`,
  );
}

const pnlFields = extractInterfaceFields(backendTypesSource, "PnlTradeRecord");
const pnlSchemaProperties = extractOpenApiSchemaProperties(openapiSource, "PnlTradeRecord");
assert.deepEqual(
  pnlSchemaProperties,
  pnlFields,
  "OpenAPI PnlTradeRecord properties must match backend PnlTradeRecord fields",
);

const pnlColumnMapping = {
  pnlId: "id",
  quoteId: "quote_id",
  settlementEventId: "settlement_event_id",
  snapshotId: "snapshot_id",
  chainId: "chain_id",
  user: "user_address",
  tokenIn: "token_in",
  tokenOut: "token_out",
  amountIn: "amount_in",
  amountOut: "amount_out",
  minAmountOut: "min_amount_out",
  nonce: "nonce",
  deadline: "deadline",
  midPrice: "mid_price",
  tokenInDecimals: "token_in_decimals",
  tokenOutDecimals: "token_out_decimals",
  fairAmountOut: "fair_amount_out",
  valuationObservedAt: "valuation_observed_at",
  grossPnlTokenOut: "gross_pnl_token_out",
  grossPnlBps: "gross_pnl_bps",
  model: "model",
  modelDescription: "model_description",
  realizedAt: "realized_at",
};
for (const field of pnlFields) {
  assert.ok(pnlColumnMapping[field], `PnlTradeRecord.${field} must have a database column mapping`);
  assert.ok(
    tables.get("pnl_records").columns.has(pnlColumnMapping[field]),
    `pnl_records must persist PnlTradeRecord.${field} as ${pnlColumnMapping[field]}`,
  );
}

const quoteRequestFields = extractInterfaceFields(backendTypesSource, "QuoteRequest");
const quoteRequestColumnMapping = {
  chainId: "chain_id",
  user: "user_address",
  tokenIn: "token_in",
  tokenOut: "token_out",
  amountIn: "amount_in",
  slippageBps: "slippage_bps",
};
for (const field of quoteRequestFields) {
  assert.ok(quoteRequestColumnMapping[field], `QuoteRequest.${field} must have a database column mapping`);
  assert.ok(
    tables.get("quotes").columns.has(quoteRequestColumnMapping[field]),
    `quotes must persist QuoteRequest.${field} as ${quoteRequestColumnMapping[field]}`,
  );
}

const settlementFields = extractInterfaceFields(backendTypesSource, "SettlementEventStatusResponse");
const settlementSchemaProperties = extractOpenApiSchemaProperties(openapiSource, "SettlementEventStatus");
assert.deepEqual(
  settlementSchemaProperties,
  settlementFields,
  "OpenAPI SettlementEventStatus properties must match backend SettlementEventStatusResponse fields",
);

const settlementColumnMapping = {
  settlementEventId: "id",
  quoteId: "quote_id",
  chainId: "chain_id",
  txHash: "tx_hash",
  quoteHash: "quote_hash",
  blockNumber: "block_number",
  logIndex: "log_index",
  user: "user_address",
  tokenIn: "token_in",
  tokenOut: "token_out",
  amountIn: "amount_in",
  amountOut: "amount_out",
  nonce: "nonce",
  observedAt: "created_at",
};
for (const field of settlementFields) {
  if (field === "status") {
    continue;
  }
  assert.ok(
    settlementColumnMapping[field],
    `SettlementEventStatusResponse.${field} must have a database column mapping`,
  );
  assert.ok(
    tables.get("settlement_events").columns.has(settlementColumnMapping[field]),
    `settlement_events must persist SettlementEventStatusResponse.${field} as ${settlementColumnMapping[field]}`,
  );
}

const hedgeFields = extractInterfaceFields(backendTypesSource, "HedgeIntentStatusResponse");
const hedgeSchemaProperties = extractOpenApiSchemaProperties(openapiSource, "HedgeIntentStatus");
assert.deepEqual(
  hedgeSchemaProperties,
  hedgeFields,
  "OpenAPI HedgeIntentStatus properties must match backend HedgeIntentStatusResponse fields",
);

const hedgeColumnMapping = {
  hedgeOrderId: "id",
  status: "status",
  settlementEventId: "settlement_event_id",
  quoteId: "quote_id",
  chainId: "chain_id",
  token: "token_address",
  side: "side",
  amount: "amount",
  reason: "reason",
  createdAt: "created_at",
  externalOrderId: "external_order_id",
  filledAmount: "filled_amount",
  failureCode: "last_error_code",
  updatedAt: "updated_at",
};
for (const field of hedgeFields) {
  assert.ok(hedgeColumnMapping[field], `HedgeIntentStatusResponse.${field} must have a database column mapping`);
  assert.ok(
    tables.get("hedge_orders").columns.has(hedgeColumnMapping[field]),
    `hedge_orders must persist HedgeIntentStatusResponse.${field} as ${hedgeColumnMapping[field]}`,
  );
}

for (const erNode of [
  "QUOTES",
  "MARKET_SNAPSHOTS",
  "RISK_DECISIONS",
  "SETTLEMENT_EVENTS",
  "INVENTORY_POSITIONS",
  "HEDGE_ORDERS",
  "PNL_RECORDS",
  "ANALYTICS_OUTBOX",
  "POST_TRADE_RECONCILIATION_JOBS",
]) {
  assert.ok(new RegExp(`\\b${erNode}\\b`).test(erDiagramSource), `ER diagram must include ${erNode}`);
}

assert.ok(
  /QUOTES\s+\|\|--o\{\s+PNL_RECORDS\s+:\s+attributes/.test(erDiagramSource),
  "ER diagram must show quote-to-PnL attribution",
);
assert.ok(
  erDiagramSource.includes("settlement_events.quote_id"),
  "ER diagram notes must document required settlement-to-quote linkage",
);
assert.ok(
  erDiagramSource.includes("partial unique index `(quote_id) WHERE canonical = TRUE`"),
  "ER diagram notes must document one canonical settlement event per signed quote",
);
assert.ok(
  erDiagramSource.includes("quote_hash"),
  "ER diagram must document settlement event quote_hash persistence",
);
assert.ok(
  erDiagramSource.includes("nullable foreign keys"),
  "ER diagram notes must document quote status pointers as nullable foreign keys",
);
assert.ok(
  erDiagramSource.includes("状态指针不能悬空"),
  "ER diagram notes must document non-dangling quote status pointers",
);
assert.ok(
  erDiagramSource.includes("transactional outbox") && erDiagramSource.includes("at-least-once") &&
    erDiagramSource.includes("ReplacingMergeTree"),
  "ER diagram must document transactional outbox delivery and ClickHouse deduplication semantics",
);

assert.ok(
  /ADD\s+COLUMN\s+canonical\s+BOOLEAN\s+NOT\s+NULL\s+DEFAULT\s+TRUE/i.test(settlementMigrationSource) &&
    /ADD\s+COLUMN\s+removed_at\s+TIMESTAMPTZ/i.test(settlementMigrationSource) &&
    settlementMigrationSource.includes("chk_settlement_events_canonical_state") &&
    /WHERE\s+canonical\s*=\s*TRUE/i.test(settlementMigrationSource),
  "settlement migration must persist and index canonical reorg state",
);
assert.ok(
  postgresSettlementSource.includes('client.query("BEGIN")') &&
    postgresSettlementSource.includes('client.query("COMMIT")') &&
    postgresSettlementSource.includes('client.query("ROLLBACK")') &&
    postgresSettlementSource.includes("ON CONFLICT DO NOTHING") &&
    postgresSettlementSource.includes("FOR UPDATE") &&
    postgresSettlementSource.includes("SET canonical = FALSE, removed_at = now()"),
  "Postgres settlement store must use transactional idempotency and retain removed events",
);
assert.ok(
  postgresSettlementSource.includes("pg_advisory_xact_lock") &&
    postgresSettlementSource.includes("applySettlementWithClient") &&
    postgresSettlementSource.includes("rebuildFromCanonicalSettlementEvents"),
  "Postgres settlement store must coordinate inventory projection updates and startup repair",
);
assert.ok(
  postgresInventorySource.includes('client.query("BEGIN")') &&
    postgresInventorySource.includes('client.query("ROLLBACK")') &&
    postgresInventorySource.includes(".sort((left, right) => left.token.localeCompare(right.token))") &&
    postgresInventorySource.includes("rebuildFromCanonicalSettlementEvents") &&
    postgresInventorySource.includes("FROM hedge_orders AS hedge") &&
    postgresInventorySource.includes("hedge.filled_amount IS NOT NULL"),
  "Postgres inventory service must update deterministically and rebuild canonical settlement plus hedge fills",
);
assert.ok(
  postgresHedgeSource.includes("ON CONFLICT (settlement_event_id) DO UPDATE SET") &&
    postgresPnlSource.includes("ON CONFLICT (quote_id, model) DO NOTHING"),
  "hedge and PnL projections must be durable and idempotent",
);
assert.ok(
  backendMainSource.includes("new PostgresSettlementEventStore") &&
    backendMainSource.includes("new PostgresInventoryService") &&
    backendMainSource.includes("new PostgresHedgeService") &&
    backendMainSource.includes("new PostgresPnlStore") &&
    backendMainSource.includes("DATABASE_URL is required when NODE_ENV="),
  "non-local runtime must wire durable post-trade stores and require PostgreSQL",
);
assert.ok(
  hedgeWorkerMigrationSource.includes("attempt_count INTEGER NOT NULL DEFAULT 0") &&
    hedgeWorkerMigrationSource.includes("chk_hedge_orders_lease_state") &&
    hedgeWorkerMigrationSource.includes("idx_hedge_orders_queued_claim") &&
    hedgeWorkerMigrationSource.includes("uq_hedge_orders_venue_client_order"),
  "hedge worker migration must add durable lease queue state and idempotency indexes",
);
assert.ok(
  postgresHedgeJobSource.includes("FOR UPDATE SKIP LOCKED") &&
    postgresHedgeJobSource.includes("FOR UPDATE OF settlement") &&
    postgresHedgeJobSource.includes("lease_owner = $1") &&
    postgresHedgeJobSource.includes("status = 'queued' AND lease_owner = $2") &&
    postgresHedgeJobSource.includes("submission_attempted_at = COALESCE") &&
    postgresHedgeJobSource.includes("HEDGE_SETTLEMENT_NON_CANONICAL") &&
    postgresHedgeJobSource.includes("next_attempt_at = now()") &&
    postgresHedgeJobSource.includes("INSERT INTO inventory_positions") &&
    postgresHedgeJobSource.includes("filled_amount = COALESCE($5, filled_amount)") &&
    postgresHedgeJobSource.includes("recordExecutionProgress") &&
    postgresHedgeJobSource.includes("BigInt(filledAmount) - BigInt(previous"),
  "Postgres hedge job store must claim due rows, guard mutations by lease owner, and atomically apply fill deltas",
);
assert.ok(
  hedgeWorkerSource.includes("adapter.queryOrder") &&
    hedgeWorkerSource.includes("adapter.submitMarketOrder") &&
    hedgeWorkerSource.indexOf("adapter.queryOrder") < hedgeWorkerSource.indexOf("adapter.submitMarketOrder") &&
    hedgeWorkerSource.includes("HEDGE_ORDER_PENDING") &&
    hedgeWorkerSource.includes("HEDGE_SUBMISSION_UNCONFIRMED") &&
    hedgeWorkerSource.includes("recordExecutionProgress") &&
    hedgeWorkerSource.includes("retryBackoffMs") &&
    !hedgeWorkerSource.includes("maxAttempts"),
  "hedge worker must reconcile before submit, persist partial fills, back off, and keep unknown states retryable",
);
assert.ok(
  binanceAdapterSource.includes('createHmac("sha256"') &&
    binanceAdapterSource.includes('"/api/v3/order"') &&
    binanceAdapterSource.includes("origClientOrderId") &&
    binanceAdapterSource.includes("newClientOrderId"),
  "Binance adapter must use signed Spot order query and submission endpoints",
);
assert.ok(
  analyticsOutboxMigrationSource.includes("CREATE TABLE analytics_outbox") &&
    analyticsOutboxMigrationSource.includes("idx_analytics_outbox_pending") &&
    analyticsOutboxMigrationSource.includes("enqueue_rfq_analytics_event") &&
    analyticsOutboxMigrationSource.includes("source_row.amount_in::text") &&
    analyticsOutboxMigrationSource.includes("SECURITY DEFINER") &&
    analyticsOutboxMigrationSource.includes("SET search_path = pg_catalog, public") &&
    analyticsOutboxMigrationSource.includes("INSERT INTO public.analytics_outbox") &&
    analyticsOutboxMigrationSource.includes("trg_quotes_analytics_update") &&
    analyticsOutboxMigrationSource.includes("trg_pnl_records_analytics_delete") &&
    schemaSource.includes("('004', 'analytics-outbox')"),
  "analytics migration and fresh schema must atomically emit versioned precision-safe events",
);
assert.ok(
  analyticsOutboxStoreSource.includes("FOR UPDATE SKIP LOCKED") &&
    analyticsOutboxStoreSource.includes("published_at = now()") &&
    analyticsOutboxStoreSource.includes("lease_owner = $2") &&
    analyticsOutboxStoreSource.includes("published_at IS NOT NULL AND published_at < $1") &&
    analyticsPublisherSource.includes("retryBackoffMs") &&
    !analyticsPublisherSource.includes("maxAttempts"),
  "analytics outbox runtime must lease, retry without exhaustion, acknowledge, and retain published rows",
);
assert.ok(
  analyticsEventSource.includes("maxSerializedEventBytes") &&
    analyticsEventSource.includes("ao_${record.outboxId}") &&
    analyticsKafkaProducerSource.includes("idempotent: true") &&
    analyticsKafkaProducerSource.includes("maxInFlightRequests: 1") &&
    analyticsKafkaProducerSource.includes("acks: -1") &&
    analyticsKafkaConsumerSource.indexOf("await this.sink.insertBatch(rows.slice") <
      analyticsKafkaConsumerSource.indexOf("await this.consumer.commitOffsets") &&
    clickhouseAnalyticsSource.includes("ReplacingMergeTree(ingested_at)") &&
    clickhouseAnalyticsSource.includes("ORDER BY event_id"),
  "analytics delivery must use bounded envelopes, acknowledged Kafka writes, insert-before-offset commit, and event-id deduplication",
);
assert.ok(
  postTradeMigrationSource.includes("CREATE TABLE post_trade_reconciliation_jobs") &&
    postTradeMigrationSource.includes("uq_settlement_events_canonical_quote_id") &&
    postTradeMigrationSource.includes("enqueue_post_trade_reconciliation_job") &&
    postTradeMigrationSource.includes("SECURITY DEFINER") &&
    postTradeMigrationSource.includes("SET search_path = pg_catalog, public") &&
    postTradeMigrationSource.includes("desired_revision = post_trade_reconciliation_jobs.desired_revision + 1") &&
    postTradeMigrationSource.includes("attempt_count = 0") &&
    schemaSource.includes("('005', 'post-trade-reconciliation')"),
  "post-trade migration must enqueue revisioned convergence and permit canonical reorg replacement",
);
assert.ok(
  quoteSnapshotPnlMigrationSource.includes("CREATE TABLE pnl_records_legacy_simulated_v1") &&
    quoteSnapshotPnlMigrationSource.includes("quote_snapshot_edge_v1") &&
    quoteSnapshotPnlMigrationSource.includes("pnl.attribution.v2") &&
    quoteSnapshotPnlMigrationSource.includes("enqueue_pnl_snapshot_analytics_event") &&
    schemaSource.includes("('006', 'quote-snapshot-pnl')"),
  "quote-snapshot PnL migration must archive legacy attribution and emit versioned valuation events",
);
assert.ok(
  settlementIndexerMigrationSource.includes("CREATE TABLE settlement_indexer_cursors") &&
    settlementIndexerMigrationSource.includes("CREATE TABLE settlement_indexer_checkpoints") &&
    settlementIndexerMigrationSource.includes("idx_settlement_events_canonical_chain_block") &&
    schemaSource.includes("('007', 'settlement-indexer')"),
  "settlement indexer migration must install durable cursor, checkpoint, and canonical range state",
);
assert.ok(
  submitReservationMigrationSource.includes("CREATE TABLE quote_submit_reservations") &&
    submitReservationMigrationSource.includes("ON DELETE CASCADE") &&
    submitReservationMigrationSource.includes("idx_quote_submit_reservations_expiry") &&
    schemaSource.includes("('008', 'submit-reservations')"),
  "submit reservation migration must install quote-scoped expiring ownership",
);
assert.ok(
  settlementIndexerStoreSource.includes("lease_expires_at > now()") &&
    settlementIndexerStoreSource.includes("revision = $4") &&
    settlementIndexerStoreSource.includes("next_block = $5") &&
    settlementIndexerStoreSource.includes("DELETE FROM settlement_indexer_checkpoints") &&
    settlementIndexerWorkerSource.includes("findSignedQuoteByChainUserNonce") &&
    settlementIndexerWorkerSource.includes("hashSettlementQuote(quote)") &&
    settlementIndexerWorkerSource.includes("removeOrphanedUncheckpointedEvents") &&
    settlementIndexerWorkerSource.includes('SettlementIndexerError("DEEP_REORG")'),
  "settlement indexer runtime must lease with CAS, verify quotes, recover crash windows, and fail closed on deep reorgs",
);
assert.ok(
  postTradeStoreSource.includes("FOR UPDATE SKIP LOCKED") &&
    postTradeStoreSource.includes("processed_revision = CASE") &&
    postTradeStoreSource.includes("desired_revision = $3") &&
    postTradeStoreSource.includes("lease_owner = $2") &&
    postTradeWorkerSource.includes("reconcileSettlementEventToHedge") &&
    postTradeWorkerSource.includes("reconcileSettlementEventToPnl") &&
    postTradeWorkerSource.includes("reconcileSettlementEventToQuote") &&
    postTradeWorkerSource.includes("stale_revision"),
  "post-trade runtime must lease jobs, guard revisions, and converge all projections",
);

console.log(`Database schema consistency check passed (${tables.size} tables)`);

function extractTables(source) {
  const result = new Map();
  const tablePattern = /CREATE\s+TABLE\s+([a-z_][a-z0-9_]*)\s*\(([\s\S]*?)\);/gi;

  for (const [, rawName, body] of source.matchAll(tablePattern)) {
    const columns = new Set();
    for (const line of body.split("\n")) {
      const match = line.match(/^\s*([a-z_][a-z0-9_]*)\b/i);
      if (match) {
        columns.add(match[1].toLowerCase());
      }
    }

    result.set(rawName.toLowerCase(), {
      body,
      columns,
    });
  }

  return result;
}

function extractInterfaceFields(source, interfaceName) {
  const match = source.match(new RegExp(`export\\s+interface\\s+${interfaceName}\\s+\\{([\\s\\S]*?)\\n\\}`));
  assert.ok(match, `Unable to find backend interface ${interfaceName}`);

  return [...match[1].matchAll(/^\s+([a-zA-Z][a-zA-Z0-9]*)(?:\?)?:/gm)].map((item) => item[1]);
}

function extractOpenApiSchemaProperties(source, schemaName) {
  const lines = source.split("\n");
  const start = lines.findIndex((line) => line === `    ${schemaName}:`);
  assert.ok(start >= 0, `Unable to find OpenAPI schema ${schemaName}`);

  const schemaLines = [];
  for (const line of lines.slice(start + 1)) {
    if (/^    [A-Za-z0-9]+:/.test(line)) {
      break;
    }
    schemaLines.push(line);
  }

  const propertiesStart = schemaLines.findIndex((line) => line === "      properties:");
  assert.ok(propertiesStart >= 0, `Unable to find OpenAPI properties for ${schemaName}`);

  const properties = [];
  for (const line of schemaLines.slice(propertiesStart + 1)) {
    if (/^      [A-Za-z0-9]+:/.test(line)) {
      break;
    }

    const match = line.match(/^        ([a-zA-Z][a-zA-Z0-9]*):$/);
    if (match) {
      properties.push(match[1]);
    }
  }

  return properties;
}

function extractStringUnionValues(source, typeName) {
  const match = source.match(new RegExp(`export\\s+type\\s+${typeName}\\s*=([\\s\\S]*?);`));
  assert.ok(match, `Unable to find TypeScript string union ${typeName}`);

  return [...match[1].matchAll(/"([^"]+)"/g)].map((item) => item[1]);
}

function extractInterfacePropertyEnumValues(source, interfaceName, propertyName) {
  const match = source.match(new RegExp(`export\\s+interface\\s+${interfaceName}\\s+\\{([\\s\\S]*?)\\n\\}`));
  assert.ok(match, `Unable to find backend interface ${interfaceName}`);

  const propertyMatch = match[1].match(new RegExp(`^\\s+${propertyName}\\??:\\s*([^;]+);`, "m"));
  assert.ok(propertyMatch, `Unable to find ${interfaceName}.${propertyName}`);

  const literalValues = [...propertyMatch[1].matchAll(/"([^"]+)"/g)].map((item) => item[1]);
  if (literalValues.length > 0) {
    return literalValues;
  }

  const aliasMatch = propertyMatch[1].trim().match(/^([A-Z][A-Za-z0-9]*)$/);
  assert.ok(aliasMatch, `${interfaceName}.${propertyName} must be a string literal union or type alias`);
  return extractStringUnionValues(source, aliasMatch[1]);
}

function extractColumnInValues(source, columnName) {
  const match = source.match(new RegExp(`${columnName}\\s+IN\\s*\\(([\\s\\S]*?)\\)`, "i"));
  assert.ok(match, `Unable to find ${columnName} IN constraint`);

  return [...match[1].matchAll(/'([^']+)'/g)].map((item) => item[1]);
}

function arraysEqual(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function hasAlterTableForeignKey(tableName, constraintName, columnName, referencedTable, referencedColumn) {
  return new RegExp(
    [
      `ALTER\\s+TABLE\\s+${tableName}`,
      `ADD\\s+CONSTRAINT\\s+${constraintName}`,
      `FOREIGN\\s+KEY\\s*\\(\\s*${columnName}\\s*\\)`,
      `REFERENCES\\s+${referencedTable}\\s*\\(\\s*${referencedColumn}\\s*\\)`,
    ].join("[\\s\\S]*?"),
    "i",
  ).test(schemaSource);
}

function hasBeforeUpdateTrigger(tableName, triggerName, functionName) {
  return new RegExp(
    [
      `CREATE\\s+TRIGGER\\s+${triggerName}`,
      `BEFORE\\s+UPDATE\\s+ON\\s+${tableName}`,
      "FOR\\s+EACH\\s+ROW",
      `EXECUTE\\s+FUNCTION\\s+${functionName}\\s*\\(\\s*\\)`,
    ].join("[\\s\\S]*?"),
    "i",
  ).test(schemaSource);
}

function hasPartialIndex(tableName, indexName, columnName) {
  return new RegExp(
    `CREATE\\s+INDEX\\s+${indexName}\\s+ON\\s+${tableName}\\s*\\(\\s*${columnName}\\s*\\)\\s*WHERE\\s+${columnName}\\s+IS\\s+NOT\\s+NULL\\s*;`,
    "i",
  ).test(schemaSource);
}

function assertSafeIdentifierPrimaryKey(tableName) {
  const body = tables.get(tableName).body;
  assert.ok(
    /btrim\s*\(\s*id\s*\)\s*<>\s*''/i.test(body),
    `${tableName}.id must reject empty primary key values`,
  );
  assert.ok(
    /char_length\s*\(\s*id\s*\)\s*<=\s*128/i.test(body),
    `${tableName}.id must cap primary key values at 128 characters`,
  );
  assert.ok(
    new RegExp(`id\\s*~\\s*'${escapeRegExp(safeIdentifierPattern)}'`, "i").test(body),
    `${tableName}.id must use the shared safe identifier character set`,
  );
}

function hasCheckExpression(tableName, expressionPattern) {
  const table = tables.get(tableName);
  return new RegExp(expressionPattern, "i").test(table.body);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
