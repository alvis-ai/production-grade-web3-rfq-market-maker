import assert from "node:assert/strict";
import test from "node:test";
import { buildServer, installGracefulShutdown, readServerListenConfig } from "../dist/main.js";

const baseQuoteRequest = {
  chainId: 1,
  user: "0x0000000000000000000000000000000000000001",
  tokenIn: "0x0000000000000000000000000000000000000002",
  tokenOut: "0x0000000000000000000000000000000000000003",
  amountIn: "1000000000",
  slippageBps: 50,
};

test("production startup requires explicit signer configuration", () => {
  const originalEnv = {
    NODE_ENV: process.env.NODE_ENV,
    RFQ_SIGNER_PRIVATE_KEY: process.env.RFQ_SIGNER_PRIVATE_KEY,
    RFQ_SETTLEMENT_ADDRESS: process.env.RFQ_SETTLEMENT_ADDRESS,
    RFQ_QUOTE_TTL_SECONDS: process.env.RFQ_QUOTE_TTL_SECONDS,
    RFQ_BODY_LIMIT_BYTES: process.env.RFQ_BODY_LIMIT_BYTES,
    RFQ_CORS_ALLOWED_ORIGINS: process.env.RFQ_CORS_ALLOWED_ORIGINS,
    RFQ_ENABLE_HSTS: process.env.RFQ_ENABLE_HSTS,
  };

  try {
    process.env.NODE_ENV = "production";
    delete process.env.RFQ_SIGNER_PRIVATE_KEY;
    delete process.env.RFQ_SETTLEMENT_ADDRESS;
    delete process.env.RFQ_QUOTE_TTL_SECONDS;
    delete process.env.RFQ_BODY_LIMIT_BYTES;
    delete process.env.RFQ_CORS_ALLOWED_ORIGINS;
    delete process.env.RFQ_ENABLE_HSTS;

    assert.throws(
      () => buildServer({ logger: false }),
      /RFQ_SIGNER_PRIVATE_KEY is required when NODE_ENV=production/,
    );

    process.env.RFQ_SIGNER_PRIVATE_KEY =
      "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

    assert.throws(
      () => buildServer({ logger: false }),
      /RFQ_SETTLEMENT_ADDRESS is required when NODE_ENV=production/,
    );

    process.env.RFQ_SIGNER_PRIVATE_KEY = "replace-with-production-signer-private-key";
    process.env.RFQ_SETTLEMENT_ADDRESS = "0x0000000000000000000000000000000000000004";

    assert.throws(
      () => buildServer({ logger: false }),
      /RFQ_SIGNER_PRIVATE_KEY must be a 32-byte hex string when NODE_ENV=production/,
    );

    process.env.RFQ_SIGNER_PRIVATE_KEY =
      "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
    process.env.RFQ_SETTLEMENT_ADDRESS = "replace-with-rfq-settlement-address";

    assert.throws(
      () => buildServer({ logger: false }),
      /RFQ_SETTLEMENT_ADDRESS must be a 20-byte hex address when NODE_ENV=production/,
    );
  } finally {
    restoreEnv("NODE_ENV", originalEnv.NODE_ENV);
    restoreEnv("RFQ_SIGNER_PRIVATE_KEY", originalEnv.RFQ_SIGNER_PRIVATE_KEY);
    restoreEnv("RFQ_SETTLEMENT_ADDRESS", originalEnv.RFQ_SETTLEMENT_ADDRESS);
    restoreEnv("RFQ_QUOTE_TTL_SECONDS", originalEnv.RFQ_QUOTE_TTL_SECONDS);
    restoreEnv("RFQ_BODY_LIMIT_BYTES", originalEnv.RFQ_BODY_LIMIT_BYTES);
    restoreEnv("RFQ_CORS_ALLOWED_ORIGINS", originalEnv.RFQ_CORS_ALLOWED_ORIGINS);
    restoreEnv("RFQ_ENABLE_HSTS", originalEnv.RFQ_ENABLE_HSTS);
  }
});

