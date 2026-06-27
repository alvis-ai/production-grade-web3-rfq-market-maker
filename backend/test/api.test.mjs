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
    assert.match(
      metrics.payload,
      new RegExp(`rfq_inventory_balance\\{chain_id="1",token="${baseQuoteRequest.tokenIn}"\\} ${baseQuoteRequest.amountIn}`),
    );
    assert.match(
      metrics.payload,
      new RegExp(`rfq_inventory_balance\\{chain_id="1",token="${baseQuoteRequest.tokenOut}"\\} -${quote.body.amountOut}`),
    );
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
    assert.match(response.body.traceId, /^tr_/);
    assert.equal(response.headers["x-trace-id"], response.body.traceId);

    const metrics = await server.inject({ method: "GET", url: "/metrics" });
    assert.equal(metrics.statusCode, 200);
    assert.match(metrics.payload, /rfq_quote_requests_total 1/);
    assert.match(metrics.payload, /rfq_quote_errors_total 1/);
  } finally {
    await server.close();
  }
});

test("RFQ API includes trace ids on validation and not found errors", async () => {
  const server = buildServer({ logger: false });
  await server.ready();

  try {
    const invalid = await injectJson(server, "POST", "/quote", {
      ...baseQuoteRequest,
      tokenIn: "not-an-address",
    });
    assert.equal(invalid.statusCode, 400);
    assert.equal(invalid.body.code, "INVALID_REQUEST");
    assert.match(invalid.body.traceId, /^tr_/);
    assert.equal(invalid.headers["x-trace-id"], invalid.body.traceId);

    const notFound = await injectJson(server, "GET", "/quote/q_missing");
    assert.equal(notFound.statusCode, 404);
    assert.equal(notFound.body.code, "QUOTE_NOT_FOUND");
    assert.match(notFound.body.traceId, /^tr_/);
    assert.equal(notFound.headers["x-trace-id"], notFound.body.traceId);
  } finally {
    await server.close();
  }
});

test("RFQ API rejects submit payloads that violate settlement shape", async () => {
  const server = buildServer({ logger: false });
  await server.ready();

  try {
    const quote = {
      user: baseQuoteRequest.user,
      tokenIn: baseQuoteRequest.tokenIn,
      tokenOut: baseQuoteRequest.tokenOut,
      amountIn: baseQuoteRequest.amountIn,
      amountOut: "1000000000",
      minAmountOut: "995000000",
      nonce: "1",
      deadline: Math.floor(Date.now() / 1000) + 30,
      chainId: baseQuoteRequest.chainId,
    };

    const invalidSignature = await injectJson(server, "POST", "/submit", {
      quote,
      signature: "0x1234",
    });
    assert.equal(invalidSignature.statusCode, 400);
    assert.equal(invalidSignature.body.code, "INVALID_REQUEST");
    assert.match(invalidSignature.body.message, /65 bytes/);
    assert.match(invalidSignature.body.traceId, /^tr_/);

    const sameTokenPair = await injectJson(server, "POST", "/submit", {
      quote: {
        ...quote,
        tokenOut: quote.tokenIn,
      },
      signature: fixedSignature(),
    });
    assert.equal(sameTokenPair.statusCode, 400);
    assert.equal(sameTokenPair.body.code, "INVALID_REQUEST");
    assert.match(sameTokenPair.body.message, /tokenIn and quote\.tokenOut must be different/);

    const zeroAmount = await injectJson(server, "POST", "/submit", {
      quote: {
        ...quote,
        amountIn: "0",
      },
      signature: fixedSignature(),
    });
    assert.equal(zeroAmount.statusCode, 400);
    assert.equal(zeroAmount.body.code, "INVALID_REQUEST");
    assert.match(zeroAmount.body.message, /positive uint string/);

    const belowMinimum = await injectJson(server, "POST", "/submit", {
      quote: {
        ...quote,
        amountOut: "994999999",
      },
      signature: fixedSignature(),
    });
    assert.equal(belowMinimum.statusCode, 400);
    assert.equal(belowMinimum.body.code, "INVALID_REQUEST");
    assert.match(belowMinimum.body.message, /greater than or equal/);
  } finally {
    await server.close();
  }
});

test("RFQ API generates unique quote ids and nonces within the same millisecond", async () => {
  const originalDateNow = Date.now;
  Date.now = () => 1893456000000;

  const server = buildServer({ logger: false });
  await server.ready();

  try {
    const responses = [];
    for (let index = 0; index < 5; index += 1) {
      responses.push(await injectJson(server, "POST", "/quote", baseQuoteRequest));
    }

    const quoteIds = new Set();
    const nonces = new Set();
    for (const response of responses) {
      assert.equal(response.statusCode, 200);
      assert.match(response.body.quoteId, /^q_[0-9]+$/);
      assert.match(response.body.nonce, /^[0-9]+$/);
      quoteIds.add(response.body.quoteId);
      nonces.add(response.body.nonce);
    }

    assert.equal(quoteIds.size, responses.length);
    assert.equal(nonces.size, responses.length);
  } finally {
    await server.close();
    Date.now = originalDateNow;
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
    headers: response.headers,
    body: response.payload ? JSON.parse(response.payload) : undefined,
  };
}

function fixedSignature() {
  return `0x${"11".repeat(65)}`;
}
