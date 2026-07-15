import assert from "node:assert/strict";
import test from "node:test";
import { buildServer } from "../dist/main.js";
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

test("non-local RFQ API startup requires durable PostgreSQL persistence", async () => {
  const original = saveEnv([
    "NODE_ENV",
    "DATABASE_URL",
    ...signerRuntimeEnvNames,
    "RFQ_RECEIPT_CONFIG_JSON",
    dailyLossRuntimeEnvName,
    usdReferenceRuntimeEnvName,
  ]);
  try {
    process.env.NODE_ENV = "production";
    delete process.env.DATABASE_URL;
    configureAwsSignerEnvironment();
    configureUsdReferenceEnvironment();
    process.env.RFQ_RECEIPT_CONFIG_JSON = JSON.stringify(receiptConfig());

    assert.throws(
      () => buildServer({
        logger: false,
        rateLimiter: allowAllRateLimiter(),
        signerService: localTestSignerService(),
      }),
      /DATABASE_URL is required when NODE_ENV=production/,
    );

    const { pool, queries } = fakeDatabasePool();
    const server = buildServer({
      apiKeyAuthenticator: allowAllApiKeyAuthenticator(),
      logger: false,
      databasePool: pool,
      marketDataService: { async getSnapshot() { throw new Error("unused market data"); } },
      rateLimiter: allowAllRateLimiter(),
      signerService: localTestSignerService(),
    });
    await server.ready();
    await server.close();

    assert.equal(queries.some((sql) => sql.includes("pg_advisory_xact_lock")), true);
    assert.equal(queries.some((sql) => sql.includes("WHERE canonical = TRUE")), true);
    assert.equal(pool.ends, 0);
  } finally {
    restoreEnv(original);
  }
});

test("RFQ API rejects malformed injected database pools", () => {
  assert.throws(
    () => buildServer({ logger: false, databasePool: {} }),
    /databasePool.connect must be a function/,
  );
});

function allowAllRateLimiter() {
  return {
    check() {
      return { allowed: true, remaining: 1, retryAfterSeconds: 60 };
    },
    checkHealth() {},
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
  const queries = [];
  const client = {
    async query(sql) {
      queries.push(sql.trim());
      return { rows: [], rowCount: 0 };
    },
    release() {},
  };
  const pool = {
    ends: 0,
    async connect() {
      return client;
    },
    async end() {
      this.ends += 1;
    },
  };
  return { pool, queries };
}

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

function saveEnv(names) {
  return Object.fromEntries(names.map((name) => [name, process.env[name]]));
}

function restoreEnv(values) {
  for (const [name, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}
