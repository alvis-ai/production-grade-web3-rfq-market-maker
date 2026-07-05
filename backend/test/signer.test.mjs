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

test("ObservedSignerService rejects malformed inner signer results", async () => {
  for (const scenario of [
    {
      name: "short_signature",
      inner: {
        async signQuote() {
          return "0x1234";
        },
        async verifyQuoteSignature() {
          return true;
        },
      },
      operation: "sign",
      action: (signer) => signer.signQuote({ quote, quoteId: "q_bad_signature", snapshotId: "snapshot_bad" }),
      message: "Signer service unavailable",
    },
    {
      name: "high_s_signature",
      inner: {
        async signQuote() {
          return malleateSignature(fixedSignature());
        },
        async verifyQuoteSignature() {
          return true;
        },
      },
      operation: "sign",
      action: (signer) => signer.signQuote({ quote, quoteId: "q_high_s", snapshotId: "snapshot_bad" }),
      message: "Signer service unavailable",
    },
    {
      name: "non_boolean_verify",
      inner: {
        async signQuote() {
          return fixedSignature();
        },
        async verifyQuoteSignature() {
          return "false";
        },
      },
      operation: "verify",
      action: (signer) => signer.verifyQuoteSignature(quote, fixedSignature()),
      message: "Signer service unavailable",
    },
  ]) {
    const metrics = signerMetrics();
    const signer = new ObservedSignerService(scenario.inner, metrics);

    await assert.rejects(
      scenario.action(signer),
      (error) => {
        assert.equal(error.code, "SIGNER_UNAVAILABLE");
        assert.equal(error.statusCode, 503);
        assert.equal(error.message, scenario.message);
        return true;
      },
    );
    assert.deepEqual(metrics.errors, [scenario.operation]);
  }
});

function fixedSignature() {
  return `0x${"11".repeat(64)}1b`;
}

function signerMetrics() {
  return {
    errors: [],
    recordSignerRequest() {},
    recordSignerError(operation) {
      this.errors.push(operation);
    },
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
