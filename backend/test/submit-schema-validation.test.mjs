import assert from "node:assert/strict";
import test from "node:test";
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

test("validateSubmitQuoteRequest rejects missing required fields before field validation", () => {
  const quote = { ...signedQuote };
  delete quote.nonce;

  assertAPIError(
    () => validateSubmitQuoteRequest({ quote: signedQuote }),
    "INVALID_REQUEST",
    "Submit request must include field signature",
    400,
  );
  assertAPIError(
    () => validateSubmitQuoteRequest({ quote, signature: canonicalSignature }),
    "INVALID_REQUEST",
    "Submit quote must include field nonce",
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

test("validateSubmitQuoteRequest rejects boxed string fields before regex coercion", () => {
  assertAPIError(
    () =>
      validateSubmitQuoteRequest({
        quote: { ...signedQuote, user: new String(signedQuote.user) },
        signature: canonicalSignature,
      }),
    "INVALID_REQUEST",
    "quote.user must be a primitive string",
    400,
  );
  assertAPIError(
    () =>
      validateSubmitQuoteRequest({
        quote: { ...signedQuote, amountIn: new String(signedQuote.amountIn) },
        signature: canonicalSignature,
      }),
    "INVALID_REQUEST",
    "quote.amountIn must be a primitive string",
    400,
  );
  assertAPIError(
    () => validateSubmitQuoteRequest({ quote: signedQuote, signature: new String(canonicalSignature) }),
    "INVALID_REQUEST",
    "signature must be a primitive string",
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
