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
const readinessComponents = {
  marketData: "ok",
  marketSnapshotStore: "ok",
  routing: "ok",
  pricing: "ok",
  risk: "ok",
  signer: "ok",
  quoteRepository: "ok",
  riskDecisionStore: "ok",
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
    nonce: quote.nonce,
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
    for (const [index, call] of calls.entries()) {
      assert.equal(call.init.headers["x-trace-id"], `tr_sdk_${index + 1}`);
    }
  } finally {
    restoreFetch();
  }
});

test("RFQClient rejects unsafe base URLs at construction", () => {
  for (const [baseUrl, expectedMessage] of [
    [null, "RFQClient baseUrl must be a string"],
    [[], "RFQClient baseUrl must be a string"],
    [" ", "RFQClient baseUrl must be a non-empty absolute http(s) URL"],
    ["/relative", "RFQClient baseUrl must be an absolute http(s) URL"],
    ["ftp://127.0.0.1:3000", "RFQClient baseUrl must use http or https"],
    ["https://user:pass@api.example.com", "RFQClient baseUrl must not include credentials"],
    ["https://*.example.com", "RFQClient baseUrl host must not contain wildcards"],
    ["https://api.example.com?token=abc", "RFQClient baseUrl must not include query strings or fragments"],
    ["https://api.example.com#quote", "RFQClient baseUrl must not include query strings or fragments"],
  ]) {
    assert.throws(
      () => new RFQClient(baseUrl),
      (error) => {
        assert.ok(error instanceof RFQClientError);
        assert.equal(error.status, 0);
        assert.equal(error.code, "RFQ_CLIENT_ERROR");
        assert.equal(error.message, expectedMessage);
        return true;
      },
    );
  }
});

test("RFQClient normalizes safe base URL origins and path prefixes", async () => {
  const calls = [];
  const response = { status: "ok" };
  const client = new RFQClient(" http://api.example.com:80/rfq/ ", {
    fetch: async (url, init = {}) => {
      calls.push({ url, init });
      return jsonResponse(200, response);
    },
  });

  assert.deepEqual(await client.health(), response);
  assert.deepEqual(calls, [{ url: "http://api.example.com/rfq/health", init: {} }]);
});

