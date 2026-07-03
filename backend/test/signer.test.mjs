import assert from "node:assert/strict";
import test from "node:test";
import { LocalEIP712SignerService, ObservedSignerService } from "../dist/modules/signer/signer.service.js";

const privateKey = "0x59c6995e998f97a5a0044966f094538d9dae1ffc26a3b6d86dae8e3a0b97e6a0";
const settlementAddress = "0x0000000000000000000000000000000000000004";
const secp256k1n = BigInt("0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141");

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

test("LocalEIP712SignerService signs and verifies RFQ typed quotes", async () => {
  const signer = new LocalEIP712SignerService({
    privateKey,
    settlementAddress,
  });

  const signature = await signer.signQuote({
    quote,
    quoteId: "q_test",
    snapshotId: "snapshot_test",
  });

  assert.match(signature, /^0x[0-9a-fA-F]{130}$/);
  assert.equal(await signer.verifyQuoteSignature(quote, signature), true);
});

test("LocalEIP712SignerService rejects tampered quote signatures", async () => {
  const signer = new LocalEIP712SignerService({
    privateKey,
    settlementAddress,
  });
  const signature = await signer.signQuote({
    quote,
    quoteId: "q_test",
    snapshotId: "snapshot_test",
  });

  assert.equal(
    await signer.verifyQuoteSignature(
      {
        ...quote,
        amountOut: "998300000",
      },
      signature,
    ),
    false,
  );
});

test("LocalEIP712SignerService rejects high-s malleated quote signatures", async () => {
  const signer = new LocalEIP712SignerService({
    privateKey,
    settlementAddress,
  });
  const signature = await signer.signQuote({
    quote,
    quoteId: "q_test",
    snapshotId: "snapshot_test",
  });

  assert.equal(await signer.verifyQuoteSignature(quote, malleateSignature(signature)), false);
});

test("LocalEIP712SignerService binds signatures to the settlement contract address", async () => {
  const signer = new LocalEIP712SignerService({
    privateKey,
    settlementAddress,
  });
  const otherSettlementSigner = new LocalEIP712SignerService({
    privateKey,
    settlementAddress: "0x0000000000000000000000000000000000000005",
  });
  const signature = await signer.signQuote({
    quote,
    quoteId: "q_test",
    snapshotId: "snapshot_test",
  });

  assert.equal(await otherSettlementSigner.verifyQuoteSignature(quote, signature), false);
});

test("LocalEIP712SignerService snapshots signer configuration at construction", async () => {
  const otherSettlementAddress = "0x0000000000000000000000000000000000000005";
  const mutableConfig = {
    privateKey,
    settlementAddress,
  };
  const signer = new LocalEIP712SignerService(mutableConfig);

  mutableConfig.settlementAddress = otherSettlementAddress;

  const signature = await signer.signQuote({
    quote,
    quoteId: "q_test",
    snapshotId: "snapshot_test",
  });
  const originalSettlementSigner = new LocalEIP712SignerService({
    privateKey,
    settlementAddress,
  });
  const otherSettlementSigner = new LocalEIP712SignerService({
    privateKey,
    settlementAddress: otherSettlementAddress,
  });

  assert.equal(await signer.verifyQuoteSignature(quote, signature), true);
  assert.equal(await originalSettlementSigner.verifyQuoteSignature(quote, signature), true);
  assert.equal(await otherSettlementSigner.verifyQuoteSignature(quote, signature), false);
});

test("LocalEIP712SignerService rejects unsafe signer configuration at construction", () => {
  assert.throws(
    () => new LocalEIP712SignerService(null),
    /Signer config must be an object/,
  );

  assert.throws(
    () => new LocalEIP712SignerService(Object.create({ privateKey, settlementAddress })),
    /Signer config.privateKey must be an own field/,
  );

  assert.throws(
    () =>
      new LocalEIP712SignerService({
        privateKey: "0x1234",
        settlementAddress,
      }),
    /Signer privateKey must be a 32-byte hex string/,
  );

  assert.throws(
    () =>
      new LocalEIP712SignerService({
        privateKey,
        settlementAddress: "0x1234",
      }),
    /Signer settlementAddress must be a 20-byte hex address/,
  );
});

test("LocalEIP712SignerService rejects malformed signer payload envelopes before signing", async () => {
  const signer = new LocalEIP712SignerService({
    privateKey,
    settlementAddress,
  });

  await assert.rejects(
    signer.signQuote(undefined),
    /Signer input must be an object/,
  );

  await assert.rejects(
    signer.signQuote({
      quoteId: "q_test",
      snapshotId: "snapshot_test",
      quote: null,
    }),
    /Signer quote must be an object/,
  );
});

test("LocalEIP712SignerService rejects inherited signer payload fields before signing", async () => {
  const signer = new LocalEIP712SignerService({
    privateKey,
    settlementAddress,
  });

  await assert.rejects(
    signer.signQuote(Object.create({ quote, quoteId: "q_test", snapshotId: "snapshot_test" })),
    /Signer input.quote must be an own field/,
  );

  await assert.rejects(
    signer.signQuote({
      quote: Object.create(quote),
      quoteId: "q_test",
      snapshotId: "snapshot_test",
    }),
    /Signer quote.user must be an own field/,
  );
});

