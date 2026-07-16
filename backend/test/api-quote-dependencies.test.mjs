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

test("RFQ API maps routing engine failures to dependency errors before pricing and signing", async () => {
  const quoteRepository = new InMemoryQuoteRepository();
  const saveRequested = quoteRepository.saveRequested.bind(quoteRepository);
  let requestedQuoteId;
  quoteRepository.saveRequested = async (input) => {
    requestedQuoteId = input.quoteId;
    await saveRequested(input);
  };
  const server = buildServer({
    logger: false,
    quoteRepository,
    routingEngine: {
      async selectRoute() {
        throw new Error("routing backend offline");
      },
    },
  });
  await server.ready();

  try {
    const response = await injectJson(server, "POST", "/quote", baseQuoteRequest);

    assert.equal(response.statusCode, 503);
    assert.equal(response.body.code, "ROUTING_UNAVAILABLE");
    assert.match(response.body.traceId, /^tr_/);
    assert.equal(response.headers["x-trace-id"], response.body.traceId);

    assert.match(requestedQuoteId, /^q_/);
    const status = await injectJson(server, "GET", `/quote/${requestedQuoteId}`);
    assert.equal(status.statusCode, 200);
    assert.equal(status.body.status, "failed");
    assert.equal(status.body.errorCode, "ROUTING_UNAVAILABLE");

    const metrics = await server.inject({ method: "GET", url: "/metrics" });
    assert.equal(metrics.statusCode, 200);
    assert.match(metrics.payload, /rfq_quote_requests_total 1/);
    assert.match(metrics.payload, /rfq_quote_errors_total 1/);
    assert.match(metrics.payload, /rfq_quote_responses_total 0/);
    assert.match(metrics.payload, /rfq_signer_requests_total\{operation="sign"\} 0/);
    assert.match(metrics.payload, /rfq_settlements_total 0/);
  } finally {
    await server.close();
  }
});

test("RFQ API maps quote store failures before signing", async () => {
  const server = buildServer({
    logger: false,
    quoteRepository: {
      async checkHealth() {},
      async saveRequested() {
        throw new Error("quote store offline");
      },
      async saveRouteDecision() {},
      async saveRejected() {},
      async saveSigned() {},
      async findStatus() {
        return undefined;
      },
      async findPrincipalId() {
        return undefined;
      },
      async markFailed() {},
      async markStatus() {},
      async findQuoteIdByChainUserNonce() {
        return undefined;
      },
      async findSignedQuoteByChainUserNonce() {
        return undefined;
      },
      async findSignedQuoteByQuoteId() {
        return undefined;
      },
    },
  });
  await server.ready();

  try {
    const response = await injectJson(server, "POST", "/quote", baseQuoteRequest);

    assert.equal(response.statusCode, 503);
    assert.equal(response.body.code, "QUOTE_STORE_UNAVAILABLE");
    assert.match(response.body.traceId, /^tr_/);
    assert.equal(response.headers["x-trace-id"], response.body.traceId);

    const metrics = await server.inject({ method: "GET", url: "/metrics" });
    assert.equal(metrics.statusCode, 200);
    assert.match(metrics.payload, /rfq_quote_requests_total 1/);
    assert.match(metrics.payload, /rfq_quote_errors_total 1/);
    assert.match(metrics.payload, /rfq_quote_responses_total 0/);
    assert.match(metrics.payload, /rfq_signer_requests_total\{operation="sign"\} 0/);
    assert.match(metrics.payload, /rfq_settlements_total 0/);
  } finally {
    await server.close();
  }
});

test("RFQ API marks requested quotes failed when risk decision audit store fails", async () => {
  const quoteRepository = new InMemoryQuoteRepository();
  const saveRequested = quoteRepository.saveRequested.bind(quoteRepository);
  let requestedQuoteId;
  quoteRepository.saveRequested = async (input) => {
    requestedQuoteId = input.quoteId;
    await saveRequested(input);
  };
  const server = buildServer({
    logger: false,
    quoteRepository,
    riskDecisionStore: {
      checkHealth() {},
      async saveDecision() {
        throw new Error("risk decision audit store offline");
      },
      async findByQuoteId() {
        return undefined;
      },
    },
  });
  await server.ready();

  try {
    const response = await injectJson(server, "POST", "/quote", baseQuoteRequest);

    assert.equal(response.statusCode, 503);
    assert.equal(response.body.code, "QUOTE_STORE_UNAVAILABLE");
    assert.match(response.body.traceId, /^tr_/);
    assert.equal(response.headers["x-trace-id"], response.body.traceId);

    assert.match(requestedQuoteId, /^q_/);
    const status = await injectJson(server, "GET", `/quote/${requestedQuoteId}`);
    assert.equal(status.statusCode, 200);
    assert.equal(status.body.status, "failed");
    assert.equal(status.body.errorCode, "QUOTE_STORE_UNAVAILABLE");

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

test("RFQ API maps pricing engine failures to dependency errors before signing", async () => {
  const quoteRepository = new InMemoryQuoteRepository();
  const saveRequested = quoteRepository.saveRequested.bind(quoteRepository);
  let requestedQuoteId;
  quoteRepository.saveRequested = async (input) => {
    requestedQuoteId = input.quoteId;
    await saveRequested(input);
  };
  const server = buildServer({
    logger: false,
    quoteRepository,
    pricingEngine: {
      async price() {
        throw new Error("pricing backend offline");
      },
    },
  });
  await server.ready();

  try {
    const response = await injectJson(server, "POST", "/quote", baseQuoteRequest);

    assert.equal(response.statusCode, 503);
    assert.equal(response.body.code, "PRICING_UNAVAILABLE");
    assert.match(response.body.traceId, /^tr_/);
    assert.equal(response.headers["x-trace-id"], response.body.traceId);

    assert.match(requestedQuoteId, /^q_/);
    const status = await injectJson(server, "GET", `/quote/${requestedQuoteId}`);
    assert.equal(status.statusCode, 200);
    assert.equal(status.body.status, "failed");
    assert.equal(status.body.errorCode, "PRICING_UNAVAILABLE");

    const metrics = await server.inject({ method: "GET", url: "/metrics" });
    assert.equal(metrics.statusCode, 200);
    assert.match(metrics.payload, /rfq_quote_requests_total 1/);
    assert.match(metrics.payload, /rfq_quote_errors_total 1/);
    assert.match(metrics.payload, /rfq_quote_responses_total 0/);
    assert.match(metrics.payload, /rfq_signer_requests_total\{operation="sign"\} 0/);
    assert.match(metrics.payload, /rfq_settlements_total 0/);
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
