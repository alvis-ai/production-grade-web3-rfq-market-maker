#!/usr/bin/env node

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { endPool, getPool } from "../backend/dist/db/pool.js";
import { BinanceSpotAdapter } from "../backend/dist/modules/hedge/binance-spot.adapter.js";
import { BinanceSymbolRulesService } from "../backend/dist/modules/hedge/binance-symbol-rules.js";
import { HedgeFeeWorker } from "../backend/dist/modules/hedge/hedge-fee-worker.js";
import { DeltaNeutralHedgePlanner } from "../backend/dist/modules/hedge/hedge-intent-planner.js";
import { HedgeRouteTable } from "../backend/dist/modules/hedge/hedge-route.js";
import { HedgeWorker } from "../backend/dist/modules/hedge/hedge-worker.js";
import { PostgresHedgeFeeStore } from "../backend/dist/modules/hedge/postgres-hedge-fee.store.js";
import { PostgresHedgeJobStore } from "../backend/dist/modules/hedge/postgres-hedge-job.store.js";
import { PostgresHedgeService } from "../backend/dist/modules/hedge/postgres-hedge.service.js";
import { PostgresInventoryService } from "../backend/dist/modules/inventory/postgres-inventory.service.js";
import { PostgresMarketSnapshotStore } from "../backend/dist/modules/market-data/postgres-market-snapshot.repository.js";
import { PostgresPnlStore } from "../backend/dist/modules/pnl/postgres-pnl.store.js";
import { QuoteSnapshotPnlValuationProvider } from "../backend/dist/modules/pnl/quote-snapshot-valuation.provider.js";
import { ConfiguredTokenRegistry } from "../backend/dist/modules/pricing/token-registry.js";
import { PostgresQuoteRepository } from "../backend/dist/modules/quote/postgres-quote.repository.js";
import { PostTradeReconciliationMetrics } from "../backend/dist/modules/reconciliation/post-trade-reconciliation.metrics.js";
import { PostTradeReconciliationWorker } from "../backend/dist/modules/reconciliation/post-trade-reconciliation.worker.js";
import { PostgresPostTradeReconciliationStore } from "../backend/dist/modules/reconciliation/postgres-post-trade-reconciliation.store.js";
import { ReconciliationService } from "../backend/dist/modules/reconciliation/reconciliation.service.js";
import { PostgresSettlementEventStore } from "../backend/dist/modules/settlement/postgres-settlement-event.store.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");
if (process.env.RFQ_HEDGE_WORKER_E2E_CONFIRM !== "yes") {
  throw new Error("RFQ_HEDGE_WORKER_E2E_CONFIRM=yes is required because this check writes synthetic trade data");
}
assertLoopbackDatabase(databaseUrl);
if (process.env.RFQ_BINANCE_TESTNET_FIXTURE_MODE !== "worker-filled") {
  throw new Error("RFQ_BINANCE_TESTNET_FIXTURE_MODE=worker-filled is required");
}