test("RFQClient rejects unsafe fetch dependencies at construction", () => {
  const originalFetch = globalThis.fetch;

  try {
    globalThis.fetch = undefined;

    assert.throws(
      () => new RFQClient("http://127.0.0.1:3000"),
      (error) => {
        assert.ok(error instanceof RFQClientError);
        assert.equal(error.status, 0);
        assert.equal(error.code, "RFQ_CLIENT_ERROR");
        assert.equal(error.message, "RFQClient fetch implementation must be available or provided");
        return true;
      },
    );

    assert.throws(
      () => new RFQClient("http://127.0.0.1:3000", null),
      (error) => {
        assert.ok(error instanceof RFQClientError);
        assert.equal(error.status, 0);
        assert.equal(error.code, "RFQ_CLIENT_ERROR");
        assert.equal(error.message, "RFQClient options must be an object");
        return true;
      },
    );

    assert.throws(
      () => new RFQClient("http://127.0.0.1:3000", { fetch: "not-a-function" }),
      (error) => {
        assert.ok(error instanceof RFQClientError);
        assert.equal(error.status, 0);
        assert.equal(error.code, "RFQ_CLIENT_ERROR");
        assert.equal(error.message, "RFQClient fetch option must be a function");
        return true;
      },
    );

    assert.throws(
      () => new RFQClient("http://127.0.0.1:3000", Object.create({ fetch: async () => jsonResponse(200, {}) })),
      (error) => {
        assert.ok(error instanceof RFQClientError);
        assert.equal(error.status, 0);
        assert.equal(error.code, "RFQ_CLIENT_ERROR");
        assert.equal(error.message, "RFQClient options.fetch must be an own field when provided");
        return true;
      },
    );

    assert.throws(
      () =>
        new RFQClient("http://127.0.0.1:3000", {
          fetch: async () => jsonResponse(200, {}),
          retry: true,
        }),
      (error) => {
        assert.ok(error instanceof RFQClientError);
        assert.equal(error.status, 0);
        assert.equal(error.code, "RFQ_CLIENT_ERROR");
        assert.equal(error.message, "RFQClient options must not include unknown field retry");
        return true;
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("RFQClient rejects unsafe trace id options", async () => {
  assert.throws(
    () => new RFQClient("http://127.0.0.1:3000", Object.create({ traceId: "tr_sdk_inherited" })),
    (error) => {
      assert.ok(error instanceof RFQClientError);
      assert.equal(error.status, 0);
      assert.equal(error.message, "RFQClient options.traceId must be an own field when provided");
      return true;
    },
  );

  assert.throws(
    () => new RFQClient("http://127.0.0.1:3000", { traceId: "client_trace" }),
    (error) => {
      assert.ok(error instanceof RFQClientError);
      assert.equal(error.status, 0);
      assert.equal(error.message, "RFQClient traceId must match tr_[A-Za-z0-9._:-]+ and be 128 characters or fewer");
      return true;
    },
  );

  assert.throws(
    () => new RFQClient("http://127.0.0.1:3000", { traceId: 123 }),
    (error) => {
      assert.ok(error instanceof RFQClientError);
      assert.equal(error.status, 0);
      assert.equal(error.message, "RFQClient traceId option must be a primitive string or function");
      return true;
    },
  );

  assert.throws(
    () => new RFQClient("http://127.0.0.1:3000", { traceId: new String("tr_sdk_wrapper") }),
    (error) => {
      assert.ok(error instanceof RFQClientError);
      assert.equal(error.status, 0);
      assert.equal(error.message, "RFQClient traceId option must be a primitive string or function");
      return true;
    },
  );

  const calls = [];
  const restoreFetch = installFetch(async (url, init = {}) => {
    calls.push({ url, init });
    return jsonResponse(200, { status: "ok" });
  });

  try {
    const client = new RFQClient("http://127.0.0.1:3000", {
      traceId: () => "trace with spaces",
    });

    await assert.rejects(
      client.health(),
      (error) => {
        assert.ok(error instanceof RFQClientError);
        assert.equal(error.status, 0);
        assert.equal(
          error.message,
          "RFQClient traceId provider result must match tr_[A-Za-z0-9._:-]+ and be 128 characters or fewer",
        );
        return true;
      },
    );
    assert.equal(calls.length, 0);

    const wrapperClient = new RFQClient("http://127.0.0.1:3000", {
      traceId: () => new String("tr_sdk_wrapper"),
    });

    await assert.rejects(
      wrapperClient.health(),
      (error) => {
        assert.ok(error instanceof RFQClientError);
        assert.equal(error.status, 0);
        assert.equal(error.message, "RFQClient traceId provider result must be a primitive string");
        return true;
      },
    );
    assert.equal(calls.length, 0);
  } finally {
    restoreFetch();
  }
});

test("RFQClient accepts injected fetch implementations", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  const metricsResponse = [
    "# TYPE rfq_quote_requests_total counter",
    "rfq_quote_requests_total 1",
    "",
  ].join("\n");

  try {
    globalThis.fetch = undefined;

    const client = new RFQClient("http://127.0.0.1:3000/", {
      fetch: async (url, init = {}) => {
        calls.push({ url, init });
        return textResponse(200, metricsResponse);
      },
    });

    assert.equal(await client.metrics(), metricsResponse);
    assert.deepEqual(calls, [{ url: "http://127.0.0.1:3000/metrics", init: {} }]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("RFQClient rejects unsafe quote requests before sending HTTP", async () => {
  const calls = [];
  const restoreFetch = installFetch(async (url, init = {}) => {
    calls.push({ url, init });
    return jsonResponse(500, { code: "INTERNAL_ERROR", message: "unexpected", traceId: "tr_unexpected" });
  });
  const quoteRequest = {
    chainId: quote.chainId,
    user: quote.user,
    tokenIn: quote.tokenIn,
    tokenOut: quote.tokenOut,
    amountIn: quote.amountIn,
    slippageBps: 50,
  };
  const cases = [
    {
      request: undefined,
      message: "RFQ quote request must be an object",
    },
    {
      request: { ...quoteRequest, extra: true },
      message: "RFQ quote request must not include unknown field extra",
    },
    {
      request: Object.create(quoteRequest),
      message: "RFQ quote request missing required field chainId",
    },
    {
      request: { ...quoteRequest, chainId: 0 },
      message: "RFQ quote request chainId must be a positive safe integer",
    },
    {
      request: { ...quoteRequest, user: "0x1234" },
      message: "RFQ quote request user must be a 20-byte hex address",
    },
    {
      request: { ...quoteRequest, tokenOut: quoteRequest.tokenIn },
      message: "RFQ quote request tokenIn and tokenOut must be different",
    },
    {
      request: { ...quoteRequest, amountIn: "0" },
      message: "RFQ quote request amountIn must be a positive uint string",
    },
    {
      request: { ...quoteRequest, amountIn: "01000000000" },
      message: "RFQ quote request amountIn must be a positive uint string",
    },
    {
      request: { ...quoteRequest, slippageBps: 10_001 },
      message: "RFQ quote request slippageBps must be an integer from 0 to 10000",
    },
  ];

  try {
    const client = new RFQClient("http://127.0.0.1:3000");

    for (const { request, message } of cases) {
      await assert.rejects(
        client.quote(request),
        (error) => {
          assert.ok(error instanceof RFQClientError);
          assert.equal(error.status, 0);
          assert.equal(error.message, message);
          return true;
        },
      );
    }

    assert.equal(calls.length, 0);
  } finally {
    restoreFetch();
  }
});

test("RFQClient rejects unsafe submit requests before sending HTTP", async () => {
  const calls = [];
  const restoreFetch = installFetch(async (url, init = {}) => {
    calls.push({ url, init });
    return jsonResponse(500, { code: "INTERNAL_ERROR", message: "unexpected", traceId: "tr_unexpected" });
  });

  try {
    const client = new RFQClient("http://127.0.0.1:3000");

    await assert.rejects(
      client.submit(undefined),
      (error) => {
        assert.ok(error instanceof RFQClientError);
        assert.equal(error.status, 0);
        assert.equal(error.message, "RFQ submit request must be an object");
        return true;
      },
    );

    await assert.rejects(
      client.submit({ quote, signature, relayer: quote.user }),
      (error) => {
        assert.ok(error instanceof RFQClientError);
        assert.equal(error.status, 0);
        assert.equal(error.message, "RFQ submit request must not include unknown field relayer");
        return true;
      },
    );

    await assert.rejects(
      client.submit({ quote }),
      (error) => {
        assert.ok(error instanceof RFQClientError);
        assert.equal(error.status, 0);
        assert.equal(error.message, "RFQ submit request missing required field signature");
        return true;
      },
    );

    await assert.rejects(
      client.submit(Object.create({ quote, signature })),
      (error) => {
        assert.ok(error instanceof RFQClientError);
        assert.equal(error.status, 0);
        assert.equal(error.message, "RFQ submit request missing required field quote");
        return true;
      },
    );

    await assert.rejects(
      client.submit({ quote, signature: `0x${"11".repeat(64)}02` }),
      (error) => {
        assert.ok(error instanceof RFQClientError);
        assert.equal(error.status, 0);
        assert.equal(error.message, "RFQ submit request signature v value must be 27 or 28");
        return true;
      },
    );

    await assert.rejects(
      client.submit({ quote, signature: malleateSignature(await validTypedDataSignature()) }),
      (error) => {
        assert.ok(error instanceof RFQClientError);
        assert.equal(error.status, 0);
        assert.equal(error.message, "RFQ submit request signature s value must be in the lower half order");
        return true;
      },
    );

    await assert.rejects(
      client.submit({
        quote: {
          ...quote,
          tokenOut: quote.tokenIn,
        },
        signature,
      }),
      (error) => {
        assert.ok(error instanceof RFQClientError);
        assert.equal(error.status, 0);
        assert.equal(error.message, "RFQ submit request quote.tokenIn and quote.tokenOut must be different");
        return true;
      },
    );

    assert.equal(calls.length, 0);
  } finally {
    restoreFetch();
  }
});

test("RFQClient percent-encodes safe dynamic status path identifiers", async () => {
  const calls = [];
  const quoteId = "q:test-id";
  const hedgeOrderId = "h:test-id";
  const settlementEventId = "se:test-id";
  const restoreFetch = installFetch(async (url) => {
    calls.push(url);
    if (url.endsWith(`/quote/${encodeURIComponent(quoteId)}`)) {
      return jsonResponse(200, {
        quoteId,
        status: "settled",
        txHash: `0x${"22".repeat(32)}`,
        settlementEventId,
      });
    }
    if (url.endsWith(`/hedges/${encodeURIComponent(hedgeOrderId)}`)) {
      return jsonResponse(200, {
        hedgeOrderId,
        status: "queued",
        settlementEventId,
        quoteId,
        chainId: quote.chainId,
        token: quote.tokenOut,
        side: "buy",
        amount: quote.amountOut,
        reason: "inventory_rebalance",
        createdAt: "2026-06-27T00:00:00.000Z",
      });
    }
    if (url.endsWith(`/settlements/${encodeURIComponent(settlementEventId)}`)) {
      return jsonResponse(200, {
        settlementEventId,
        status: "applied",
        quoteId,
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
      });
    }

    return jsonResponse(404, { code: "QUOTE_NOT_FOUND", message: "not found", traceId: "trace_not_found" });
  });

  try {
    const client = new RFQClient("http://127.0.0.1:3000");

    await client.getQuote(quoteId);
    await client.getHedge(hedgeOrderId);
    await client.getSettlement(settlementEventId);

    assert.deepEqual(calls, [
      "http://127.0.0.1:3000/quote/q%3Atest-id",
      "http://127.0.0.1:3000/hedges/h%3Atest-id",
      "http://127.0.0.1:3000/settlements/se%3Atest-id",
    ]);
  } finally {
    restoreFetch();
  }
});

test("RFQClient rejects unsafe dynamic status identifiers before fetch", async () => {
  const calls = [];
  const restoreFetch = installFetch(async (url) => {
    calls.push(url);
    return jsonResponse(500, {
      code: "INTERNAL_ERROR",
      message: "unexpected fetch",
      traceId: "trace_unexpected_fetch",
    });
  });

  try {
    const client = new RFQClient("http://127.0.0.1:3000");

    for (const [operation, expectedMessage] of [
      [() => client.getQuote(new String("q_test")), "quoteId must be a primitive string"],
      [() => client.getQuote(" "), "quoteId must be a non-empty string"],
      [() => client.getQuote("q/bad"), "quoteId must contain only letters, numbers, underscore, colon, or hyphen"],
      [() => client.getQuote("q".repeat(129)), "quoteId must be 128 characters or fewer"],
      [() => client.getHedge(new String("h_test")), "hedgeOrderId must be a primitive string"],
      [() => client.getHedge(""), "hedgeOrderId must be a non-empty string"],
      [() => client.getHedge("h/bad"), "hedgeOrderId must contain only letters, numbers, underscore, colon, or hyphen"],
      [() => client.getHedge("h".repeat(129)), "hedgeOrderId must be 128 characters or fewer"],
      [() => client.getSettlement(new String("se_test")), "settlementEventId must be a primitive string"],
      [() => client.getSettlement(" \n "), "settlementEventId must be a non-empty string"],
      [
        () => client.getSettlement("se/bad"),
        "settlementEventId must contain only letters, numbers, underscore, colon, or hyphen",
      ],
      [() => client.getSettlement("s".repeat(129)), "settlementEventId must be 128 characters or fewer"],
    ]) {
      await assert.rejects(operation(), (error) => {
        assert.ok(error instanceof RFQClientError);
        assert.equal(error.status, 0);
        assert.equal(error.code, "RFQ_CLIENT_ERROR");
        assert.equal(error.message, expectedMessage);
        return true;
      });
    }

    assert.deepEqual(calls, []);
  } finally {
    restoreFetch();
  }
});

test("RFQClient throws structured RFQClientError for API errors", async () => {
  const restoreFetch = installFetch(async () =>
    jsonResponse(
      409,
      {
        code: "RISK_REJECTED",
        message: "Risk policy rejected quote",
        traceId: "tr_body_test",
      },
      { "x-trace-id": "tr_header_should_not_win" },
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
        slippageBps: 999,
      }),
      (error) => {
        assert.ok(error instanceof RFQClientError);
        assert.equal(error.status, 409);
        assert.equal(error.code, "RISK_REJECTED");
        assert.equal(error.message, "Risk policy rejected quote");
        assert.equal(error.traceId, "tr_body_test");
        return true;
      },
    );
  } finally {
    restoreFetch();
  }
});

test("RFQClient ignores non-closed API error bodies", async () => {
  const restoreFetch = installFetch(async () =>
    jsonResponse(
      409,
      {
        code: "RISK_REJECTED",
        message: "Risk policy rejected quote",
        traceId: "tr_body_test",
        reasonCode: "TOXIC_FLOW_SCORE",
      },
      { "x-trace-id": "tr_closed_error_header" },
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
        assert.equal(error.status, 409);
        assert.equal(error.code, "RFQ_CLIENT_ERROR");
        assert.equal(error.message, "RFQ quote failed");
        assert.equal(error.traceId, "tr_closed_error_header");
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
        traceId: "tr_rate_limited",
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
        assert.equal(error.traceId, "tr_rate_limited");
        assert.equal(error.retryAfterSeconds, 60);
        return true;
      },
    );
  } finally {
    restoreFetch();
  }
});

test("RFQClient ignores non-canonical Retry-After headers", async () => {
  for (const value of ["0", "060", "60.0", "6e1", "9007199254740992", "Fri, 31 Dec 2027 23:59:59 GMT"]) {
    const restoreFetch = installFetch(async () =>
      jsonResponse(
        429,
        {
          code: "RATE_LIMITED",
          message: "Too many requests",
          traceId: "tr_rate_limited",
        },
        { "retry-after": value },
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
          assert.equal(error.retryAfterSeconds, undefined);
          return true;
        },
      );
    } finally {
      restoreFetch();
    }
  }
});

test("RFQClient falls back for unknown API error codes", async () => {
  const restoreFetch = installFetch(async () =>
    jsonResponse(
      500,
      {
        code: "NEW_SERVER_ERROR",
        message: "Unexpected server error",
        traceId: "tr_unknown",
      },
      { "x-trace-id": "tr_header_unknown" },
    ),
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
        assert.equal(error.traceId, "tr_header_unknown");
        return true;
      },
    );
  } finally {
    restoreFetch();
  }
});

test("RFQClient ignores prototype-backed API error bodies", async () => {
  const restoreFetch = installFetch(async () =>
    jsonResponse(
      409,
      Object.create({
        code: "RISK_REJECTED",
        message: "Risk policy rejected quote",
        traceId: "tr_prototype_body",
      }),
      { "x-trace-id": "tr_error_header" },
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
        assert.equal(error.status, 409);
        assert.equal(error.code, "RFQ_CLIENT_ERROR");
        assert.equal(error.message, "RFQ quote failed");
        assert.equal(error.traceId, "tr_error_header");
        return true;
      },
    );
  } finally {
    restoreFetch();
  }
});

test("RFQClient ignores unsafe response trace ids and falls back to safe trace headers", async () => {
  const restoreFetch = installFetch(async () =>
    jsonResponse(
      409,
      {
        code: "RISK_REJECTED",
        message: "Risk policy rejected quote",
        traceId: "unsafe trace id",
      },
      { "x-trace-id": "tr_safe_header" },
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
        assert.equal(error.status, 409);
        assert.equal(error.code, "RISK_REJECTED");
        assert.equal(error.message, "Risk policy rejected quote");
        assert.equal(error.traceId, "tr_safe_header");
        return true;
      },
    );
  } finally {
    restoreFetch();
  }

  const restoreUnsafeHeaderFetch = installFetch(async () => textResponse(200, "not json", { "x-trace-id": "../bad" }));

  try {
    const client = new RFQClient("http://127.0.0.1:3000");

    await assert.rejects(
      client.health(),
      (error) => {
        assert.ok(error instanceof RFQClientError);
        assert.equal(error.status, 200);
        assert.equal(error.code, "RFQ_CLIENT_ERROR");
        assert.equal(error.message, "RFQ health response returned malformed JSON");
        assert.equal(error.traceId, undefined);
        return true;
      },
    );
  } finally {
    restoreUnsafeHeaderFetch();
  }
});

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