test("non-local startup requires explicit signer configuration", () => {
  const originalEnv = {
    NODE_ENV: process.env.NODE_ENV,
    RFQ_SIGNER_PRIVATE_KEY: process.env.RFQ_SIGNER_PRIVATE_KEY,
    RFQ_SETTLEMENT_ADDRESS: process.env.RFQ_SETTLEMENT_ADDRESS,
  };

  try {
    process.env.NODE_ENV = "staging";
    delete process.env.RFQ_SIGNER_PRIVATE_KEY;
    delete process.env.RFQ_SETTLEMENT_ADDRESS;

    assert.throws(
      () => buildServer({ logger: false }),
      /RFQ_SIGNER_PRIVATE_KEY is required when NODE_ENV=staging/,
    );

    process.env.RFQ_SIGNER_PRIVATE_KEY =
      "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

    assert.throws(
      () => buildServer({ logger: false }),
      /RFQ_SETTLEMENT_ADDRESS is required when NODE_ENV=staging/,
    );
  } finally {
    restoreEnv("NODE_ENV", originalEnv.NODE_ENV);
    restoreEnv("RFQ_SIGNER_PRIVATE_KEY", originalEnv.RFQ_SIGNER_PRIVATE_KEY);
    restoreEnv("RFQ_SETTLEMENT_ADDRESS", originalEnv.RFQ_SETTLEMENT_ADDRESS);
  }
});

test("RFQ API uses RFQ_QUOTE_TTL_SECONDS for signed quote deadlines", async () => {
  const originalTtl = process.env.RFQ_QUOTE_TTL_SECONDS;
  const originalDateNow = Date.now;
  const fixedNow = originalDateNow();
  process.env.RFQ_QUOTE_TTL_SECONDS = "120";
  Date.now = () => fixedNow;

  const server = buildServer({ logger: false });
  await server.ready();

  try {
    const quote = await injectJson(server, "POST", "/quote", baseQuoteRequest);

    assert.equal(quote.statusCode, 200);
    assert.equal(quote.body.deadline, Math.floor(fixedNow / 1000) + 120);
  } finally {
    await server.close();
    Date.now = originalDateNow;
    restoreEnv("RFQ_QUOTE_TTL_SECONDS", originalTtl);
  }
});

test("RFQ API rejects invalid RFQ_QUOTE_TTL_SECONDS at startup", () => {
  const originalTtl = process.env.RFQ_QUOTE_TTL_SECONDS;

  try {
    for (const ttl of ["0", "3601", "1e2", "30.0", "+30", "0x1e"]) {
      process.env.RFQ_QUOTE_TTL_SECONDS = ttl;

      assert.throws(
        () => buildServer({ logger: false }),
        /RFQ_QUOTE_TTL_SECONDS must be a base-10 integer between 1 and 3600/,
      );
    }
  } finally {
    restoreEnv("RFQ_QUOTE_TTL_SECONDS", originalTtl);
  }
});

test("RFQ API rejects invalid RFQ_BODY_LIMIT_BYTES at startup", () => {
  const originalBodyLimit = process.env.RFQ_BODY_LIMIT_BYTES;

  try {
    for (const bodyLimit of ["1023", "1048577", "3.2768e4", "32768.0", "+32768", "0x8000"]) {
      process.env.RFQ_BODY_LIMIT_BYTES = bodyLimit;

      assert.throws(
        () => buildServer({ logger: false }),
        /RFQ_BODY_LIMIT_BYTES must be a base-10 integer between 1024 and 1048576/,
      );
    }
  } finally {
    restoreEnv("RFQ_BODY_LIMIT_BYTES", originalBodyLimit);
  }
});

test("RFQ API rejects invalid RFQ_CORS_ALLOWED_ORIGINS at startup", () => {
  const originalOrigins = process.env.RFQ_CORS_ALLOWED_ORIGINS;

  try {
    for (const origins of [
      "not-an-origin",
      "https:app.example.com",
      "https://app.example.com/",
      "https://app.example.com/path",
      "https://app.example.com?debug=true",
      "https://app.example.com#prod",
      "https://*.example.com",
      "https://user:pass@app.example.com",
      "ftp://app.example.com",
    ]) {
      process.env.RFQ_CORS_ALLOWED_ORIGINS = origins;

      assert.throws(
        () => buildServer({ logger: false }),
        /RFQ_CORS_ALLOWED_ORIGINS must be a comma-separated list of HTTP\(S\) URL origins without path, query, fragment, credentials, or wildcards/,
      );
    }
  } finally {
    restoreEnv("RFQ_CORS_ALLOWED_ORIGINS", originalOrigins);
  }
});

