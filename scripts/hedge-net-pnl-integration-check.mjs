import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { endPool, getPool } from "../backend/dist/db/pool.js";
import { PostgresHedgeFeeStore } from "../backend/dist/modules/hedge/postgres-hedge-fee.store.js";
import { PostgresHedgeJobStore } from "../backend/dist/modules/hedge/postgres-hedge-job.store.js";
import { PostgresPnlStore } from "../backend/dist/modules/pnl/postgres-pnl.store.js";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");

const pool = getPool();
const runId = randomBytes(8).toString("hex");
const quoteId = `q_hnp_${runId}`;
const snapshotId = `s_hnp_${runId}`;
const settlementEventId = `se_hnp_${runId}`;
const hedgeOrderId = `h_hnp_${runId}`;
const pnlId = `pnl_${quoteId}`;
const principalId = `principal_hnp_${runId}`;
const workerId = `worker_hnp_${runId}`;
const feeWorkerId = `fee_hnp_${runId}`;
const user = `0x${randomBytes(20).toString("hex")}`;
const quoteToken = `0x${randomBytes(20).toString("hex")}`;
const baseToken = `0x${randomBytes(20).toString("hex")}`;
const txHash = `0x${randomBytes(32).toString("hex")}`;
const quoteHash = `0x${randomBytes(32).toString("hex")}`;
const signature = `0x${"11".repeat(64)}1b`;
const grossModelDescription =
  "Gross settlement PnL in tokenOut base units versus the persisted quote-time mid price, excluding fees, gas, and hedge execution";

try {
  await insertFixtures();

  const jobStore = new PostgresHedgeJobStore(pool);
  const job = await jobStore.claimNext(workerId, 30_000);
  assert.equal(job?.hedgeOrderId, hedgeOrderId);
  assert.equal(job?.referenceToken, quoteToken);
  await jobStore.prepareRoute(hedgeOrderId, workerId, {
    venue: "binance",
    symbol: "ETHUSDT",
    clientOrderId: `rfq_${runId.padEnd(32, "0")}`,
    baseAsset: "ETH",
    quoteAsset: "USDT",
    quoteToken,
    baseTokenDecimals: 18,
    quoteTokenDecimals: 18,
  });
  await jobStore.completeFilled(
    hedgeOrderId,
    workerId,
    `rfq_${runId.padEnd(32, "0")}`,
    "100234",
    "990000000000000000",
    "0.985",
  );

  const feeStore = new PostgresHedgeFeeStore(pool);
  const feeJob = await feeStore.claimNext(feeWorkerId, 30_000);
  assert.equal(feeJob?.hedgeOrderId, hedgeOrderId);
  await feeStore.completeReconciliation(
    hedgeOrderId,
    feeWorkerId,
    "990000000000000000",
    "100234",
    "0.985",
    [{
      venueTradeId: "200345",
      venueOrderId: "100234",
      price: "0.994949494949494949",
      quantity: "0.99",
      quoteQuantity: "0.985",
      commissionQuantity: "0.001",
      commissionAsset: "USDT",
      executedAt: "2026-07-15T00:00:00.000Z",
      isBuyer: true,
      isMaker: false,
    }],
  );

  const persisted = await pool.query(
    `SELECT route_accounting_version, hedge_net_pnl_status,
            hedge_net_pnl_quote_quantity::text AS net_quantity,
            hedge_commission_quote_quantity::text AS commission_quantity
     FROM hedge_orders WHERE id = $1`,
    [hedgeOrderId],
  );
  assert.equal(persisted.rows[0]?.route_accounting_version, "venue-assets-v1");
  assert.equal(persisted.rows[0]?.hedge_net_pnl_status, "complete");
  assert.equal(persisted.rows[0]?.net_quantity, "0.014000000000000000");
  assert.equal(persisted.rows[0]?.commission_quantity, "0.001000000000000000");

  const pnlStore = new PostgresPnlStore(pool, { resolve() { throw new Error("not used"); } });
  const summary = await pnlStore.summary(principalId);
  assert.equal(summary.hedgeNet.completeTrades, 1);
  assert.deepEqual(summary.hedgeNet.totals, [{
    chainId: 1,
    valuationToken: quoteToken,
    valuationAsset: "USDT",
    totalTrades: 1,
    netPnlQuoteQuantity: "0.014",
  }]);
  assert.equal(summary.hedgeNet.records[0]?.status, "complete");
  console.log("Hedge net PnL PostgreSQL integration check passed");
} finally {
  try {
    await cleanupFixtures();
  } finally {
    await endPool();
  }
}

