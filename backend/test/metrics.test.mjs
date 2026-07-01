import assert from "node:assert/strict";
import test from "node:test";
import { MetricsService } from "../dist/modules/metrics/metrics.service.js";

const token = "0x0000000000000000000000000000000000000003";
const pnlTradeRecord = {
  pnlId: "pnl_q_1",
  quoteId: "q_1",
  chainId: 1,
  user: "0x0000000000000000000000000000000000000001",
  tokenIn: "0x0000000000000000000000000000000000000002",
  tokenOut: token,
  amountIn: "1000000000",
  amountOut: "998400000",
  minAmountOut: "995000000",
  nonce: "1",
  deadline: 1893456000,
  grossPnlTokenOut: "1600000",
  grossPnlBps: 16,
  model: "simulated_mid_price_v1",
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
    riskDecisionStore: "ok",
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
  assert.match(output, /rfq_dependency_status\{component="riskDecisionStore",status="ok"\} 1/);
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

test("MetricsService validates inventory and PnL metric inputs before mutating state", () => {
  const metrics = new MetricsService();

  assert.throws(
    () =>
      metrics.recordInventoryPosition({
        chainId: 1,
        token: "0x1234",
        balance: 1n,
      }),
    /Metrics inventory token must be a 20-byte hex address/,
  );
  assert.throws(
    () =>
      metrics.recordPnlTrade({
        ...pnlTradeRecord,
        grossPnlTokenOut: "not-an-int",
      }),
    /Metrics PnL trade grossPnlTokenOut must be an int string/,
  );
  assert.throws(
    () =>
      metrics.recordPnlTrade({
        ...pnlTradeRecord,
        minAmountOut: "999000000",
      }),
    /Metrics PnL trade amountOut must be greater than or equal to minAmountOut/,
  );

  const output = metrics.renderPrometheus();

  assert.match(output, /rfq_inventory_balance/);
  assert.doesNotMatch(output, /rfq_inventory_balance\{chain_id="1",token="0x1234"\}/);
  assert.match(output, /rfq_pnl_trades_total 0/);
  assert.doesNotMatch(output, /rfq_realized_pnl_token_out\{chain_id="1",token="0x0000000000000000000000000000000000000003"\}/);
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

test("MetricsService rejects unsupported fixed-label inputs before mutating state", () => {
  const metrics = new MetricsService();

  assert.throws(
    () => metrics.recordRateLimited("metrics"),
    /Metrics rate-limited endpoint must be quote, submit, or status/,
  );
  assert.throws(
    () => metrics.recordSignerRequest("rotate"),
    /Metrics signer operation must be sign or verify/,
  );
  assert.throws(
    () => metrics.recordSignerLatency("rotate", 0.1),
    /Metrics signer operation must be sign or verify/,
  );
  assert.throws(
    () =>
      metrics.recordReadiness({
        ...readinessResponse,
        status: "unknown",
      }),
    /Metrics readiness status must be ready or degraded/,
  );
  assert.throws(
    () => {
      const { signer, ...components } = readinessResponse.components;
      metrics.recordReadiness({
        ...readinessResponse,
        components,
      });
    },
    /Metrics readiness component signer must be ok or degraded/,
  );
  assert.throws(
    () =>
      metrics.recordReadiness({
        ...readinessResponse,
        components: {
          ...readinessResponse.components,
          externalUrl: "ok",
        },
      }),
    /Metrics readiness component externalUrl is not supported/,
  );

  const output = metrics.renderPrometheus();

  assert.match(output, /rfq_rate_limited_total\{endpoint="quote"\} 0/);
  assert.match(output, /rfq_rate_limited_total\{endpoint="submit"\} 0/);
  assert.match(output, /rfq_rate_limited_total\{endpoint="status"\} 0/);
  assert.match(output, /rfq_signer_requests_total\{operation="sign"\} 0/);
  assert.match(output, /rfq_signer_latency_seconds_count\{operation="sign"\} 0/);
  assert.match(output, /rfq_readiness_status\{status="ready"\} 0/);
  assert.match(output, /rfq_readiness_status\{status="degraded"\} 0/);
  assert.match(output, /rfq_dependency_status\{component="signer",status="ok"\} 0/);
  assert.match(output, /rfq_dependency_status\{component="signer",status="degraded"\} 0/);
});

test("MetricsService rejects non-string dynamic label values before mutating state", () => {
  const metrics = new MetricsService();

  assert.throws(
    () => metrics.recordQuoteRejection(null),
    /Metrics label value must be a string/,
  );
  assert.throws(
    () => metrics.recordHedgeIntentError([]),
    /Metrics label value must be a string/,
  );
  assert.throws(
    () => metrics.recordQuoteStatusUpdateError({}),
    /Metrics label value must be a string/,
  );
  assert.throws(
    () => metrics.recordPnlRecordError(undefined),
    /Metrics label value must be a string/,
  );

  const output = metrics.renderPrometheus();

  assert.doesNotMatch(output, /rfq_quote_rejections_total\{reason=/);
  assert.doesNotMatch(output, /rfq_hedge_intent_errors_total\{reason=/);
  assert.doesNotMatch(output, /rfq_quote_status_update_errors_total\{target_status=/);
  assert.doesNotMatch(output, /rfq_pnl_record_errors_total\{reason=/);
});

test("MetricsService rejects non-finite histogram observations before mutating state", () => {
  const metrics = new MetricsService();

  assert.throws(
    () => metrics.recordQuoteLatency(Number.NaN),
    /Metrics histogram observation must be a finite number/,
  );
  assert.throws(
    () => metrics.recordSubmitLatency(Number.POSITIVE_INFINITY),
    /Metrics histogram observation must be a finite number/,
  );
  assert.throws(
    () => metrics.recordSignerLatency("sign", Number.NEGATIVE_INFINITY),
    /Metrics histogram observation must be a finite number/,
  );
  assert.throws(
    () => metrics.recordHedgeLag(Number.NaN),
    /Metrics histogram observation must be a finite number/,
  );

  const output = metrics.renderPrometheus();

  assert.match(output, /rfq_quote_latency_seconds_sum 0/);
  assert.match(output, /rfq_quote_latency_seconds_count 0/);
  assert.match(output, /rfq_submit_latency_seconds_sum 0/);
  assert.match(output, /rfq_submit_latency_seconds_count 0/);
  assert.match(output, /rfq_signer_latency_seconds_sum\{operation="sign"\} 0/);
  assert.match(output, /rfq_signer_latency_seconds_count\{operation="sign"\} 0/);
  assert.match(output, /rfq_hedge_lag_seconds_sum 0/);
  assert.match(output, /rfq_hedge_lag_seconds_count 0/);
  assert.doesNotMatch(output, /NaN|Infinity/);
});
