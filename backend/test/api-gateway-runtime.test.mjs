import assert from "node:assert/strict";
import test from "node:test";
import { buildServer, installGracefulShutdown } from "../dist/main.js";

test("RFQ API emits baseline security headers on successful responses", async () => {
  const server = buildServer({ logger: false });
  await server.ready();

  try {
    const response = await server.inject({ method: "GET", url: "/health" });

    assert.equal(response.statusCode, 200);
    assertSecurityHeaders(response, { hsts: false });
  } finally {
    await server.close();
  }
});

test("RFQ API emits HSTS when enabled", async () => {
  const server = buildServer({ logger: false, enableHsts: true });
  await server.ready();

  try {
    const response = await server.inject({ method: "GET", url: "/health" });

    assert.equal(response.statusCode, 200);
    assertSecurityHeaders(response, { hsts: true });
  } finally {
    await server.close();
  }
});

test("RFQ API registers graceful shutdown handlers for termination signals", async () => {
  const listeners = new Map();
  const fakeProcess = {
    exitCode: undefined,
    on(signal, listener) {
      listeners.set(signal, listener);
    },
  };
  let closeCount = 0;
  const fakeServer = {
    async close() {
      closeCount += 1;
    },
  };

  installGracefulShutdown(fakeServer, fakeProcess);

  assert.equal(typeof listeners.get("SIGTERM"), "function");
  assert.equal(typeof listeners.get("SIGINT"), "function");

  listeners.get("SIGTERM")();
  listeners.get("SIGINT")();
  await flushMicrotasks();

  assert.equal(closeCount, 1);
  assert.equal(fakeProcess.exitCode, 0);
});

test("RFQ API marks graceful shutdown failures as process failures", async () => {
  const listeners = new Map();
  const fakeProcess = {
    exitCode: undefined,
    on(signal, listener) {
      listeners.set(signal, listener);
    },
  };
  const logged = [];
  const fakeServer = {
    async close() {
      throw new Error("close failed");
    },
  };

  installGracefulShutdown(fakeServer, fakeProcess, {
    error(input) {
      logged.push(input);
    },
  });

  listeners.get("SIGTERM")();
  await flushMicrotasks();

  assert.equal(fakeProcess.exitCode, 1);
  assert.match(String(logged[0]), /close failed/);
});

test("RFQ API emits CORS headers for allowed browser origins", async () => {
  const server = buildServer({
    logger: false,
    corsAllowedOrigins: ["https://app.example.com"],
  });
  await server.ready();

  try {
    const response = await server.inject({
      method: "GET",
      url: "/health",
      headers: { origin: "https://app.example.com" },
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.headers["access-control-allow-origin"], "https://app.example.com");
    assert.equal(response.headers.vary, "Origin");
    assert.equal(response.headers["access-control-allow-methods"], "GET,POST,OPTIONS");
    assert.equal(response.headers["access-control-allow-headers"], "content-type,x-api-key,x-trace-id");
    assert.equal(response.headers["access-control-max-age"], "600");
  } finally {
    await server.close();
  }
});

test("RFQ API answers CORS preflight for allowed origins", async () => {
  const server = buildServer({
    logger: false,
    corsAllowedOrigins: ["https://app.example.com"],
  });
  await server.ready();

  try {
    const response = await server.inject({
      method: "OPTIONS",
      url: "/quote",
      headers: {
        origin: "https://app.example.com",
        "access-control-request-method": "POST",
      },
    });

    assert.equal(response.statusCode, 204);
    assert.equal(response.headers["access-control-allow-origin"], "https://app.example.com");
    assert.equal(response.headers["access-control-allow-methods"], "GET,POST,OPTIONS");
    assert.equal(response.payload, "");
  } finally {
    await server.close();
  }
});

test("RFQ API rejects CORS preflight for disallowed origins", async () => {
  const server = buildServer({
    logger: false,
    corsAllowedOrigins: ["https://app.example.com"],
  });
  await server.ready();

  try {
    const response = await server.inject({
      method: "OPTIONS",
      url: "/quote",
      headers: {
        origin: "https://evil.example.com",
        "access-control-request-method": "POST",
      },
    });
    const body = JSON.parse(response.payload);

    assert.equal(response.statusCode, 403);
    assert.equal(body.code, "INVALID_REQUEST");
    assert.equal(body.message, "CORS origin is not allowed");
    assert.match(body.traceId, /^tr_/);
    assert.equal(response.headers["x-trace-id"], body.traceId);
    assert.equal(response.headers["access-control-allow-origin"], undefined);
  } finally {
    await server.close();
  }
});

test("RFQ API propagates safe incoming trace ids and falls back for unsafe values", async () => {
  const server = buildServer({ logger: false });
  await server.ready();

  try {
    const health = await injectJson(server, "GET", "/health", undefined, {
      "x-trace-id": "tr_client_123",
    });

    assert.equal(health.statusCode, 200);
    assert.equal(health.headers["x-trace-id"], "tr_client_123");

    const missingQuote = await injectJson(server, "GET", "/quote/q_missing", undefined, {
      "x-trace-id": "tr_client_error",
    });

    assert.equal(missingQuote.statusCode, 404);
    assert.equal(missingQuote.body.code, "QUOTE_NOT_FOUND");
    assert.equal(missingQuote.headers["x-trace-id"], "tr_client_error");
    assert.equal(missingQuote.body.traceId, "tr_client_error");

    const unsafeTrace = await injectJson(server, "GET", "/quote/q_missing", undefined, {
      "x-trace-id": "trace with spaces",
    });

    assert.equal(unsafeTrace.statusCode, 404);
    assert.match(unsafeTrace.body.traceId, /^tr_/);
    assert.equal(unsafeTrace.headers["x-trace-id"], unsafeTrace.body.traceId);
    assert.notEqual(unsafeTrace.body.traceId, "trace with spaces");
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

function assertSecurityHeaders(response, { hsts }) {
  assert.equal(response.headers["cache-control"], "no-store");
  assert.equal(response.headers["x-content-type-options"], "nosniff");
  assert.equal(response.headers["x-frame-options"], "DENY");
  assert.equal(response.headers["referrer-policy"], "no-referrer");
  assert.equal(response.headers["permissions-policy"], "camera=(), microphone=(), geolocation=()");
  if (hsts) {
    assert.equal(response.headers["strict-transport-security"], "max-age=31536000; includeSubDomains");
  } else {
    assert.equal(response.headers["strict-transport-security"], undefined);
  }
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}
