import assert from "node:assert/strict";
import test from "node:test";
import { recoverTypedDataAddress, verifyTypedData } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  RFQClient,
  RFQClientError,
  buildQuoteTypedData,
  buildRFQDomain,
  buildSubmitQuoteArgs,
  buildTreasuryTransferArgs,
  hashSettlementQuote,
  quoteTypes,
  rfqSettlementAbi,
  treasuryAbi,
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
const signature = `0x${"11".repeat(65)}`;
const signerPrivateKey = "0x59c6995e998f97a5a0044966f094538d9dae1ffc26a3b6d86dae8e3a0b97e6a0";

test("buildRFQDomain and buildQuoteTypedData preserve EIP-712 quote schema", () => {
  assert.deepEqual(buildRFQDomain(quote.chainId, verifyingContract), {
    name: "ProductionGradeRFQ",
    version: "1",
    chainId: quote.chainId,
    verifyingContract,
  });

  const typedData = buildQuoteTypedData(quote, verifyingContract);

  assert.equal(typedData.primaryType, "Quote");
  assert.deepEqual(typedData.message, quote);
  assert.deepEqual(typedData.types, quoteTypes);
  assert.deepEqual(
    typedData.types.Quote.map((field) => `${field.name}:${field.type}`),
    [
      "user:address",
      "tokenIn:address",
      "tokenOut:address",
      "amountIn:uint256",
      "amountOut:uint256",
      "minAmountOut:uint256",
      "nonce:uint256",
      "deadline:uint256",
      "chainId:uint256",
    ],
  );
});

test("buildQuoteTypedData produces viem-verifiable EIP-712 payloads", async () => {
  const account = privateKeyToAccount(signerPrivateKey);
  const typedData = buildQuoteTypedData(quote, verifyingContract);
  const signed = await account.signTypedData(typedData);

  assert.match(signed, /^0x[0-9a-fA-F]{130}$/);
  assert.equal(
    (await recoverTypedDataAddress({
      ...typedData,
      signature: signed,
    })).toLowerCase(),
    account.address.toLowerCase(),
  );
  assert.equal(
    await verifyTypedData({
      ...typedData,
      address: account.address,
      signature: signed,
    }),
    true,
  );
});

test("buildSubmitQuoteArgs converts string integer fields to settlement bigint fields", () => {
  const args = buildSubmitQuoteArgs(quote, signature);

  assert.equal(args[1], signature);
  assert.deepEqual(args[0], {
    user: quote.user,
    tokenIn: quote.tokenIn,
    tokenOut: quote.tokenOut,
    amountIn: 1000000000n,
    amountOut: 1000000000n,
    minAmountOut: 995000000n,
    nonce: 42n,
    deadline: 1893456000n,
    chainId: 1n,
  });
  assert.ok(rfqSettlementAbi.some((item) => item.type === "function" && item.name === "hashQuote"));
});

test("hashSettlementQuote matches RFQSettlement.hashQuote struct hashing", () => {
  assert.equal(
    hashSettlementQuote(quote),
    "0xcc2f7c4203c4d5bc133de16a899dadcc348ccdf7222093307bc2cc522493503d",
  );
});

test("Treasury helpers expose release and emergency withdrawal contract calls", () => {
  const args = buildTreasuryTransferArgs({
    token: quote.tokenOut,
    to: quote.user,
    amount: quote.amountOut,
  });

  assert.deepEqual(args, [quote.tokenOut, quote.user, 1000000000n]);
  assert.ok(treasuryAbi.some((item) => item.type === "function" && item.name === "release"));
  assert.ok(treasuryAbi.some((item) => item.type === "function" && item.name === "emergencyWithdraw"));
  assert.ok(treasuryAbi.some((item) => item.type === "event" && item.name === "FundsReleased"));
});