test("RFQ API normalizes RFQ_CORS_ALLOWED_ORIGINS at startup", async () => {
  const originalOrigins = process.env.RFQ_CORS_ALLOWED_ORIGINS;

  try {
    process.env.RFQ_CORS_ALLOWED_ORIGINS =
      " https://APP.EXAMPLE.COM:443 , http://localhost:5173, https://app.example.com ";
    const server = buildServer({ logger: false });
    await server.ready();

    try {
      const response = await server.inject({
        method: "GET",
        url: "/health",
        headers: { origin: "https://app.example.com" },
      });

      assert.equal(response.statusCode, 200);
      assert.equal(response.headers["access-control-allow-origin"], "https://app.example.com");
    } finally {
      await server.close();
    }
  } finally {
    restoreEnv("RFQ_CORS_ALLOWED_ORIGINS", originalOrigins);
  }
});

test("RFQ API rejects invalid RFQ_ENABLE_HSTS at startup", () => {
  const originalHsts = process.env.RFQ_ENABLE_HSTS;

  try {
    process.env.RFQ_ENABLE_HSTS = "sometimes";

    assert.throws(
      () => buildServer({ logger: false }),
      /RFQ_ENABLE_HSTS must be true or false/,
    );
  } finally {
    restoreEnv("RFQ_ENABLE_HSTS", originalHsts);
  }
});

test("RFQ API rejects invalid RFQ_TRUST_PROXY at startup", () => {
  const originalTrustProxy = process.env.RFQ_TRUST_PROXY;

  try {
    process.env.RFQ_TRUST_PROXY = "sometimes";

    assert.throws(
      () => buildServer({ logger: false }),
      /RFQ_TRUST_PROXY must be true or false/,
    );
  } finally {
    restoreEnv("RFQ_TRUST_PROXY", originalTrustProxy);
  }
});

test("RFQ API validates standalone listen configuration", () => {
  assert.deepEqual(readServerListenConfig({ env: {} }), {
    host: "127.0.0.1",
    port: 3000,
  });
  assert.deepEqual(readServerListenConfig({ env: { HOST: " 0.0.0.0 ", PORT: "8080" } }), {
    host: "0.0.0.0",
    port: 8080,
  });

  assert.throws(
    () => readServerListenConfig({ env: { PORT: "65536" } }),
    /PORT must be a base-10 integer between 1 and 65535/,
  );
  assert.throws(
    () => readServerListenConfig({ env: { PORT: "3000.5" } }),
    /PORT must be a base-10 integer between 1 and 65535/,
  );
  assert.throws(
    () => readServerListenConfig({ env: { PORT: "3e3" } }),
    /PORT must be a base-10 integer between 1 and 65535/,
  );
  assert.throws(
    () => readServerListenConfig({ env: { PORT: "0x0bb8" } }),
    /PORT must be a base-10 integer between 1 and 65535/,
  );
  assert.throws(
    () => readServerListenConfig({ env: { HOST: "127.0.0.1 local" } }),
    /HOST must be a non-empty hostname or IP address without whitespace/,
  );
});

