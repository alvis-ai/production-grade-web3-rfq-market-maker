import assert from "node:assert/strict";
import test from "node:test";
import {
  RFQClient,
  hedgeFillNetPnlModelDescription,
  quoteSnapshotPnlModelDescription,
} from "../dist/index.js";

const quote = {
  user: "0x0000000000000000000000000000000000000001",
  tokenIn: "0x0000000000000000000000000000000000000002",
  tokenOut: "0x0000000000000000000000000000000000000003",
  amountIn: "1000000000",
  amountOut: "998400000",
  minAmountOut: "995000000",
  nonce: "42",
  deadline: 1893456000,
  chainId: 1,
};

const signature = `0x${"11".repeat(64)}1b`;
const readinessComponents = {
  marketData: "ok",
  marketSnapshotStore: "ok",
  routing: "ok",
  pricing: "ok",
  risk: "ok",
  signer: "ok",
  quoteRepository: "ok",
  quoteControl: "ok",
  riskDecisionStore: "ok",
  rateLimitStore: "ok",
  inventory: "ok",
  execution: "ok",
  settlementEventStore: "ok",
  pnl: "ok",
  metrics: "ok",
};

test("RFQClient sends quote, submit, status, health, and metrics requests with expected shapes", async () => {
  const calls = [];
  const quoteResponse = {
    quoteId: "q_test",
    snapshotId: "s_test",
    amountOut: "998400000",
    minAmountOut: "995000000",
    deadline: 1893456000,
    nonce: "42",
    signature,
  };
  const submitResponse = {
    status: "accepted",
    txHash: `0x${"22".repeat(32)}`,
    settlementEventId: "se_1_22222222_0",
    hedgeOrderId: "h_1_00000003_000001",
    pnlId: "pnl_q_test",
  };
  const statusResponse = {
    quoteId: "q_test",
    status: "settled",
    txHash: submitResponse.txHash,
    settlementEventId: submitResponse.settlementEventId,
    hedgeOrderId: submitResponse.hedgeOrderId,
    pnlId: submitResponse.pnlId,
  };
  const hedgeResponse = {
    hedgeOrderId: submitResponse.hedgeOrderId,
    status: "queued",
    settlementEventId: submitResponse.settlementEventId,
    quoteId: "q_test",
    chainId: quote.chainId,
    token: quote.tokenOut,
    side: "buy",
    amount: quote.amountOut,
    reason: "inventory_rebalance",
    createdAt: "2026-06-27T00:00:00.000Z",
  };
  const settlementResponse = {
    settlementEventId: submitResponse.settlementEventId,
    status: "applied",
    quoteId: "q_test",
    chainId: quote.chainId,
    txHash: submitResponse.txHash,
    quoteHash: `0x${"33".repeat(32)}`,
    blockNumber: 123456,
    logIndex: 0,
    user: quote.user,
    tokenIn: quote.tokenIn,
    tokenOut: quote.tokenOut,
    amountIn: quote.amountIn,
    amountOut: quote.amountOut,
    nonce: quote.nonce,
    observedAt: "2026-06-27T00:00:00.000Z",
  };
  const pnlResponse = {
    status: "ok",
    totalTrades: 1,
    totals: [{
      chainId: quote.chainId,
      tokenOut: quote.tokenOut,
      totalTrades: 1,
      grossPnlTokenOut: "1600000",
    }],
    trades: [
      {
        pnlId: submitResponse.pnlId,
        quoteId: "q_test",
        settlementEventId: submitResponse.settlementEventId,
        snapshotId: quoteResponse.snapshotId,
        chainId: quote.chainId,
        user: quote.user,
        tokenIn: quote.tokenIn,
        tokenOut: quote.tokenOut,
        amountIn: quote.amountIn,
        amountOut: quote.amountOut,
        minAmountOut: quote.minAmountOut,
        nonce: quote.nonce,
        deadline: quote.deadline,
        midPrice: "1",
        tokenInDecimals: 18,
        tokenOutDecimals: 18,
        fairAmountOut: "1000000000",
        valuationObservedAt: "2026-06-26T23:59:59.000Z",
        grossPnlTokenOut: "1600000",
        grossPnlBps: 16,
        model: "quote_snapshot_edge_v1",
        modelDescription: quoteSnapshotPnlModelDescription,
        realizedAt: "2026-06-27T00:00:00.000Z",
      },
    ],
    hedgeNet: {
      model: "hedge_fill_net_v1",
      modelDescription: hedgeFillNetPnlModelDescription,
      totalTrades: 1,
      completeTrades: 0,
      pendingTrades: 1,
      unavailableTrades: 0,
      totals: [],
      records: [{
        quoteId: "q_test",
        chainId: quote.chainId,
        status: "pending",
        model: "hedge_fill_net_v1",
        modelDescription: hedgeFillNetPnlModelDescription,
        hedgeOrderId: submitResponse.hedgeOrderId,
        valuationToken: quote.tokenIn,
        valuationAsset: "USDT",
      }],
    },
  };
  const healthResponse = { status: "ok" };
  const readinessResponse = {
    status: "ready",
    components: readinessComponents,
  };
  const metricsResponse = [
    "# TYPE rfq_quote_requests_total counter",
    "rfq_quote_requests_total 1",
    "",
  ].join("\n");

  const restoreFetch = installFetch(async (url, init = {}) => {
    calls.push({ url, init });
    if (url.endsWith("/quote") && init.method === "POST") {
      return jsonResponse(200, quoteResponse);
    }
    if (url.endsWith("/submit") && init.method === "POST") {
      return jsonResponse(202, submitResponse);
    }
    if (url.endsWith("/quote/q_test")) {
      return jsonResponse(200, statusResponse);
    }
    if (url.endsWith("/hedges/h_1_00000003_000001")) {
      return jsonResponse(200, hedgeResponse);
    }
    if (url.endsWith("/settlements/se_1_22222222_0")) {
      return jsonResponse(200, settlementResponse);
    }
    if (url.endsWith("/pnl")) {
      return jsonResponse(200, pnlResponse);
    }
    if (url.endsWith("/health")) {
      return jsonResponse(200, healthResponse);
    }
    if (url.endsWith("/ready")) {
      return jsonResponse(200, readinessResponse);
    }
    if (url.endsWith("/metrics")) {
      return textResponse(200, metricsResponse);
    }
    return jsonResponse(404, { code: "NOT_FOUND", message: "not found", traceId: "trace_not_found" });
  });

  try {
    const client = new RFQClient("http://127.0.0.1:3000/", {
      traceId: () => `tr_sdk_${calls.length + 1}`,
    });

    assert.deepEqual(await client.quote({
      chainId: quote.chainId,
      user: quote.user,
      tokenIn: quote.tokenIn,
      tokenOut: quote.tokenOut,
      amountIn: quote.amountIn,
      slippageBps: 50,
    }), quoteResponse);
    assert.deepEqual(await client.submit({ quote, signature, txHash: submitResponse.txHash }), submitResponse);
    assert.deepEqual(await client.getQuote("q_test"), statusResponse);
    assert.deepEqual(await client.getHedge(submitResponse.hedgeOrderId), hedgeResponse);
    assert.deepEqual(await client.getSettlement(submitResponse.settlementEventId), settlementResponse);
    assert.deepEqual(await client.pnl(), pnlResponse);
    assert.deepEqual(await client.health(), healthResponse);
    assert.deepEqual(await client.ready(), readinessResponse);
    assert.equal(await client.metrics(), metricsResponse);

    assert.equal(calls.length, 9);
    assert.equal(calls[0].url, "http://127.0.0.1:3000/quote");
    assert.equal(calls[0].init.headers["content-type"], "application/json");
    assert.deepEqual(JSON.parse(calls[1].init.body), { quote, signature, txHash: submitResponse.txHash });
    assert.equal(calls[2].url, "http://127.0.0.1:3000/quote/q_test");
    assert.equal(calls[3].url, "http://127.0.0.1:3000/hedges/h_1_00000003_000001");
    assert.equal(calls[4].url, "http://127.0.0.1:3000/settlements/se_1_22222222_0");
    assert.equal(calls[5].url, "http://127.0.0.1:3000/pnl");
    assert.equal(calls[6].url, "http://127.0.0.1:3000/health");
    assert.equal(calls[7].url, "http://127.0.0.1:3000/ready");
    assert.equal(calls[8].url, "http://127.0.0.1:3000/metrics");
    for (const [index, call] of calls.entries()) {
      assert.equal(call.init.headers["x-trace-id"], `tr_sdk_${index + 1}`);
    }
  } finally {
    restoreFetch();
  }
});

function installFetch(fetchImpl) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  return () => {
    globalThis.fetch = originalFetch;
  };
}

function jsonResponse(status, payload, headers = {}) {
  return new Response(JSON.stringify(payload), { status, headers });
}

function textResponse(status, payload, headers = {}) {
  return new Response(payload, { status, headers });
}
