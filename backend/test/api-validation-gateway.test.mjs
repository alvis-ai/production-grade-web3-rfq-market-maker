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
    assertSecurityHeaders(invalid, { hsts: false });

    const unsafeChainId = await injectJson(server, "POST", "/quote", {
      ...baseQuoteRequest,
      chainId: Number.MAX_SAFE_INTEGER + 1,
    });
    assert.equal(unsafeChainId.statusCode, 400);
    assert.equal(unsafeChainId.body.code, "INVALID_REQUEST");
    assert.match(unsafeChainId.body.message, /chainId must be a positive safe integer/);

    const notFound = await injectJson(server, "GET", "/quote/q_missing");
    assert.equal(notFound.statusCode, 404);
    assert.equal(notFound.body.code, "QUOTE_NOT_FOUND");
    assert.match(notFound.body.traceId, /^tr_/);
    assert.equal(notFound.headers["x-trace-id"], notFound.body.traceId);
  } finally {
    await server.close();
  }
});

test("RFQ API returns closed structured error responses", async () => {
  const server = buildServer({ logger: false });
  server.get("/closed-internal-error", async () => {
    throw new Error("internal details must not leak");
  });
  await server.ready();

  try {
    const validationError = await injectJson(server, "POST", "/quote", {
      ...baseQuoteRequest,
      routeHint: "debug",
    });
    assert.equal(validationError.statusCode, 400);
    assertClosedErrorResponse(validationError, "INVALID_REQUEST", "Quote request contains unknown field routeHint");

    const notFoundError = await injectJson(server, "GET", "/quote/q_missing");
    assert.equal(notFoundError.statusCode, 404);
    assertClosedErrorResponse(notFoundError, "QUOTE_NOT_FOUND", "Quote not found");

    const frameworkError = await injectRaw(server, "POST", "/quote", '{"chainId":');
    assert.equal(frameworkError.statusCode, 400);
    assertClosedErrorResponse(frameworkError, "INVALID_REQUEST", "Malformed JSON request body");

    const internalError = await injectJson(server, "GET", "/closed-internal-error");
    assert.equal(internalError.statusCode, 500);
    assertClosedErrorResponse(internalError, "INTERNAL_ERROR", "Internal server error");
  } finally {
    await server.close();
  }
});

test("RFQ API maps unmatched routes to structured errors", async () => {
  const server = buildServer({ logger: false });
  await server.ready();

  try {
    const missingRoute = await injectJson(server, "GET", "/not-a-real-route");

    assert.equal(missingRoute.statusCode, 404);
    assert.equal(missingRoute.body.code, "INVALID_REQUEST");
    assert.equal(missingRoute.body.message, "Route not found");
    assert.match(missingRoute.body.traceId, /^tr_/);
    assert.equal(missingRoute.headers["x-trace-id"], missingRoute.body.traceId);
    assertSecurityHeaders(missingRoute, { hsts: false });

    const unsupportedMethod = await injectJson(server, "PATCH", "/quote/q_missing");

    assert.equal(unsupportedMethod.statusCode, 404);
    assert.equal(unsupportedMethod.body.code, "INVALID_REQUEST");
    assert.equal(unsupportedMethod.body.message, "Route not found");
    assert.match(unsupportedMethod.body.traceId, /^tr_/);
    assert.equal(unsupportedMethod.headers["x-trace-id"], unsupportedMethod.body.traceId);
  } finally {
    await server.close();
  }
});

test("RFQ API maps malformed JSON bodies to structured errors", async () => {
  const server = buildServer({ logger: false });
  await server.ready();

  try {
    const response = await injectRaw(server, "POST", "/quote", '{"chainId":');

    assert.equal(response.statusCode, 400);
    assert.equal(response.body.code, "INVALID_REQUEST");
    assert.equal(response.body.message, "Malformed JSON request body");
    assert.match(response.body.traceId, /^tr_/);
    assert.equal(response.headers["x-trace-id"], response.body.traceId);
  } finally {
    await server.close();
  }
});

test("RFQ API maps oversized JSON bodies to structured errors", async () => {
  const server = buildServer({ logger: false, bodyLimitBytes: 1024 });
  await server.ready();

  try {
    const response = await injectRaw(server, "POST", "/quote", JSON.stringify({
      ...baseQuoteRequest,
      amountIn: "1".repeat(2048),
    }));

    assert.equal(response.statusCode, 413);
    assert.equal(response.body.code, "INVALID_REQUEST");
    assert.equal(response.body.message, "Request body too large");
    assert.match(response.body.traceId, /^tr_/);
    assert.equal(response.headers["x-trace-id"], response.body.traceId);
  } finally {
    await server.close();
  }
});

test("RFQ API ignores inherited framework error fields", async () => {
  const server = buildServer({ logger: false });
  server.get("/prototype-framework-error", async () => {
    throw Object.create({ statusCode: 400, code: "FST_ERR_CTP_BODY_TOO_LARGE" });
  });
  await server.ready();

  try {
    const response = await injectJson(server, "GET", "/prototype-framework-error");

    assert.equal(response.statusCode, 500);
    assert.equal(response.body.code, "INTERNAL_ERROR");
    assert.equal(response.body.message, "Internal server error");
    assert.match(response.body.traceId, /^tr_/);
    assert.equal(response.headers["x-trace-id"], response.body.traceId);
    assertSecurityHeaders(response, { hsts: false });
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

async function injectRaw(server, method, url, payload) {
  const response = await server.inject({
    method,
    url,
    headers: { "content-type": "application/json" },
    payload,
  });

  return {
    statusCode: response.statusCode,
    headers: response.headers,
    body: response.payload ? JSON.parse(response.payload) : undefined,
  };
}

function assertResponseFields(body, fields) {
  assert.deepEqual(Object.keys(body).sort(), [...fields].sort());
}

function assertClosedErrorResponse(response, code, message) {
  assertResponseFields(response.body, ["code", "message", "traceId"]);
  assert.equal(response.body.code, code);
  assert.equal(response.body.message, message);
  assert.match(response.body.traceId, /^tr_/);
  assert.equal(response.headers["x-trace-id"], response.body.traceId);
}

function assertSecurityHeaders(response, { hsts }) {
  assert.equal(response.headers["cache-control"], "no-store");
  assert.equal(response.headers["x-content-type-options"], "nosniff");
  assert.equal(response.headers["x-frame-options"], "DENY");
  assert.equal(response.headers["referrer-policy"], "no-referrer");
  assert.equal(response.headers["permissions-policy"], "camera=(), microphone=(), geolocation=()");
  if (hsts) {
    assert.equal(response.headers["strict-transport-security"], "max-age=31536000; includeSubDomains");
  } else {
    assert.equal(response.headers["strict-transport-security"], undefined);
  }
}
