import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { endPool, getPool } from "../backend/dist/db/pool.js";

const databaseUrl = process.env.DATABASE_URL;
const clickhouseUrl = process.env.RFQ_CLICKHOUSE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");
if (!clickhouseUrl) throw new Error("RFQ_CLICKHOUSE_URL is required");
if (process.env.RFQ_ANALYTICS_INTEGRATION_CONFIRM !== "yes") {
  throw new Error("RFQ_ANALYTICS_INTEGRATION_CONFIRM=yes is required because this check writes synthetic trade data");
}
const clickhouseDatabase = process.env.RFQ_CLICKHOUSE_DATABASE ?? "default";
const clickhouseTable = process.env.RFQ_CLICKHOUSE_ANALYTICS_TABLE ?? "rfq_analytics_events";
for (const [name, value] of [["RFQ_CLICKHOUSE_DATABASE", clickhouseDatabase], ["RFQ_CLICKHOUSE_ANALYTICS_TABLE", clickhouseTable]]) {
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(value)) throw new Error(`${name} is invalid`);
}

const pool = getPool();
const client = await pool.connect();
const runId = randomBytes(8).toString("hex");
const quoteId = `q_analytics_${runId}`;
const snapshotId = `s_analytics_${runId}`;
const riskDecisionId = `rd_analytics_${runId}`;
const settlementEventId = `se_analytics_${runId}`;
const inventoryPositionId = `ip_analytics_${runId}`;
const hedgeOrderId = `h_analytics_${runId}`;
const pnlId = `pnl_analytics_${runId}`;
const user = `0x${randomBytes(20).toString("hex")}`;
const tokenIn = `0x${randomBytes(20).toString("hex")}`;
const tokenOut = `0x${randomBytes(20).toString("hex")}`;
const txHash = `0x${randomBytes(32).toString("hex")}`;
const quoteHash = `0x${randomBytes(32).toString("hex")}`;
const signature = `0x${"11".repeat(64)}1b`;
const modelDescription = "Gross settlement PnL in tokenOut base units versus the persisted quote-time mid price, excluding fees, gas, and hedge execution";
const expectedTypes = [
  "hedge.lifecycle.v2",
  "inventory.position.v1",
  "market.snapshot.v1",
  "pnl.attribution.v2",
  "quote.lifecycle.v1",
  "risk.decision.v1",
  "settlement.lifecycle.v1",
];
const fixtureAggregateIds = [
  quoteId,
  snapshotId,
  settlementEventId,
  inventoryPositionId,
  hedgeOrderId,
  pnlId,
];
let fixturesCommitted = false;
let eventIds = [];

