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
  const txHash = `0x${"ab".repeat(32)}`;
  const parsed = validateSubmitQuoteRequest({
    quote: signedQuote,
    signature: canonicalSignature,
    txHash: txHash.toUpperCase().replace("0X", "0x"),
  });

  assert.deepEqual(parsed, {
    quote: signedQuote,
    signature: canonicalSignature,
    txHash,
  });
});

test("validateSubmitQuoteRequest rejects unsafe submit payloads before execution", () => {
  const inheritedTxHash = { quote: signedQuote, signature: canonicalSignature };
  Object.setPrototypeOf(inheritedTxHash, { txHash: `0x${"ab".repeat(32)}` });
  assertAPIError(
    () => validateSubmitQuoteRequest(inheritedTxHash),
    "INVALID_REQUEST",
    "Submit request txHash must be an own field when provided",
    400,
  );
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
  const confirmedExpired = validateSubmitQuoteRequest({
    quote: { ...signedQuote, deadline: Math.floor(Date.now() / 1000) - 1 },
    signature: canonicalSignature,
    txHash: `0x${"ab".repeat(32)}`,
  });
  assert.equal(confirmedExpired.txHash, `0x${"ab".repeat(32)}`);
  assertAPIError(
    () => validateSubmitQuoteRequest({ quote: signedQuote, signature: "0x1234" }),
    "INVALID_REQUEST",
    "signature must be 65 bytes",
    400,
  );
  assertAPIError(
    () => validateSubmitQuoteRequest({ quote: signedQuote, signature: canonicalSignature, txHash: "0x1234" }),
    "INVALID_REQUEST",
    "txHash must be a 32-byte hex string",
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

function assertAPIError(callback, code, message, statusCode) {
  assert.throws(callback, (error) => {
    assert.equal(error.code, code);
    assert.equal(error.message, message);
    assert.equal(error.statusCode, statusCode);
    return true;
  });
}
