import assert from "node:assert/strict";
import test from "node:test";
import { buildServer, readServerListenConfig } from "../dist/main.js";

const baseQuoteRequest = {
  chainId: 1,
  user: "0x0000000000000000000000000000000000000001",
  tokenIn: "0x0000000000000000000000000000000000000002",
  tokenOut: "0x0000000000000000000000000000000000000003",
  amountIn: "1000000000",
  slippageBps: 50,
};

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

test("RFQ API rejects malformed RFQ_CEX_PAIRS before starting market data workers", () => {
  const originalPairs = process.env.RFQ_CEX_PAIRS;

  try {
    for (const pairs of [
      "1:0x0000000000000000000000000000000000000002:0x0000000000000000000000000000000000000003:ETHUSDT",
      "1:0x0000000000000000000000000000000000000002:0x0000000000000000000000000000000000000003:kraken:ETHUSD",
      "1:0x0000000000000000000000000000000000000002:0x0000000000000000000000000000000000000003:binance:!!",
    ]) {
      process.env.RFQ_CEX_PAIRS = pairs;
      assert.throws(() => buildServer({ logger: false }), /Invalid RFQ_CEX_PAIRS entry/);
    }
  } finally {
    restoreEnv("RFQ_CEX_PAIRS", originalPairs);
  }
});

test("RFQ API rejects unsafe CEX order book runtime bounds", () => {
  const originalPairs = process.env.RFQ_CEX_PAIRS;
  const originalAge = process.env.RFQ_CEX_MAX_SOURCE_AGE_MS;
  try {
    process.env.RFQ_CEX_PAIRS =
      "1:0x0000000000000000000000000000000000000002:0x0000000000000000000000000000000000000003:binance:ETHUSDT";
    for (const age of ["99", "1e3", "60001"]) {
      process.env.RFQ_CEX_MAX_SOURCE_AGE_MS = age;
      assert.throws(() => buildServer({ logger: false }), /RFQ_CEX_MAX_SOURCE_AGE_MS/);
    }
  } finally {
    restoreEnv("RFQ_CEX_PAIRS", originalPairs);
    restoreEnv("RFQ_CEX_MAX_SOURCE_AGE_MS", originalAge);
  }
});

test("production RFQ API requires two CEX sources per configured pair by default", () => {
  const names = [
    "NODE_ENV",
    "RFQ_SIGNER_PRIVATE_KEY",
    "RFQ_SETTLEMENT_ADDRESS",
    "RFQ_ALLOW_SIMULATED_SETTLEMENT",
    "RFQ_CEX_PAIRS",
    "RFQ_CEX_MIN_SOURCES",
  ];
  const original = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  try {
    process.env.NODE_ENV = "production";
    process.env.RFQ_SIGNER_PRIVATE_KEY =
      "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
    process.env.RFQ_SETTLEMENT_ADDRESS = "0x0000000000000000000000000000000000000004";
    process.env.RFQ_ALLOW_SIMULATED_SETTLEMENT = "true";
    process.env.RFQ_CEX_PAIRS =
      "1:0x0000000000000000000000000000000000000002:0x0000000000000000000000000000000000000003:binance:ETHUSDT";
    delete process.env.RFQ_CEX_MIN_SOURCES;

    assert.throws(
      () => buildServer({
        logger: false,
        databasePool: { connect() { throw new Error("unused"); } },
        rateLimiter: {
          check() { return { allowed: true, remaining: 1, retryAfterSeconds: 1 }; },
          checkHealth() {},
        },
      }),
      /each pair must configure at least minSources distinct sources/,
    );
  } finally {
    for (const name of names) restoreEnv(name, original[name]);
  }
});

test("RFQ API rejects invalid or incomplete Chainlink provider configuration", () => {
  const originalProvider = process.env.RFQ_MARKET_DATA_PROVIDER;
  const originalConfig = process.env.RFQ_CHAINLINK_CONFIG_JSON;

  try {
    process.env.RFQ_MARKET_DATA_PROVIDER = "oracle";
    assert.throws(() => buildServer({ logger: false }), /must be static or chainlink/);

    process.env.RFQ_MARKET_DATA_PROVIDER = "chainlink";
    delete process.env.RFQ_CHAINLINK_CONFIG_JSON;
    assert.throws(() => buildServer({ logger: false }), /is required/);

    process.env.RFQ_CHAINLINK_CONFIG_JSON = "{";
    assert.throws(() => buildServer({ logger: false }), /must contain valid JSON/);
  } finally {
    restoreEnv("RFQ_MARKET_DATA_PROVIDER", originalProvider);
    restoreEnv("RFQ_CHAINLINK_CONFIG_JSON", originalConfig);
  }
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
    RFQ_RATE_LIMIT_BACKEND: process.env.RFQ_RATE_LIMIT_BACKEND,
    RFQ_REDIS_URL: process.env.RFQ_REDIS_URL,
    RFQ_TOKEN_REGISTRY_JSON: process.env.RFQ_TOKEN_REGISTRY_JSON,
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
    delete process.env.RFQ_RATE_LIMIT_BACKEND;
    delete process.env.RFQ_REDIS_URL;
    delete process.env.RFQ_TOKEN_REGISTRY_JSON;
    Object.setPrototypeOf(process.env, {
      NODE_ENV: "production",
      RFQ_SIGNER_PRIVATE_KEY: "replace-with-production-signer-private-key",
      RFQ_SETTLEMENT_ADDRESS: "replace-with-rfq-settlement-address",
      RFQ_QUOTE_TTL_SECONDS: "120",
      RFQ_CORS_ALLOWED_ORIGINS: "https://evil.example.com",
      RFQ_ENABLE_HSTS: "true",
      RFQ_RATE_LIMIT_BACKEND: "redis",
      RFQ_REDIS_URL: "redis://evil.example.com:6379/0",
      RFQ_TOKEN_REGISTRY_JSON: "{",
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
    restoreEnv("RFQ_RATE_LIMIT_BACKEND", originalEnv.RFQ_RATE_LIMIT_BACKEND);
    restoreEnv("RFQ_REDIS_URL", originalEnv.RFQ_REDIS_URL);
    restoreEnv("RFQ_TOKEN_REGISTRY_JSON", originalEnv.RFQ_TOKEN_REGISTRY_JSON);
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

function restoreEnv(name, value) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}
