import assert from "node:assert/strict";
import test from "node:test";
import { MetricsService } from "../dist/modules/metrics/metrics.service.js";

const token = "0x0000000000000000000000000000000000000003";
const simulatedPnlModelDescription =
  "Simulated same-decimal quote attribution where grossPnlTokenOut equals amountIn minus amountOut and is not cross-token accounting PnL";
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
  modelDescription: simulatedPnlModelDescription,
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
      metrics.recordInventoryPosition({
        chainId: 1,
        token: new String(token),
        balance: 1n,
      }),
    /Metrics inventory token must be a 20-byte hex address/,
  );
  assert.throws(
    () =>
      metrics.recordInventoryPosition(
        Object.create({
          chainId: 1,
          token,
          balance: 1n,
        }),
      ),
    /Metrics inventory position.chainId must be an own field/,
  );
  assert.throws(
    () =>
      metrics.recordPnlTrade({
        ...pnlTradeRecord,
        pnlId: new String(pnlTradeRecord.pnlId),
      }),
    /Metrics PnL trade pnlId must be a primitive string/,
  );
  assert.throws(
    () => metrics.recordPnlTrade(Object.create(pnlTradeRecord)),
    /Metrics PnL trade record.pnlId must be an own field/,
  );
  assert.throws(
    () =>
      metrics.recordPnlTrade({
        ...pnlTradeRecord,
        pnlId: "pnl.bad",
      }),
    /Metrics PnL trade pnlId must contain only letters, numbers, underscore, colon, or hyphen/,
  );
  assert.throws(
    () =>
      metrics.recordPnlTrade({
        ...pnlTradeRecord,
        pnlId: "p".repeat(129),
      }),
    /Metrics PnL trade pnlId must be 128 characters or fewer/,
  );
  assert.throws(
    () =>
      metrics.recordPnlTrade({
        ...pnlTradeRecord,
        quoteId: new String(pnlTradeRecord.quoteId),
      }),
    /Metrics PnL trade quoteId must be a primitive string/,
  );
  assert.throws(
    () =>
      metrics.recordPnlTrade({
        ...pnlTradeRecord,
        quoteId: "q/bad",
      }),
    /Metrics PnL trade quoteId must contain only letters, numbers, underscore, colon, or hyphen/,
  );
  assert.throws(
    () =>
      metrics.recordPnlTrade({
        ...pnlTradeRecord,
        quoteId: "q".repeat(129),
      }),
    /Metrics PnL trade quoteId must be 128 characters or fewer/,
  );
  assert.throws(
    () =>
      metrics.recordPnlTrade({
        ...pnlTradeRecord,
        user: new String(pnlTradeRecord.user),
      }),
    /Metrics PnL trade user must be a 20-byte hex address/,
  );
  assert.throws(
    () =>
      metrics.recordPnlTrade({
        ...pnlTradeRecord,
        tokenIn: new String(pnlTradeRecord.tokenIn),
      }),
    /Metrics PnL trade tokenIn must be a 20-byte hex address/,
  );
  assert.throws(
    () =>
      metrics.recordPnlTrade({
        ...pnlTradeRecord,
        amountIn: "0100000000",
      }),
    /Metrics PnL trade amountIn must be a positive uint string/,
  );
  assert.throws(
    () =>
      metrics.recordPnlTrade({
        ...pnlTradeRecord,
        nonce: "01",
      }),
    /Metrics PnL trade nonce must be a positive uint string/,
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
        grossPnlTokenOut: "01600000",
      }),
    /Metrics PnL trade grossPnlTokenOut must be an int string/,
  );
  assert.throws(
    () =>
      metrics.recordPnlTrade({
        ...pnlTradeRecord,
        grossPnlTokenOut: "-0",
      }),
    /Metrics PnL trade grossPnlTokenOut must be an int string/,
  );
  assert.throws(
    () =>
      metrics.recordPnlTrade({
        ...pnlTradeRecord,
        grossPnlTokenOut: new String("1600000"),
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
  assert.throws(
    () =>
      metrics.recordPnlTrade({
        ...pnlTradeRecord,
        modelDescription: "unsupported PnL model",
      }),
    /Metrics PnL trade modelDescription must describe simulated_mid_price_v1/,
  );
  assert.throws(
    () =>
      metrics.recordPnlTrade({
        ...pnlTradeRecord,
        realizedAt: "2026-06-29",
      }),
    /Metrics PnL trade realizedAt must be a canonical UTC ISO timestamp/,
  );
  assert.throws(
    () =>
      metrics.recordPnlTrade({
        ...pnlTradeRecord,
        realizedAt: "June 29, 2026",
      }),
    /Metrics PnL trade realizedAt must be a canonical UTC ISO timestamp/,
  );
  assert.throws(
    () =>
      metrics.recordPnlTrade({
        ...pnlTradeRecord,
        realizedAt: "2026-02-31T00:00:00.000Z",
      }),
    /Metrics PnL trade realizedAt must be a canonical UTC ISO timestamp/,
  );

  const output = metrics.renderPrometheus();

  assert.match(output, /rfq_inventory_balance/);
  assert.doesNotMatch(output, /rfq_inventory_balance\{chain_id="1",token="0x1234"\}/);
  assert.match(output, /rfq_pnl_trades_total 0/);
  assert.doesNotMatch(output, /rfq_realized_pnl_token_out\{chain_id="1",token="0x0000000000000000000000000000000000000003"\}/);
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
    () => metrics.recordReadiness(Object.create(readinessResponse)),
    /Metrics readiness.status must be an own field/,
  );
  assert.throws(
    () =>
      metrics.recordReadiness({
        status: "degraded",
        components: Object.create(readinessResponse.components),
      }),
    /Metrics readiness components.marketData must be an own field/,
  );
  assert.throws(
    () => {
      const { signer, ...components } = readinessResponse.components;
      metrics.recordReadiness({
        ...readinessResponse,
        components,
      });
    },
    /Metrics readiness components.signer must be an own field/,
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