test("RFQClient sends quote, submit, status, health, and metrics requests with expected shapes", async () => {
  const calls = [];
  const quoteResponse = {
    quoteId: "q_test",
    snapshotId: "s_test",
    amountOut: "1000000000",
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
    observedAt: "2026-06-27T00:00:00.000Z",
  };
  const pnlResponse = {
    status: "ok",
    totalTrades: 1,
    grossPnlTokenOut: "1600000",
    trades: [
      {
        pnlId: submitResponse.pnlId,
        quoteId: "q_test",
        chainId: quote.chainId,
        tokenIn: quote.tokenIn,
        tokenOut: quote.tokenOut,
        amountIn: quote.amountIn,
        amountOut: quote.amountOut,
        grossPnlTokenOut: "1600000",
        grossPnlBps: 16,
        model: "simulated_mid_price_v1",
        realizedAt: "2026-06-27T00:00:00.000Z",
      },
    ],
  };
  const healthResponse = { status: "ok" };
  const readinessResponse = {
    status: "ready",
    components: {
      signer: "ok",
      marketData: "ok",
    },
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
    const client = new RFQClient("http://127.0.0.1:3000");

    assert.deepEqual(await client.quote({
      chainId: quote.chainId,
      user: quote.user,
      tokenIn: quote.tokenIn,
      tokenOut: quote.tokenOut,
      amountIn: quote.amountIn,
      slippageBps: 50,
    }), quoteResponse);
    assert.deepEqual(await client.submit({ quote, signature }), submitResponse);
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
    assert.deepEqual(JSON.parse(calls[1].init.body), { quote, signature });
    assert.equal(calls[2].url, "http://127.0.0.1:3000/quote/q_test");
    assert.equal(calls[3].url, "http://127.0.0.1:3000/hedges/h_1_00000003_000001");
    assert.equal(calls[4].url, "http://127.0.0.1:3000/settlements/se_1_22222222_0");
    assert.equal(calls[5].url, "http://127.0.0.1:3000/pnl");
    assert.equal(calls[6].url, "http://127.0.0.1:3000/health");
    assert.equal(calls[7].url, "http://127.0.0.1:3000/ready");
    assert.equal(calls[8].url, "http://127.0.0.1:3000/metrics");
  } finally {
    restoreFetch();
  }
});

test("RFQClient throws structured RFQClientError for API errors", async () => {
  const restoreFetch = installFetch(async () =>
    jsonResponse(409, {
      code: "RISK_REJECTED",
      message: "Risk policy rejected quote",
      traceId: "trace_test",
    }),
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
        slippageBps: 999,
      }),
      (error) => {
        assert.ok(error instanceof RFQClientError);
        assert.equal(error.status, 409);
        assert.equal(error.code, "RISK_REJECTED");
        assert.equal(error.message, "Risk policy rejected quote");
        assert.equal(error.traceId, "trace_test");
        return true;
      },
    );
  } finally {
    restoreFetch();
  }
});

test("RFQClient exposes Retry-After seconds for rate limited responses", async () => {
  const restoreFetch = installFetch(async () =>
    jsonResponse(
      429,
      {
        code: "RATE_LIMITED",
        message: "Too many requests",
        traceId: "trace_rate_limited",
      },
      { "retry-after": "60" },
    ),
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
        assert.equal(error.status, 429);
        assert.equal(error.code, "RATE_LIMITED");
        assert.equal(error.message, "Too many requests");
        assert.equal(error.traceId, "trace_rate_limited");
        assert.equal(error.retryAfterSeconds, 60);
        return true;
      },
    );
  } finally {
    restoreFetch();
  }
});

test("RFQClient falls back for unknown API error codes", async () => {
  const restoreFetch = installFetch(async () =>
    jsonResponse(500, {
      code: "NEW_SERVER_ERROR",
      message: "Unexpected server error",
      traceId: "trace_unknown",
    }),
  );

  try {
    const client = new RFQClient("http://127.0.0.1:3000");

    await assert.rejects(
      client.metrics(),
      (error) => {
        assert.ok(error instanceof RFQClientError);
        assert.equal(error.status, 500);
        assert.equal(error.code, "RFQ_CLIENT_ERROR");
        assert.equal(error.message, "RFQ metrics request failed");
        assert.equal(error.traceId, undefined);
        return true;
      },
    );
  } finally {
    restoreFetch();
  }
});

test("RFQClient rejects malformed successful JSON responses", async () => {
  const restoreFetch = installFetch(async () => textResponse(200, "not json"));

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
        return true;
      },
    );
  } finally {
    restoreFetch();
  }
});

