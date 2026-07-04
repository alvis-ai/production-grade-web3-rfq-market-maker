import assert from "node:assert/strict";
import test from "node:test";
import { RFQClient, RFQClientError } from "../dist/index.js";

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