try {
  await client.query("BEGIN");
  await client.query(
    `INSERT INTO market_snapshots (
       id, chain_id, token_in, token_out, mid_price, bid_price, ask_price,
       liquidity_usd, market_spread_bps, volatility_bps, source, observed_at
     ) VALUES ($1, 1, $2, $3, '1.000000000000000000', '0.990000000000000000',
       '1.010000000000000000', 1000000, 10, 25, 'analytics-integration', now())`,
    [snapshotId, tokenIn, tokenOut],
  );
  await client.query(
    `INSERT INTO quotes (
       id, chain_id, user_address, token_in, token_out, amount_in, slippage_bps,
       amount_out, min_amount_out, nonce, deadline, snapshot_id, pricing_version,
       spread_bps, size_impact_bps, market_spread_bps, inventory_skew_bps, volatility_premium_bps,
       hedge_cost_bps, risk_policy_version,
       status, signature
     ) VALUES ($1, 1, $2, $3, $4, 1000000000000000000, 50,
       990000000000000000, 980000000000000000, 1, 4102444800, $5,
       'formula-v4', 20, 5, 10, 0, 5, 0, 'risk-v1', 'signed', $6)`,
    [quoteId, user, tokenIn, tokenOut, snapshotId, signature],
  );
  await client.query(
    `INSERT INTO risk_decisions (id, quote_id, decision, policy_version)
     VALUES ($1, $2, 'approved', 'risk-v1')`,
    [riskDecisionId, quoteId],
  );
  await client.query(
    `INSERT INTO settlement_events (
       id, quote_id, chain_id, tx_hash, quote_hash, log_index, block_number,
       user_address, token_in, token_out, amount_in, amount_out, nonce
     ) VALUES ($1, $2, 1, $3, $4, 0, 100, $5, $6, $7,
       1000000000000000000, 990000000000000000, 1)`,
    [settlementEventId, quoteId, txHash, quoteHash, user, tokenIn, tokenOut],
  );
  await client.query(
    `INSERT INTO inventory_positions (id, chain_id, token_address, balance)
     VALUES ($1, 1, $2, -990000000000000000)`,
    [inventoryPositionId, tokenOut],
  );
  await client.query(
    `INSERT INTO hedge_orders (
       id, settlement_event_id, quote_id, chain_id, token_address, side,
       amount, venue, status, reason
     ) VALUES ($1, $2, $3, 1, $4, 'buy', 990000000000000000,
       'internal', 'queued', 'inventory_rebalance')`,
    [hedgeOrderId, settlementEventId, quoteId, tokenOut],
  );
  await client.query(
    `INSERT INTO pnl_records (
       id, quote_id, settlement_event_id, snapshot_id, chain_id,
       user_address, token_in, token_out, amount_in,
       amount_out, min_amount_out, nonce, deadline, gross_pnl_token_out,
       gross_pnl_bps, model, model_description, realized_at, mid_price,
       token_in_decimals, token_out_decimals, fair_amount_out, valuation_observed_at
     ) VALUES ($1, $2, $3, $4, 1, $5, $6, $7, 1000000000000000000,
       990000000000000000, 980000000000000000, 1, 4102444800,
       10000000000000000, 100, 'quote_snapshot_edge_v1', $8, now(),
       1.000000000000000000, 18, 18, 1000000000000000000, now())`,
    [pnlId, quoteId, settlementEventId, snapshotId, user, tokenIn, tokenOut, modelDescription],
  );
  await client.query("COMMIT");
  fixturesCommitted = true;

  const outbox = await waitFor(async () => {
    const result = await pool.query(
      `SELECT id::text, event_type, published_at
       FROM analytics_outbox
       WHERE aggregate_id = ANY($1::text[])
       ORDER BY id`,
      [fixtureAggregateIds],
    );
    return result.rows.length === 7 && result.rows.every((row) => row.published_at !== null)
      ? result.rows
      : undefined;
  }, 30_000, "analytics outbox publication");
  assert.deepEqual(outbox.map((row) => row.event_type).sort(), expectedTypes);
  eventIds = outbox.map((row) => `ao_${row.id}`);
  const eventIdFilter = sqlStringList(eventIds);

  const projection = await waitFor(async () => {
    const result = await clickhouseQuery(
      `SELECT count() AS row_count, uniqExact(event_id) AS unique_count, groupUniqArray(event_type) AS event_types FROM ${clickhouseTable} FINAL WHERE event_id IN (${eventIdFilter})`,
    );
    const row = result.data?.[0];
    return Number(row?.unique_count) === 7 ? row : undefined;
  }, 30_000, "ClickHouse analytics projection");

  assert.equal(Number(projection.row_count), 7);
  assert.equal(Number(projection.unique_count), 7);
  assert.deepEqual([...projection.event_types].sort(), expectedTypes);

  const quoteProjection = await clickhouseQuery(
    `SELECT payload FROM ${clickhouseTable} FINAL WHERE event_type = 'quote.lifecycle.v1' AND event_id IN (${eventIdFilter}) LIMIT 1`,
  );
  const quotePayload = JSON.parse(quoteProjection.data[0].payload);
  assert.equal(quotePayload.amountIn, "1000000000000000000");
  assert.equal(typeof quotePayload.amountIn, "string");
  assert.equal(quotePayload.marketSpreadBps, 10);

  const snapshotProjection = await clickhouseQuery(
    `SELECT payload FROM ${clickhouseTable} FINAL WHERE event_type = 'market.snapshot.v1' AND event_id IN (${eventIdFilter}) LIMIT 1`,
  );
  assert.equal(JSON.parse(snapshotProjection.data[0].payload).marketSpreadBps, 10);

  const migrations = await pool.query("SELECT version FROM _migrations ORDER BY version");
  assert.deepEqual(
    migrations.rows.map((row) => row.version),
    ["001", "002", "003", "004", "005", "006", "007", "008", "009", "010", "011", "012", "013", "014"],
  );

  await cleanupOperationalFixtures();
  fixturesCommitted = false;
  await clickhouseCommand(
    `ALTER TABLE ${clickhouseTable} DELETE WHERE event_id IN (${eventIdFilter}) SETTINGS mutations_sync = 1`,
  );

  process.stdout.write(`${JSON.stringify({
    status: "ok",
    outbox: {
      total: outbox.length,
      published: outbox.filter((row) => row.published_at !== null).length,
      pending: outbox.filter((row) => row.published_at === null).length,
    },
    clickhouse: {
      rows: Number(projection.row_count),
      uniqueEvents: Number(projection.unique_count),
      eventTypes: [...projection.event_types].sort(),
    },
  }, null, 2)}\n`);
} catch (error) {
  try {
    await client.query("ROLLBACK");
  } catch {}
  if (fixturesCommitted) {
    try {
      await cleanupOperationalFixtures();
    } catch (cleanupError) {
      process.stderr.write(`Analytics integration fixture cleanup failed: ${String(cleanupError)}\n`);
    }
  }
  throw error;
} finally {
  client.release();
  await endPool();
}

