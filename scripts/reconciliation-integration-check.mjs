import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { endPool, getPool } from "../backend/dist/db/pool.js";
import { PostgresHedgeService } from "../backend/dist/modules/hedge/postgres-hedge.service.js";
import { PostgresInventoryService } from "../backend/dist/modules/inventory/postgres-inventory.service.js";
import { PostgresPnlStore } from "../backend/dist/modules/pnl/postgres-pnl.store.js";
import { PostgresQuoteRepository } from "../backend/dist/modules/quote/postgres-quote.repository.js";
import { PostTradeReconciliationMetrics } from "../backend/dist/modules/reconciliation/post-trade-reconciliation.metrics.js";
import { PostTradeReconciliationWorker } from "../backend/dist/modules/reconciliation/post-trade-reconciliation.worker.js";
import { PostgresPostTradeReconciliationStore } from "../backend/dist/modules/reconciliation/postgres-post-trade-reconciliation.store.js";
import { ReconciliationService } from "../backend/dist/modules/reconciliation/reconciliation.service.js";
import { PostgresSettlementEventStore } from "../backend/dist/modules/settlement/postgres-settlement-event.store.js";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
if (process.env.RFQ_RECONCILIATION_INTEGRATION_CONFIRM !== "yes") {
  throw new Error("RFQ_RECONCILIATION_INTEGRATION_CONFIRM=yes is required because this check writes synthetic trade data");
}

const pool = getPool();
const runId = randomBytes(8).toString("hex");
const quoteId = `q_reconciliation_${runId}`;
const snapshotId = `s_reconciliation_${runId}`;
const user = `0x${randomBytes(20).toString("hex")}`;
const tokenIn = `0x${randomBytes(20).toString("hex")}`;
const tokenOut = `0x${randomBytes(20).toString("hex")}`;
const signature = `0x${"11".repeat(64)}1b`;
const quote = {
  user,
  tokenIn,
  tokenOut,
  amountIn: "1000000000000000000",
  amountOut: "990000000000000000",
  minAmountOut: "980000000000000000",
  nonce: "1",
  deadline: 4_102_444_800,
  chainId: 1,
};
const firstTxHash = `0x${randomBytes(32).toString("hex")}`;
const replacementTxHash = `0x${randomBytes(32).toString("hex")}`;
const inventory = new PostgresInventoryService(pool);
const settlementEvents = new PostgresSettlementEventStore(pool, inventory);
const quoteRepository = new PostgresQuoteRepository(pool);
const hedgeService = new PostgresHedgeService(pool);
const pnlService = new PostgresPnlStore(pool);
const jobStore = new PostgresPostTradeReconciliationStore(pool);
const reconciliation = new ReconciliationService({
  quoteRepository,
  settlementEventService: settlementEvents,
  hedgeService,
  pnlService,
});
const metrics = new PostTradeReconciliationMetrics();
const worker = new PostTradeReconciliationWorker(jobStore, reconciliation, {
  workerId: `reconciliation_check_${runId}`,
  leaseMs: 30_000,
  pollIntervalMs: 10,
  retryDelayMs: 100,
}, metrics, { error() {} });
let fixturesCreated = false;

try {
  const migrations = await pool.query("SELECT version FROM _migrations ORDER BY version");
  assert.equal(migrations.rows.some((row) => row.version === "005"), true, "migration 005 must be applied");
  await pool.query(
    `INSERT INTO market_snapshots (
       id, chain_id, token_in, token_out, mid_price, bid_price, ask_price,
       liquidity_usd, volatility_bps, source, observed_at
     ) VALUES ($1, 1, $2, $3, '1.000000000000000000', '0.990000000000000000',
       '1.010000000000000000', 1000000, 25, 'reconciliation-integration', now())`,
    [snapshotId, tokenIn, tokenOut],
  );
  await pool.query(
    `INSERT INTO quotes (
       id, chain_id, user_address, token_in, token_out, amount_in, slippage_bps,
       amount_out, min_amount_out, nonce, deadline, snapshot_id, pricing_version,
       spread_bps, size_impact_bps, inventory_skew_bps, risk_policy_version,
       status, signature
     ) VALUES ($1, 1, $2, $3, $4, $5, 50, $6, $7, $8, $9, $10,
       'formula-v1', 20, 5, 0, 'risk-v1', 'signed', $11)`,
    [
      quoteId,
      user,
      tokenIn,
      tokenOut,
      quote.amountIn,
      quote.amountOut,
      quote.minAmountOut,
      quote.nonce,
      quote.deadline,
      snapshotId,
      signature,
    ],
  );
  fixturesCreated = true;

  const first = await settlementEvents.applySettlementEvent({
    quoteId,
    quote,
    txHash: firstTxHash,
    blockNumber: 100,
    logIndex: 0,
  });
  assert.equal(await worker.runOnce(), true);
  await assertConverged(first.event.settlementEventId, firstTxHash, 1);

  const removed = await settlementEvents.removeSettlementEvent({
    chainId: quote.chainId,
    txHash: firstTxHash,
    blockNumber: 100,
    logIndex: 0,
  });
  assert.equal(removed.removed, true);
  assert.equal(await worker.runOnce(), true);
  const removedStatus = await quoteRepository.findStatus(quoteId);
  assert.equal(removedStatus.status, "signed");
  assert.equal(removedStatus.settlementEventId, undefined);
  assert.equal(await hedgeService.getHedgeIntentBySettlementEvent(first.event.settlementEventId), undefined);
  assert.equal(await pnlService.getPnlRecordByQuoteId(quoteId), undefined);
  await assertProcessedRevision(2);

  const replacement = await settlementEvents.applySettlementEvent({
    quoteId,
    quote,
    txHash: replacementTxHash,
    blockNumber: 101,
    logIndex: 1,
  });
  assert.notEqual(replacement.event.settlementEventId, first.event.settlementEventId);
  assert.equal(await worker.runOnce(), true);
  await assertConverged(replacement.event.settlementEventId, replacementTxHash, 3);

  const history = await pool.query(
    `SELECT id, canonical FROM settlement_events WHERE quote_id = $1 ORDER BY block_number, log_index`,
    [quoteId],
  );
  assert.deepEqual(history.rows.map((row) => row.canonical), [false, true]);

  process.stdout.write(`${JSON.stringify({
    status: "ok",
    quoteId,
    settlementHistory: history.rows.length,
    canonicalSettlementEventId: replacement.event.settlementEventId,
    processedRevision: 3,
  }, null, 2)}\n`);
} finally {
  if (fixturesCreated) await cleanup();
  await endPool();
}

