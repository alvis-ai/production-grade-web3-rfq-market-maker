import assert from "node:assert/strict";
import test from "node:test";
import { buildServer } from "../dist/main.js";
import { InMemoryQuoteRepository } from "../dist/modules/quote/quote.repository.js";

const baseQuoteRequest = {
  chainId: 1,
  user: "0x0000000000000000000000000000000000000001",
  tokenIn: "0x0000000000000000000000000000000000000002",
  tokenOut: "0x0000000000000000000000000000000000000003",
  amountIn: "1000000000",
  slippageBps: 50,
};

test("RFQ API records signer errors and rejects quote when signing is unavailable", async () => {
  const server = buildServer({
    logger: false,
    signerService: {
      async signQuote() {
        throw new Error("signer offline");
      },
      async verifyQuoteSignature() {
        return false;
      },
    },
  });
  await server.ready();

  try {
    const response = await injectJson(server, "POST", "/quote", baseQuoteRequest);

    assert.equal(response.statusCode, 503);
    assert.equal(response.body.code, "SIGNER_UNAVAILABLE");
    assert.match(response.body.traceId, /^tr_/);
    assert.equal(response.headers["x-trace-id"], response.body.traceId);

    const metrics = await server.inject({ method: "GET", url: "/metrics" });
    assert.equal(metrics.statusCode, 200);
    assert.match(metrics.payload, /rfq_quote_requests_total 1/);
    assert.match(metrics.payload, /rfq_quote_errors_total 1/);
    assert.match(metrics.payload, /rfq_quote_responses_total 0/);
    assert.match(metrics.payload, /rfq_signer_requests_total\{operation="sign"\} 1/);
    assert.match(metrics.payload, /rfq_signer_errors_total\{operation="sign"\} 1/);
    assert.match(metrics.payload, /rfq_signer_requests_total\{operation="verify"\} 0/);
    assert.match(metrics.payload, /rfq_signer_latency_seconds_count\{operation="sign"\} 1/);
  } finally {
    await server.close();
  }
});

test("RFQ API preserves signer errors when failed quote persistence fails", async () => {
  class FailingFailedStatusQuoteRepository extends InMemoryQuoteRepository {
    requestedQuoteId;

    async saveRequested(input) {
      this.requestedQuoteId = input.quoteId;
      await super.saveRequested(input);
    }

    async markFailed() {
      throw new Error("quote failed status store offline");
    }
  }

  const quoteRepository = new FailingFailedStatusQuoteRepository();
  const server = buildServer({
    logger: false,
    quoteRepository,
    signerService: {
      async signQuote() {
        throw new Error("signer offline");
      },
      async verifyQuoteSignature() {
        return false;
      },
    },
  });
  await server.ready();

  try {
    const response = await injectJson(server, "POST", "/quote", baseQuoteRequest);

    assert.equal(response.statusCode, 503);
    assert.equal(response.body.code, "SIGNER_UNAVAILABLE");
    assert.match(response.body.traceId, /^tr_/);
    assert.equal(response.headers["x-trace-id"], response.body.traceId);
    assert.match(quoteRepository.requestedQuoteId, /^q_/);

    const status = await injectJson(server, "GET", `/quote/${quoteRepository.requestedQuoteId}`);
    assert.equal(status.statusCode, 200);
    assert.equal(status.body.status, "requested");
    assert.equal(status.body.errorCode, undefined);

    const metrics = await server.inject({ method: "GET", url: "/metrics" });
    assert.equal(metrics.statusCode, 200);
    assert.match(metrics.payload, /rfq_quote_requests_total 1/);
    assert.match(metrics.payload, /rfq_quote_errors_total 1/);
    assert.match(metrics.payload, /rfq_quote_responses_total 0/);
    assert.match(metrics.payload, /rfq_signer_requests_total\{operation="sign"\} 1/);
    assert.match(metrics.payload, /rfq_signer_errors_total\{operation="sign"\} 1/);
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