test("RFQClient rejects malformed health and readiness status responses", async () => {
  const restoreHealthFetch = installFetch(async () => jsonResponse(200, { status: "degraded" }));

  try {
    const client = new RFQClient("http://127.0.0.1:3000");

    await assert.rejects(
      client.health(),
      (error) => {
        assert.ok(error instanceof RFQClientError);
        assert.equal(error.status, 200);
        assert.equal(error.code, "RFQ_CLIENT_ERROR");
        assert.equal(error.message, "RFQ health response returned malformed status");
        return true;
      },
    );
  } finally {
    restoreHealthFetch();
  }

  const restoreReadyFetch = installFetch(async () =>
    jsonResponse(200, {
      status: "ready",
      components: {
        signer: "unknown",
      },
    }),
  );

  try {
    const client = new RFQClient("http://127.0.0.1:3000");

    await assert.rejects(
      client.ready(),
      (error) => {
        assert.ok(error instanceof RFQClientError);
        assert.equal(error.status, 200);
        assert.equal(error.code, "RFQ_CLIENT_ERROR");
        assert.equal(error.message, "RFQ readiness response returned malformed status");
        return true;
      },
    );
  } finally {
    restoreReadyFetch();
  }
});

test("RFQClient rejects malformed hedge status enum responses", async () => {
  const restoreFetch = installFetch(async () =>
    jsonResponse(200, {
      hedgeOrderId: "h_1_00000003_000001",
      status: "queued",
      settlementEventId: "se_1_22222222_0",
      quoteId: "q_test",
      chainId: quote.chainId,
      token: quote.tokenOut,
      side: "hold",
      amount: quote.amountOut,
      reason: "inventory_rebalance",
      createdAt: "2026-06-27T00:00:00.000Z",
    }),
  );

  try {
    const client = new RFQClient("http://127.0.0.1:3000");

    await assert.rejects(
      client.getHedge("h_1_00000003_000001"),
      (error) => {
        assert.ok(error instanceof RFQClientError);
        assert.equal(error.status, 200);
        assert.equal(error.code, "RFQ_CLIENT_ERROR");
        assert.equal(error.message, "RFQ hedge status response returned malformed status");
        return true;
      },
    );
  } finally {
    restoreFetch();
  }
});

test("RFQClient rejects malformed submit and quote status enum responses", async () => {
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

  const restoreQuoteStatusFetch = installFetch(async () =>
    jsonResponse(200, {
      quoteId: "q_test",
      status: "unknown",
      txHash: `0x${"22".repeat(32)}`,
    }),
  );

  try {
    const client = new RFQClient("http://127.0.0.1:3000");

    await assert.rejects(
      client.getQuote("q_test"),
      (error) => {
        assert.ok(error instanceof RFQClientError);
        assert.equal(error.status, 200);
        assert.equal(error.code, "RFQ_CLIENT_ERROR");
        assert.equal(error.message, "RFQ quote status response returned malformed status");
        return true;
      },
    );
  } finally {
    restoreQuoteStatusFetch();
  }
});

test("RFQClient rejects malformed successful signature and hash fields", async () => {
  const restoreQuoteFetch = installFetch(async () =>
    jsonResponse(200, {
      quoteId: "q_test",
      snapshotId: "s_test",
      amountOut: "1000000000",
      minAmountOut: "995000000",
      deadline: 1893456000,
      nonce: "42",
      signature: "0x1234",
    }),
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
        assert.equal(error.message, "RFQ quote response returned malformed signature");
        return true;
      },
    );
  } finally {
    restoreQuoteFetch();
  }

  const restoreSubmitFetch = installFetch(async () =>
    jsonResponse(202, {
      status: "accepted",
      txHash: "0x1234",
      settlementEventId: "se_1_1234_0",
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
        assert.equal(error.message, "RFQ submit response returned malformed txHash");
        return true;
      },
    );
  } finally {
    restoreSubmitFetch();
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

test("RFQClient returns degraded readiness payloads from HTTP 503", async () => {
  const readinessResponse = {
    status: "degraded",
    components: {
      marketData: "degraded",
      signer: "ok",
    },
  };
  const restoreFetch = installFetch(async () => jsonResponse(503, readinessResponse));

  try {
    const client = new RFQClient("http://127.0.0.1:3000");

    assert.deepEqual(await client.ready(), readinessResponse);
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
