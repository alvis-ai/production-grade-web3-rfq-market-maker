import assert from "node:assert/strict";
import test from "node:test";
import { validateQuoteRequest } from "../dist/shared/validation/quote-request.js";
import { validateSubmitQuoteRequest } from "../dist/shared/validation/submit-request.js";

const quoteRequest = {
  chainId: 1,
  user: "0x0000000000000000000000000000000000000001",
  tokenIn: "0x0000000000000000000000000000000000000002",
  tokenOut: "0x0000000000000000000000000000000000000003",
  amountIn: "1000000000",
  slippageBps: 50,
};

const signedQuote = {
  user: quoteRequest.user,
  tokenIn: quoteRequest.tokenIn,
  tokenOut: quoteRequest.tokenOut,
  amountIn: quoteRequest.amountIn,
  amountOut: "998400000",
  minAmountOut: "993408000",
  nonce: "42",
  deadline: 1893456000,
  chainId: quoteRequest.chainId,
};

const signature = `0x${"11".repeat(65)}`;

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
    () => validateQuoteRequest({ ...quoteRequest, slippageBps: 10001 }),
    "INVALID_REQUEST",
    "slippageBps must be an integer from 0 to 10000",
    400,
  );
});

test("validateSubmitQuoteRequest parses valid signed quote submits", () => {
  const parsed = validateSubmitQuoteRequest({
    quote: signedQuote,
    signature,
  });

  assert.deepEqual(parsed, {
    quote: signedQuote,
    signature,
  });
});

test("validateSubmitQuoteRequest rejects unsafe submit payloads before execution", () => {
  assertAPIError(
    () => validateSubmitQuoteRequest({ quote: signedQuote, signature, relayer: "0x1234" }),
    "INVALID_REQUEST",
    "Submit request contains unknown field relayer",
    400,
  );
  assertAPIError(
    () => validateSubmitQuoteRequest({ quote: { ...signedQuote, permit: "0x" }, signature }),
    "INVALID_REQUEST",
    "Submit quote contains unknown field permit",
    400,
  );
  assertAPIError(
    () =>
      validateSubmitQuoteRequest({
        quote: {
          ...signedQuote,
          amountOut: "993407999",
        },
        signature,
      }),
    "INVALID_REQUEST",
    "quote.amountOut must be greater than or equal to quote.minAmountOut",
    400,
  );
  assertAPIError(
    () =>
      validateSubmitQuoteRequest({
        quote: {
          ...signedQuote,
          deadline: Math.floor(Date.now() / 1000) - 1,
        },
        signature,
      }),
    "QUOTE_EXPIRED",
    "Quote expired",
    409,
  );
  assertAPIError(
    () => validateSubmitQuoteRequest({ quote: signedQuote, signature: "0x1234" }),
    "INVALID_REQUEST",
    "signature must be 65 bytes",
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
