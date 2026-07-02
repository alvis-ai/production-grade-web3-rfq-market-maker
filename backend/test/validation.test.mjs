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

const canonicalSignature = `0x${"11".repeat(64)}1b`;
const highSSignature = `0x${"11".repeat(32)}${"f".repeat(64)}1b`;

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

test("validateSubmitQuoteRequest parses valid signed quote submits", () => {
  const parsed = validateSubmitQuoteRequest({
    quote: signedQuote,
    signature: canonicalSignature,
  });

  assert.deepEqual(parsed, {
    quote: signedQuote,
    signature: canonicalSignature,
  });
});

test("validateSubmitQuoteRequest rejects unsafe submit payloads before execution", () => {
  assertAPIError(
    () => validateSubmitQuoteRequest({ quote: signedQuote, signature: canonicalSignature, relayer: "0x1234" }),
    "INVALID_REQUEST",
    "Submit request contains unknown field relayer",
    400,
  );
  assertAPIError(
    () => validateSubmitQuoteRequest({ quote: { ...signedQuote, permit: "0x" }, signature: canonicalSignature }),
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
        signature: canonicalSignature,
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
          nonce: "0",
        },
        signature: canonicalSignature,
      }),
    "INVALID_REQUEST",
    "quote.nonce must be a positive uint string",
    400,
  );
  assertAPIError(
    () =>
      validateSubmitQuoteRequest({
        quote: {
          ...signedQuote,
          amountOut: "0998400000",
        },
        signature: canonicalSignature,
      }),
    "INVALID_REQUEST",
    "quote.amountOut must be a positive uint string",
    400,
  );
  assertAPIError(
    () =>
      validateSubmitQuoteRequest({
        quote: {
          ...signedQuote,
          deadline: Math.floor(Date.now() / 1000) - 1,
        },
        signature: canonicalSignature,
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
  assertAPIError(
    () => validateSubmitQuoteRequest({ quote: signedQuote, signature: `0x${"11".repeat(64)}02` }),
    "INVALID_REQUEST",
    "signature v value must be 27 or 28",
    400,
  );
  assertAPIError(
    () => validateSubmitQuoteRequest({ quote: signedQuote, signature: highSSignature }),
    "INVALID_REQUEST",
    "signature s value must be in the lower half order",
    400,
  );
});

test("validateSubmitQuoteRequest rejects non-schema JSON primitive types before coercion", () => {
  assertAPIError(
    () =>
      validateSubmitQuoteRequest({
        quote: { ...signedQuote, amountIn: 1000000000 },
        signature: canonicalSignature,
      }),
    "INVALID_REQUEST",
    "quote.amountIn must be a uint string",
    400,
  );
  assertAPIError(
    () =>
      validateSubmitQuoteRequest({
        quote: { ...signedQuote, nonce: 42 },
        signature: canonicalSignature,
      }),
    "INVALID_REQUEST",
    "quote.nonce must be a uint string",
    400,
  );
  assertAPIError(
    () =>
      validateSubmitQuoteRequest({
        quote: { ...signedQuote, deadline: `${signedQuote.deadline}` },
        signature: canonicalSignature,
      }),
    "INVALID_REQUEST",
    "quote.deadline must be a positive safe integer",
    400,
  );
  assertAPIError(
    () =>
      validateSubmitQuoteRequest({
        quote: { ...signedQuote, chainId: "1" },
        signature: canonicalSignature,
      }),
    "INVALID_REQUEST",
    "quote.chainId must be a positive safe integer",
    400,
  );
  assertAPIError(
    () => validateSubmitQuoteRequest({ quote: signedQuote, signature: 1 }),
    "INVALID_REQUEST",
    "signature must be hex encoded",
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
