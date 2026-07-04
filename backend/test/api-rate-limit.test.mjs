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

test("RFQ API rate limits quote requests by client", async () => {
  const server = buildServer({
    logger: false,
    rateLimit: {
      windowMs: 60_000,
      maxQuoteRequests: 1,
      maxSubmitRequests: 100,
      maxStatusRequests: 100,
    },
  });
  await server.ready();

  try {
    const firstQuote = await injectJson(server, "POST", "/quote", baseQuoteRequest);
    assert.equal(firstQuote.statusCode, 200);
    assert.equal(firstQuote.headers["x-ratelimit-remaining"], "0");

    const secondQuote = await injectJson(server, "POST", "/quote", baseQuoteRequest);
    assert.equal(secondQuote.statusCode, 429);
    assert.equal(secondQuote.body.code, "RATE_LIMITED");
    assert.equal(secondQuote.headers["retry-after"], "60");
    assert.match(secondQuote.body.traceId, /^tr_/);
    assert.equal(secondQuote.headers["x-trace-id"], secondQuote.body.traceId);

    const metrics = await server.inject({ method: "GET", url: "/metrics" });
    assert.equal(metrics.statusCode, 200);
    assert.match(metrics.payload, /rfq_quote_requests_total 2/);
    assert.match(metrics.payload, /rfq_quote_responses_total 1/);
    assert.match(metrics.payload, /rfq_quote_errors_total 1/);
    assert.match(metrics.payload, /rfq_quote_latency_seconds_count 2/);
    assert.match(metrics.payload, /rfq_rate_limited_total\{endpoint="quote"\} 1/);
    assert.match(metrics.payload, /rfq_rate_limited_total\{endpoint="submit"\} 0/);
    assert.match(metrics.payload, /rfq_rate_limited_total\{endpoint="status"\} 0/);
  } finally {
    await server.close();
  }
});

test("RFQ API does not trust x-forwarded-for for rate limit identity by default", async () => {
  const server = buildServer({
    logger: false,
    rateLimit: {
      windowMs: 60_000,
      maxQuoteRequests: 1,
      maxSubmitRequests: 100,
      maxStatusRequests: 100,
    },
  });
  await server.ready();

  try {
    const firstQuote = await injectJson(server, "POST", "/quote", baseQuoteRequest, {
      "x-forwarded-for": "198.51.100.10",
    });
    assert.equal(firstQuote.statusCode, 200);

    const secondQuote = await injectJson(server, "POST", "/quote", baseQuoteRequest, {
      "x-forwarded-for": "198.51.100.11",
    });
    assert.equal(secondQuote.statusCode, 429);
    assert.equal(secondQuote.body.code, "RATE_LIMITED");
  } finally {
    await server.close();
  }
});

test("RFQ API trusts x-forwarded-for for rate limit identity only when proxy trust is enabled", async () => {
  const server = buildServer({
    logger: false,
    trustProxy: true,
    rateLimit: {
      windowMs: 60_000,
      maxQuoteRequests: 1,
      maxSubmitRequests: 100,
      maxStatusRequests: 100,
    },
  });
  await server.ready();

  try {
    const firstQuote = await injectJson(server, "POST", "/quote", baseQuoteRequest, {
      "x-forwarded-for": "198.51.100.10",
    });
    assert.equal(firstQuote.statusCode, 200);

    const secondQuote = await injectJson(server, "POST", "/quote", baseQuoteRequest, {
      "x-forwarded-for": "198.51.100.11",
    });
    assert.equal(secondQuote.statusCode, 200);

    const replayFirstClient = await injectJson(server, "POST", "/quote", baseQuoteRequest, {
      "x-forwarded-for": "198.51.100.10, 203.0.113.7",
    });
    assert.equal(replayFirstClient.statusCode, 429);
    assert.equal(replayFirstClient.body.code, "RATE_LIMITED");

    const emptyForwardedClient = await injectJson(server, "POST", "/quote", baseQuoteRequest, {
      "x-forwarded-for": ", 203.0.113.7",
    });
    assert.equal(emptyForwardedClient.statusCode, 200);

    const secondEmptyForwardedClient = await injectJson(server, "POST", "/quote", baseQuoteRequest, {
      "x-forwarded-for": ", 203.0.113.8",
    });
    assert.equal(secondEmptyForwardedClient.statusCode, 429);
    assert.equal(secondEmptyForwardedClient.body.code, "RATE_LIMITED");
  } finally {
    await server.close();
  }
});

