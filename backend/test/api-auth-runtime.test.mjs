import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { buildServer } from "../dist/main.js";
import { Sha256ApiKeyAuthenticator } from "../dist/modules/auth/api-key-auth.service.js";
import {
  configureAwsSignerEnvironment,
  localTestSignerService,
  signerRuntimeEnvNames,
  testSettlementAddress,
} from "./helpers/signer-runtime-fixtures.mjs";

const secret = "0123456789abcdefghijklmnopqrstuvwxyz_ABCD";
const apiKey = `client_primary.${secret}`;
const baseQuoteRequest = {
  chainId: 1,
  user: "0x0000000000000000000000000000000000000001",
  tokenIn: "0x0000000000000000000000000000000000000002",
  tokenOut: "0x0000000000000000000000000000000000000003",
  amountIn: "1000000000000000000",
  slippageBps: 50,
};

test("RFQ API protects business routes while leaving probes and metrics public", async () => {
  const server = buildServer({ logger: false, apiKeyAuthenticator: authenticator() });
  await server.ready();
  try {
    for (const url of ["/health", "/ready", "/metrics"]) {
      const response = await server.inject({ method: "GET", url });
      assert.notEqual(response.statusCode, 401, url);
    }

    const missing = await injectJson(server, "POST", "/quote", baseQuoteRequest);
    assert.equal(missing.statusCode, 401);
    assert.equal(missing.body.code, "AUTHENTICATION_REQUIRED");
    assert.equal(missing.body.message, "Valid API key required");
    assert.equal(missing.headers["x-trace-id"], missing.body.traceId);

    const malformed = await injectJson(server, "POST", "/quote", baseQuoteRequest, { "x-api-key": "bad" });
    assert.equal(malformed.statusCode, 401);

    const quote = await injectJson(server, "POST", "/quote", baseQuoteRequest, { "x-api-key": apiKey });
    assert.equal(quote.statusCode, 200);

    const denied = await injectJson(server, "GET", "/pnl", undefined, { "x-api-key": apiKey });
    assert.equal(denied.statusCode, 403);
    assert.equal(denied.body.code, "AUTHORIZATION_DENIED");

    const metrics = await server.inject({ method: "GET", url: "/metrics" });
    assert.match(metrics.payload, /rfq_api_auth_rejections_total\{reason="missing"\} 1/);
    assert.match(metrics.payload, /rfq_api_auth_rejections_total\{reason="malformed"\} 1/);
    assert.match(metrics.payload, /rfq_api_auth_rejections_total\{reason="scope_denied"\} 1/);
  } finally {
    await server.close();
  }
});

test("RFQ API uses authenticated key identity for distributed rate-limit decisions", async () => {
  const checks = [];
  const server = buildServer({
    logger: false,
    apiKeyAuthenticator: authenticator(),
    rateLimiter: {
      check(input) {
        checks.push(input);
        return { allowed: true, remaining: 5, retryAfterSeconds: 60 };
      },
      checkHealth() {},
    },
  });
  await server.ready();
  try {
    const response = await injectJson(server, "POST", "/quote", baseQuoteRequest, {
      "x-api-key": apiKey,
      "x-forwarded-for": "203.0.113.7",
    });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(checks[0], { endpoint: "quote", clientId: "api-key:client_primary" });
  } finally {
    await server.close();
  }
});

test("RFQ API rejects malformed injected authenticators and dependency results", async () => {
  assert.throws(() => buildServer({ logger: false, apiKeyAuthenticator: {} }), /authenticate must be a function/);

  const server = buildServer({
    logger: false,
    apiKeyAuthenticator: { authenticate() { return { status: "authenticated", principal: {} }; } },
  });
  await server.ready();
  try {
    const response = await injectJson(server, "POST", "/quote", baseQuoteRequest, { "x-api-key": apiKey });
    assert.equal(response.statusCode, 500);
    assert.equal(response.body.code, "INTERNAL_ERROR");
  } finally {
    await server.close();
  }
});

