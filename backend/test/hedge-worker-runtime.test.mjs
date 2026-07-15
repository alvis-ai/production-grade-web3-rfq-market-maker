import assert from "node:assert/strict";
import test from "node:test";
import { readHedgeWorkerRuntimeConfig } from "../dist/hedge-worker-main.js";

const token = "0x0000000000000000000000000000000000000003";
const quoteToken = "0x0000000000000000000000000000000000000002";
const tokenRegistry = {
  tokens: [{
    chainId: 1,
    tokenAddress: token,
    symbol: "WETH",
    decimals: 18,
    isWhitelisted: true,
    riskTier: "medium",
    usdReference: false,
  }, {
    chainId: 1,
    tokenAddress: quoteToken,
    symbol: "USDT",
    decimals: 6,
    isWhitelisted: true,
    riskTier: "low",
    usdReference: true,
  }],
};
const env = {
  DATABASE_URL: "postgres://rfq:rfq@localhost:5432/rfq",
  RFQ_TOKEN_REGISTRY_JSON: JSON.stringify(tokenRegistry),
  RFQ_HEDGE_ROUTES_JSON: JSON.stringify({ routes: [{
    chainId: 1,
    token,
    venue: "binance",
    symbol: "ETHUSDT",
    baseAsset: "ETH",
    quoteAsset: "USDT",
    quoteToken,
    tokenDecimals: 18,
    quoteTokenDecimals: 6,
    stepSizeRaw: "100000000000000",
  }] }),
  RFQ_BINANCE_API_KEY: "api-key",
  RFQ_BINANCE_API_SECRET: "api-secret",
  RFQ_HEDGE_WORKER_ID: "worker_1",
};

test("hedge worker runtime config requires durable storage, routes, and isolated credentials", () => {
  const config = readHedgeWorkerRuntimeConfig(env);
  assert.equal(config.worker.workerId, "worker_1");
  assert.equal(config.worker.leaseMs, 45000);
  assert.equal(config.routes.find(1, token).symbol, "ETHUSDT");
  assert.equal(config.binance.apiKey, "api-key");
  assert.equal(config.listenPort, 3001);
  assert.equal(config.shutdownTimeoutMs, 20_000);

  assert.throws(() => readHedgeWorkerRuntimeConfig({ ...env, DATABASE_URL: undefined }), /DATABASE_URL is required/);
  assert.throws(
    () => readHedgeWorkerRuntimeConfig({ ...env, RFQ_TOKEN_REGISTRY_JSON: undefined }),
    /RFQ_TOKEN_REGISTRY_JSON is required/,
  );
  assert.throws(() => readHedgeWorkerRuntimeConfig({ ...env, RFQ_BINANCE_API_SECRET: undefined }), /API_SECRET is required/);
  assert.throws(
    () => readHedgeWorkerRuntimeConfig({
      ...env,
      RFQ_TOKEN_REGISTRY_JSON: JSON.stringify({
        tokens: [{ ...tokenRegistry.tokens[0], decimals: 6 }, tokenRegistry.tokens[1]],
      }),
    }),
    /does not match token registry decimals/,
  );
  assert.throws(
    () => readHedgeWorkerRuntimeConfig({ ...env, RFQ_BINANCE_API_KEY: "replace-with-trade-only-key" }),
    /placeholder must be replaced/,
  );
  assert.throws(
    () => readHedgeWorkerRuntimeConfig({
      ...env,
      RFQ_HEDGE_LEASE_MS: "41000",
      RFQ_BINANCE_REQUEST_TIMEOUT_MS: "10000",
    }),
    /must exceed four/,
  );
  assert.equal(readHedgeWorkerRuntimeConfig({
    ...env,
    RFQ_HEDGE_LEASE_MS: "41001",
    RFQ_BINANCE_REQUEST_TIMEOUT_MS: "10000",
  }).worker.leaseMs, 41001);
});

test("hedge worker runtime config reads only own environment fields", () => {
  const inherited = Object.create(env);
  assert.throws(() => readHedgeWorkerRuntimeConfig(inherited), /DATABASE_URL is required/);
});

test("hedge worker requires verified PostgreSQL TLS in production", () => {
  assert.throws(
    () => readHedgeWorkerRuntimeConfig({ ...env, NODE_ENV: "production" }),
    /sslmode=verify-full/,
  );
  assert.doesNotThrow(() => readHedgeWorkerRuntimeConfig({
    ...env,
    NODE_ENV: "production",
    DATABASE_URL: "postgres://hedge:secret@db.example.com/rfq?sslmode=verify-full",
  }));
});
