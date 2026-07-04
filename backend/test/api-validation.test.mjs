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

test("RFQ API rejects unknown request fields", async () => {
  const server = buildServer({ logger: false });
  await server.ready();

  try {
    const quoteWithUnknownField = await injectJson(server, "POST", "/quote", {
      ...baseQuoteRequest,
      routeHint: "ignored-by-old-clients",
    });
    assert.equal(quoteWithUnknownField.statusCode, 400);
    assert.equal(quoteWithUnknownField.body.code, "INVALID_REQUEST");
    assert.equal(quoteWithUnknownField.body.message, "Quote request contains unknown field routeHint");
    assert.match(quoteWithUnknownField.body.traceId, /^tr_/);

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

    const submitWithUnknownField = await injectJson(server, "POST", "/submit", {
      quote,
      signature: fixedSignature(),
      relayer: baseQuoteRequest.user,
    });
    assert.equal(submitWithUnknownField.statusCode, 400);
    assert.equal(submitWithUnknownField.body.code, "INVALID_REQUEST");
    assert.equal(submitWithUnknownField.body.message, "Submit request contains unknown field relayer");

    const signedQuoteWithUnknownField = await injectJson(server, "POST", "/submit", {
      quote: {
        ...quote,
        permit: "unexpected",
      },
      signature: fixedSignature(),
    });
    assert.equal(signedQuoteWithUnknownField.statusCode, 400);
    assert.equal(signedQuoteWithUnknownField.body.code, "INVALID_REQUEST");
    assert.equal(signedQuoteWithUnknownField.body.message, "Submit quote contains unknown field permit");
  } finally {
    await server.close();
  }
});

test("RFQ API rejects missing required request fields", async () => {
  const server = buildServer({ logger: false });
  await server.ready();

  try {
    const quoteMissingAmountIn = { ...baseQuoteRequest };
    delete quoteMissingAmountIn.amountIn;
    const quoteWithMissingField = await injectJson(server, "POST", "/quote", quoteMissingAmountIn);
    assert.equal(quoteWithMissingField.statusCode, 400);
    assert.equal(quoteWithMissingField.body.code, "INVALID_REQUEST");
    assert.equal(quoteWithMissingField.body.message, "Quote request must include field amountIn");

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

    const submitWithMissingSignature = await injectJson(server, "POST", "/submit", { quote });
    assert.equal(submitWithMissingSignature.statusCode, 400);
    assert.equal(submitWithMissingSignature.body.code, "INVALID_REQUEST");
    assert.equal(submitWithMissingSignature.body.message, "Submit request must include field signature");

    const quoteMissingNonce = { ...quote };
    delete quoteMissingNonce.nonce;
    const submitWithMissingQuoteField = await injectJson(server, "POST", "/submit", {
      quote: quoteMissingNonce,
      signature: fixedSignature(),
    });
    assert.equal(submitWithMissingQuoteField.statusCode, 400);
    assert.equal(submitWithMissingQuoteField.body.code, "INVALID_REQUEST");
    assert.equal(submitWithMissingQuoteField.body.message, "Submit quote must include field nonce");
  } finally {
    await server.close();
  }
});

test("RFQ API rejects request JSON primitive types that would require coercion", async () => {
  const server = buildServer({ logger: false });
  await server.ready();

  try {
    const quoteWithStringChain = await injectJson(server, "POST", "/quote", {
      ...baseQuoteRequest,
      chainId: "1",
    });
    assert.equal(quoteWithStringChain.statusCode, 400);
    assert.equal(quoteWithStringChain.body.code, "INVALID_REQUEST");
    assert.equal(quoteWithStringChain.body.message, "chainId must be a positive safe integer");

    const quoteWithBooleanSlippage = await injectJson(server, "POST", "/quote", {
      ...baseQuoteRequest,
      slippageBps: false,
    });
    assert.equal(quoteWithBooleanSlippage.statusCode, 400);
    assert.equal(quoteWithBooleanSlippage.body.code, "INVALID_REQUEST");
    assert.equal(quoteWithBooleanSlippage.body.message, "slippageBps must be an integer from 0 to 10000");

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

    const submitWithNumericAmount = await injectJson(server, "POST", "/submit", {
      quote: {
        ...quote,
        amountIn: 1000000000,
      },
      signature: fixedSignature(),
    });
    assert.equal(submitWithNumericAmount.statusCode, 400);
    assert.equal(submitWithNumericAmount.body.code, "INVALID_REQUEST");
    assert.equal(submitWithNumericAmount.body.message, "quote.amountIn must be a uint string");

    const submitWithStringDeadline = await injectJson(server, "POST", "/submit", {
      quote: {
        ...quote,
        deadline: `${quote.deadline}`,
      },
      signature: fixedSignature(),
    });
    assert.equal(submitWithStringDeadline.statusCode, 400);
    assert.equal(submitWithStringDeadline.body.code, "INVALID_REQUEST");
    assert.equal(submitWithStringDeadline.body.message, "quote.deadline must be a positive safe integer");
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

    const invalidSignatureV = await injectJson(server, "POST", "/submit", {
      quote,
      signature: `0x${"11".repeat(64)}02`,
    });
    assert.equal(invalidSignatureV.statusCode, 400);
    assert.equal(invalidSignatureV.body.code, "INVALID_REQUEST");
    assert.equal(invalidSignatureV.body.message, "signature v value must be 27 or 28");
    assert.match(invalidSignatureV.body.traceId, /^tr_/);

    const highSSignature = await injectJson(server, "POST", "/submit", {
      quote,
      signature: `0x${"11".repeat(32)}${"f".repeat(64)}1b`,
    });
    assert.equal(highSSignature.statusCode, 400);
    assert.equal(highSSignature.body.code, "INVALID_REQUEST");
    assert.equal(highSSignature.body.message, "signature s value must be in the lower half order");
    assert.match(highSSignature.body.traceId, /^tr_/);

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

    const unsafeDeadline = await injectJson(server, "POST", "/submit", {
      quote: {
        ...quote,
        deadline: Number.MAX_SAFE_INTEGER + 1,
      },
      signature: fixedSignature(),
    });
    assert.equal(unsafeDeadline.statusCode, 400);
    assert.equal(unsafeDeadline.body.code, "INVALID_REQUEST");
    assert.match(unsafeDeadline.body.message, /quote\.deadline must be a positive safe integer/);

    const unsafeChainId = await injectJson(server, "POST", "/submit", {
      quote: {
        ...quote,
        chainId: Number.MAX_SAFE_INTEGER + 1,
      },
      signature: fixedSignature(),
    });
    assert.equal(unsafeChainId.statusCode, 400);
    assert.equal(unsafeChainId.body.code, "INVALID_REQUEST");
    assert.match(unsafeChainId.body.message, /quote\.chainId must be a positive safe integer/);
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

function fixedSignature() {
  return `0x${"11".repeat(64)}1b`;
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
