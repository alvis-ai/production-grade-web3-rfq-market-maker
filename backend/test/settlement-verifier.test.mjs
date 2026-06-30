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
  await assertSettlementRevert(
    new LocalSettlementVerifier({
      ...defaultLocalSettlementVerifierPolicy,
      tokenWhitelist: [quote.tokenIn],
    }).verify({
      quoteId: "q_test",
      request,
    }),
    "TOKEN_NOT_WHITELISTED",
  );
});

test("LocalSettlementVerifier rejects disabled settlement chains", async () => {
  await assertSettlementRevert(
    new LocalSettlementVerifier({
      ...defaultLocalSettlementVerifierPolicy,
      enabledChainIds: [8453],
    }).verify({
      quoteId: "q_test",
      request,
    }),
    "INVALID_CHAIN_ID",
  );
});

test("LocalSettlementVerifier rejects expired settlement quotes", async () => {
  await assertSettlementRevert(
    new LocalSettlementVerifier().verify({
      quoteId: "q_test",
      request: {
        ...request,
        quote: {
          ...quote,
          deadline: Math.floor(Date.now() / 1000) - 1,
        },
      },
    }),
    "QUOTE_EXPIRED",
  );
});

test("LocalSettlementVerifier rejects invalid settlement token pairs", async () => {
  await assertSettlementRevert(
    new LocalSettlementVerifier().verify({
      quoteId: "q_test",
      request: {
        ...request,
        quote: {
          ...quote,
          tokenOut: quote.tokenIn,
        },
      },
    }),
    "INVALID_TOKEN_PAIR",
  );
});

test("LocalSettlementVerifier rejects invalid settlement amounts", async () => {
  await assertSettlementRevert(
    new LocalSettlementVerifier().verify({
      quoteId: "q_test",
      request: {
        ...request,
        quote: {
          ...quote,
          amountOut: "0",
        },
      },
    }),
    "INVALID_AMOUNT",
  );
});

test("LocalSettlementVerifier rejects settlement amountOut below minimum", async () => {
  await assertSettlementRevert(
    new LocalSettlementVerifier().verify({
      quoteId: "q_test",
      request: {
        ...request,
        quote: {
          ...quote,
          amountOut: "993407999",
        },
      },
    }),
    "AMOUNT_OUT_BELOW_MINIMUM",
  );
});

test("LocalSettlementVerifier rejects unsafe policy configuration at construction", () => {
  assert.throws(
    () =>
      new LocalSettlementVerifier({
        ...defaultLocalSettlementVerifierPolicy,
        verifierVersion: " ",
      }),
    /Local settlement verifier verifierVersion must be a non-empty string/,
  );

  assert.throws(
    () =>
      new LocalSettlementVerifier({
        ...defaultLocalSettlementVerifierPolicy,
        enabledChainIds: [],
      }),
    /Local settlement verifier enabledChainIds must contain at least one chain id/,
  );

  assert.throws(
    () =>
      new LocalSettlementVerifier({
        ...defaultLocalSettlementVerifierPolicy,
        enabledChainIds: [0],
      }),
    /Local settlement verifier enabledChainIds entries must be positive safe integers/,
  );

  assert.throws(
    () =>
      new LocalSettlementVerifier({
        ...defaultLocalSettlementVerifierPolicy,
        enabledChainIds: [1, 1],
      }),
    /Local settlement verifier enabledChainIds must not contain duplicate chain ids/,
  );

  assert.throws(
    () =>
      new LocalSettlementVerifier({
        ...defaultLocalSettlementVerifierPolicy,
        tokenWhitelist: [],
      }),
    /Local settlement verifier tokenWhitelist must contain at least one address/,
  );

  assert.throws(
    () =>
      new LocalSettlementVerifier({
        ...defaultLocalSettlementVerifierPolicy,
        tokenWhitelist: ["0x00000000000000000000000000000000000000zz"],
      }),
    /Local settlement verifier tokenWhitelist entries must be 20-byte hex addresses/,
  );

  assert.throws(
    () =>
      new LocalSettlementVerifier({
        ...defaultLocalSettlementVerifierPolicy,
        tokenWhitelist: [
          "0x00000000000000000000000000000000000000cc",
          "0x00000000000000000000000000000000000000CC",
        ],
      }),
    /Local settlement verifier tokenWhitelist must not contain duplicate addresses/,
  );
});

async function assertSettlementRevert(promise, internalReasonCode) {
  await assert.rejects(promise, (error) => {
    assert.equal(error.code, "SETTLEMENT_REVERTED");
    assert.equal(error.statusCode, 409);
    assert.equal(error.internalReasonCode, internalReasonCode);
    return true;
  });
}
