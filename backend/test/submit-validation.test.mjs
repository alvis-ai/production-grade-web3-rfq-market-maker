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
const highSSignature = `0x${"11".repeat(32)}${"f".repeat(64)}1b`;

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
