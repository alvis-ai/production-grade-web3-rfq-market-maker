import assert from "node:assert/strict";
import test from "node:test";
import { privateKeyToAccount } from "viem/accounts";
import {
  RFQClient,
  RFQClientError,
  buildQuoteTypedData,
  simulatedPnlModelDescription,
} from "../dist/index.js";

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

const verifyingContract = "0x0000000000000000000000000000000000000004";
const signature = `0x${"11".repeat(64)}1b`;
const signerPrivateKey = "0x59c6995e998f97a5a0044966f094538d9dae1ffc26a3b6d86dae8e3a0b97e6a0";
const secp256k1n = BigInt("0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141");
test("RFQClient rejects malformed successful JSON responses", async () => {
  const restoreFetch = installFetch(async () => textResponse(200, "not json", { "x-trace-id": "tr_malformed_json" }));

  try {
    const client = new RFQClient("http://127.0.0.1:3000");

    await assert.rejects(
      client.quote({
        chainId: quote.chainId,
        user: quote.user,
        tokenIn: quote.tokenIn,
        tokenOut: quote.tokenOut,
        amountIn: quote.amountIn,
        slippageBps: 50,
      }),
      (error) => {
        assert.ok(error instanceof RFQClientError);
        assert.equal(error.status, 200);
        assert.equal(error.code, "RFQ_CLIENT_ERROR");
        assert.equal(error.message, "RFQ quote response returned malformed JSON");
        assert.equal(error.traceId, "tr_malformed_json");
        return true;
      },
    );
  } finally {
    restoreFetch();
  }
});

test("RFQClient rejects malformed submit and quote status responses", async () => {
  const restoreSubmitFetch = installFetch(async () =>
    jsonResponse(202, {
      status: "pending",
      txHash: `0x${"22".repeat(32)}`,
      settlementEventId: "se_1_22222222_0",
    }),
  );

  try {
    const client = new RFQClient("http://127.0.0.1:3000");

    await assert.rejects(
      client.submit({ quote, signature }),
      (error) => {
        assert.ok(error instanceof RFQClientError);
        assert.equal(error.status, 202);
        assert.equal(error.code, "RFQ_CLIENT_ERROR");
        assert.equal(error.message, "RFQ submit response returned malformed status");
        return true;
      },
    );
  } finally {
    restoreSubmitFetch();
  }

  const quoteStatusResponse = {
    quoteId: "q_test",
    status: "settled",
    snapshotId: "s_test",
    deadline: quote.deadline,
    txHash: `0x${"22".repeat(32)}`,
    settlementEventId: "se_1_22222222_0",
    hedgeOrderId: "h_1_00000003_000001",
    pnlId: "pnl_q_test",
  };
  const cases = [
    {
      payload: { ...quoteStatusResponse, quoteId: "" },
      message: "RFQ quote status response returned malformed quoteId",
    },
    {
      payload: { ...quoteStatusResponse, quoteId: "q.bad" },
      message: "RFQ quote status response returned malformed quoteId",
    },
    {
      payload: { ...quoteStatusResponse, status: "unknown" },
      message: "RFQ quote status response returned malformed status",
    },
    {
      payload: { ...quoteStatusResponse, routeHint: "debug" },
      message: "RFQ quote status response returned malformed routeHint",
    },
    {
      payload: { ...quoteStatusResponse, snapshotId: "" },
      message: "RFQ quote status response returned malformed snapshotId",
    },
    {
      payload: { ...quoteStatusResponse, snapshotId: "snapshot".repeat(19) },
      message: "RFQ quote status response returned malformed snapshotId",
    },
    {
      payload: { ...quoteStatusResponse, deadline: 0 },
      message: "RFQ quote status response returned malformed deadline",
    },
    {
      payload: { ...quoteStatusResponse, deadline: "1893456000" },
      message: "RFQ quote status response returned malformed deadline",
    },
    {
      payload: { ...quoteStatusResponse, txHash: "0x1234" },
      message: "RFQ quote status response returned malformed txHash",
    },
    {
      payload: { ...quoteStatusResponse, txHash: undefined },
      message: "RFQ quote status response returned malformed txHash",
    },
    {
      payload: { ...quoteStatusResponse, settlementEventId: "" },
      message: "RFQ quote status response returned malformed settlementEventId",
    },
    {
      payload: { ...quoteStatusResponse, settlementEventId: "se/bad" },
      message: "RFQ quote status response returned malformed settlementEventId",
    },
    {
      payload: { ...quoteStatusResponse, settlementEventId: undefined },
      message: "RFQ quote status response returned malformed settlementEventId",
    },
    {
      payload: { ...quoteStatusResponse, hedgeOrderId: "" },
      message: "RFQ quote status response returned malformed hedgeOrderId",
    },
    {
      payload: { ...quoteStatusResponse, hedgeOrderId: "h".repeat(129) },
      message: "RFQ quote status response returned malformed hedgeOrderId",
    },
    {
      payload: { ...quoteStatusResponse, pnlId: "" },
      message: "RFQ quote status response returned malformed pnlId",
    },
    {
      payload: { ...quoteStatusResponse, pnlId: "pnl.bad" },
      message: "RFQ quote status response returned malformed pnlId",
    },
    {
      payload: { ...quoteStatusResponse, errorCode: "" },
      message: "RFQ quote status response returned malformed errorCode",
    },
    {
      payload: {
        ...quoteStatusResponse,
        status: "signed",
      },
      message: "RFQ quote status response returned malformed status",
    },
    {
      payload: {
        quoteId: "q_rejected",
        status: "rejected",
      },
      message: "RFQ quote status response returned malformed errorCode",
    },
    {
      payload: {
        quoteId: "q_failed",
        status: "failed",
      },
      message: "RFQ quote status response returned malformed errorCode",
    },
  ];

  for (const { payload, message } of cases) {
    const restoreQuoteStatusFetch = installFetch(async () => jsonResponse(200, payload));

    try {
      const client = new RFQClient("http://127.0.0.1:3000");

      await assert.rejects(
        client.getQuote("q_test"),
        (error) => {
          assert.ok(error instanceof RFQClientError);
          assert.equal(error.status, 200);
          assert.equal(error.code, "RFQ_CLIENT_ERROR");
          assert.equal(error.message, message);
          return true;
        },
      );
    } finally {
      restoreQuoteStatusFetch();
    }
  }
});

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

