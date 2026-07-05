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

test("validateSubmitQuoteRequest validates internal submit validation options", () => {
  const expiredSignedQuote = {
    ...signedQuote,
    deadline: Math.floor(Date.now() / 1000) - 1,
  };

  assert.equal(
    validateSubmitQuoteRequest(
      {
        quote: expiredSignedQuote,
        signature: canonicalSignature,
      },
      { allowExpired: true },
    ).quote.deadline,
    expiredSignedQuote.deadline,
  );

  assertAPIError(
    () =>
      validateSubmitQuoteRequest(
        {
          quote: expiredSignedQuote,
          signature: canonicalSignature,
        },
        Object.create({ allowExpired: true }),
      ),
    "INVALID_REQUEST",
    "Submit validation options.allowExpired must be an own field when provided",
    400,
  );
  assertAPIError(
    () =>
      validateSubmitQuoteRequest(
        {
          quote: signedQuote,
          signature: canonicalSignature,
        },
        { allowExpired: "true" },
      ),
    "INVALID_REQUEST",
    "Submit validation options allowExpired must be a boolean",
    400,
  );
  assertAPIError(
    () =>
      validateSubmitQuoteRequest(
        {
          quote: signedQuote,
          signature: canonicalSignature,
        },
        { allowExpired: true, retry: true },
      ),
    "INVALID_REQUEST",
    "Submit validation options contains unknown field retry",
    400,
  );
  assertAPIError(
    () =>
      validateSubmitQuoteRequest(
        {
          quote: signedQuote,
          signature: canonicalSignature,
        },
        null,
      ),
    "INVALID_REQUEST",
    "Submit validation options must be an object",
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