async function clickhouseQuery(query) {
  const response = await clickhouseRequest(query, true);
  return response.json();
}

async function clickhouseCommand(query) {
  await clickhouseRequest(query, false);
}

async function clickhouseRequest(query, expectsJson) {
  const endpoint = new URL(clickhouseUrl);
  endpoint.searchParams.set("database", clickhouseDatabase);
  if (expectsJson) endpoint.searchParams.set("default_format", "JSON");
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "text/plain" },
    body: query,
  });
  if (!response.ok) throw new Error(`ClickHouse query failed with HTTP ${response.status}: ${await response.text()}`);
  return response;
}

async function cleanupOperationalFixtures() {
  await client.query("BEGIN");
  try {
    await client.query("DELETE FROM post_trade_reconciliation_jobs WHERE quote_id = $1", [quoteId]);
    await client.query("DELETE FROM hedge_orders WHERE id = $1", [hedgeOrderId]);
    await client.query("DELETE FROM pnl_records WHERE id = $1", [pnlId]);
    await client.query("DELETE FROM risk_decisions WHERE id = $1", [riskDecisionId]);
    await client.query("DELETE FROM settlement_events WHERE id = $1", [settlementEventId]);
    await client.query("DELETE FROM inventory_positions WHERE id = $1", [inventoryPositionId]);
    await client.query("DELETE FROM quotes WHERE id = $1", [quoteId]);
    await client.query("DELETE FROM market_snapshots WHERE id = $1", [snapshotId]);
    await client.query("DELETE FROM analytics_outbox WHERE aggregate_id = ANY($1::text[])", [fixtureAggregateIds]);
    await client.query("COMMIT");
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    throw error;
  }
}

function sqlStringList(values) {
  if (!Array.isArray(values) || values.length === 0 ||
      values.some((value) => typeof value !== "string" || !/^ao_[1-9][0-9]*$/.test(value))) {
    throw new Error("Analytics integration event ids are invalid");
  }
  return values.map((value) => `'${value}'`).join(", ");
}

async function waitFor(probe, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const result = await probe();
      if (result !== undefined) return result;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${label}${lastError ? `: ${String(lastError)}` : ""}`);
}