test("RFQClient rejects malformed health and readiness status responses", async () => {
  const malformedHealthCases = [
    Object.create({ status: "ok" }),
    {
      status: "ok",
      version: "debug-build",
    },
  ];

  for (const payload of malformedHealthCases) {
    const restoreHealthFetch = installFetch(async () => jsonResponse(200, payload));

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
  }

  const malformedReadinessCases = [
    Object.create({
      status: "ready",
      components: readinessComponents,
    }),
    {
      status: "ready",
      generatedAt: "2026-06-27T00:00:00.000Z",
      components: readinessComponents,
    },
    {
      status: "ready",
      components: {
        ...readinessComponents,
        signer: "unknown",
      },
    },
    {
      status: "ready",
      components: {
        signer: "ok",
      },
    },
    {
      status: "ready",
      components: {
        ...readinessComponents,
        externalUrl: "ok",
      },
    },
  ];

  for (const payload of malformedReadinessCases) {
    const restoreReadyFetch = installFetch(async () => jsonResponse(200, payload));

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
  }
});

test("RFQClient rejects malformed hedge status responses", async () => {
  const hedgeResponse = {
    hedgeOrderId: "h_1_00000003_000001",
    status: "queued",
    settlementEventId: "se_1_22222222_0",
    quoteId: "q_test",
    chainId: quote.chainId,
    token: quote.tokenOut,
    side: "buy",
    amount: quote.amountOut,
    reason: "inventory_rebalance",
    createdAt: "2026-06-27T00:00:00.000Z",
  };

  const cases = [
    {
      payload: { ...hedgeResponse, hedgeOrderId: "" },
      message: "RFQ hedge status response returned malformed hedgeOrderId",
    },
    {
      payload: { ...hedgeResponse, hedgeOrderId: "h.bad" },
      message: "RFQ hedge status response returned malformed hedgeOrderId",
    },
    {
      payload: { ...hedgeResponse, settlementEventId: "se".repeat(65) },
      message: "RFQ hedge status response returned malformed settlementEventId",
    },
    {
      payload: { ...hedgeResponse, quoteId: "q/bad" },
      message: "RFQ hedge status response returned malformed quoteId",
    },
    {
      payload: { ...hedgeResponse, status: "submitted" },
      message: "RFQ hedge status response returned malformed status",
    },
    {
      payload: { ...hedgeResponse, venue: "CEX_A" },
      message: "RFQ hedge status response returned malformed venue",
    },
    {
      payload: { ...hedgeResponse, chainId: 0 },
      message: "RFQ hedge status response returned malformed chainId",
    },
    {
      payload: { ...hedgeResponse, chainId: "1" },
      message: "RFQ hedge status response returned malformed chainId",
    },
    {
      payload: { ...hedgeResponse, token: "0x1234" },
      message: "RFQ hedge status response returned malformed token",
    },
    {
      payload: { ...hedgeResponse, side: "hold" },
      message: "RFQ hedge status response returned malformed side",
    },
    {
      payload: { ...hedgeResponse, amount: "0" },
      message: "RFQ hedge status response returned malformed amount",
    },
    {
      payload: { ...hedgeResponse, reason: "manual" },
      message: "RFQ hedge status response returned malformed reason",
    },
    {
      payload: { ...hedgeResponse, createdAt: "not-a-date" },
      message: "RFQ hedge status response returned malformed createdAt",
    },
    {
      payload: { ...hedgeResponse, createdAt: "2026-06-27" },
      message: "RFQ hedge status response returned malformed createdAt",
    },
    {
      payload: { ...hedgeResponse, externalOrderId: " " },
      message: "RFQ hedge status response returned malformed externalOrderId",
    },
    {
      payload: { ...hedgeResponse, updatedAt: "not-a-date" },
      message: "RFQ hedge status response returned malformed updatedAt",
    },
  ];

  for (const { payload, message } of cases) {
    const restoreFetch = installFetch(async () => jsonResponse(200, payload));

    try {
      const client = new RFQClient("http://127.0.0.1:3000");

      await assert.rejects(
        client.getHedge("h_1_00000003_000001"),
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

test("RFQClient accepts terminal hedge status responses", async () => {
  const terminalResponses = [
    {
      hedgeOrderId: "h_1_00000003_000001",
      status: "filled",
      settlementEventId: "se_1_22222222_0",
      quoteId: "q_test",
      chainId: quote.chainId,
      token: quote.tokenOut,
      side: "buy",
      amount: quote.amountOut,
      reason: "inventory_rebalance",
      createdAt: "2026-06-27T00:00:00.000Z",
      externalOrderId: "cex_order_1",
      updatedAt: "2026-06-27T00:00:01.000Z",
    },
    {
      hedgeOrderId: "h_1_00000003_000002",
      status: "failed",
      settlementEventId: "se_1_33333333_0",
      quoteId: "q_failed",
      chainId: quote.chainId,
      token: quote.tokenOut,
      side: "buy",
      amount: quote.amountOut,
      reason: "risk_reduction",
      createdAt: "2026-06-27T00:00:00.000Z",
      updatedAt: "2026-06-27T00:00:02.000Z",
    },
  ];
  let index = 0;
  const restoreFetch = installFetch(async () => jsonResponse(200, terminalResponses[index++]));

  try {
    const client = new RFQClient("http://127.0.0.1:3000");

    assert.deepEqual(await client.getHedge(terminalResponses[0].hedgeOrderId), terminalResponses[0]);
    assert.deepEqual(await client.getHedge(terminalResponses[1].hedgeOrderId), terminalResponses[1]);
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

test("RFQClient returns degraded readiness payloads from HTTP 503", async () => {
  const readinessResponse = {
    status: "degraded",
    components: {
      ...readinessComponents,
      marketData: "degraded",
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
