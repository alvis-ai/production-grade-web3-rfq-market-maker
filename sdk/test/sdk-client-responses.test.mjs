import assert from "node:assert/strict";
import test from "node:test";
import { privateKeyToAccount } from "viem/accounts";
import {
  RFQClient,
  RFQClientError,
  buildQuoteTypedData,
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
  return new Response(JSON.stringify(payload), { status, headers });
}

function textResponse(status, payload, headers = {}) {
  return new Response(payload, { status, headers });
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
