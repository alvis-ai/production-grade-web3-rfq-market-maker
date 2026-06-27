import assert from "node:assert/strict";
import test from "node:test";
import {
  LocalSettlementVerifier,
  defaultLocalSettlementVerifierPolicy,
} from "../dist/modules/settlement/settlement-verifier.service.js";

const quote = {
  user: "0x0000000000000000000000000000000000000001",
  tokenIn: "0x0000000000000000000000000000000000000002",
  tokenOut: "0x0000000000000000000000000000000000000003",
  amountIn: "1000000000",
  amountOut: "998400000",
  minAmountOut: "993408000",
  nonce: "42",
  deadline: Math.floor(Date.now() / 1000) + 30,
  chainId: 1,
};

const request = {
  quote,
  signature: `0x${"11".repeat(65)}`,
};

test("LocalSettlementVerifier accepts contract-shaped settlement quotes", async () => {
  const result = await new LocalSettlementVerifier().verify({
    quoteId: "q_test",
    request,
  });

  assert.equal(result.status, "verified");
  assert.equal(result.verifierVersion, "local-rfq-settlement-v1");
  assert.equal(result.amountOut, quote.amountOut);
});

test("LocalSettlementVerifier rejects non-whitelisted settlement tokens", async () => {
  await assert.rejects(
    new LocalSettlementVerifier({
      ...defaultLocalSettlementVerifierPolicy,
      tokenWhitelist: [quote.tokenIn],
    }).verify({
      quoteId: "q_test",
      request,
    }),
    (error) => {
      assert.equal(error.code, "SETTLEMENT_REVERTED");
      assert.equal(error.statusCode, 409);
      assert.equal(error.internalReasonCode, "TOKEN_NOT_WHITELISTED");
      return true;
    },
  );
});