test("LocalEIP712SignerService rejects unsafe quote inputs before signing", async () => {
  const signer = new LocalEIP712SignerService({
    privateKey,
    settlementAddress,
  });

  await assert.rejects(
    signer.signQuote({
      quote,
      quoteId: " ",
      snapshotId: "snapshot_test",
    }),
    /Signer quoteId must be a non-empty string/,
  );

  await assert.rejects(
    signer.signQuote({
      quote,
      quoteId: new String("q_test"),
      snapshotId: "snapshot_test",
    }),
    /Signer quoteId must be a primitive string/,
  );

  await assert.rejects(
    signer.signQuote({
      quote,
      quoteId: "q.bad",
      snapshotId: "snapshot_test",
    }),
    /Signer quoteId must contain only letters, numbers, underscore, colon, or hyphen/,
  );

  await assert.rejects(
    signer.signQuote({
      quote,
      quoteId: "q".repeat(129),
      snapshotId: "snapshot_test",
    }),
    /Signer quoteId must be 128 characters or fewer/,
  );

  await assert.rejects(
    signer.signQuote({
      quote,
      quoteId: "q_test",
      snapshotId: new String("snapshot_test"),
    }),
    /Signer snapshotId must be a primitive string/,
  );

  await assert.rejects(
    signer.signQuote({
      quote,
      quoteId: "q_test",
      snapshotId: "snapshot/bad",
    }),
    /Signer snapshotId must contain only letters, numbers, underscore, colon, or hyphen/,
  );

  await assert.rejects(
    signer.signQuote({
      quote,
      quoteId: "q_test",
      snapshotId: "s".repeat(129),
    }),
    /Signer snapshotId must be 128 characters or fewer/,
  );

  await assert.rejects(
    signer.signQuote({
      quote: {
        ...quote,
        amountIn: "01000000000",
      },
      quoteId: "q_test",
      snapshotId: "snapshot_test",
    }),
    /Signer quote.amountIn must be a positive uint string/,
  );

  await assert.rejects(
    signer.signQuote({
      quote: {
        ...quote,
        amountOut: "0998400000",
      },
      quoteId: "q_test",
      snapshotId: "snapshot_test",
    }),
    /Signer quote.amountOut must be a positive uint string/,
  );

  await assert.rejects(
    signer.signQuote({
      quote: {
        ...quote,
        minAmountOut: "0993408000",
      },
      quoteId: "q_test",
      snapshotId: "snapshot_test",
    }),
    /Signer quote.minAmountOut must be a positive uint string/,
  );

  await assert.rejects(
    signer.signQuote({
      quote: {
        ...quote,
        nonce: "042",
      },
      quoteId: "q_test",
      snapshotId: "snapshot_test",
    }),
    /Signer quote.nonce must be a positive uint string/,
  );

  await assert.rejects(
    signer.signQuote({
      quote: {
        ...quote,
        amountOut: "900",
        minAmountOut: "901",
      },
      quoteId: "q_test",
      snapshotId: "snapshot_test",
    }),
    /Signer quote.amountOut must be greater than or equal to quote.minAmountOut/,
  );
});

test("LocalEIP712SignerService returns false for malformed verification inputs", async () => {
  const signer = new LocalEIP712SignerService({
    privateKey,
    settlementAddress,
  });

  assert.equal(await signer.verifyQuoteSignature(quote, "0x1234"), false);
  assert.equal(await signer.verifyQuoteSignature(Object.create(quote), fixedSignature()), false);
  assert.equal(
    await signer.verifyQuoteSignature(
      {
        ...quote,
        nonce: "042",
      },
      fixedSignature(),
    ),
    false,
  );
  assert.equal(
    await signer.verifyQuoteSignature(
      {
        ...quote,
        tokenOut: quote.tokenIn,
      },
      `0x${"11".repeat(65)}`,
    ),
    false,
  );
});

test("ObservedSignerService rejects unsafe wrapper dependencies at construction", () => {
  assert.throws(
    () => new ObservedSignerService(undefined, signerMetrics()),
    /Signer inner must be an object/,
  );
  assert.throws(
    () => new ObservedSignerService([], signerMetrics()),
    /Signer inner must be an object/,
  );
  assert.throws(
    () =>
      new ObservedSignerService(
        {
          async signQuote() {
            return fixedSignature();
          },
          async verifyQuoteSignature() {
            return true;
          },
        },
        [],
      ),
    /Signer metricsService must be an object/,
  );
  assert.throws(
    () => new ObservedSignerService({}, signerMetrics()),
    /Signer inner.signQuote must be a function/,
  );
  assert.throws(
    () =>
      new ObservedSignerService(
        {
          async signQuote() {
            return fixedSignature();
          },
        },
        signerMetrics(),
      ),
    /Signer inner.verifyQuoteSignature must be a function/,
  );
  assert.throws(
    () =>
      new ObservedSignerService(
        {
          async signQuote() {
            return fixedSignature();
          },
          async verifyQuoteSignature() {
            return true;
          },
        },
        {
          recordSignerRequest() {},
          recordSignerError() {},
        },
      ),
    /Signer metricsService.recordSignerLatency must be a function/,
  );
});

function fixedSignature() {
  return `0x${"11".repeat(64)}1b`;
}

function signerMetrics() {
  return {
    recordSignerRequest() {},
    recordSignerError() {},
    recordSignerLatency() {},
  };
}

function malleateSignature(signature) {
  const r = signature.slice(2, 66);
  const s = BigInt(`0x${signature.slice(66, 130)}`);
  const v = Number.parseInt(signature.slice(130, 132), 16);
  const highS = (secp256k1n - s).toString(16).padStart(64, "0");
  const flippedV = v === 27 ? 28 : 27;

  return `0x${r}${highS}${flippedV.toString(16).padStart(2, "0")}`;
}
