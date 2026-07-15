import assert from "node:assert/strict";
import test from "node:test";
import { buildServer } from "../dist/main.js";

const baseQuoteRequest = {
  chainId: 1,
  user: "0x0000000000000000000000000000000000000001",
  tokenIn: "0x0000000000000000000000000000000000000002",
  tokenOut: "0x0000000000000000000000000000000000000003",
  amountIn: "1000000000",
  slippageBps: 50,
};
const quoteSnapshotPnlModelDescription =
  "Gross settlement PnL in tokenOut base units versus the persisted quote-time mid price, excluding fees, gas, and hedge execution";

test("RFQ API accepts quote, submit, status, and metrics flow", async () => {
  const server = buildServer({ logger: false });
  await server.ready();

  try {
    const health = await injectJson(server, "GET", "/health");
    assert.equal(health.statusCode, 200);
    assertTraceHeader(health);
    assertResponseFields(health.body, ["status"]);
    assert.equal(health.body.status, "ok");

    const ready = await injectJson(server, "GET", "/ready");
    assert.equal(ready.statusCode, 200);
    assertTraceHeader(ready);
    assertResponseFields(ready.body, ["status", "components"]);
    assertResponseFields(ready.body.components, [
      "marketData",
      "marketSnapshotStore",
      "routing",
      "pricing",
      "risk",
      "signer",
      "quoteRepository",
      "quoteControl",
      "riskDecisionStore",
      "rateLimitStore",
      "inventory",
      "execution",
      "settlementEventStore",
      "pnl",
      "metrics",
    ]);
    assert.equal(ready.body.status, "ready");
    assert.equal(ready.body.components.signer, "ok");
    assert.equal(ready.body.components.marketData, "ok");
    assert.equal(ready.body.components.routing, "ok");
    assert.equal(ready.body.components.pricing, "ok");
    assert.equal(ready.body.components.risk, "ok");
    assert.equal(ready.body.components.marketSnapshotStore, "ok");
    assert.equal(ready.body.components.quoteRepository, "ok");
    assert.equal(ready.body.components.riskDecisionStore, "ok");
    assert.equal(ready.body.components.rateLimitStore, "ok");
    assert.equal(ready.body.components.inventory, "ok");
    assert.equal(ready.body.components.execution, "ok");
    assert.equal(ready.body.components.settlementEventStore, "ok");
    assert.equal(ready.body.components.pnl, "ok");
    assert.equal(ready.body.components.metrics, "ok");

    const quote = await injectJson(server, "POST", "/quote", baseQuoteRequest);
    assert.equal(quote.statusCode, 200);
    assertTraceHeader(quote);
    assertResponseFields(quote.body, ["quoteId", "snapshotId", "amountOut", "minAmountOut", "deadline", "nonce", "signature"]);
    assert.match(quote.body.quoteId, /^q_/);
    assert.equal(quote.body.amountOut, "998400000");
    assert.equal(quote.body.minAmountOut, "993408000");
    assert.match(quote.body.signature, /^0x[0-9a-fA-F]{130}$/);

    const submit = await injectJson(server, "POST", "/submit", {
      quote: {
        user: baseQuoteRequest.user,
        tokenIn: baseQuoteRequest.tokenIn,
        tokenOut: baseQuoteRequest.tokenOut,
        amountIn: baseQuoteRequest.amountIn,
        amountOut: quote.body.amountOut,
        minAmountOut: quote.body.minAmountOut,
        nonce: quote.body.nonce,
        deadline: quote.body.deadline,
        chainId: baseQuoteRequest.chainId,
      },
      signature: uppercaseHex(quote.body.signature),
    });
    assert.equal(submit.statusCode, 202);
    assertTraceHeader(submit);
    assertResponseFields(submit.body, ["status", "txHash", "settlementEventId", "hedgeOrderId", "pnlId"]);
    assert.equal(submit.body.status, "accepted");
    assert.match(submit.body.txHash, /^0x[0-9a-fA-F]{64}$/);
    assert.match(submit.body.settlementEventId, /^se_/);
    assert.match(submit.body.hedgeOrderId, /^h_/);
    assert.equal(submit.body.pnlId, `pnl_${quote.body.quoteId}`);

    const status = await injectJson(server, "GET", `/quote/${quote.body.quoteId}`);
    assert.equal(status.statusCode, 200);
    assertTraceHeader(status);
    assertResponseFields(status.body, [
      "quoteId",
      "status",
      "snapshotId",
      "deadline",
      "txHash",
      "settlementEventId",
      "hedgeOrderId",
      "pnlId",
    ]);
    assert.equal(status.body.quoteId, quote.body.quoteId);
    assert.equal(status.body.snapshotId, quote.body.snapshotId);
    assert.equal(status.body.deadline, quote.body.deadline);
    assert.equal(status.body.status, "settled");
    assert.equal(status.body.txHash, submit.body.txHash);
    assert.equal(status.body.settlementEventId, submit.body.settlementEventId);
    assert.equal(status.body.hedgeOrderId, submit.body.hedgeOrderId);
    assert.equal(status.body.pnlId, submit.body.pnlId);

    const settlement = await injectJson(server, "GET", `/settlements/${submit.body.settlementEventId}`);
    assert.equal(settlement.statusCode, 200);
    assertTraceHeader(settlement);
    assertResponseFields(settlement.body, [
      "settlementEventId",
      "status",
      "quoteId",
      "chainId",
      "txHash",
      "quoteHash",
      "blockNumber",
      "logIndex",
      "user",
      "tokenIn",
      "tokenOut",
      "amountIn",
      "amountOut",
      "nonce",
      "observedAt",
    ]);
    assert.equal(settlement.body.settlementEventId, submit.body.settlementEventId);
    assert.equal(settlement.body.status, "applied");
    assert.equal(settlement.body.quoteId, quote.body.quoteId);
    assert.equal(settlement.body.chainId, baseQuoteRequest.chainId);
    assert.equal(settlement.body.txHash, submit.body.txHash);
    assert.match(settlement.body.quoteHash, /^0x[0-9a-fA-F]{64}$/);
    assert.equal(settlement.body.blockNumber, 0);
    assert.equal(settlement.body.logIndex, 0);
    assert.equal(settlement.body.user, baseQuoteRequest.user);
    assert.equal(settlement.body.tokenIn, baseQuoteRequest.tokenIn);
    assert.equal(settlement.body.tokenOut, baseQuoteRequest.tokenOut);
    assert.equal(settlement.body.amountIn, baseQuoteRequest.amountIn);
    assert.equal(settlement.body.amountOut, quote.body.amountOut);
    assert.equal(settlement.body.nonce, quote.body.nonce);
    assert.match(settlement.body.observedAt, /^\d{4}-\d{2}-\d{2}T/);

    const hedge = await injectJson(server, "GET", `/hedges/${submit.body.hedgeOrderId}`);
    assert.equal(hedge.statusCode, 200);
    assertTraceHeader(hedge);
    assertResponseFields(hedge.body, [
      "hedgeOrderId",
      "status",
      "settlementEventId",
      "quoteId",
      "chainId",
      "token",
      "side",
      "amount",
      "reason",
      "createdAt",
    ]);
    assert.equal(hedge.body.hedgeOrderId, submit.body.hedgeOrderId);
    assert.equal(hedge.body.status, "queued");
    assert.equal(hedge.body.settlementEventId, submit.body.settlementEventId);
    assert.equal(hedge.body.quoteId, quote.body.quoteId);
    assert.equal(hedge.body.chainId, baseQuoteRequest.chainId);
    assert.equal(hedge.body.token, baseQuoteRequest.tokenIn);
    assert.equal(hedge.body.side, "sell");
    assert.equal(hedge.body.amount, baseQuoteRequest.amountIn);
    assert.equal(hedge.body.reason, "inventory_rebalance");
    assert.match(hedge.body.createdAt, /^\d{4}-\d{2}-\d{2}T/);

    const pnl = await injectJson(server, "GET", "/pnl");
    assert.equal(pnl.statusCode, 200);
    assertTraceHeader(pnl);
    assertResponseFields(pnl.body, ["status", "totalTrades", "totals", "trades", "hedgeNet"]);
    assert.equal(pnl.body.status, "ok");
    assert.equal(pnl.body.totalTrades, 1);
    assert.deepEqual(pnl.body.totals, [{
      chainId: baseQuoteRequest.chainId,
      tokenOut: baseQuoteRequest.tokenOut,
      totalTrades: 1,
      grossPnlTokenOut: "1600000",
    }]);
    assert.equal(pnl.body.trades.length, 1);
    assert.equal(pnl.body.hedgeNet.totalTrades, 1);
    assert.equal(pnl.body.hedgeNet.unavailableTrades, 1);
    assert.equal(pnl.body.hedgeNet.records[0].reasonCode, "HEDGE_EVIDENCE_MISSING");
    assertResponseFields(pnl.body.trades[0], [
      "pnlId",
      "quoteId",
      "settlementEventId",
      "snapshotId",
      "chainId",
      "user",
      "tokenIn",
      "tokenOut",
      "amountIn",
      "amountOut",
      "minAmountOut",
      "nonce",
      "deadline",
      "midPrice",
      "tokenInDecimals",
      "tokenOutDecimals",
      "fairAmountOut",
      "valuationObservedAt",
      "grossPnlTokenOut",
      "grossPnlBps",
      "model",
      "modelDescription",
      "realizedAt",
    ]);
    assert.equal(pnl.body.trades[0].pnlId, submit.body.pnlId);
    assert.equal(pnl.body.trades[0].quoteId, quote.body.quoteId);
    assert.equal(pnl.body.trades[0].settlementEventId, submit.body.settlementEventId);
    assert.equal(pnl.body.trades[0].snapshotId, quote.body.snapshotId);
    assert.equal(pnl.body.trades[0].amountIn, baseQuoteRequest.amountIn);
    assert.equal(pnl.body.trades[0].amountOut, quote.body.amountOut);
    assert.equal(pnl.body.trades[0].midPrice, "1");
    assert.equal(pnl.body.trades[0].tokenInDecimals, 18);
    assert.equal(pnl.body.trades[0].tokenOutDecimals, 18);
    assert.equal(pnl.body.trades[0].fairAmountOut, baseQuoteRequest.amountIn);
    assert.equal(pnl.body.trades[0].grossPnlTokenOut, "1600000");
    assert.equal(pnl.body.trades[0].grossPnlBps, 16);
    assert.equal(pnl.body.trades[0].model, "quote_snapshot_edge_v1");
    assert.equal(pnl.body.trades[0].modelDescription, quoteSnapshotPnlModelDescription);
    assert.match(pnl.body.trades[0].valuationObservedAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.match(pnl.body.trades[0].realizedAt, /^\d{4}-\d{2}-\d{2}T/);

    const metrics = await server.inject({ method: "GET", url: "/metrics" });
    assert.equal(metrics.statusCode, 200);
    assertTraceHeader(metrics);
    assert.match(metrics.payload, /rfq_readiness_status\{status="ready"\} 1/);
    assert.match(metrics.payload, /rfq_readiness_status\{status="degraded"\} 0/);
    assert.match(metrics.payload, /rfq_dependency_status\{component="marketData",status="ok"\} 1/);
    assert.match(metrics.payload, /rfq_dependency_status\{component="signer",status="ok"\} 1/);
    assert.match(metrics.payload, /rfq_quote_requests_total 1/);
    assert.match(metrics.payload, /rfq_quote_latency_seconds_count 1/);
    assert.match(metrics.payload, /rfq_quote_latency_seconds_bucket\{le="\+Inf"\} 1/);
    assert.match(metrics.payload, /rfq_signer_requests_total\{operation="sign"\} 1/);
    assert.match(metrics.payload, /rfq_signer_requests_total\{operation="verify"\} 1/);
    assert.match(metrics.payload, /rfq_signer_errors_total\{operation="sign"\} 0/);
    assert.match(metrics.payload, /rfq_signer_latency_seconds_count\{operation="sign"\} 1/);
    assert.match(metrics.payload, /rfq_signer_latency_seconds_count\{operation="verify"\} 1/);
    assert.match(metrics.payload, /rfq_submit_accepted_total 1/);
    assert.match(metrics.payload, /rfq_submit_latency_seconds_count 1/);
    assert.match(metrics.payload, /rfq_submit_latency_seconds_bucket\{le="\+Inf"\} 1/);
    assert.match(metrics.payload, /rfq_settlements_total 1/);
    assert.match(metrics.payload, /rfq_hedge_intents_total 1/);
    assert.match(metrics.payload, /rfq_hedge_lag_seconds_count 1/);
    assert.match(metrics.payload, /rfq_hedge_lag_seconds_bucket\{le="\+Inf"\} 1/);
    assert.match(
      metrics.payload,
      new RegExp(`rfq_inventory_balance\\{chain_id="1",token="${baseQuoteRequest.tokenIn}"\\} ${baseQuoteRequest.amountIn}`),
    );
    assert.match(
      metrics.payload,
      new RegExp(`rfq_inventory_balance\\{chain_id="1",token="${baseQuoteRequest.tokenOut}"\\} -${quote.body.amountOut}`),
    );
    assert.match(metrics.payload, /rfq_pnl_trades_total 1/);
    assert.match(
      metrics.payload,
      new RegExp(`rfq_realized_pnl_token_out\\{chain_id="1",token="${baseQuoteRequest.tokenOut}"\\} 1600000`),
    );
  } finally {
    await server.close();
  }
});

async function injectJson(server, method, url, payload, headers = {}) {
  const requestHeaders = { ...headers };
  if (payload) {
    requestHeaders["content-type"] = "application/json";
  }

  const response = await server.inject({
    method,
    url,
    headers: Object.keys(requestHeaders).length > 0 ? requestHeaders : undefined,
    payload: payload ? JSON.stringify(payload) : undefined,
  });

  return {
    statusCode: response.statusCode,
    headers: response.headers,
    body: response.payload ? JSON.parse(response.payload) : undefined,
  };
}

function assertTraceHeader(response) {
  assert.match(String(response.headers["x-trace-id"]), /^tr_/);
}

function assertResponseFields(body, fields) {
  assert.deepEqual(Object.keys(body).sort(), [...fields].sort());
}

function uppercaseHex(value) {
  return `0x${value.slice(2).toUpperCase()}`;
}