const pool = getPool();
const runId = randomBytes(8).toString("hex");
const quoteId = `q_hedge_e2e_${runId}`;
const snapshotId = `s_hedge_e2e_${runId}`;
const principalId = `principal_hedge_e2e_${runId}`;
const user = `0x${randomBytes(20).toString("hex")}`;
const quoteToken = `0x${randomBytes(20).toString("hex")}`;
const baseToken = `0x${randomBytes(20).toString("hex")}`;
const txHash = `0x${randomBytes(32).toString("hex")}`;
const signature = `0x${"11".repeat(64)}1b`;
const observedAt = new Date().toISOString();
const quote = {
  user,
  tokenIn: quoteToken,
  tokenOut: baseToken,
  amountIn: "18000000",
  amountOut: "200000000000000000",
  minAmountOut: "190000000000000000",
  nonce: "1",
  deadline: 4_102_444_800,
  chainId: 1,
};
const request = {
  chainId: quote.chainId,
  user: quote.user,
  tokenIn: quote.tokenIn,
  tokenOut: quote.tokenOut,
  amountIn: quote.amountIn,
  slippageBps: 50,
};
const tokenRegistry = new ConfiguredTokenRegistry({
  tokens: [
    {
      chainId: 1,
      tokenAddress: quoteToken,
      symbol: "USDT",
      decimals: 6,
      isWhitelisted: true,
      riskTier: "low",
      usdReference: true,
    },
    {
      chainId: 1,
      tokenAddress: baseToken,
      symbol: "BTC",
      decimals: 18,
      isWhitelisted: true,
      riskTier: "medium",
      usdReference: false,
    },
  ],
});
const routes = new HedgeRouteTable([{
  chainId: 1,
  token: baseToken,
  venue: "binance",
  symbol: "BTCUSDT",
  baseAsset: "BTC",
  quoteAsset: "USDT",
  quoteToken,
  tokenDecimals: 18,
  quoteTokenDecimals: 6,
  stepSizeRaw: "1000000000000000",
  priceTick: "0.01",
  maxSlippageBps: 0,
}]);
routes.validateTokenRegistry(tokenRegistry);

const inventory = new PostgresInventoryService(pool);
const settlementEvents = new PostgresSettlementEventStore(pool, inventory);
const hedgeService = new PostgresHedgeService(pool);
const quoteRepository = new PostgresQuoteRepository(pool);
const marketSnapshots = new PostgresMarketSnapshotStore(pool);
const pnlService = new PostgresPnlStore(
  pool,
  new QuoteSnapshotPnlValuationProvider(marketSnapshots, tokenRegistry),
);
const reconciliation = new ReconciliationService({
  quoteRepository,
  settlementEventService: settlementEvents,
  hedgeService,
  pnlService,
}, new DeltaNeutralHedgePlanner(tokenRegistry));
const reconciliationWorker = new PostTradeReconciliationWorker(
  new PostgresPostTradeReconciliationStore(pool),
  reconciliation,
  {
    workerId: `reconciliation_hedge_e2e_${runId}`,
    leaseMs: 30_000,
    pollIntervalMs: 10,
    retryDelayMs: 10,
  },
  new PostTradeReconciliationMetrics(),
  { error() {} },
);
const symbolRules = new BinanceSymbolRulesService({
  baseUrl: "https://testnet.binance.vision",
  requestTimeoutMs: 1_000,
  maxAgeMs: 10_000,
}, routes);
const adapter = new BinanceSpotAdapter({
  apiKey: "testnet-api-key",
  apiSecret: "testnet-api-secret",
  baseUrl: "https://testnet.binance.vision",
  recvWindowMs: 5_000,
  requestTimeoutMs: 1_000,
}, symbolRules);
const adapters = new Map([["binance", adapter]]);
const hedgeWorker = new HedgeWorker(
  new PostgresHedgeJobStore(pool),
  routes,
  adapters,
  {
    workerId: `hedge_e2e_${runId}`,
    leaseMs: 10_000,
    pollIntervalMs: 10,
    retryDelayMs: 10,
    maxOrderAgeMs: 30_000,
  },
  { info() {}, error() {} },
);
const feeWorker = new HedgeFeeWorker(
  new PostgresHedgeFeeStore(pool),
  routes,
  adapters,
  {
    workerId: `hedge_fee_e2e_${runId}`,
    leaseMs: 10_000,
    pollIntervalMs: 10,
    retryDelayMs: 10,
    maxOrderAgeMs: 30_000,
  },
  { info() {}, error() {} },
);
let fixtureMayExist = false;