test("RFQClient rejects malformed successful response fields", async () => {
  const quoteResponse = {
    quoteId: "q_test",
    snapshotId: "s_test",
    amountOut: "1000000000",
    minAmountOut: "995000000",
    deadline: 1893456000,
    nonce: "42",
    signature,
  };
  const quoteCases = [
    {
      payload: Object.create(quoteResponse),
      message: "RFQ quote response returned malformed quoteId",
    },
    {
      payload: { ...quoteResponse, quoteId: "" },
      message: "RFQ quote response returned malformed quoteId",
      traceId: "tr_malformed_field",
    },
    {
      payload: { ...quoteResponse, routeHint: "debug" },
      message: "RFQ quote response returned malformed routeHint",
    },
    {
      payload: { ...quoteResponse, quoteId: "q.bad" },
      message: "RFQ quote response returned malformed quoteId",
    },
    {
      payload: { ...quoteResponse, snapshotId: "" },
      message: "RFQ quote response returned malformed snapshotId",
    },
    {
      payload: { ...quoteResponse, snapshotId: "s".repeat(129) },
      message: "RFQ quote response returned malformed snapshotId",
    },
    {
      payload: { ...quoteResponse, amountOut: "0" },
      message: "RFQ quote response returned malformed amountOut",
    },
    {
      payload: { ...quoteResponse, amountOut: "01000000000" },
      message: "RFQ quote response returned malformed amountOut",
    },
    {
      payload: { ...quoteResponse, minAmountOut: "1000000001" },
      message: "RFQ quote response returned malformed minAmountOut",
    },
    {
      payload: { ...quoteResponse, nonce: "-1" },
      message: "RFQ quote response returned malformed nonce",
    },
    {
      payload: { ...quoteResponse, deadline: 0 },
      message: "RFQ quote response returned malformed deadline",
    },
    {
      payload: { ...quoteResponse, deadline: "1893456000" },
      message: "RFQ quote response returned malformed deadline",
    },
    {
      payload: { ...quoteResponse, signature: "0x1234" },
      message: "RFQ quote response returned malformed signature",
    },
    {
      payload: { ...quoteResponse, signature: `0x${"11".repeat(64)}02` },
      message: "RFQ quote response returned malformed signature",
    },
    {
      payload: { ...quoteResponse, signature: malleateSignature(await validTypedDataSignature()) },
      message: "RFQ quote response returned malformed signature",
    },
  ];

  for (const { payload, message, traceId } of quoteCases) {
    const restoreQuoteFetch = installFetch(async () =>
      jsonResponse(200, payload, traceId ? { "x-trace-id": traceId } : {}),
    );

    try {
      const client = new RFQClient("http://127.0.0.1:3000");

      await assert.rejects(
        client.quote({
          chainId: quote.chainId,
          user: quote.user,
          tokenIn: quote.tokenIn,
          tokenOut: quote.tokenOut,
          amountIn: quote.amountIn,
          slippageBps: 50,
        }),
        (error) => {
          assert.ok(error instanceof RFQClientError);
          assert.equal(error.status, 200);
          assert.equal(error.code, "RFQ_CLIENT_ERROR");
          assert.equal(error.message, message);
          if (traceId) {
            assert.equal(error.traceId, traceId);
          }
          return true;
        },
      );
    } finally {
      restoreQuoteFetch();
    }
  }

  const submitResponse = {
    status: "accepted",
    txHash: `0x${"22".repeat(32)}`,
    settlementEventId: "se_1_1234_0",
    hedgeOrderId: "h_1_00000003_000001",
    pnlId: "pnl_q_test",
  };
  const submitCases = [
    {
      payload: withPrototype({ txHash: submitResponse.txHash }, { status: "accepted" }),
      message: "RFQ submit response returned malformed txHash",
    },
    {
      payload: { ...submitResponse, txHash: "0x1234" },
      message: "RFQ submit response returned malformed txHash",
    },
    {
      payload: { ...submitResponse, relayer: quote.user },
      message: "RFQ submit response returned malformed relayer",
    },
    {
      payload: { ...submitResponse, settlementEventId: "" },
      message: "RFQ submit response returned malformed settlementEventId",
    },
    {
      payload: { ...submitResponse, settlementEventId: "se.bad" },
      message: "RFQ submit response returned malformed settlementEventId",
    },
    {
      payload: { ...submitResponse, hedgeOrderId: "" },
      message: "RFQ submit response returned malformed hedgeOrderId",
    },
    {
      payload: { ...submitResponse, hedgeOrderId: "h".repeat(129) },
      message: "RFQ submit response returned malformed hedgeOrderId",
    },
    {
      payload: { ...submitResponse, pnlId: "" },
      message: "RFQ submit response returned malformed pnlId",
    },
    {
      payload: { ...submitResponse, pnlId: "pnl/bad" },
      message: "RFQ submit response returned malformed pnlId",
    },
  ];

  for (const { payload, message } of submitCases) {
    const restoreSubmitFetch = installFetch(async () => jsonResponse(202, payload));

    try {
      const client = new RFQClient("http://127.0.0.1:3000");

      await assert.rejects(
        client.submit({ quote, signature }),
        (error) => {
          assert.ok(error instanceof RFQClientError);
          assert.equal(error.status, 202);
          assert.equal(error.code, "RFQ_CLIENT_ERROR");
          assert.equal(error.message, message);
          return true;
        },
      );
    } finally {
      restoreSubmitFetch();
    }
  }

  const restoreSettlementFetch = installFetch(async () =>
    jsonResponse(200, {
      settlementEventId: "se_1_22222222_0",
      status: "applied",
      quoteId: "q_test",
      chainId: quote.chainId,
      txHash: `0x${"22".repeat(32)}`,
      quoteHash: "0x1234",
      blockNumber: 123456,
      logIndex: 0,
      user: quote.user,
      tokenIn: quote.tokenIn,
      tokenOut: quote.tokenOut,
      amountIn: quote.amountIn,
      amountOut: quote.amountOut,
      nonce: quote.nonce,
      observedAt: "2026-06-27T00:00:00.000Z",
    }),
  );

  try {
    const client = new RFQClient("http://127.0.0.1:3000");

    await assert.rejects(
      client.getSettlement("se_1_22222222_0"),
      (error) => {
        assert.ok(error instanceof RFQClientError);
        assert.equal(error.status, 200);
        assert.equal(error.code, "RFQ_CLIENT_ERROR");
        assert.equal(error.message, "RFQ settlement event status response returned malformed quoteHash");
        return true;
      },
    );
  } finally {
    restoreSettlementFetch();
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

function textResponse(status, payload, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: responseHeaders(headers),
    async json() {
      throw new Error("text response does not support json");
    },
    async text() {
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

function withPrototype(prototype, ownFields) {
  return Object.assign(Object.create(prototype), ownFields);
}

function malleateSignature(value) {
  const r = value.slice(2, 66);
  const s = BigInt(`0x${value.slice(66, 130)}`);
  const v = Number.parseInt(value.slice(130, 132), 16);
  const highS = (secp256k1n - s).toString(16).padStart(64, "0");
  const flippedV = v === 27 ? 28 : 27;

  return `0x${r}${highS}${flippedV.toString(16).padStart(2, "0")}`;
}

async function validTypedDataSignature() {
  const account = privateKeyToAccount(signerPrivateKey);
  return account.signTypedData(buildQuoteTypedData(quote, verifyingContract));
}
