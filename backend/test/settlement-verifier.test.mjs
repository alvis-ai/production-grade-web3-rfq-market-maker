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
  signature: `0x${"11".repeat(64)}1b`,
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

test("LocalSettlementVerifier rejects malformed verification payload envelopes before settlement checks", async () => {
  const verifier = new LocalSettlementVerifier();

  await assert.rejects(
    verifier.verify(undefined),
    /Local settlement verifier input must be an object/,
  );

  await assert.rejects(
    verifier.verify({
      quoteId: " ",
      request,
    }),
    /Local settlement verifier quoteId must be a non-empty string/,
  );

  await assert.rejects(
    verifier.verify({
      quoteId: new String("q_test"),
      request,
    }),
    /Local settlement verifier quoteId must be a primitive string/,
  );

  await assert.rejects(
    verifier.verify({
      quoteId: "q.bad",
      request,
    }),
    /Local settlement verifier quoteId must contain only letters, numbers, underscore, colon, or hyphen/,
  );

  await assert.rejects(
    verifier.verify({
      quoteId: "q".repeat(129),
      request,
    }),
    /Local settlement verifier quoteId must be 128 characters or fewer/,
  );

  await assert.rejects(
    verifier.verify({
      quoteId: "q_missing_request",
    }),
    /Local settlement verifier input.request must be an own field/,
  );

  await assert.rejects(
    verifier.verify({
      quoteId: "q_missing_quote",
      request: {
        signature: request.signature,
        quote: null,
      },
    }),
    /Local settlement verifier request.quote must be an object/,
  );
});

test("LocalSettlementVerifier rejects inherited verification fields before settlement checks", async () => {
  const verifier = new LocalSettlementVerifier();

  await assert.rejects(
    verifier.verify(Object.create({
      quoteId: "q_inherited_input",
      request,
    })),
    /Local settlement verifier input.quoteId must be an own field/,
  );

  await assert.rejects(
    verifier.verify({
      quoteId: "q_inherited_request",
      request: Object.create(request),
    }),
    /Local settlement verifier request.quote must be an own field/,
  );

  await assert.rejects(
    verifier.verify({
      quoteId: "q_inherited_quote",
      request: {
        quote: Object.create(quote),
        signature: request.signature,
      },
    }),
    /Local settlement verifier request.quote.user must be an own field/,
  );
});

