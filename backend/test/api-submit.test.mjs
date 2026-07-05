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
const secp256k1n = BigInt("0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141");

test("RFQ API prices later quotes with inventory skew after settlement", async () => {
  const server = buildServer({ logger: false });
  await server.ready();

  try {
    const firstQuote = await injectJson(server, "POST", "/quote", baseQuoteRequest);
    assert.equal(firstQuote.statusCode, 200);
    assert.equal(firstQuote.body.amountOut, "998400000");

    const submit = await injectJson(server, "POST", "/submit", {
      quote: quotePayloadFromResponse(firstQuote.body),
      signature: firstQuote.body.signature,
    });
    assert.equal(submit.statusCode, 202);

    const secondQuote = await injectJson(server, "POST", "/quote", baseQuoteRequest);
    assert.equal(secondQuote.statusCode, 200);
    assert.equal(secondQuote.body.amountOut, "996500000");
    assert.equal(secondQuote.body.minAmountOut, "991517500");
  } finally {
    await server.close();
  }
});

test("RFQ API rejects expired submit quotes before simulated settlement", async () => {
  const server = buildServer({ logger: false });
  await server.ready();

  try {
    const response = await injectJson(server, "POST", "/submit", {
      quote: {
        user: baseQuoteRequest.user,
        tokenIn: baseQuoteRequest.tokenIn,
        tokenOut: baseQuoteRequest.tokenOut,
        amountIn: baseQuoteRequest.amountIn,
        amountOut: "1000000000",
        minAmountOut: "995000000",
        nonce: "1",
        deadline: Math.floor(Date.now() / 1000) - 1,
        chainId: baseQuoteRequest.chainId,
      },
      signature: fixedSignature(),
    });

    assert.equal(response.statusCode, 409);
    assert.equal(response.body.code, "QUOTE_EXPIRED");
    assert.match(response.body.traceId, /^tr_/);

    const metrics = await server.inject({ method: "GET", url: "/metrics" });
    assert.equal(metrics.statusCode, 200);
    assert.match(metrics.payload, /rfq_submit_requests_total 1/);
    assert.match(metrics.payload, /rfq_submit_errors_total 1/);
    assert.match(metrics.payload, /rfq_submit_accepted_total 0/);
    assert.match(metrics.payload, /rfq_settlements_total 0/);
    assert.doesNotMatch(metrics.payload, /rfq_inventory_balance\{chain_id=/);
  } finally {
    await server.close();
  }
});

test("RFQ API rejects unissued submit quotes before simulated settlement", async () => {
  const server = buildServer({ logger: false });
  await server.ready();

  try {
    const response = await injectJson(server, "POST", "/submit", {
      quote: {
        user: baseQuoteRequest.user,
        tokenIn: baseQuoteRequest.tokenIn,
        tokenOut: baseQuoteRequest.tokenOut,
        amountIn: baseQuoteRequest.amountIn,
        amountOut: "1000000000",
        minAmountOut: "995000000",
        nonce: "999",
        deadline: Math.floor(Date.now() / 1000) + 30,
        chainId: baseQuoteRequest.chainId,
      },
      signature: fixedSignature(),
    });

    assert.equal(response.statusCode, 404);
    assert.equal(response.body.code, "QUOTE_NOT_FOUND");
    assert.match(response.body.traceId, /^tr_/);

    const metrics = await server.inject({ method: "GET", url: "/metrics" });
    assert.equal(metrics.statusCode, 200);
    assert.match(metrics.payload, /rfq_submit_requests_total 1/);
    assert.match(metrics.payload, /rfq_submit_errors_total 1/);
    assert.match(metrics.payload, /rfq_submit_accepted_total 0/);
    assert.match(metrics.payload, /rfq_settlements_total 0/);
    assert.doesNotMatch(metrics.payload, /rfq_inventory_balance\{chain_id=/);
  } finally {
    await server.close();
  }
});

test("RFQ API rejects issued quotes with invalid trusted signer signature", async () => {
  const server = buildServer({ logger: false });
  await server.ready();

  try {
    const quote = await injectJson(server, "POST", "/quote", baseQuoteRequest);
    assert.equal(quote.statusCode, 200);

    const response = await injectJson(server, "POST", "/submit", {
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
      signature: fixedSignature(),
    });

    assert.equal(response.statusCode, 409);
    assert.equal(response.body.code, "INVALID_SIGNATURE");
    assert.match(response.body.traceId, /^tr_/);

    const status = await injectJson(server, "GET", `/quote/${quote.body.quoteId}`);
    assert.equal(status.statusCode, 200);
    assert.equal(status.body.status, "signed");

    const metrics = await server.inject({ method: "GET", url: "/metrics" });
    assert.equal(metrics.statusCode, 200);
    assert.match(metrics.payload, /rfq_submit_requests_total 1/);
    assert.match(metrics.payload, /rfq_submit_errors_total 1/);
    assert.match(metrics.payload, /rfq_submit_accepted_total 0/);
    assert.match(metrics.payload, /rfq_settlements_total 0/);
    assert.doesNotMatch(metrics.payload, /rfq_inventory_balance\{chain_id=/);
  } finally {
    await server.close();
  }
});

test("RFQ API rejects issued quotes with high-s malleated signatures", async () => {
  const server = buildServer({ logger: false });
  await server.ready();

  try {
    const quote = await injectJson(server, "POST", "/quote", baseQuoteRequest);
    assert.equal(quote.statusCode, 200);

    const response = await injectJson(server, "POST", "/submit", {
      quote: quotePayloadFromResponse(quote.body),
      signature: malleateSignature(quote.body.signature),
    });

    assert.equal(response.statusCode, 400);
    assert.equal(response.body.code, "INVALID_REQUEST");
    assert.equal(response.body.message, "signature s value must be in the lower half order");
    assert.match(response.body.traceId, /^tr_/);

    const status = await injectJson(server, "GET", `/quote/${quote.body.quoteId}`);
    assert.equal(status.statusCode, 200);
    assert.equal(status.body.status, "signed");

    const metrics = await server.inject({ method: "GET", url: "/metrics" });
    assert.equal(metrics.statusCode, 200);
    assert.match(metrics.payload, /rfq_submit_requests_total 1/);
    assert.match(metrics.payload, /rfq_submit_errors_total 1/);
    assert.match(metrics.payload, /rfq_submit_accepted_total 0/);
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

function fixedSignature() {
  return `0x${"11".repeat(64)}1b`;
}

function quotePayloadFromResponse(quote) {
  return {
    user: baseQuoteRequest.user,
    tokenIn: baseQuoteRequest.tokenIn,
    tokenOut: baseQuoteRequest.tokenOut,
    amountIn: baseQuoteRequest.amountIn,
    amountOut: quote.amountOut,
    minAmountOut: quote.minAmountOut,
    nonce: quote.nonce,
    deadline: quote.deadline,
    chainId: baseQuoteRequest.chainId,
  };
}

function malleateSignature(signature) {
  const r = signature.slice(2, 66);
  const s = BigInt(`0x${signature.slice(66, 130)}`);
  const v = Number.parseInt(signature.slice(130, 132), 16);
  const highS = (secp256k1n - s).toString(16).padStart(64, "0");
  const flippedV = v === 27 ? 28 : 27;

  return `0x${r}${highS}${flippedV.toString(16).padStart(2, "0")}`;
}