try {
  await assertDatabaseReadyAndIdle();
  await marketSnapshots.saveSnapshot({
    request,
    snapshot: {
      snapshotId,
      midPrice: "0.011111111111111111",
      liquidityUsd: "1000000",
      marketSpreadBps: 10,
      volatilityBps: 25,
      observedAt,
    },
    source: "hedge-worker-e2e",
  });
  fixtureMayExist = true;
  await pool.query(
    `INSERT INTO quotes (
       id, principal_id, chain_id, user_address, token_in, token_out, amount_in, slippage_bps,
       amount_out, min_amount_out, nonce, deadline, snapshot_id, pricing_version,
       spread_bps, size_impact_bps, market_spread_bps, inventory_skew_bps,
       volatility_premium_bps, hedge_cost_bps, risk_policy_version, status, signature
     ) VALUES ($1, $2, 1, $3, $4, $5, $6, 50, $7, $8, $9, $10, $11,
       'formula-v4:internal_inventory', 20, 5, 10, 0, 5, 0, 'risk-v1', 'signed', $12)`,
    [
      quoteId,
      principalId,
      user,
      quoteToken,
      baseToken,
      quote.amountIn,
      quote.amountOut,
      quote.minAmountOut,
      quote.nonce,
      quote.deadline,
      snapshotId,
      signature,
    ],
  );

  const settlement = await settlementEvents.applySettlementEvent({
    quoteId,
    quote,
    txHash,
    blockNumber: 100,
    logIndex: 0,
    settledAt: observedAt,
  });
  assert.equal(settlement.duplicate, false);
  assert.equal(await reconciliationWorker.runOnce(), true, "reconciliation worker must claim the settlement revision");

  const quoteStatus = await quoteRepository.findStatus(quoteId);
  const queuedHedge = await hedgeService.getHedgeIntentBySettlementEvent(settlement.event.settlementEventId);
  assert.equal(quoteStatus.status, "settled");
  assert.equal(quoteStatus.settlementEventId, settlement.event.settlementEventId);
  assert.equal(quoteStatus.hedgeOrderId, queuedHedge?.hedgeOrderId);
  assert.equal(queuedHedge?.status, "queued");
  assert.equal(queuedHedge?.side, "buy");
  assert.equal(queuedHedge?.token.toLowerCase(), baseToken.toLowerCase());
  assert.equal(queuedHedge?.amount, quote.amountOut);
  assert.equal((await inventory.getPosition(1, baseToken)).balance, -200000000000000000n);

  await symbolRules.checkHealth();
  const hedgeResult = await hedgeWorker.runOnce();
  assert.deepEqual(hedgeResult, { status: "filled", hedgeOrderId: queuedHedge.hedgeOrderId });
  assert.equal((await inventory.getPosition(1, baseToken)).balance, 0n);

  const feeResult = await feeWorker.runOnce();
  assert.deepEqual(feeResult, { status: "reconciled", hedgeOrderId: queuedHedge.hedgeOrderId });
  const finalHedge = await hedgeService.getHedgeIntent(queuedHedge.hedgeOrderId);
  assert.equal(finalHedge?.status, "filled");
  assert.equal(finalHedge?.venue, "binance");
  assert.equal(finalHedge?.venueSymbol, "BTCUSDT");
  assert.equal(finalHedge?.venueOrderId, "123");
  assert.equal(finalHedge?.filledAmount, quote.amountOut);
  assert.equal(normalizeDecimal(finalHedge?.executedQuoteQuantity), "18");
  assert.equal(finalHedge?.executionEvidenceVersion, "base-and-quote-v2");
  assert.equal(finalHedge?.feeReconciliationStatus, "complete");
  assert.equal(finalHedge?.commissionTotals?.[0]?.asset, "USDT");
  assert.equal(normalizeDecimal(finalHedge?.commissionTotals?.[0]?.quantity), "0.018");

  const persisted = await pool.query(
    `SELECT status, venue, venue_symbol, client_order_id, venue_order_id,
            execution_order_type, execution_time_in_force, execution_limit_price::text,
            execution_policy_version, execution_evidence_version,
            executed_quote_quantity::text, fee_reconciliation_status,
            hedge_net_pnl_status, hedge_commission_quote_quantity::text,
            hedge_net_pnl_quote_quantity::text
     FROM hedge_orders WHERE id = $1`,
    [queuedHedge.hedgeOrderId],
  );
  assert.equal(persisted.rows.length, 1);
  assert.deepEqual({
    status: persisted.rows[0].status,
    venue: persisted.rows[0].venue,
    symbol: persisted.rows[0].venue_symbol,
    venueOrderId: persisted.rows[0].venue_order_id,
    orderType: persisted.rows[0].execution_order_type,
    timeInForce: persisted.rows[0].execution_time_in_force,
    limitPrice: normalizeDecimal(persisted.rows[0].execution_limit_price),
    policy: persisted.rows[0].execution_policy_version,
    evidence: persisted.rows[0].execution_evidence_version,
    quoteQuantity: normalizeDecimal(persisted.rows[0].executed_quote_quantity),
    feeStatus: persisted.rows[0].fee_reconciliation_status,
    pnlStatus: persisted.rows[0].hedge_net_pnl_status,
    commission: normalizeDecimal(persisted.rows[0].hedge_commission_quote_quantity),
    netPnl: normalizeDecimal(persisted.rows[0].hedge_net_pnl_quote_quantity),
  }, {
    status: "filled",
    venue: "binance",
    symbol: "BTCUSDT",
    venueOrderId: "123",
    orderType: "LIMIT",
    timeInForce: "GTC",
    limitPrice: "90",
    policy: "bounded-limit-v1",
    evidence: "base-and-quote-v2",
    quoteQuantity: "18",
    feeStatus: "complete",
    pnlStatus: "complete",
    commission: "0.018",
    netPnl: "-0.018",
  });
  assert.match(persisted.rows[0].client_order_id, /^rfq_[0-9a-f]{32}$/);

  const fills = await pool.query(
    `SELECT venue, venue_symbol, venue_order_id, venue_trade_id,
            price::text, base_quantity::text, quote_quantity::text,
            commission_quantity::text, commission_asset, is_buyer, is_maker
     FROM hedge_execution_fills WHERE hedge_order_id = $1`,
    [queuedHedge.hedgeOrderId],
  );
  assert.equal(fills.rows.length, 1);
  assert.deepEqual({
    venue: fills.rows[0].venue,
    symbol: fills.rows[0].venue_symbol,
    orderId: fills.rows[0].venue_order_id,
    tradeId: fills.rows[0].venue_trade_id,
    price: normalizeDecimal(fills.rows[0].price),
    base: normalizeDecimal(fills.rows[0].base_quantity),
    quote: normalizeDecimal(fills.rows[0].quote_quantity),
    commission: normalizeDecimal(fills.rows[0].commission_quantity),
    commissionAsset: fills.rows[0].commission_asset,
    isBuyer: fills.rows[0].is_buyer,
    isMaker: fills.rows[0].is_maker,
  }, {
    venue: "binance",
    symbol: "BTCUSDT",
    orderId: "123",
    tradeId: "456",
    price: "90",
    base: "0.2",
    quote: "18",
    commission: "0.018",
    commissionAsset: "USDT",
    isBuyer: true,
    isMaker: false,
  });

  const pnl = await pnlService.summary(principalId);
  assert.equal(pnl.hedgeNet.completeTrades, 1);
  assert.deepEqual(pnl.hedgeNet.totals, [{
    chainId: 1,
    valuationToken: quoteToken.toLowerCase(),
    valuationAsset: "USDT",
    totalTrades: 1,
    netPnlQuoteQuantity: "-0.018",
  }]);
  assert.deepEqual(await hedgeWorker.runOnce(), { status: "idle" });
  assert.deepEqual(await feeWorker.runOnce(), { status: "idle" });

  process.stdout.write(`${JSON.stringify({
    status: "ok",
    quoteId,
    settlementEventId: settlement.event.settlementEventId,
    hedgeOrderId: queuedHedge.hedgeOrderId,
    execution: "filled",
    feeReconciliation: "complete",
    hedgeNetPnlQuoteQuantity: "-0.018",
  }, null, 2)}\n`);
} finally {
  try {
    if (fixtureMayExist) await cleanupFixtures();
  } finally {
    await endPool();
  }
}