async function insertFixtures() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO market_snapshots (
         id, chain_id, token_in, token_out, mid_price, bid_price, ask_price,
         liquidity_usd, market_spread_bps, volatility_bps, source, observed_at
       ) VALUES ($1, 1, $2, $3, 1, 0.99, 1.01, 1000000, 10, 25, 'hedge-net-pnl-integration', now())`,
      [snapshotId, quoteToken, baseToken],
    );
    await client.query(
      `INSERT INTO quotes (
         id, principal_id, chain_id, user_address, token_in, token_out, amount_in, slippage_bps,
         amount_out, min_amount_out, nonce, deadline, snapshot_id, pricing_version,
         spread_bps, size_impact_bps, market_spread_bps, inventory_skew_bps,
         volatility_premium_bps, hedge_cost_bps, risk_policy_version, status, signature
       ) VALUES ($1, $2, 1, $3, $4, $5, 1000000000000000000, 50,
         990000000000000000, 980000000000000000, 1, 4102444800, $6, 'formula-v4',
         20, 5, 10, 0, 5, 0, 'risk-v1', 'signed', $7)`,
      [quoteId, principalId, user, quoteToken, baseToken, snapshotId, signature],
    );
    await client.query(
      `INSERT INTO settlement_events (
         id, quote_id, chain_id, tx_hash, quote_hash, log_index, block_number,
         user_address, token_in, token_out, amount_in, amount_out, nonce
       ) VALUES ($1, $2, 1, $3, $4, 0, 100, $5, $6, $7,
         1000000000000000000, 990000000000000000, 1)`,
      [settlementEventId, quoteId, txHash, quoteHash, user, quoteToken, baseToken],
    );
    await client.query(
      `INSERT INTO hedge_orders (
       id, settlement_event_id, quote_id, chain_id, token_address, side,
         amount, venue, status, reason, next_attempt_at, created_at
       ) VALUES ($1, $2, $3, 1, $4, 'buy', 990000000000000000,
         'internal', 'queued', 'inventory_rebalance',
         '1970-01-01T00:00:00.000Z', '1970-01-01T00:00:00.000Z')`,
      [hedgeOrderId, settlementEventId, quoteId, baseToken],
    );
    await client.query(
      `INSERT INTO pnl_records (
         id, quote_id, settlement_event_id, snapshot_id, chain_id,
         user_address, token_in, token_out, amount_in, amount_out, min_amount_out,
         nonce, deadline, mid_price, token_in_decimals, token_out_decimals,
         fair_amount_out, valuation_observed_at, gross_pnl_token_out, gross_pnl_bps,
         model, model_description, realized_at
       ) VALUES ($1, $2, $3, $4, 1, $5, $6, $7,
         1000000000000000000, 990000000000000000, 980000000000000000,
         1, 4102444800, 1, 18, 18, 1000000000000000000, now(),
         10000000000000000, 100, 'quote_snapshot_edge_v1', $8, now())`,
      [pnlId, quoteId, settlementEventId, snapshotId, user, quoteToken, baseToken, grossModelDescription],
    );
    await client.query("COMMIT");
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

async function cleanupFixtures() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const inventory = await client.query(
      "SELECT id FROM inventory_positions WHERE chain_id = 1 AND lower(token_address) = lower($1)",
      [baseToken],
    );
    const aggregateIds = [quoteId, snapshotId, settlementEventId, hedgeOrderId, pnlId,
      ...inventory.rows.map((row) => row.id)];
    await client.query("DELETE FROM post_trade_reconciliation_jobs WHERE quote_id = $1", [quoteId]);
    await client.query("DELETE FROM toxic_flow_markouts WHERE settlement_event_id = $1", [settlementEventId]);
    await client.query("DELETE FROM toxic_flow_markout_jobs WHERE settlement_event_id = $1", [settlementEventId]);
    await client.query("DELETE FROM hedge_orders WHERE id = $1", [hedgeOrderId]);
    await client.query("DELETE FROM pnl_records WHERE id = $1", [pnlId]);
    await client.query("DELETE FROM settlement_events WHERE id = $1", [settlementEventId]);
    await client.query("DELETE FROM inventory_positions WHERE chain_id = 1 AND lower(token_address) = lower($1)", [baseToken]);
    await client.query("DELETE FROM quotes WHERE id = $1", [quoteId]);
    await client.query("DELETE FROM market_snapshots WHERE id = $1", [snapshotId]);
    await client.query("DELETE FROM analytics_outbox WHERE aggregate_id = ANY($1::text[])", [aggregateIds]);
    await client.query("COMMIT");
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }
}
