import assert from "node:assert/strict";
import test from "node:test";
import { buildServer, readServerListenConfig } from "../dist/main.js";
import { buildRequiredCexCacheKeys, readCexOrderBookConfig } from "../dist/runtime/market-runtime.js";
import {
  configureAwsSignerEnvironment,
  localTestSignerService,
  signerRuntimeEnvNames,
} from "./helpers/signer-runtime-fixtures.mjs";

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

test("RFQ API rejects invalid RFQ_SUBMIT_RESERVATION_LEASE_MS at startup", () => {
  const originalLease = process.env.RFQ_SUBMIT_RESERVATION_LEASE_MS;
  try {
    for (const lease of ["59999", "3600001", "9e5", "900000.0", "+900000"]) {
      process.env.RFQ_SUBMIT_RESERVATION_LEASE_MS = lease;
      assert.throws(
        () => buildServer({ logger: false }),
        /RFQ_SUBMIT_RESERVATION_LEASE_MS must be a base-10 integer between 60000 and 3600000/,
      );
    }
  } finally {
    restoreEnv("RFQ_SUBMIT_RESERVATION_LEASE_MS", originalLease);
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
    ...signerRuntimeEnvNames,
    "RFQ_ALLOW_SIMULATED_SETTLEMENT",
    "RFQ_CEX_PAIRS",
    "RFQ_CEX_MIN_SOURCES",
  ];
  const original = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  try {
    process.env.NODE_ENV = "production";
    configureAwsSignerEnvironment();
    process.env.RFQ_ALLOW_SIMULATED_SETTLEMENT = "true";
    process.env.RFQ_CEX_PAIRS =
      "1:0x0000000000000000000000000000000000000002:0x0000000000000000000000000000000000000003:binance:ETHUSDT";
    delete process.env.RFQ_CEX_MIN_SOURCES;

    assert.throws(
      () => buildServer({
        apiKeyAuthenticator: allowAllApiKeyAuthenticator(),
        logger: false,
        databasePool: { connect() { throw new Error("unused"); } },
        rateLimiter: {
          check() { return { allowed: true, remaining: 1, retryAfterSeconds: 1 }; },
          checkHealth() {},
        },
        signerService: localTestSignerService(),
      }),
      /each pair must configure at least minSources distinct sources/,
    );
  } finally {
    for (const name of names) restoreEnv(name, original[name]);
  }
});

test("production RFQ API rejects an unprotected static market-data provider", () => {
  const names = [
    "NODE_ENV",
    ...signerRuntimeEnvNames,
    "RFQ_ALLOW_SIMULATED_SETTLEMENT",
    "RFQ_MARKET_DATA_PROVIDER",
    "RFQ_CEX_PAIRS",
    "RFQ_CEX_REQUIRE_LIVE_BOOK",
  ];
  const original = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  try {
    process.env.NODE_ENV = "production";
    configureAwsSignerEnvironment();
    process.env.RFQ_ALLOW_SIMULATED_SETTLEMENT = "true";
    process.env.RFQ_MARKET_DATA_PROVIDER = "static";
    process.env.RFQ_CEX_REQUIRE_LIVE_BOOK = "true";
    delete process.env.RFQ_CEX_PAIRS;

    assert.throws(
      () => buildServer({
        apiKeyAuthenticator: allowAllApiKeyAuthenticator(),
        logger: false,
        databasePool: { connect() { throw new Error("unused database"); } },
        rateLimiter: {
          check() { return { allowed: true, remaining: 1, retryAfterSeconds: 1 }; },
          checkHealth() {},
        },
        signerService: localTestSignerService(),
      }),
      /Non-local static market data requires non-empty RFQ_CEX_PAIRS/,
    );
  } finally {
    for (const name of names) restoreEnv(name, original[name]);
  }
});

