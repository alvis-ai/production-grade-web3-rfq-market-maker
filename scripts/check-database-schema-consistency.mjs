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
    "token_in",
    "token_out",
    "amount_in",
    "amount_out",
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

for (const indexName of [
  "idx_quotes_user_created_at",
  "idx_quotes_status_created_at",
  "uq_quotes_chain_user_nonce",
  "idx_risk_decisions_quote_id",
  "uq_hedge_orders_settlement_event",
  "idx_pnl_records_realized_at",
  "idx_pnl_records_chain_pair_realized_at",
]) {
  assert.ok(
    new RegExp(`CREATE\\s+(?:UNIQUE\\s+)?INDEX\\s+${indexName}\\b`, "i").test(schemaSource),
    `docs/database/schema.sql must define ${indexName}`,
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
  tokenIn: "token_in",
  tokenOut: "token_out",
  amountIn: "amount_in",
  amountOut: "amount_out",
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
  erDiagramSource.includes("quote_hash"),
  "ER diagram must document settlement event quote_hash persistence",
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
