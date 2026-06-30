#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const schemaSource = await readFile("docs/database/schema.sql", "utf8");
const erDiagramSource = await readFile("docs/database/er-diagram.md", "utf8");
const openapiSource = await readFile("docs/api/openapi.yaml", "utf8");
const backendTypesSource = await readFile("backend/src/shared/types/rfq.ts", "utf8");

const tables = extractTables(schemaSource);

const requiredTables = {
  quotes: [
    "id",
    "chain_id",
    "user_address",
    "token_in",
    "token_out",
    "amount_in",
    "amount_out",
    "min_amount_out",
    "nonce",
    "deadline",
    "snapshot_id",
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
  ],
  inventory_positions: ["id", "chain_id", "token_address", "balance", "target_balance", "max_exposure"],
  hedge_orders: [
    "id",
    "settlement_event_id",
    "chain_id",
    "token_address",
    "side",
    "amount",
    "venue",
    "status",
  ],
  pnl_records: [
    "id",
    "quote_id",
    "chain_id",
    "user_address",
    "token_in",
    "token_out",
    "amount_in",
    "amount_out",
    "min_amount_out",
    "nonce",
    "deadline",
    "gross_pnl_token_out",
    "gross_pnl_bps",
    "model",
    "realized_at",
  ],
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
  /CREATE\s+UNIQUE\s+INDEX\s+uq_settlement_events_quote_id\s+ON\s+settlement_events\s*\(\s*quote_id\s*\)\s*;/i.test(schemaSource),
  "settlement_events must keep one settlement event per quote",
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
  /CREATE\s+UNIQUE\s+INDEX\s+uq_hedge_orders_settlement_event\s+ON\s+hedge_orders\s*\(\s*settlement_event_id\s*\)\s*;/i.test(schemaSource),
  "hedge_orders must keep one hedge intent per settlement event",
);
assert.ok(
  /UNIQUE\s*\(\s*quote_id\s*,\s*model\s*\)/i.test(tables.get("pnl_records").body),
  "pnl_records must keep one attribution record per quote and model",
);
assert.ok(
  hasAlterTableForeignKey("quotes", "fk_quotes_snapshot_id", "snapshot_id", "market_snapshots", "id"),
  "quotes.snapshot_id must reference market_snapshots(id)",
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
    ["chk_quotes_status", "quotes must constrain lifecycle status values"],
    ["chk_quotes_amounts_non_negative", "quotes must constrain unsigned quote amount fields"],
    ["chk_quotes_addresses_hex", "quotes must constrain address-shaped fields"],
    ["chk_quotes_signature_and_tx_hash_hex", "quotes must constrain signature and transaction hash shape"],
    ["chk_quotes_status_payload_consistency", "quotes must constrain lifecycle status pointer consistency"],
    ["chk_quotes_signed_payload_consistency", "quotes must constrain signed lifecycle payload completeness"],
    ["chk_quotes_rejection_payload_consistency", "quotes must constrain rejection payload completeness"],
  ],
  market_snapshots: [
    ["chk_market_snapshots_prices", "market_snapshots must constrain price and liquidity fields"],
    ["chk_market_snapshots_addresses_hex", "market_snapshots must constrain token address shape"],
  ],
  risk_decisions: [
    ["chk_risk_decisions_status", "risk_decisions must constrain decision status values"],
    ["chk_risk_decisions_limits", "risk_decisions must constrain non-negative numeric limits"],
  ],
  settlement_events: [
    ["chk_settlement_events_hashes", "settlement_events must constrain hash-shaped fields"],
    ["chk_settlement_events_addresses_hex", "settlement_events must constrain address-shaped fields"],
    ["chk_settlement_events_amounts_positive", "settlement_events must constrain positive settlement fields"],
  ],
  inventory_positions: [
    ["chk_inventory_positions_token_hex", "inventory_positions must constrain token address shape"],
    ["chk_inventory_positions_limits", "inventory_positions must constrain inventory limit fields"],
  ],
  hedge_orders: [
    ["chk_hedge_orders_side", "hedge_orders must constrain side enum values"],
    ["chk_hedge_orders_status", "hedge_orders must constrain status enum values"],
    ["chk_hedge_orders_token_hex", "hedge_orders must constrain token address shape"],
    ["chk_hedge_orders_amount_positive", "hedge_orders must constrain positive hedge amounts"],
  ],
  pnl_records: [
    ["chk_pnl_records_model", "pnl_records must constrain supported attribution models"],
    ["chk_pnl_records_addresses_hex", "pnl_records must constrain token address shape"],
    ["chk_pnl_records_amounts_positive", "pnl_records must constrain positive trade amounts"],
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

assert.ok(
  /status\s+IN\s*\(\s*'requested'\s*,\s*'rejected'\s*,\s*'signed'\s*,\s*'expired'\s*,\s*'submitted'\s*,\s*'settled'\s*,\s*'failed'\s*\)/i.test(
    tables.get("quotes").body,
  ),
  "quotes status constraint must match backend QuoteLifecycleStatus values",
);
assert.ok(
  /signature\s+IS\s+NULL\s+OR\s+signature\s+~\s+'\^0x\[0-9a-fA-F\]\{130\}\$'/i.test(tables.get("quotes").body),
  "quotes signature constraint must require 65-byte EIP-712 signatures",
);
assert.ok(
  /tx_hash\s+IS\s+NULL\s+OR\s+tx_hash\s+~\s+'\^0x\[0-9a-fA-F\]\{64\}\$'/i.test(tables.get("quotes").body),
  "quotes tx_hash constraint must require 32-byte transaction hashes",
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
  /status\s+NOT\s+IN\s*\(\s*'signed'\s*,\s*'expired'\s*,\s*'submitted'\s*,\s*'settled'\s*\)[\s\S]*?amount_out\s+IS\s+NOT\s+NULL[\s\S]*?min_amount_out\s+IS\s+NOT\s+NULL[\s\S]*?nonce\s+IS\s+NOT\s+NULL[\s\S]*?deadline\s+IS\s+NOT\s+NULL[\s\S]*?pricing_version\s+IS\s+NOT\s+NULL[\s\S]*?risk_policy_version\s+IS\s+NOT\s+NULL[\s\S]*?signature\s+IS\s+NOT\s+NULL/i.test(
    tables.get("quotes").body,
  ),
  "signed lifecycle statuses must keep complete signed quote payload metadata",
);
assert.ok(
  /status\s+NOT\s+IN\s*\(\s*'rejected'\s*,\s*'failed'\s*\)[\s\S]*?reject_code\s+IS\s+NOT\s+NULL/i.test(
    tables.get("quotes").body,
  ),
  "rejected and failed quote statuses must keep reject_code",
);
assert.ok(
  /decision\s+IN\s*\(\s*'approved'\s*,\s*'rejected'\s*\)/i.test(tables.get("risk_decisions").body),
  "risk decision status constraint must match backend RiskDecisionStatus values",
);
assert.ok(
  /side\s+IN\s*\(\s*'buy'\s*,\s*'sell'\s*\)/i.test(tables.get("hedge_orders").body),
  "hedge side constraint must match backend HedgeIntent side values",
);
assert.ok(
  /model\s+IN\s*\(\s*'simulated_mid_price_v1'\s*\)/i.test(tables.get("pnl_records").body),
  "pnl model constraint must match backend PnlTradeRecord model values",
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
  "uq_settlement_events_quote_id",
  "uq_hedge_orders_settlement_event",
  "idx_pnl_records_realized_at",
  "idx_pnl_records_chain_pair_realized_at",
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
  chainId: "chain_id",
  user: "user_address",
  tokenIn: "token_in",
  tokenOut: "token_out",
  amountIn: "amount_in",
  amountOut: "amount_out",
  minAmountOut: "min_amount_out",
  nonce: "nonce",
  deadline: "deadline",
  grossPnlTokenOut: "gross_pnl_token_out",
  grossPnlBps: "gross_pnl_bps",
  model: "model",
  realizedAt: "realized_at",
};
for (const field of pnlFields) {
  assert.ok(pnlColumnMapping[field], `PnlTradeRecord.${field} must have a database column mapping`);
  assert.ok(
    tables.get("pnl_records").columns.has(pnlColumnMapping[field]),
    `pnl_records must persist PnlTradeRecord.${field} as ${pnlColumnMapping[field]}`,
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

for (const erNode of [
  "QUOTES",
  "MARKET_SNAPSHOTS",
  "RISK_DECISIONS",
  "SETTLEMENT_EVENTS",
  "INVENTORY_POSITIONS",
  "HEDGE_ORDERS",
  "PNL_RECORDS",
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
  erDiagramSource.includes("unique index `(quote_id)`"),
  "ER diagram notes must document one settlement event per signed quote",
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

  return [...match[1].matchAll(/^\s+([a-zA-Z][a-zA-Z0-9]*):/gm)].map((item) => item[1]);
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
