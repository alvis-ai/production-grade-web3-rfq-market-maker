import assert from "node:assert/strict";
import test from "node:test";
import { privateKeyToAccount } from "viem/accounts";
import {
  LocalSettlementVerifier,
  defaultLocalSettlementVerifierPolicy,
} from "../dist/modules/settlement/settlement-verifier.service.js";
import { LocalEIP712SignerService } from "../dist/modules/signer/signer.service.js";

const defaultSignerConfig = {
  privateKey: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  settlementAddress: "0x0000000000000000000000000000000000000004",
};
const overlapSignerConfig = {
  ...defaultSignerConfig,
  privateKey: "0x59c6995e998f97a5a0044966f094538b2923b206d98a74dc7c90d40b3692cc62",
};
const overlapSignerAddress = privateKeyToAccount(overlapSignerConfig.privateKey).address;

const quote = {
  user: "0x0000000000000000000000000000000000000001",
  tokenIn: "0x0000000000000000000000000000000000000002",
  tokenOut: "0x0000000000000000000000000000000000000003",
  amountIn: "1000000000",
  amountOut: "998400000",
  minAmountOut: "993408000",
  nonce: "42",
  deadline: 1893456000,
  chainId: 1,
};

const request = {
  quote,
  signature: await signQuote(quote),
};

test("LocalSettlementVerifier accepts contract-shaped settlement quotes", async () => {
  const result = await new LocalSettlementVerifier().verify({
    quoteId: "q_test",
    request,
  });

  assert.equal(result.status, "verified");
  assert.equal(result.verifierVersion, "local-rfq-settlement-v2");
  assert.equal(result.amountOut, quote.amountOut);
});

test("LocalSettlementVerifier accepts an explicitly configured overlap signer", async () => {
  const verifier = new LocalSettlementVerifier({
    ...defaultLocalSettlementVerifierPolicy,
    trustedSignerOverlapAddresses: [overlapSignerAddress],
  });
  const result = await verifier.verify({
    quoteId: "q_overlap_signer",
    request: {
      quote,
      signature: await signQuote(quote, overlapSignerConfig),
    },
  });

  assert.equal(result.status, "verified");
  assert.equal(result.verifierVersion, "local-rfq-settlement-v2");
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

test("LocalSettlementVerifier rejects signatures outside the trusted EIP-712 signer and settlement domain", async () => {
  await assertSettlementRevert(
    new LocalSettlementVerifier().verify({
      quoteId: "q_untrusted_signer",
      request: {
        ...request,
        signature: await signQuote(quote, {
          ...defaultSignerConfig,
          privateKey: "0x59c6995e998f97a5a0044966f094538b2923b206d98a74dc7c90d40b3692cc62",
        }),
      },
    }),
    "INVALID_SIGNATURE",
  );

  await assertSettlementRevert(
    new LocalSettlementVerifier().verify({
      quoteId: "q_wrong_settlement_domain",
      request: {
        ...request,
        signature: await signQuote(quote, {
          ...defaultSignerConfig,
          settlementAddress: "0x0000000000000000000000000000000000000005",
        }),
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
    trustedSignerOverlapAddresses: [overlapSignerAddress],
  };
  const verifier = new LocalSettlementVerifier(mutablePolicy);

  mutablePolicy.verifierVersion = "mutated-settlement-v2";
  mutablePolicy.enabledChainIds.length = 0;
  mutablePolicy.tokenWhitelist.length = 0;
  mutablePolicy.trustedSignerOverlapAddresses.length = 0;

  const result = await verifier.verify({
    quoteId: "q_snapshot",
    request: {
      quote,
      signature: await signQuote(quote, overlapSignerConfig),
    },
  });

  assert.equal(result.status, "verified");
  assert.equal(result.verifierVersion, "snapshot-settlement-v1");
  assert.equal(result.amountOut, quote.amountOut);
});

async function assertSettlementRevert(promise, internalReasonCode) {
  await assert.rejects(promise, (error) => {
    assert.equal(error.code, "SETTLEMENT_REVERTED");
    assert.equal(error.statusCode, 409);
    assert.equal(error.internalReasonCode, internalReasonCode);
    return true;
  });
}

function signQuote(signedQuote, signerConfig = defaultSignerConfig) {
  return new LocalEIP712SignerService(signerConfig).signQuote({
    quote: signedQuote,
    quoteId: "q_test",
    snapshotId: "snapshot_test",
  });
}