test("non-local RFQ API requires API key auth configuration or an injected authenticator", async () => {
  const names = [
    "NODE_ENV",
    "DATABASE_URL",
    "RFQ_API_KEY_CONFIG_JSON",
    "RFQ_RECEIPT_CONFIG_JSON",
    ...signerRuntimeEnvNames,
  ];
  const original = saveEnv(names);
  try {
    process.env.NODE_ENV = "production";
    process.env.DATABASE_URL = "postgres://unused";
    configureAwsSignerEnvironment();
    process.env.RFQ_RECEIPT_CONFIG_JSON = JSON.stringify({ chains: [{
      chainId: 1,
      rpcUrl: "http://127.0.0.1:8545",
      settlementAddress: testSettlementAddress,
      confirmations: 2,
      receiptTimeoutMs: 120_000,
    }] });
    delete process.env.RFQ_API_KEY_CONFIG_JSON;

    const options = {
      logger: false,
      databasePool: fakeDatabasePool(),
      marketDataService: { async getSnapshot() { throw new Error("unused market data"); } },
      rateLimiter: allowAllRateLimiter(),
      signerService: localTestSignerService(),
    };
    assert.throws(() => buildServer(options), /RFQ_API_KEY_CONFIG_JSON is required when NODE_ENV=production/);
    assert.throws(
      () => buildServer({ ...options, apiKeyAuthenticator: false }),
      /apiKeyAuthenticator cannot be disabled when NODE_ENV=production/,
    );

    const server = buildServer({ ...options, apiKeyAuthenticator: authenticator() });
    await server.ready();
    try {
      const missingIdempotencyKey = await injectJson(server, "POST", "/quote", baseQuoteRequest, {
        "x-api-key": apiKey,
      });
      assert.equal(missingIdempotencyKey.statusCode, 400);
      assert.equal(missingIdempotencyKey.body.code, "INVALID_REQUEST");
      assert.equal(missingIdempotencyKey.body.message, "Idempotency-Key is required for quote requests");
    } finally {
      await server.close();
    }
  } finally {
    restoreEnv(original);
  }
});

test("RFQ API CORS contract permits the API key request header", async () => {
  const server = buildServer({ logger: false, corsAllowedOrigins: ["https://app.example.com"] });
  await server.ready();
  try {
    const response = await server.inject({
      method: "OPTIONS",
      url: "/quote",
      headers: { origin: "https://app.example.com", "access-control-request-method": "POST" },
    });
    assert.equal(response.statusCode, 204);
    assert.equal(response.headers["access-control-allow-headers"], "content-type,idempotency-key,x-api-key,x-trace-id");
  } finally {
    await server.close();
  }
});

function authenticator() {
  return new Sha256ApiKeyAuthenticator({ keys: [{
    keyId: "client_primary",
    principalId: "institution_a",
    secretSha256: createHash("sha256").update(secret).digest("hex"),
    scopes: ["quote:write", "submit:write", "status:read"],
    expiresAt: "2099-01-01T00:00:00.000Z",
  }] });
}

async function injectJson(server, method, url, payload, headers = {}) {
  const response = await server.inject({
    method,
    url,
    headers: { ...(payload ? { "content-type": "application/json" } : {}), ...headers },
    payload: payload ? JSON.stringify(payload) : undefined,
  });
  return {
    statusCode: response.statusCode,
    headers: response.headers,
    body: response.payload && response.headers["content-type"]?.includes("application/json")
      ? JSON.parse(response.payload)
      : undefined,
  };
}

function allowAllRateLimiter() {
  return { check() { return { allowed: true, remaining: 1, retryAfterSeconds: 60 }; }, checkHealth() {} };
}

function fakeDatabasePool() {
  return {
    async connect() {
      return { async query() { return { rows: [], rowCount: 0 }; }, release() {} };
    },
  };
}

function saveEnv(names) {
  return Object.fromEntries(names.map((name) => [name, process.env[name]]));
}

function restoreEnv(values) {
  for (const [name, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}