test("RFQ API rejects oversized trusted forwarded rate limit identity", async () => {
  const server = buildServer({
    logger: false,
    trustProxy: true,
    rateLimit: {
      windowMs: 60_000,
      maxQuoteRequests: 1,
      maxSubmitRequests: 100,
      maxStatusRequests: 100,
    },
  });
  await server.ready();

  try {
    const response = await injectJson(server, "POST", "/quote", baseQuoteRequest, {
      "x-forwarded-for": "a".repeat(129),
    });

    assert.equal(response.statusCode, 400);
    assert.equal(response.body.code, "INVALID_REQUEST");
    assert.match(response.body.message, /Rate limit clientId must be 128 characters or fewer/);
  } finally {
    await server.close();
  }
});

test("RFQ API rejects unsafe trusted forwarded rate limit identity", async () => {
  const server = buildServer({
    logger: false,
    trustProxy: true,
    rateLimit: {
      windowMs: 60_000,
      maxQuoteRequests: 1,
      maxSubmitRequests: 100,
      maxStatusRequests: 100,
    },
  });
  await server.ready();

  try {
    const response = await injectJson(server, "POST", "/quote", baseQuoteRequest, {
      "x-forwarded-for": "198.51.100.10/bad",
    });

    assert.equal(response.statusCode, 400);
    assert.equal(response.body.code, "INVALID_REQUEST");
    assert.match(response.body.message, /Rate limit clientId must contain only letters, numbers, dot, underscore, colon, or hyphen/);
  } finally {
    await server.close();
  }
});

test("RFQ API rate limits submit requests before validation and settlement", async () => {
  const server = buildServer({
    logger: false,
    rateLimit: {
      windowMs: 60_000,
      maxQuoteRequests: 100,
      maxSubmitRequests: 1,
      maxStatusRequests: 100,
    },
  });
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

    const firstSubmit = await injectJson(server, "POST", "/submit", {
      quote,
      signature: fixedSignature(),
    });
    assert.equal(firstSubmit.statusCode, 404);
    assert.equal(firstSubmit.body.code, "QUOTE_NOT_FOUND");

    const secondSubmit = await injectJson(server, "POST", "/submit", {
      quote,
      signature: fixedSignature(),
    });
    assert.equal(secondSubmit.statusCode, 429);
    assert.equal(secondSubmit.body.code, "RATE_LIMITED");
    assert.equal(secondSubmit.headers["retry-after"], "60");
    assert.match(secondSubmit.body.traceId, /^tr_/);

    const metrics = await server.inject({ method: "GET", url: "/metrics" });
    assert.equal(metrics.statusCode, 200);
    assert.match(metrics.payload, /rfq_submit_requests_total 2/);
    assert.match(metrics.payload, /rfq_submit_errors_total 2/);
    assert.match(metrics.payload, /rfq_submit_accepted_total 0/);
    assert.match(metrics.payload, /rfq_submit_latency_seconds_count 2/);
    assert.match(metrics.payload, /rfq_rate_limited_total\{endpoint="quote"\} 0/);
    assert.match(metrics.payload, /rfq_rate_limited_total\{endpoint="submit"\} 1/);
    assert.match(metrics.payload, /rfq_rate_limited_total\{endpoint="status"\} 0/);
    assert.match(metrics.payload, /rfq_settlements_total 0/);
  } finally {
    await server.close();
  }
});

test("RFQ API rate limits quote status requests by client", async () => {
  const server = buildServer({
    logger: false,
    rateLimit: {
      windowMs: 60_000,
      maxQuoteRequests: 100,
      maxSubmitRequests: 100,
      maxStatusRequests: 1,
    },
  });
  await server.ready();

  try {
    const firstStatus = await injectJson(server, "GET", "/quote/q_missing");
    assert.equal(firstStatus.statusCode, 404);
    assert.equal(firstStatus.body.code, "QUOTE_NOT_FOUND");

    const secondStatus = await injectJson(server, "GET", "/quote/q_missing");
    assert.equal(secondStatus.statusCode, 429);
    assert.equal(secondStatus.body.code, "RATE_LIMITED");
    assert.equal(secondStatus.headers["retry-after"], "60");
    assert.match(secondStatus.body.traceId, /^tr_/);

    const metrics = await server.inject({ method: "GET", url: "/metrics" });
    assert.equal(metrics.statusCode, 200);
    assert.match(metrics.payload, /rfq_rate_limited_total\{endpoint="quote"\} 0/);
    assert.match(metrics.payload, /rfq_rate_limited_total\{endpoint="submit"\} 0/);
    assert.match(metrics.payload, /rfq_rate_limited_total\{endpoint="status"\} 1/);
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