test("CEX runtime requires a live order book by default outside local environments", () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalRequireLiveBook = process.env.RFQ_CEX_REQUIRE_LIVE_BOOK;
  const originalProvider = process.env.RFQ_MARKET_DATA_PROVIDER;
  const pairs = [{
    chainId: 1,
    tokenIn: "0x0000000000000000000000000000000000000002",
    tokenOut: "0x0000000000000000000000000000000000000003",
    exchange: "binance",
    symbol: "ETHUSDT",
  }];
  try {
    delete process.env.NODE_ENV;
    delete process.env.RFQ_CEX_REQUIRE_LIVE_BOOK;
    assert.equal(readCexOrderBookConfig([]).requireLiveBook, false);

    process.env.NODE_ENV = "production";
    assert.equal(readCexOrderBookConfig(pairs).requireLiveBook, true);

    process.env.RFQ_CEX_REQUIRE_LIVE_BOOK = "false";
    assert.throws(
      () => readCexOrderBookConfig(pairs),
      /requires RFQ_MARKET_DATA_PROVIDER=chainlink/,
    );
    process.env.RFQ_MARKET_DATA_PROVIDER = "chainlink";
    assert.equal(readCexOrderBookConfig(pairs).requireLiveBook, false);

    process.env.RFQ_CEX_REQUIRE_LIVE_BOOK = "sometimes";
    assert.throws(
      () => readCexOrderBookConfig([]),
      /RFQ_CEX_REQUIRE_LIVE_BOOK must be true or false/,
    );
  } finally {
    restoreEnv("NODE_ENV", originalNodeEnv);
    restoreEnv("RFQ_CEX_REQUIRE_LIVE_BOOK", originalRequireLiveBook);
    restoreEnv("RFQ_MARKET_DATA_PROVIDER", originalProvider);
  }
});

