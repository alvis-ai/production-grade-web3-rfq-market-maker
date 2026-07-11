import assert from "node:assert/strict";
import test from "node:test";
import { buildServer } from "../dist/main.js";

const signerKey = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const settlementAddress = "0x0000000000000000000000000000000000000004";

test("non-local RFQ API startup requires durable PostgreSQL persistence", async () => {
  const original = saveEnv([
    "NODE_ENV",
    "DATABASE_URL",
    "RFQ_SIGNER_PRIVATE_KEY",
    "RFQ_SETTLEMENT_ADDRESS",
    "RFQ_RECEIPT_CONFIG_JSON",
  ]);
  try {
    process.env.NODE_ENV = "production";
    delete process.env.DATABASE_URL;
    process.env.RFQ_SIGNER_PRIVATE_KEY = signerKey;
    process.env.RFQ_SETTLEMENT_ADDRESS = settlementAddress;
    process.env.RFQ_RECEIPT_CONFIG_JSON = JSON.stringify(receiptConfig());

    assert.throws(
      () => buildServer({ logger: false, rateLimiter: allowAllRateLimiter() }),
      /DATABASE_URL is required when NODE_ENV=production/,
    );

    const { pool, queries } = fakeDatabasePool();
    const server = buildServer({ logger: false, databasePool: pool, rateLimiter: allowAllRateLimiter() });
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
      rpcUrl: "http://127.0.0.1:8545",
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