test("RFQ API reads startup environment only from own fields", async () => {
  assert.deepEqual(readServerListenConfig({ env: Object.create({ HOST: "0.0.0.0", PORT: "8080" }) }), {
    host: "127.0.0.1",
    port: 3000,
  });

  const originalEnv = {
    NODE_ENV: process.env.NODE_ENV,
    RFQ_SIGNER_PRIVATE_KEY: process.env.RFQ_SIGNER_PRIVATE_KEY,
    RFQ_SETTLEMENT_ADDRESS: process.env.RFQ_SETTLEMENT_ADDRESS,
    RFQ_QUOTE_TTL_SECONDS: process.env.RFQ_QUOTE_TTL_SECONDS,
    RFQ_CORS_ALLOWED_ORIGINS: process.env.RFQ_CORS_ALLOWED_ORIGINS,
    RFQ_ENABLE_HSTS: process.env.RFQ_ENABLE_HSTS,
  };
  const originalEnvPrototype = Object.getPrototypeOf(process.env);
  const fixedNow = Date.now();
  const originalDateNow = Date.now;

  try {
    delete process.env.NODE_ENV;
    delete process.env.RFQ_SIGNER_PRIVATE_KEY;
    delete process.env.RFQ_SETTLEMENT_ADDRESS;
    delete process.env.RFQ_QUOTE_TTL_SECONDS;
    delete process.env.RFQ_CORS_ALLOWED_ORIGINS;
    delete process.env.RFQ_ENABLE_HSTS;
    Object.setPrototypeOf(process.env, {
      NODE_ENV: "production",
      RFQ_SIGNER_PRIVATE_KEY: "replace-with-production-signer-private-key",
      RFQ_SETTLEMENT_ADDRESS: "replace-with-rfq-settlement-address",
      RFQ_QUOTE_TTL_SECONDS: "120",
      RFQ_CORS_ALLOWED_ORIGINS: "https://evil.example.com",
      RFQ_ENABLE_HSTS: "true",
    });
    Date.now = () => fixedNow;

    const server = buildServer({ logger: false });
    await server.ready();

    try {
      const quote = await injectJson(server, "POST", "/quote", baseQuoteRequest);
      assert.equal(quote.statusCode, 200);
      assert.equal(quote.body.deadline, Math.floor(fixedNow / 1000) + 30);

      const health = await server.inject({
        method: "GET",
        url: "/health",
        headers: { origin: "https://evil.example.com" },
      });
      assert.equal(health.headers["access-control-allow-origin"], undefined);
      assert.equal(health.headers["strict-transport-security"], undefined);
    } finally {
      await server.close();
    }
  } finally {
    Object.setPrototypeOf(process.env, originalEnvPrototype);
    Date.now = originalDateNow;
    restoreEnv("NODE_ENV", originalEnv.NODE_ENV);
    restoreEnv("RFQ_SIGNER_PRIVATE_KEY", originalEnv.RFQ_SIGNER_PRIVATE_KEY);
    restoreEnv("RFQ_SETTLEMENT_ADDRESS", originalEnv.RFQ_SETTLEMENT_ADDRESS);
    restoreEnv("RFQ_QUOTE_TTL_SECONDS", originalEnv.RFQ_QUOTE_TTL_SECONDS);
    restoreEnv("RFQ_CORS_ALLOWED_ORIGINS", originalEnv.RFQ_CORS_ALLOWED_ORIGINS);
    restoreEnv("RFQ_ENABLE_HSTS", originalEnv.RFQ_ENABLE_HSTS);
  }
});

test("RFQ API rejects unsafe rate limit configuration at startup", () => {
  assert.throws(
    () => buildServer({
      logger: false,
      rateLimit: {
        windowMs: 0,
      },
    }),
    /Rate limit windowMs must be a positive safe integer/,
  );

  assert.throws(
    () => buildServer({
      logger: false,
      rateLimit: {
        maxSubmitRequests: 0,
      },
    }),
    /Rate limit maxSubmitRequests must be a positive safe integer/,
  );
});

test("RFQ API rejects unsafe direct runtime options at startup", () => {
  assert.throws(
    () => buildServer(null),
    /buildServer options must be an object/,
  );
  assert.throws(
    () => buildServer([]),
    /buildServer options must be an object/,
  );
  assert.throws(
    () => buildServer(Object.create({ logger: false })),
    /buildServer options.logger must be an own field when provided/,
  );
  assert.throws(
    () => buildServer({ logger: "false" }),
    /logger must be a boolean/,
  );
  assert.throws(
    () => buildServer({ logger: false, bodyLimitBytes: 1023 }),
    /bodyLimitBytes must be an integer between 1024 and 1048576/,
  );
  assert.throws(
    () => buildServer({ logger: false, quoteTtlSeconds: 3601 }),
    /quoteTtlSeconds must be an integer between 1 and 3600/,
  );
  assert.throws(
    () => buildServer({ logger: false, quoteTtlSeconds: 30.5 }),
    /quoteTtlSeconds must be an integer between 1 and 3600/,
  );
  assert.throws(
    () => buildServer({ logger: false, enableHsts: "true" }),
    /enableHsts must be a boolean/,
  );
  assert.throws(
    () => buildServer({ logger: false, trustProxy: "true" }),
    /trustProxy must be a boolean/,
  );
  assert.throws(
    () => buildServer({ logger: false, rateLimit: "enabled" }),
    /buildServer rateLimit must be an object or false/,
  );
  assert.throws(
    () => buildServer({ logger: false, rateLimit: Object.create({ windowMs: 60_000 }) }),
    /buildServer rateLimit.windowMs must be an own field when provided/,
  );
});

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
    assert.equal(response.headers["access-control-allow-headers"], "content-type,x-trace-id");
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

function restoreEnv(name, value) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}
