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

test("RFQ API reads market data warmed by the background price updater", async () => {
  const server = buildServer({ logger: false });
  await server.ready();

  try {
    await sleep(20);
    const response = await injectJson(server, "POST", "/quote", baseQuoteRequest);

    assert.equal(response.statusCode, 200);

    const metrics = await server.inject({ method: "GET", url: "/metrics" });
    assert.equal(metrics.statusCode, 200);
    assert.match(metrics.payload, /rfq_market_data_cache_hits_total 1/);
    assert.match(metrics.payload, /rfq_market_data_cache_misses_total 0/);
    assert.match(metrics.payload, /rfq_market_data_refreshes_total\{outcome="success"\} [1-9][0-9]*/);
    assert.match(metrics.payload, /rfq_market_data_refreshes_total\{outcome="failure"\} 0/);
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
