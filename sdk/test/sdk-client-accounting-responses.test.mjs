import assert from "node:assert/strict";
import test from "node:test";
import {
  RFQClient,
  RFQClientError,
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

test("RFQClient rejects malformed settlement status responses", async () => {
  const settlementResponse = {
    settlementEventId: "se_1_22222222_0",
    status: "applied",
    quoteId: "q_test",
    chainId: quote.chainId,
    txHash: `0x${"22".repeat(32)}`,
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

  const cases = [
    {
      payload: { ...settlementResponse, settlementEventId: "" },
      message: "RFQ settlement event status response returned malformed settlementEventId",
    },
    {
      payload: { ...settlementResponse, settlementEventId: "se.bad" },
      message: "RFQ settlement event status response returned malformed settlementEventId",
    },
    {
      payload: { ...settlementResponse, status: "pending" },
      message: "RFQ settlement event status response returned malformed status",
    },
    {
      payload: { ...settlementResponse, chainName: "mainnet" },
      message: "RFQ settlement event status response returned malformed chainName",
    },
    {
      payload: { ...settlementResponse, quoteId: "" },
      message: "RFQ settlement event status response returned malformed quoteId",
    },
    {
      payload: { ...settlementResponse, quoteId: "q".repeat(129) },
      message: "RFQ settlement event status response returned malformed quoteId",
    },
    {
      payload: { ...settlementResponse, chainId: 0 },
      message: "RFQ settlement event status response returned malformed chainId",
    },
    {
      payload: { ...settlementResponse, chainId: "1" },
      message: "RFQ settlement event status response returned malformed chainId",
    },
    {
      payload: { ...settlementResponse, txHash: "0x1234" },
      message: "RFQ settlement event status response returned malformed txHash",
    },
    {
      payload: { ...settlementResponse, quoteHash: "0x1234" },
      message: "RFQ settlement event status response returned malformed quoteHash",
    },
    {
      payload: { ...settlementResponse, blockNumber: -1 },
      message: "RFQ settlement event status response returned malformed blockNumber",
    },
    {
      payload: { ...settlementResponse, blockNumber: "123456" },
      message: "RFQ settlement event status response returned malformed blockNumber",
    },
    {
      payload: { ...settlementResponse, logIndex: -1 },
      message: "RFQ settlement event status response returned malformed logIndex",
    },
    {
      payload: { ...settlementResponse, user: "0x1234" },
      message: "RFQ settlement event status response returned malformed user",
    },
    {
      payload: { ...settlementResponse, tokenOut: quote.tokenIn },
      message: "RFQ settlement event status response returned malformed tokenOut",
    },
    {
      payload: { ...settlementResponse, amountIn: "0" },
      message: "RFQ settlement event status response returned malformed amountIn",
    },
    {
      payload: { ...settlementResponse, nonce: "0" },
      message: "RFQ settlement event status response returned malformed nonce",
    },
    {
      payload: { ...settlementResponse, nonce: "01" },
      message: "RFQ settlement event status response returned malformed nonce",
    },
    {
      payload: { ...settlementResponse, observedAt: "not-a-date" },
      message: "RFQ settlement event status response returned malformed observedAt",
    },
    {
      payload: { ...settlementResponse, observedAt: "June 27, 2026" },
      message: "RFQ settlement event status response returned malformed observedAt",
    },
  ];

  for (const { payload, message } of cases) {
    const restoreFetch = installFetch(async () => jsonResponse(200, payload));

    try {
      const client = new RFQClient("http://127.0.0.1:3000");

      await assert.rejects(
        client.getSettlement("se_1_22222222_0"),
        (error) => {
          assert.ok(error instanceof RFQClientError);
          assert.equal(error.status, 200);
          assert.equal(error.code, "RFQ_CLIENT_ERROR");
          assert.equal(error.message, message);
          return true;
        },
      );
    } finally {
      restoreFetch();
    }
  }
});

test("RFQClient rejects malformed PnL summary responses", async () => {
  const basePnlResponse = {
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
        pnlId: "pnl_q_test",
        quoteId: "q_test",
        settlementEventId: "se_q_test",
        snapshotId: "snapshot_q_test",
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
      pendingTrades: 0,
      unavailableTrades: 1,
      totals: [],
      records: [{
        quoteId: "q_test",
        chainId: quote.chainId,
        status: "unavailable",
        model: "hedge_fill_net_v1",
        modelDescription: hedgeFillNetPnlModelDescription,
        reasonCode: "HEDGE_EVIDENCE_MISSING",
      }],
    },
    page: {
      limit: 50,
      returned: 1,
      hasMore: false,
      asOf: "2026-06-27T00:00:01.000Z",
    },
  };

  const cases = [
    {
      payload: { ...basePnlResponse, status: "pending" },
      message: "RFQ PnL summary response returned malformed status",
    },
    {
      payload: { ...basePnlResponse, reconciliationId: "recon_1" },
      message: "RFQ PnL summary response returned malformed reconciliationId",
    },
    {
      payload: { ...basePnlResponse, totalTrades: 0 },
      message: "RFQ PnL summary response returned malformed totalTrades",
    },
    {
      payload: { ...basePnlResponse, totalTrades: "1" },
      message: "RFQ PnL summary response returned malformed totalTrades",
    },
    {
      payload: {
        ...basePnlResponse,
        totals: [{ ...basePnlResponse.totals[0], grossPnlTokenOut: "1599999" }],
      },
      message: "RFQ PnL summary response returned malformed totals",
    },
    {
      payload: {
        ...basePnlResponse,
        totals: [{ ...basePnlResponse.totals[0], grossPnlTokenOut: "01600000" }],
      },
      message: "RFQ PnL summary response total returned malformed grossPnlTokenOut",
    },
    {
      payload: {
        ...basePnlResponse,
        totals: [{ ...basePnlResponse.totals[0], grossPnlTokenOut: "-0" }],
      },
      message: "RFQ PnL summary response total returned malformed grossPnlTokenOut",
    },
    {
      payload: {
        ...basePnlResponse,
        trades: [{ ...basePnlResponse.trades[0], pnlId: "pnl.bad" }],
      },
      message: "RFQ PnL summary response trade returned malformed pnlId",
    },
    {
      payload: {
        ...basePnlResponse,
        trades: [{ ...basePnlResponse.trades[0], quoteId: "q".repeat(129) }],
      },
      message: "RFQ PnL summary response trade returned malformed quoteId",
    },
    {
      payload: {
        ...basePnlResponse,
        trades: [{ ...basePnlResponse.trades[0], settlementEventId: "se.bad" }],
      },
      message: "RFQ PnL summary response trade returned malformed settlementEventId",
    },
    {
      payload: {
        ...basePnlResponse,
        trades: [{ ...basePnlResponse.trades[0], snapshotId: "snapshot.bad" }],
      },
      message: "RFQ PnL summary response trade returned malformed snapshotId",
    },
    {
      payload: {
        ...basePnlResponse,
        trades: [{ ...basePnlResponse.trades[0], routeId: "route_1" }],
      },
      message: "RFQ PnL summary response trade returned malformed routeId",
    },
    {
      payload: {
        ...basePnlResponse,
        trades: [{ ...basePnlResponse.trades[0], tokenIn: "0x1234" }],
      },
      message: "RFQ PnL summary response trade returned malformed tokenIn",
    },
    {
      payload: {
        ...basePnlResponse,
        trades: [{ ...basePnlResponse.trades[0], user: "0x1234" }],
      },
      message: "RFQ PnL summary response trade returned malformed user",
    },
    {
      payload: {
        ...basePnlResponse,
        trades: [{ ...basePnlResponse.trades[0], amountOut: "0" }],
      },
      message: "RFQ PnL summary response trade returned malformed amountOut",
    },
    {
      payload: {
        ...basePnlResponse,
        trades: [{ ...basePnlResponse.trades[0], amountOut: "100", minAmountOut: "200" }],
      },
      message: "RFQ PnL summary response trade returned malformed amountOut",
    },
    {
      payload: {
        ...basePnlResponse,
        trades: [{ ...basePnlResponse.trades[0], nonce: "0" }],
      },
      message: "RFQ PnL summary response trade returned malformed nonce",
    },
    {
      payload: {
        ...basePnlResponse,
        trades: [{ ...basePnlResponse.trades[0], deadline: 0 }],
      },
      message: "RFQ PnL summary response trade returned malformed deadline",
    },
    {
      payload: {
        ...basePnlResponse,
        trades: [{ ...basePnlResponse.trades[0], deadline: "1893456000" }],
      },
      message: "RFQ PnL summary response trade returned malformed deadline",
    },
    {
      payload: {
        ...basePnlResponse,
        trades: [{ ...basePnlResponse.trades[0], midPrice: "0" }],
      },
      message: "RFQ PnL summary response trade returned malformed midPrice",
    },
    {
      payload: {
        ...basePnlResponse,
        trades: [{ ...basePnlResponse.trades[0], tokenOutDecimals: 37 }],
      },
      message: "RFQ PnL summary response trade returned malformed tokenOutDecimals",
    },
    {
      payload: {
        ...basePnlResponse,
        trades: [{ ...basePnlResponse.trades[0], fairAmountOut: "0" }],
      },
      message: "RFQ PnL summary response trade returned malformed fairAmountOut",
    },
    {
      payload: {
        ...basePnlResponse,
        trades: [{ ...basePnlResponse.trades[0], valuationObservedAt: "not-a-date" }],
      },
      message: "RFQ PnL summary response trade returned malformed valuationObservedAt",
    },
    {
      payload: {
        ...basePnlResponse,
        trades: [{ ...basePnlResponse.trades[0], grossPnlTokenOut: "01600000" }],
      },
      message: "RFQ PnL summary response trade returned malformed grossPnlTokenOut",
    },
    {
      payload: {
        ...basePnlResponse,
        trades: [{ ...basePnlResponse.trades[0], grossPnlTokenOut: "-0" }],
      },
      message: "RFQ PnL summary response trade returned malformed grossPnlTokenOut",
    },
    {
      payload: {
        ...basePnlResponse,
        trades: [{ ...basePnlResponse.trades[0], grossPnlBps: "16" }],
      },
      message: "RFQ PnL summary response trade returned malformed grossPnlBps",
    },
    {
      payload: {
        ...basePnlResponse,
        trades: [{ ...basePnlResponse.trades[0], model: "unknown_model" }],
      },
      message: "RFQ PnL summary response trade returned malformed model",
    },
    {
      payload: {
        ...basePnlResponse,
        trades: [{ ...basePnlResponse.trades[0], modelDescription: "unsupported PnL model" }],
      },
      message: "RFQ PnL summary response trade returned malformed modelDescription",
    },
    {
      payload: {
        ...basePnlResponse,
        trades: [{ ...basePnlResponse.trades[0], realizedAt: "not-a-date" }],
      },
      message: "RFQ PnL summary response trade returned malformed realizedAt",
    },
    {
      payload: {
        ...basePnlResponse,
        trades: [{ ...basePnlResponse.trades[0], realizedAt: "2026-02-31T00:00:00.000Z" }],
      },
      message: "RFQ PnL summary response trade returned malformed realizedAt",
    },
    {
      payload: { ...basePnlResponse, page: { ...basePnlResponse.page, returned: 0 } },
      message: "RFQ PnL summary response page returned malformed limit",
    },
    {
      payload: { ...basePnlResponse, page: { ...basePnlResponse.page, hasMore: true } },
      message: "RFQ PnL summary response page returned malformed nextCursor",
    },
    {
      payload: { ...basePnlResponse, page: { ...basePnlResponse.page, asOf: "not-a-date" } },
      message: "RFQ PnL summary response page returned malformed limit",
    },
  ];

  for (const { payload, message } of cases) {
    const restoreFetch = installFetch(async () => jsonResponse(200, payload));

    try {
      const client = new RFQClient("http://127.0.0.1:3000");

      await assert.rejects(
        client.pnl(),
        (error) => {
          assert.ok(error instanceof RFQClientError);
          assert.equal(error.status, 200);
          assert.equal(error.code, "RFQ_CLIENT_ERROR");
          assert.equal(error.message, message);
          return true;
        },
      );
    } finally {
      restoreFetch();
    }
  }
});

test("RFQClient sends bounded PnL cursor options and rejects malformed options locally", async () => {
  const urls = [];
  const response = {
    status: "ok",
    totalTrades: 0,
    totals: [],
    trades: [],
    hedgeNet: {
      model: "hedge_fill_net_v1",
      modelDescription: hedgeFillNetPnlModelDescription,
      totalTrades: 0,
      completeTrades: 0,
      pendingTrades: 0,
      unavailableTrades: 0,
      totals: [],
      records: [],
    },
    page: {
      limit: 2,
      returned: 0,
      hasMore: false,
      asOf: "2026-07-16T00:00:00.000Z",
    },
  };
  const restoreFetch = installFetch(async (url) => {
    urls.push(url);
    return jsonResponse(200, response);
  });

  try {
    const client = new RFQClient("http://127.0.0.1:3000");
    await client.pnl({ limit: 2, cursor: "pnl1_abc_DEF-123" });
    assert.equal(urls[0], "http://127.0.0.1:3000/pnl?limit=2&cursor=pnl1_abc_DEF-123");

    for (const options of [
      null,
      { limit: 0 },
      { limit: 101 },
      { limit: "2" },
      { cursor: "invalid" },
      { offset: 1 },
      Object.create({ cursor: "pnl1_abc" }),
    ]) {
      await assert.rejects(client.pnl(options), (error) => {
        assert.ok(error instanceof RFQClientError);
        assert.equal(error.status, 0);
        return true;
      });
    }
    assert.equal(urls.length, 1);
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