async function assertDatabaseReadyAndIdle() {
  const migrations = await pool.query("SELECT version FROM _migrations ORDER BY version");
  assert.equal(migrations.rows.some((row) => row.version === "029"), true, "migration 029 must be applied");
  const pending = await pool.query(
    `SELECT
       (SELECT COUNT(*)::text FROM post_trade_reconciliation_jobs
        WHERE processed_revision < desired_revision AND next_attempt_at <= now()) AS reconciliation_jobs,
       (SELECT COUNT(*)::text FROM hedge_orders
        WHERE status = 'queued' AND next_attempt_at <= now()
          AND (lease_expires_at IS NULL OR lease_expires_at <= now())) AS hedge_jobs,
       (SELECT COUNT(*)::text FROM hedge_orders
        WHERE fee_reconciliation_status = 'pending' AND fee_next_attempt_at <= now()
          AND (fee_lease_expires_at IS NULL OR fee_lease_expires_at <= now())) AS fee_jobs`,
  );
  assert.deepEqual(pending.rows[0], {
    reconciliation_jobs: "0",
    hedge_jobs: "0",
    fee_jobs: "0",
  }, "hedge worker E2E requires a database without unrelated due jobs");
}

async function cleanupFixtures() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const aggregateRows = await client.query(
      `SELECT id FROM hedge_orders WHERE quote_id = $1
       UNION SELECT id FROM pnl_records WHERE quote_id = $1
       UNION SELECT id FROM settlement_events WHERE quote_id = $1`,
      [quoteId],
    );
    const inventoryRows = await client.query(
      "SELECT id FROM inventory_positions WHERE chain_id = 1 AND lower(token_address) = ANY($1::text[])",
      [[quoteToken.toLowerCase(), baseToken.toLowerCase()]],
    );
    await client.query(
      `UPDATE quotes SET status = 'signed', tx_hash = NULL, settlement_event_id = NULL,
         hedge_order_id = NULL, pnl_id = NULL WHERE id = $1`,
      [quoteId],
    );
    await client.query("DELETE FROM post_trade_reconciliation_jobs WHERE quote_id = $1", [quoteId]);
    await client.query(
      "DELETE FROM toxic_flow_markout_jobs WHERE settlement_event_id IN (SELECT id FROM settlement_events WHERE quote_id = $1)",
      [quoteId],
    );
    await client.query("DELETE FROM toxic_flow_markouts WHERE quote_id = $1", [quoteId]);
    await client.query("DELETE FROM hedge_orders WHERE quote_id = $1", [quoteId]);
    await client.query("DELETE FROM pnl_records WHERE quote_id = $1", [quoteId]);
    await client.query("DELETE FROM settlement_events WHERE quote_id = $1", [quoteId]);
    await client.query(
      "DELETE FROM inventory_positions WHERE chain_id = 1 AND lower(token_address) = ANY($1::text[])",
      [[quoteToken.toLowerCase(), baseToken.toLowerCase()]],
    );
    await client.query("DELETE FROM quotes WHERE id = $1", [quoteId]);
    await client.query("DELETE FROM market_snapshots WHERE id = $1", [snapshotId]);
    const aggregateIds = [
      quoteId,
      snapshotId,
      ...aggregateRows.rows.map((row) => row.id),
      ...inventoryRows.rows.map((row) => row.id),
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

function normalizeDecimal(value) {
  assert.equal(typeof value, "string", "decimal evidence must be a string");
  assert.match(value, /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/);
  const [integer, fraction = ""] = value.split(".");
  const normalizedFraction = fraction.replace(/0+$/, "");
  return normalizedFraction.length === 0 ? integer : `${integer}.${normalizedFraction}`;
}

function assertLoopbackDatabase(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("DATABASE_URL must be a valid PostgreSQL URL");
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error("DATABASE_URL must use postgres or postgresql");
  }
  if (!new Set(["localhost", "127.0.0.1", "::1"]).has(url.hostname)) {
    throw new Error("Hedge worker E2E only permits a loopback PostgreSQL database");
  }
}
