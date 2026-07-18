import assert from "node:assert/strict";
import test from "node:test";
import { buildServer } from "../dist/main.js";
import { resolveRateLimiter } from "../dist/runtime/gateway-runtime.js";
import {
  configureAwsSignerEnvironment,
  localTestSignerService,
  signerRuntimeEnvNames,
  testSettlementAddress as settlementAddress,
} from "./helpers/signer-runtime-fixtures.mjs";
import {
  configureUsdReferenceEnvironment,
  dailyLossRuntimeEnvName,
  usdReferenceRuntimeEnvName,
} from "./helpers/usd-reference-runtime-fixtures.mjs";

const quoteRequest = {
  chainId: 1,
  user: "0x0000000000000000000000000000000000000001",
  tokenIn: "0x0000000000000000000000000000000000000002",
  tokenOut: "0x0000000000000000000000000000000000000003",
  amountIn: "1000000000",
  slippageBps: 50,
};

test("RFQ API permits disabled rate limiting only in local environments", () => {
  const originalNodeEnv = process.env.NODE_ENV;
  try {
    for (const nodeEnv of ["production", "staging"]) {
      process.env.NODE_ENV = nodeEnv;
      assert.throws(
        () => resolveRateLimiter({ rateLimit: false }),
        new RegExp(`rateLimit cannot be disabled when NODE_ENV=${nodeEnv}`),
      );
    }
    for (const nodeEnv of [undefined, "development", "test"]) {
      if (nodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = nodeEnv;
      assert.equal(resolveRateLimiter({ rateLimit: false }), undefined);
    }
  } finally {
    restoreEnv({ NODE_ENV: originalNodeEnv });
  }
});

test("RFQ API awaits injected distributed rate limit decisions", async () => {
  let checks = 0;
  const server = buildServer({
    logger: false,
    rateLimiter: {
      async check() {
        checks += 1;
        return checks === 1
          ? { allowed: true, remaining: 0, retryAfterSeconds: 60 }
          : { allowed: false, remaining: 0, retryAfterSeconds: 59 };
      },
      checkHealth() {},
    },
  });
  await server.ready();

  try {
    const first = await injectJson(server, "POST", "/quote", quoteRequest);
    const second = await injectJson(server, "POST", "/quote", quoteRequest);

    assert.equal(first.statusCode, 200);
    assert.equal(first.headers["x-ratelimit-remaining"], "0");
    assert.equal(second.statusCode, 429);
    assert.equal(second.body.code, "RATE_LIMITED");
    assert.equal(second.headers["retry-after"], "59");
  } finally {
    await server.close();
  }
});

test("RFQ API fails closed when the distributed rate limit store is unavailable", async () => {
  const server = buildServer({
    logger: false,
    rateLimiter: {
      async check() {
        throw new Error("redis offline");
      },
      checkHealth() {},
    },
  });
  await server.ready();

  try {
    const response = await injectJson(server, "POST", "/quote", quoteRequest);

    assert.equal(response.statusCode, 503);
    assert.equal(response.body.code, "RATE_LIMIT_UNAVAILABLE");
    assert.equal(response.body.message, "Rate limit store unavailable");
  } finally {
    await server.close();
  }
});

test("RFQ API fails closed on malformed distributed rate limit decisions", async () => {
  const server = buildServer({
    logger: false,
    rateLimiter: {
      async check() {
        return { allowed: "yes", remaining: -1, retryAfterSeconds: 0, internal: true };
      },
      checkHealth() {},
    },
  });
  await server.ready();

  try {
    const response = await injectJson(server, "POST", "/quote", quoteRequest);
    assert.equal(response.statusCode, 503);
    assert.equal(response.body.code, "RATE_LIMIT_UNAVAILABLE");
  } finally {
    await server.close();
  }
});

test("RFQ API readiness and shutdown include the rate limit store", async () => {
  let closes = 0;
  const server = buildServer({
    logger: false,
    rateLimiter: {
      async check() {
        return { allowed: true, remaining: 1, retryAfterSeconds: 60 };
      },
      async checkHealth() {
        throw new Error("redis offline");
      },
      async close() {
        closes += 1;
      },
    },
  });
  await server.ready();

  const response = await injectJson(server, "GET", "/ready");
  assert.equal(response.statusCode, 503);
  assert.equal(response.body.components.rateLimitStore, "degraded");

  const metrics = await server.inject({ method: "GET", url: "/metrics" });
  assert.match(metrics.payload, /rfq_dependency_status\{component="rateLimitStore",status="degraded"\} 1/);

  await server.close();
  assert.equal(closes, 1);
});

test("RFQ API validates Redis rate limit runtime configuration", async () => {
  const names = [
    "NODE_ENV",
    ...signerRuntimeEnvNames,
    "RFQ_RECEIPT_CONFIG_JSON",
    "RFQ_RATE_LIMIT_BACKEND",
    "RFQ_REDIS_URL",
    dailyLossRuntimeEnvName,
    usdReferenceRuntimeEnvName,
  ];
  const original = saveEnv(names);

  try {
    delete process.env.NODE_ENV;
    process.env.RFQ_RATE_LIMIT_BACKEND = "cluster";
    assert.throws(() => buildServer({ logger: false }), /must be memory or redis/);

    process.env.RFQ_RATE_LIMIT_BACKEND = "redis";
    delete process.env.RFQ_REDIS_URL;
    assert.throws(() => buildServer({ logger: false }), /RFQ_REDIS_URL is required/);

    process.env.RFQ_REDIS_URL = "http://localhost:6379";
    assert.throws(() => buildServer({ logger: false }), /redis:\/\/ or rediss:\/\//);

    process.env.NODE_ENV = "production";
    configureAwsSignerEnvironment();
    configureUsdReferenceEnvironment();
    process.env.RFQ_RECEIPT_CONFIG_JSON = JSON.stringify(receiptConfig());
    process.env.RFQ_RATE_LIMIT_BACKEND = "memory";
    assert.throws(
      () => buildServer({
        logger: false,
        databasePool: fakeDatabasePool(),
        signerService: localTestSignerService(),
      }),
      /must be redis when NODE_ENV=production/,
    );
    assert.throws(
      () => buildServer({
        logger: false,
        databasePool: fakeDatabasePool(),
        signerService: localTestSignerService(),
        rateLimit: false,
      }),
      /rateLimit cannot be disabled when NODE_ENV=production/,
    );

    delete process.env.RFQ_RATE_LIMIT_BACKEND;
    delete process.env.RFQ_REDIS_URL;
    assert.throws(
      () => buildServer({
        logger: false,
        databasePool: fakeDatabasePool(),
        signerService: localTestSignerService(),
      }),
      /RFQ_REDIS_URL is required/,
    );

    process.env.RFQ_REDIS_URL = "redis://127.0.0.1:6379/0";
    assert.throws(
      () => buildServer({
        apiKeyAuthenticator: allowAllApiKeyAuthenticator(),
        logger: false,
        databasePool: fakeDatabasePool(),
        marketDataService: { async getSnapshot() { throw new Error("unused market data"); } },
        signerService: localTestSignerService(),
      }),
      /must use rediss:\/\//,
    );

    process.env.RFQ_REDIS_URL = "rediss://redis.example.com:6380/0";
    const server = buildServer({
      apiKeyAuthenticator: allowAllApiKeyAuthenticator(),
      logger: false,
      databasePool: fakeDatabasePool(),
      marketDataService: { async getSnapshot() { throw new Error("unused market data"); } },
      quoteExposureStore: unusedQuoteExposureStore(),
      signerService: localTestSignerService(),
    });
    await server.ready();
    await server.close();
  } finally {
    restoreEnv(original);
  }
});

function unusedQuoteExposureStore() {
  return {
    async checkHealth() {},
    async reserve() { throw new Error("unused quote exposure"); },
    async release() {},
  };
}

test("RFQ API rejects conflicting or malformed injected rate limiters", () => {
  const limiter = {
    check() {
      return { allowed: true, remaining: 1, retryAfterSeconds: 60 };
    },
    checkHealth() {},
  };
  assert.throws(
    () => buildServer({ logger: false, rateLimit: false, rateLimiter: limiter }),
    /cannot both be provided/,
  );
  assert.throws(
    () => buildServer({ logger: false, rateLimiter: { check() {} } }),
    /rateLimiter.checkHealth must be a function/,
  );
});

function receiptConfig() {
  return {
    chains: [{
      chainId: 1,
      rpcUrl: "https://rpc.example.com/v1/key",
      settlementAddress,
      confirmations: 2,
      receiptTimeoutMs: 120_000,
    }],
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

function fakeDatabasePool() {
  const client = {
    async query() {
      return { rows: [], rowCount: 0 };
    },
    release() {},
  };
  return {
    async connect() {
      return client;
    },
  };
}

async function injectJson(server, method, url, payload) {
  const response = await server.inject({
    method,
    url,
    headers: payload ? { "content-type": "application/json" } : undefined,
    payload: payload ? JSON.stringify(payload) : undefined,
  });
  return {
    statusCode: response.statusCode,
    headers: response.headers,
    body: response.payload ? JSON.parse(response.payload) : undefined,
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
