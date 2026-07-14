import assert from "node:assert/strict";
import test from "node:test";
import { MetricsService } from "../dist/modules/metrics/metrics.service.js";

const token = "0x0000000000000000000000000000000000000003";
const quoteSnapshotPnlModelDescription =
  "Gross settlement PnL in tokenOut base units versus the persisted quote-time mid price, excluding fees, gas, and hedge execution";
const pnlTradeRecord = {
  pnlId: "pnl_q_1",
  quoteId: "q_1",
  settlementEventId: "se_q_1",
  snapshotId: "snapshot_q_1",
  chainId: 1,
  user: "0x0000000000000000000000000000000000000001",
  tokenIn: "0x0000000000000000000000000000000000000002",
  tokenOut: token,
  amountIn: "1000000000",
  amountOut: "998400000",
  minAmountOut: "995000000",
  nonce: "1",
  deadline: 1893456000,
  midPrice: "1",
  tokenInDecimals: 18,
  tokenOutDecimals: 18,
  fairAmountOut: "1000000000",
  valuationObservedAt: "2026-06-28T23:59:59.000Z",
  grossPnlTokenOut: "1600000",
  grossPnlBps: 16,
  model: "quote_snapshot_edge_v1",
  modelDescription: quoteSnapshotPnlModelDescription,
  realizedAt: "2026-06-29T00:00:00.000Z",
};
const readinessResponse = {
  status: "degraded",
  components: {
    marketData: "ok",
    marketSnapshotStore: "ok",
    routing: "ok",
    pricing: "ok",
    risk: "ok",
    signer: "degraded",
    quoteRepository: "ok",
    quoteControl: "ok",
    riskDecisionStore: "ok",
    rateLimitStore: "ok",
    inventory: "ok",
    execution: "ok",
    settlementEventStore: "ok",
    pnl: "ok",
    metrics: "ok",
  },
};

test("MetricsService renders fixed readiness and dependency labels", () => {
  const metrics = new MetricsService();
  metrics.recordReadiness(readinessResponse);

  const output = metrics.renderPrometheus();

  assert.match(output, /rfq_readiness_status\{status="ready"\} 0/);
  assert.match(output, /rfq_readiness_status\{status="degraded"\} 1/);
  assert.match(output, /rfq_dependency_status\{component="signer",status="degraded"\} 1/);
  assert.match(output, /rfq_dependency_status\{component="marketData",status="ok"\} 1/);
  assert.match(output, /rfq_dependency_status\{component="marketSnapshotStore",status="ok"\} 1/);
  assert.match(output, /rfq_dependency_status\{component="quoteControl",status="ok"\} 1/);
  assert.match(output, /rfq_dependency_status\{component="riskDecisionStore",status="ok"\} 1/);
  assert.match(output, /rfq_dependency_status\{component="rateLimitStore",status="ok"\} 1/);
  assert.match(output, /rfq_dependency_status\{component="settlementEventStore",status="ok"\} 1/);
});
test("MetricsService sanitizes reason labels and renders core settlement metrics", () => {
  const metrics = new MetricsService();

  metrics.recordQuoteRejection("toxic flow/user");
  metrics.recordHedgeIntentError("venue offline\nretry");
  metrics.recordPnlRecordError("");
  metrics.recordQuoteStatusUpdateError("settled");
  metrics.recordSignerRequest("sign");
  metrics.recordSignerLatency("sign", 0.0123);
  metrics.recordSubmitLatency(-1);
  metrics.recordInventoryPosition({
    chainId: 1,
    token,
    balance: -998400000n,
  });
  metrics.recordPnlTrade(pnlTradeRecord);
  metrics.recordQuoteControlState(true);
  metrics.recordPausedQuotePairCount(2);
  metrics.recordQuoteControlUpdate();
  metrics.recordQuoteControlError("read");

  const output = metrics.renderPrometheus();

  assert.match(output, /rfq_quote_rejections_total\{reason="TOXIC_FLOW_USER"\} 1/);
  assert.match(output, /rfq_hedge_intent_errors_total\{reason="VENUE_OFFLINE_RETRY"\} 1/);
  assert.match(output, /rfq_pnl_record_errors_total\{reason="UNKNOWN"\} 1/);
  assert.match(output, /rfq_quote_status_update_errors_total\{target_status="SETTLED"\} 1/);
  assert.match(output, /rfq_signer_requests_total\{operation="sign"\} 1/);
  assert.match(output, /rfq_signer_latency_seconds_count\{operation="sign"\} 1/);
  assert.match(output, /rfq_submit_latency_seconds_sum 0/);
  assert.match(output, /rfq_inventory_balance\{chain_id="1",token="0x0000000000000000000000000000000000000003"\} -998400000/);
  assert.match(output, /rfq_pnl_trades_total 1/);
  assert.match(output, /rfq_realized_pnl_token_out\{chain_id="1",token="0x0000000000000000000000000000000000000003"\} 1600000/);
  assert.match(output, /rfq_quote_paused 1/);
  assert.match(output, /rfq_quote_pairs_paused 2/);
  assert.match(output, /rfq_quote_control_updates_total 1/);
  assert.match(output, /rfq_quote_control_errors_total\{operation="read"\} 1/);
});

test("MetricsService snapshots inventory positions before storing gauges", () => {
  const metrics = new MetricsService();
  const position = {
    chainId: 1,
    token,
    balance: -998400000n,
  };

  metrics.recordInventoryPosition(position);
  position.chainId = 2;
  position.token = "0x0000000000000000000000000000000000000004";
  position.balance = 123n;

  const output = metrics.renderPrometheus();

  assert.match(output, /rfq_inventory_balance\{chain_id="1",token="0x0000000000000000000000000000000000000003"\} -998400000/);
  assert.doesNotMatch(output, /rfq_inventory_balance\{chain_id="2",token="0x0000000000000000000000000000000000000004"\} 123/);
});

test("MetricsService exposes bounded CEX order book health", () => {
  const metrics = new MetricsService();
  metrics.recordCexOrderBookCycle({
    configuredSources: 3,
    readySources: 1,
    staleSources: 1,
    unavailableSources: 1,
    usablePairs: 1,
    blockedPairs: 2,
    deviationRejectedSources: 1,
    maxUpdateAgeSeconds: 2.5,
  });
  metrics.recordCexOrderBookConnectorError("binance");

  const output = metrics.renderPrometheus();
  assert.match(output, /rfq_cex_order_book_sources\{state="ready"\} 1/);
  assert.match(output, /rfq_cex_order_book_sources\{state="stale"\} 1/);
  assert.match(output, /rfq_cex_order_book_sources\{state="unavailable"\} 1/);
  assert.match(output, /rfq_cex_order_book_pairs\{state="blocked"\} 2/);
  assert.match(output, /rfq_cex_order_book_deviation_rejected_sources 1/);
  assert.match(output, /rfq_cex_order_book_max_update_age_seconds 2.5/);
  assert.match(output, /rfq_cex_order_book_connector_errors_total\{exchange="binance"\} 1/);
  assert.match(output, /rfq_cex_order_book_connector_errors_total\{exchange="coinbase"\} 0/);

  assert.throws(
    () => metrics.recordCexOrderBookCycle({
      configuredSources: 2,
      readySources: 1,
      staleSources: 0,
      unavailableSources: 0,
      usablePairs: 1,
      blockedPairs: 0,
      deviationRejectedSources: 0,
      maxUpdateAgeSeconds: 0,
    }),
    /must sum to configuredSources/,
  );
  assert.throws(() => metrics.recordCexOrderBookConnectorError("kraken"), /binance or coinbase/);
});