async function assertConverged(settlementEventId, txHash, revision) {
  const status = await quoteRepository.findStatus(quoteId);
  const hedge = await hedgeService.getHedgeIntentBySettlementEvent(settlementEventId);
  const pnl = await pnlService.getPnlRecordByQuoteId(quoteId);
  assert.equal(status.status, "settled");
  assert.equal(status.txHash, txHash.toLowerCase());
  assert.equal(status.settlementEventId, settlementEventId);
  assert.equal(status.hedgeOrderId, hedge.hedgeOrderId);
  assert.equal(status.pnlId, pnl.pnlId);
  await assertProcessedRevision(revision);
}

async function assertProcessedRevision(revision) {
  const result = await pool.query(
    `SELECT desired_revision::text, processed_revision::text, lease_owner
     FROM post_trade_reconciliation_jobs WHERE quote_id = $1`,
    [quoteId],
  );
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].desired_revision, String(revision));
  assert.equal(result.rows[0].processed_revision, String(revision));
  assert.equal(result.rows[0].lease_owner, null);
}

async function cleanup() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const inventoryRows = await client.query(
      "SELECT id FROM inventory_positions WHERE chain_id = 1 AND lower(token_address) = ANY($1::text[])",
      [[tokenIn.toLowerCase(), tokenOut.toLowerCase()]],
    );
    const hedgeRows = await client.query("SELECT id FROM hedge_orders WHERE quote_id = $1", [quoteId]);
    const pnlRows = await client.query("SELECT id FROM pnl_records WHERE quote_id = $1", [quoteId]);
    const settlementRows = await client.query("SELECT id FROM settlement_events WHERE quote_id = $1", [quoteId]);
    await client.query(
      `UPDATE quotes SET status = 'signed', tx_hash = NULL, settlement_event_id = NULL,
         hedge_order_id = NULL, pnl_id = NULL WHERE id = $1`,
      [quoteId],
    );
    await client.query("DELETE FROM post_trade_reconciliation_jobs WHERE quote_id = $1", [quoteId]);
    await client.query("DELETE FROM hedge_orders WHERE quote_id = $1", [quoteId]);
    await client.query("DELETE FROM pnl_records WHERE quote_id = $1", [quoteId]);
    await client.query("DELETE FROM settlement_events WHERE quote_id = $1", [quoteId]);
    await client.query(
      "DELETE FROM inventory_positions WHERE chain_id = 1 AND lower(token_address) = ANY($1::text[])",
      [[tokenIn.toLowerCase(), tokenOut.toLowerCase()]],
    );
    await client.query("DELETE FROM quotes WHERE id = $1", [quoteId]);
    await client.query("DELETE FROM market_snapshots WHERE id = $1", [snapshotId]);
    const aggregateIds = [
      quoteId,
      snapshotId,
      ...inventoryRows.rows.map((row) => row.id),
      ...hedgeRows.rows.map((row) => row.id),
      ...pnlRows.rows.map((row) => row.id),
      ...settlementRows.rows.map((row) => row.id),
    ];
    await client.query(
      `DELETE FROM analytics_outbox
       WHERE aggregate_id = ANY($1::text[]) OR payload->>'quoteId' = $2`,
      [aggregateIds, quoteId],
    );
    await client.query("COMMIT");
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }
}
