import assert from "node:assert/strict";
import test from "node:test";
import { validateQuoteRequest } from "../dist/shared/validation/quote-request.js";

const quoteRequest = {
  chainId: 1,
  user: "0x0000000000000000000000000000000000000001",
  tokenIn: "0x0000000000000000000000000000000000000002",
  tokenOut: "0x0000000000000000000000000000000000000003",
  amountIn: "1000000000",
  slippageBps: 50,
};

test("validateQuoteRequest parses valid quote requests without coercing uint strings", () => {
  assert.deepEqual(validateQuoteRequest(quoteRequest), quoteRequest);
});

test("validateQuoteRequest rejects unknown fields and invalid quote shape", () => {
  assertAPIError(
    () => validateQuoteRequest({ ...quoteRequest, routeHint: "fast" }),
    "INVALID_REQUEST",
    "Quote request contains unknown field routeHint",
    400,
  );
  assertAPIError(
    () => validateQuoteRequest({ ...quoteRequest, tokenOut: quoteRequest.tokenIn }),
    "INVALID_REQUEST",
    "tokenIn and tokenOut must be different",
    400,
  );
  assertAPIError(
    () => validateQuoteRequest({ ...quoteRequest, amountIn: "0" }),
    "INVALID_REQUEST",
    "amountIn must be a positive uint string",
    400,
  );
  assertAPIError(
    () => validateQuoteRequest({ ...quoteRequest, amountIn: "001000000000" }),
    "INVALID_REQUEST",
    "amountIn must be a positive uint string",
    400,
  );
  assertAPIError(
    () => validateQuoteRequest({ ...quoteRequest, slippageBps: 10001 }),
    "INVALID_REQUEST",
    "slippageBps must be an integer from 0 to 10000",
    400,
  );
});

test("validateQuoteRequest rejects missing required fields before field validation", () => {
  const request = { ...quoteRequest };
  delete request.amountIn;

  assertAPIError(
    () => validateQuoteRequest(request),
    "INVALID_REQUEST",
    "Quote request must include field amountIn",
    400,
  );
});

test("validateQuoteRequest rejects non-schema JSON primitive types before coercion", () => {
  assertAPIError(
    () => validateQuoteRequest({ ...quoteRequest, chainId: "1" }),
    "INVALID_REQUEST",
    "chainId must be a positive safe integer",
    400,
  );
  assertAPIError(
    () => validateQuoteRequest({ ...quoteRequest, chainId: true }),
    "INVALID_REQUEST",
    "chainId must be a positive safe integer",
    400,
  );
  assertAPIError(
    () => validateQuoteRequest({ ...quoteRequest, user: 1 }),
    "INVALID_REQUEST",
    "user must be an EVM address",
    400,
  );
  assertAPIError(
    () => validateQuoteRequest({ ...quoteRequest, amountIn: 1000000000 }),
    "INVALID_REQUEST",
    "amountIn must be a positive uint string",
    400,
  );
  assertAPIError(
    () => validateQuoteRequest({ ...quoteRequest, slippageBps: "50" }),
    "INVALID_REQUEST",
    "slippageBps must be an integer from 0 to 10000",
    400,
  );
  assertAPIError(
    () => validateQuoteRequest({ ...quoteRequest, slippageBps: false }),
    "INVALID_REQUEST",
    "slippageBps must be an integer from 0 to 10000",
    400,
  );
});

test("validateQuoteRequest rejects boxed string fields before regex coercion", () => {
  assertAPIError(
    () => validateQuoteRequest({ ...quoteRequest, user: new String(quoteRequest.user) }),
    "INVALID_REQUEST",
    "user must be a primitive string",
    400,
  );
  assertAPIError(
    () => validateQuoteRequest({ ...quoteRequest, amountIn: new String(quoteRequest.amountIn) }),
    "INVALID_REQUEST",
    "amountIn must be a primitive string",
    400,
  );
});


function assertAPIError(callback, code, message, statusCode) {
  assert.throws(callback, (error) => {
    assert.equal(error.code, code);
    assert.equal(error.message, message);
    assert.equal(error.statusCode, statusCode);
    return true;
  });
}