test("CEX live-book policy protects both RFQ directions for each native market", () => {
  const pairs = [{
    chainId: 1,
    tokenIn: "0x0000000000000000000000000000000000000002",
    tokenOut: "0x0000000000000000000000000000000000000003",
    exchange: "binance",
    symbol: "ETHUSDT",
  }];
  assert.deepEqual(buildRequiredCexCacheKeys(pairs, true), [
    "1:0x0000000000000000000000000000000000000002:0x0000000000000000000000000000000000000003",
    "1:0x0000000000000000000000000000000000000003:0x0000000000000000000000000000000000000002",
  ]);
  assert.deepEqual(buildRequiredCexCacheKeys(pairs, false), []);
  assert.equal(buildRequiredCexCacheKeys([...pairs, ...pairs], true).length, 2);
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
    RFQ_SIGNER_MODE: process.env.RFQ_SIGNER_MODE,
    RFQ_SIGNER_PRIVATE_KEY: process.env.RFQ_SIGNER_PRIVATE_KEY,
    RFQ_SETTLEMENT_ADDRESS: process.env.RFQ_SETTLEMENT_ADDRESS,
    RFQ_TRUSTED_SIGNER_ADDRESS: process.env.RFQ_TRUSTED_SIGNER_ADDRESS,
    RFQ_AWS_KMS_KEY_ID: process.env.RFQ_AWS_KMS_KEY_ID,
    RFQ_AWS_KMS_REGION: process.env.RFQ_AWS_KMS_REGION,
    RFQ_AWS_KMS_MAX_ATTEMPTS: process.env.RFQ_AWS_KMS_MAX_ATTEMPTS,
    RFQ_QUOTE_TTL_SECONDS: process.env.RFQ_QUOTE_TTL_SECONDS,
    RFQ_CORS_ALLOWED_ORIGINS: process.env.RFQ_CORS_ALLOWED_ORIGINS,
    RFQ_ENABLE_HSTS: process.env.RFQ_ENABLE_HSTS,
    RFQ_RATE_LIMIT_BACKEND: process.env.RFQ_RATE_LIMIT_BACKEND,
    RFQ_REDIS_URL: process.env.RFQ_REDIS_URL,
    RFQ_TOKEN_REGISTRY_JSON: process.env.RFQ_TOKEN_REGISTRY_JSON,
    RFQ_RISK_POLICY_JSON: process.env.RFQ_RISK_POLICY_JSON,
  };
  const originalEnvPrototype = Object.getPrototypeOf(process.env);
  const fixedNow = Date.now();
  const originalDateNow = Date.now;

  try {
    delete process.env.NODE_ENV;
    delete process.env.RFQ_SIGNER_MODE;
    delete process.env.RFQ_SIGNER_PRIVATE_KEY;
    delete process.env.RFQ_SETTLEMENT_ADDRESS;
    delete process.env.RFQ_TRUSTED_SIGNER_ADDRESS;
    delete process.env.RFQ_AWS_KMS_KEY_ID;
    delete process.env.RFQ_AWS_KMS_REGION;
    delete process.env.RFQ_AWS_KMS_MAX_ATTEMPTS;
    delete process.env.RFQ_QUOTE_TTL_SECONDS;
    delete process.env.RFQ_CORS_ALLOWED_ORIGINS;
    delete process.env.RFQ_ENABLE_HSTS;
    delete process.env.RFQ_RATE_LIMIT_BACKEND;
    delete process.env.RFQ_REDIS_URL;
    delete process.env.RFQ_TOKEN_REGISTRY_JSON;
    delete process.env.RFQ_RISK_POLICY_JSON;
    Object.setPrototypeOf(process.env, {
      NODE_ENV: "production",
      RFQ_SIGNER_MODE: "aws-kms",
      RFQ_SIGNER_PRIVATE_KEY: "replace-with-production-signer-private-key",
      RFQ_SETTLEMENT_ADDRESS: "replace-with-rfq-settlement-address",
      RFQ_TRUSTED_SIGNER_ADDRESS: "replace-with-kms-signer-address",
      RFQ_AWS_KMS_KEY_ID: "alias/replace-with-production-kms-key",
      RFQ_AWS_KMS_REGION: "us-east-1",
      RFQ_AWS_KMS_MAX_ATTEMPTS: "9",
      RFQ_QUOTE_TTL_SECONDS: "120",
      RFQ_CORS_ALLOWED_ORIGINS: "https://evil.example.com",
      RFQ_ENABLE_HSTS: "true",
      RFQ_RATE_LIMIT_BACKEND: "redis",
      RFQ_REDIS_URL: "redis://evil.example.com:6379/0",
      RFQ_TOKEN_REGISTRY_JSON: "{",
      RFQ_RISK_POLICY_JSON: "{",
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
    restoreEnv("RFQ_SIGNER_MODE", originalEnv.RFQ_SIGNER_MODE);
    restoreEnv("RFQ_SIGNER_PRIVATE_KEY", originalEnv.RFQ_SIGNER_PRIVATE_KEY);
    restoreEnv("RFQ_SETTLEMENT_ADDRESS", originalEnv.RFQ_SETTLEMENT_ADDRESS);
    restoreEnv("RFQ_TRUSTED_SIGNER_ADDRESS", originalEnv.RFQ_TRUSTED_SIGNER_ADDRESS);
    restoreEnv("RFQ_AWS_KMS_KEY_ID", originalEnv.RFQ_AWS_KMS_KEY_ID);
    restoreEnv("RFQ_AWS_KMS_REGION", originalEnv.RFQ_AWS_KMS_REGION);
    restoreEnv("RFQ_AWS_KMS_MAX_ATTEMPTS", originalEnv.RFQ_AWS_KMS_MAX_ATTEMPTS);
    restoreEnv("RFQ_QUOTE_TTL_SECONDS", originalEnv.RFQ_QUOTE_TTL_SECONDS);
    restoreEnv("RFQ_CORS_ALLOWED_ORIGINS", originalEnv.RFQ_CORS_ALLOWED_ORIGINS);
    restoreEnv("RFQ_ENABLE_HSTS", originalEnv.RFQ_ENABLE_HSTS);
    restoreEnv("RFQ_RATE_LIMIT_BACKEND", originalEnv.RFQ_RATE_LIMIT_BACKEND);
    restoreEnv("RFQ_REDIS_URL", originalEnv.RFQ_REDIS_URL);
    restoreEnv("RFQ_TOKEN_REGISTRY_JSON", originalEnv.RFQ_TOKEN_REGISTRY_JSON);
    restoreEnv("RFQ_RISK_POLICY_JSON", originalEnv.RFQ_RISK_POLICY_JSON);
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

function allowAllApiKeyAuthenticator() {
  return {
    authenticate() {
      return {
        status: "authenticated",
        principal: { keyId: "test_key", principalId: "test_principal", scopes: ["quote:write"] },
      };
    },
  };
}

function restoreEnv(name, value) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}
