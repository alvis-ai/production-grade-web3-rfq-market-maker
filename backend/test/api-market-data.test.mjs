import assert from "node:assert/strict";
import test from "node:test";
import { buildServer } from "../dist/main.js";

const baseQuoteRequest = {
  chainId: 1,
  user: "0x0000000000000000000000000000000000000001",
  tokenIn: "0x0000000000000000000000000000000000000002",
  tokenOut: "0x0000000000000000000000000000000000000003",
  amountIn: "1000000000",
  slippageBps: 50,
};

test("RFQ API rejects stale market data before pricing and signing", async () => {
  const server = buildServer({
    logger: false,
    marketDataService: {
      async getSnapshot(request) {
        return {
          snapshotId: "snapshot_stale",
          midPrice: "1",
          liquidityUsd: "10000000000000",
          volatilityBps: 25,
          observedAt: new Date(Date.now() - 60_000).toISOString(),
        };
      },
    },
  });
  await server.ready();

  try {
    const response = await injectJson(server, "POST", "/quote", baseQuoteRequest);

    assert.equal(response.statusCode, 503);
    assert.equal(response.body.code, "MARKET_DATA_UNAVAILABLE");
    assert.match(response.body.message, /stale/);
    assert.match(response.body.traceId, /^tr_/);
    assert.equal(response.headers["x-trace-id"], response.body.traceId);

    const metrics = await server.inject({ method: "GET", url: "/metrics" });
    assert.equal(metrics.statusCode, 200);
    assert.match(metrics.payload, /rfq_quote_requests_total 1/);
    assert.match(metrics.payload, /rfq_quote_errors_total 1/);
    assert.match(metrics.payload, /rfq_quote_responses_total 0/);
    assert.doesNotMatch(metrics.payload, /rfq_settlements_total 1/);
  } finally {
    await server.close();
  }
});

test("RFQ API rejects unconfigured market data pairs before pricing and signing", async () => {
  const server = buildServer({ logger: false });
  await server.ready();

  try {
    const response = await injectJson(server, "POST", "/quote", {
      ...baseQuoteRequest,
      tokenOut: "0x0000000000000000000000000000000000000004",
    });

    assert.equal(response.statusCode, 503);
    assert.equal(response.body.code, "MARKET_DATA_UNAVAILABLE");
    assert.match(response.body.traceId, /^tr_/);
    assert.equal(response.headers["x-trace-id"], response.body.traceId);

    const metrics = await server.inject({ method: "GET", url: "/metrics" });
    assert.equal(metrics.statusCode, 200);
    assert.match(metrics.payload, /rfq_quote_requests_total 1/);
    assert.match(metrics.payload, /rfq_quote_errors_total 1/);
    assert.match(metrics.payload, /rfq_quote_responses_total 0/);
    assert.match(metrics.payload, /rfq_signer_requests_total\{operation="sign"\} 0/);
  } finally {
    await server.close();
  }
});

test("RFQ API rejects market data timestamps too far in the future", async () => {
  const server = buildServer({
    logger: false,
    marketDataService: {
      async getSnapshot() {
        return {
          snapshotId: "snapshot_future",
          midPrice: "1",
          liquidityUsd: "10000000000000",
          volatilityBps: 25,
          observedAt: new Date(Date.now() + 60_000).toISOString(),
        };
      },
    },
  });
  await server.ready();

  try {
    const response = await injectJson(server, "POST", "/quote", baseQuoteRequest);

    assert.equal(response.statusCode, 503);
    assert.equal(response.body.code, "MARKET_DATA_UNAVAILABLE");
    assert.match(response.body.message, /future/);
    assert.match(response.body.traceId, /^tr_/);
    assert.equal(response.headers["x-trace-id"], response.body.traceId);

    const metrics = await server.inject({ method: "GET", url: "/metrics" });
    assert.equal(metrics.statusCode, 200);
    assert.match(metrics.payload, /rfq_quote_requests_total 1/);
    assert.match(metrics.payload, /rfq_quote_errors_total 1/);
    assert.match(metrics.payload, /rfq_quote_responses_total 0/);
    assert.match(metrics.payload, /rfq_signer_requests_total\{operation="sign"\} 0/);
  } finally {
    await server.close();
  }
});

test("RFQ API maps market data failures to dependency errors before routing and signing", async () => {
  const server = buildServer({
    logger: false,
    marketDataService: {
      async getSnapshot() {
        throw new Error("market data backend offline");
      },
    },
  });
  await server.ready();

  try {
    const response = await injectJson(server, "POST", "/quote", baseQuoteRequest);

    assert.equal(response.statusCode, 503);
    assert.equal(response.body.code, "MARKET_DATA_UNAVAILABLE");
    assert.match(response.body.traceId, /^tr_/);
    assert.equal(response.headers["x-trace-id"], response.body.traceId);

    const metrics = await server.inject({ method: "GET", url: "/metrics" });
    assert.equal(metrics.statusCode, 200);
    assert.match(metrics.payload, /rfq_quote_requests_total 1/);
    assert.match(metrics.payload, /rfq_quote_errors_total 1/);
    assert.match(metrics.payload, /rfq_quote_responses_total 0/);
    assert.match(metrics.payload, /rfq_signer_requests_total\{operation="sign"\} 0/);
    assert.match(metrics.payload, /rfq_settlements_total 0/);
    assert.doesNotMatch(metrics.payload, /rfq_inventory_balance\{chain_id=/);
  } finally {
    await server.close();
  }
});

test("RFQ API rejects invalid market data before pricing and signing", async () => {
  const server = buildServer({
    logger: false,
    marketDataService: {
      async getSnapshot() {
        return {
          snapshotId: "snapshot_invalid_mid",
          midPrice: "not-a-price",
          liquidityUsd: "10000000000000",
          volatilityBps: 25,
          observedAt: new Date().toISOString(),
        };
      },
    },
  });
  await server.ready();

  try {
    const response = await injectJson(server, "POST", "/quote", baseQuoteRequest);

    assert.equal(response.statusCode, 503);
    assert.equal(response.body.code, "MARKET_DATA_UNAVAILABLE");
    assert.match(response.body.message, /mid price/);
    assert.match(response.body.traceId, /^tr_/);
    assert.equal(response.headers["x-trace-id"], response.body.traceId);

    const metrics = await server.inject({ method: "GET", url: "/metrics" });
    assert.equal(metrics.statusCode, 200);
    assert.match(metrics.payload, /rfq_quote_requests_total 1/);
    assert.match(metrics.payload, /rfq_quote_errors_total 1/);
    assert.match(metrics.payload, /rfq_quote_responses_total 0/);
    assert.match(metrics.payload, /rfq_settlements_total 0/);
    assert.doesNotMatch(metrics.payload, /rfq_inventory_balance\{chain_id=/);
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
