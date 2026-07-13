import assert from "node:assert/strict";
import test from "node:test";
import {
  RFQClient,
  RFQClientError,
} from "../dist/index.js";

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

test("RFQClient sends API keys only to protected endpoints and supports rotation providers", async () => {
  const calls = [];
  const key = "client_primary.0123456789abcdefghijklmnopqrstuvwxyz_ABCD";
  const client = new RFQClient("http://127.0.0.1:3000", {
    apiKey: () => key,
    fetch: async (url, init = {}) => {
      calls.push({ url, init });
      if (url.endsWith("/health")) return jsonResponse(200, { status: "ok" });
      return jsonResponse(401, {
        code: "AUTHENTICATION_REQUIRED",
        message: "Valid API key required",
        traceId: "tr_sdk_auth",
      }, { "x-trace-id": "tr_sdk_auth" });
    },
  });

  assert.deepEqual(await client.health(), { status: "ok" });
  await assert.rejects(client.getQuote("q_123"), (error) => {
    assert.ok(error instanceof RFQClientError);
    assert.equal(error.code, "AUTHENTICATION_REQUIRED");
    return true;
  });
  assert.deepEqual(calls[0].init, {});
  assert.deepEqual(calls[1].init.headers, { "x-api-key": key });
});

test("RFQClient validates static and rotating API key options without evaluating them for public probes", async () => {
  for (const value of [null, new String("client_primary.secret"), "client_primary.short", "bad key.secret"]) {
    assert.throws(() => new RFQClient("http://127.0.0.1:3000", { apiKey: value }), RFQClientError);
  }

  const client = new RFQClient("http://127.0.0.1:3000", {
    apiKey: () => "invalid",
    fetch: async () => jsonResponse(200, { status: "ok" }),
  });
  assert.deepEqual(await client.health(), { status: "ok" });
  await assert.rejects(client.getQuote("q_123"), /keyId.secret format/);
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
