import assert from "node:assert/strict";
import test from "node:test";
import { RFQClient, RFQClientError, simulatedPnlModelDescription } from "../dist/index.js";

const quote = {
  user: "0x0000000000000000000000000000000000000001",
  tokenIn: "0x0000000000000000000000000000000000000002",
  tokenOut: "0x0000000000000000000000000000000000000003",
  amountIn: "1000000000",
  amountOut: "1000000000",
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
    grossPnlTokenOut: "1600000",
    trades: [
      {
        pnlId: "pnl_q_test",
        quoteId: "q_test",
        chainId: quote.chainId,
        user: quote.user,
        tokenIn: quote.tokenIn,
        tokenOut: quote.tokenOut,
        amountIn: quote.amountIn,
        amountOut: quote.amountOut,
        minAmountOut: quote.minAmountOut,
        nonce: quote.nonce,
        deadline: quote.deadline,
        grossPnlTokenOut: "1600000",
        grossPnlBps: 16,
        model: "simulated_mid_price_v1",
        modelDescription: simulatedPnlModelDescription,
        realizedAt: "2026-06-27T00:00:00.000Z",
      },
    ],
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
      payload: { ...basePnlResponse, totalTrades: 2 },
      message: "RFQ PnL summary response returned malformed totalTrades",
    },
    {
      payload: { ...basePnlResponse, totalTrades: "1" },
      message: "RFQ PnL summary response returned malformed totalTrades",
    },
    {
      payload: { ...basePnlResponse, grossPnlTokenOut: "1599999" },
      message: "RFQ PnL summary response returned malformed grossPnlTokenOut",
    },
    {
      payload: { ...basePnlResponse, grossPnlTokenOut: "01600000" },
      message: "RFQ PnL summary response returned malformed grossPnlTokenOut",
    },
    {
      payload: { ...basePnlResponse, grossPnlTokenOut: "-0" },
      message: "RFQ PnL summary response returned malformed grossPnlTokenOut",
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

function installFetch(fetchImpl) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  return () => {
    globalThis.fetch = originalFetch;
  };
}

function jsonResponse(status, payload, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: responseHeaders(headers),
    async json() {
      return payload;
    },
  };
}

function responseHeaders(headers) {
  const normalized = new Map(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
  return {
    get(name) {
      return normalized.get(name.toLowerCase()) ?? null;
    },
  };
}
