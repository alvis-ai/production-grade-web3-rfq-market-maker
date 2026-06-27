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

test("RFQ API accepts quote, submit, status, and metrics flow", async () => {
  const server = buildServer({ logger: false });
  await server.ready();

  try {
    const health = await injectJson(server, "GET", "/health");
    assert.equal(health.statusCode, 200);
    assert.equal(health.body.status, "ok");

    const quote = await injectJson(server, "POST", "/quote", baseQuoteRequest);
    assert.equal(quote.statusCode, 200);
    assert.match(quote.body.quoteId, /^q_/);
    assert.equal(quote.body.amountOut, baseQuoteRequest.amountIn);
    assert.equal(quote.body.minAmountOut, "995000000");
    assert.match(quote.body.signature, /^0x[0-9a-fA-F]+$/);

    const submit = await injectJson(server, "POST", "/submit", {
      quote: {
        user: baseQuoteRequest.user,
        tokenIn: baseQuoteRequest.tokenIn,
        tokenOut: baseQuoteRequest.tokenOut,
        amountIn: baseQuoteRequest.amountIn,
        amountOut: quote.body.amountOut,
        minAmountOut: quote.body.minAmountOut,
        nonce: quote.body.nonce,
        deadline: quote.body.deadline,
        chainId: baseQuoteRequest.chainId,
      },
      signature: quote.body.signature,
    });
    assert.equal(submit.statusCode, 202);
    assert.equal(submit.body.status, "accepted");
    assert.match(submit.body.txHash, /^0x[0-9a-fA-F]+$/);

    const status = await injectJson(server, "GET", `/quote/${quote.body.quoteId}`);
    assert.equal(status.statusCode, 200);
    assert.equal(status.body.status, "settled");
    assert.equal(status.body.txHash, submit.body.txHash);

    const metrics = await server.inject({ method: "GET", url: "/metrics" });
    assert.equal(metrics.statusCode, 200);
    assert.match(metrics.payload, /rfq_quote_requests_total 1/);
    assert.match(metrics.payload, /rfq_submit_accepted_total 1/);
    assert.match(metrics.payload, /rfq_settlements_total 1/);
    assert.match(metrics.payload, /rfq_hedge_intents_total 1/);
  } finally {
    await server.close();
  }
});

test("RFQ API rejects quotes that fail pre-trade risk policy", async () => {
  const server = buildServer({ logger: false });
  await server.ready();

  try {
    const response = await injectJson(server, "POST", "/quote", {
      ...baseQuoteRequest,
      slippageBps: 999,
    });

    assert.equal(response.statusCode, 409);
    assert.equal(response.body.code, "RISK_REJECTED");

    const metrics = await server.inject({ method: "GET", url: "/metrics" });
    assert.equal(metrics.statusCode, 200);
    assert.match(metrics.payload, /rfq_quote_requests_total 1/);
    assert.match(metrics.payload, /rfq_quote_errors_total 1/);
  } finally {
    await server.close();
  }
});

async function injectJson(server, method, url, payload) {
  const response = await server.inject({
    method,
    url,
    headers: payload ? { "content-type": "application/json" } : undefined,
    payload: payload ? JSON.stringify(payload) : undefined,
  });

  return {
    statusCode: response.statusCode,
    body: response.payload ? JSON.parse(response.payload) : undefined,
  };
}