test("LocalSettlementVerifier rejects malformed settlement quote fields before policy checks", async () => {
  const verifier = new LocalSettlementVerifier();

  await assertSettlementRevert(
    verifier.verify({
      quoteId: "q_bad_chain",
      request: {
        ...request,
        quote: {
          ...quote,
          chainId: "1",
        },
      },
    }),
    "INVALID_CHAIN_ID",
  );

  await assertSettlementRevert(
    verifier.verify({
      quoteId: "q_bad_deadline",
      request: {
        ...request,
        quote: {
          ...quote,
          deadline: "1893456000",
        },
      },
    }),
    "INVALID_DEADLINE",
  );

  await assertSettlementRevert(
    verifier.verify({
      quoteId: "q_bad_user",
      request: {
        ...request,
        quote: {
          ...quote,
          user: new String(quote.user),
        },
      },
    }),
    "INVALID_QUOTE_USER",
  );

  await assertSettlementRevert(
    verifier.verify({
      quoteId: "q_bad_token",
      request: {
        ...request,
        quote: {
          ...quote,
          tokenOut: "0x00000000000000000000000000000000000000zz",
        },
      },
    }),
    "INVALID_TOKEN",
  );

  await assertSettlementRevert(
    verifier.verify({
      quoteId: "q_bad_amount_type",
      request: {
        ...request,
        quote: {
          ...quote,
          amountIn: 1000000000,
        },
      },
    }),
    "INVALID_AMOUNT",
  );

  await assertSettlementRevert(
    verifier.verify({
      quoteId: "q_bad_amount_leading_zero",
      request: {
        ...request,
        quote: {
          ...quote,
          amountOut: "0998400000",
        },
      },
    }),
    "INVALID_AMOUNT",
  );

  await assertSettlementRevert(
    verifier.verify({
      quoteId: "q_bad_nonce",
      request: {
        ...request,
        quote: {
          ...quote,
          nonce: "0",
        },
      },
    }),
    "INVALID_NONCE",
  );

  await assertSettlementRevert(
    verifier.verify({
      quoteId: "q_bad_nonce_leading_zero",
      request: {
        ...request,
        quote: {
          ...quote,
          nonce: "042",
        },
      },
    }),
    "INVALID_NONCE",
  );
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

test("LocalSettlementVerifier rejects non-canonical settlement signatures", async () => {
  await assertSettlementRevert(
    new LocalSettlementVerifier().verify({
      quoteId: "q_invalid_signature_length",
      request: {
        ...request,
        signature: "0x1234",
      },
    }),
    "INVALID_SIGNATURE",
  );

  await assertSettlementRevert(
    new LocalSettlementVerifier().verify({
      quoteId: "q_invalid_signature_object",
      request: {
        ...request,
        signature: new String(request.signature),
      },
    }),
    "INVALID_SIGNATURE",
  );

  await assertSettlementRevert(
    new LocalSettlementVerifier().verify({
      quoteId: "q_invalid_signature_v",
      request: {
        ...request,
        signature: `0x${"11".repeat(64)}02`,
      },
    }),
    "INVALID_SIGNATURE",
  );

  await assertSettlementRevert(
    new LocalSettlementVerifier().verify({
      quoteId: "q_high_s_signature",
      request: {
        ...request,
        signature: `0x${"11".repeat(32)}${"f".repeat(64)}1b`,
      },
    }),
    "INVALID_SIGNATURE",
  );
});

test("LocalSettlementVerifier snapshots policy configuration at construction", async () => {
  const mutablePolicy = {
    ...defaultLocalSettlementVerifierPolicy,
    verifierVersion: "snapshot-settlement-v1",
    enabledChainIds: [1],
    tokenWhitelist: [quote.tokenIn, quote.tokenOut],
  };
  const verifier = new LocalSettlementVerifier(mutablePolicy);

  mutablePolicy.verifierVersion = "mutated-settlement-v2";
  mutablePolicy.enabledChainIds.length = 0;
  mutablePolicy.tokenWhitelist.length = 0;

  const result = await verifier.verify({
    quoteId: "q_snapshot",
    request,
  });

  assert.equal(result.status, "verified");
  assert.equal(result.verifierVersion, "snapshot-settlement-v1");
  assert.equal(result.amountOut, quote.amountOut);
});

test("LocalSettlementVerifier rejects unsafe policy configuration at construction", () => {
  assert.throws(
    () => new LocalSettlementVerifier(null),
    /Local settlement verifier policy must be an object/,
  );
  assert.throws(
    () => new LocalSettlementVerifier(Object.create(defaultLocalSettlementVerifierPolicy)),
    /Local settlement verifier policy.verifierVersion must be an own field/,
  );

  const policyWithInheritedTokenWhitelist = {
    verifierVersion: defaultLocalSettlementVerifierPolicy.verifierVersion,
    enabledChainIds: defaultLocalSettlementVerifierPolicy.enabledChainIds,
  };
  Object.setPrototypeOf(policyWithInheritedTokenWhitelist, {
    tokenWhitelist: defaultLocalSettlementVerifierPolicy.tokenWhitelist,
  });
  assert.throws(
    () => new LocalSettlementVerifier(policyWithInheritedTokenWhitelist),
    /Local settlement verifier policy.tokenWhitelist must be an own field/,
  );

  assert.throws(
    () =>
      new LocalSettlementVerifier({
        ...defaultLocalSettlementVerifierPolicy,
        enabledChainIds: undefined,
      }),
    /Local settlement verifier enabledChainIds must be an array/,
  );

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
        tokenWhitelist: [new String(quote.tokenIn), quote.tokenOut],
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
