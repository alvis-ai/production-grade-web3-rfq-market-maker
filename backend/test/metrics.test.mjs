import assert from "node:assert/strict";
import test from "node:test";
import { MetricsService } from "../dist/modules/metrics/metrics.service.js";

const token = "0x0000000000000000000000000000000000000003";

test("MetricsService renders fixed readiness and dependency labels", () => {
  const metrics = new MetricsService();
  metrics.recordReadiness({
    status: "degraded",
    components: {
      marketData: "ok",
      routing: "ok",
      pricing: "ok",
      risk: "ok",
      signer: "degraded",
      quoteRepository: "ok",
      inventory: "ok",
      execution: "ok",
      settlementEventStore: "ok",
      pnl: "ok",
      metrics: "ok",
    },
  });

  const output = metrics.renderPrometheus();

  assert.match(output, /rfq_readiness_status\{status="ready"\} 0/);
  assert.match(output, /rfq_readiness_status\{status="degraded"\} 1/);
  assert.match(output, /rfq_dependency_status\{component="signer",status="degraded"\} 1/);
  assert.match(output, /rfq_dependency_status\{component="marketData",status="ok"\} 1/);
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
  metrics.recordPnlTrade({
    pnlId: "pnl_q_1",
    quoteId: "q_1",
    chainId: 1,
    tokenIn: "0x0000000000000000000000000000000000000002",
    tokenOut: token,
    amountIn: "1000000000",
    amountOut: "998400000",
    grossPnlTokenOut: "1600000",
    grossPnlBps: 16,
    model: "simulated_mid_price_v1",
    realizedAt: "2026-06-29T00:00:00.000Z",
  });

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
});
