import assert from "node:assert/strict";
import test from "node:test";
import { recoverTypedDataAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  decodeDERSignature,
  KmsSignerService,
} from "../dist/modules/signer/kms-signer.service.js";
import { buildQuoteTypedData } from "../dist/modules/signer/signer.service.js";

const secp256k1n = BigInt("0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141");
const privateKey = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const settlementAddress = "0x0000000000000000000000000000000000000004";
const account = privateKeyToAccount(privateKey);
const quote = {
  user: "0x0000000000000000000000000000000000000001",
  tokenIn: "0x0000000000000000000000000000000000000002",
  tokenOut: "0x0000000000000000000000000000000000000003",
  amountIn: "1000000000",
  amountOut: "998",
  minAmountOut: "990",
  nonce: "42",
  deadline: 4_102_444_800,
  chainId: 1,
};

test("KmsSignerService selects the recovery id bound to the configured trusted signer", async () => {
  const signer = signerWithProvider(async (digest) => {
    const signature = await account.sign({ hash: hexDigest(digest) });
    return ethereumSignatureToDer(signature);
  });

  const signature = await signer.signQuote(signInput());
  const recovered = await recoverTypedDataAddress({
    ...buildQuoteTypedData(quote, settlementAddress),
    signature,
  });

  assert.equal(recovered.toLowerCase(), account.address.toLowerCase());
  assert.equal(await signer.verifyQuoteSignature(quote, signature), true);
});

test("KmsSignerService canonicalizes high-s DER signatures without changing signer identity", async () => {
  const signer = signerWithProvider(async (digest) => {
    const signature = await account.sign({ hash: hexDigest(digest) });
    const r = BigInt(`0x${signature.slice(2, 66)}`);
    const lowS = BigInt(`0x${signature.slice(66, 130)}`);
    return encodeDerSignature(r, secp256k1n - lowS);
  });

  const signature = await signer.signQuote(signInput("q_kms_high_s"));
  const s = BigInt(`0x${signature.slice(66, 130)}`);

  assert.ok(s <= secp256k1n / 2n);
  assert.equal(await signer.verifyQuoteSignature(quote, signature), true);
});

test("KmsSignerService fails closed when KMS signs with an unexpected key", async () => {
  const otherAccount = privateKeyToAccount(
    "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  );
  const signer = signerWithProvider(async (digest) => {
    const signature = await otherAccount.sign({ hash: hexDigest(digest) });
    return ethereumSignatureToDer(signature);
  });

  await assert.rejects(
    signer.signQuote(signInput("q_wrong_kms_key")),
    (error) => error?.code === "SIGNER_UNAVAILABLE" && /configured trusted signer/.test(error.message),
  );
});

test("KmsSignerService validates provider, config, and signing inputs", async () => {
  assert.throws(
    () => new KmsSignerService(undefined, kmsConfig()),
    /provider must be an object/,
  );
  assert.throws(
    () => new KmsSignerService({ keyId: "bad key", signDigest: async () => new Uint8Array() }, kmsConfig()),
    /provider.keyId must be a safe/,
  );
  assert.throws(
    () => new KmsSignerService({ keyId: "test-key", signDigest: async () => new Uint8Array() }, {
      ...kmsConfig(),
      extra: true,
    }),
    /must not include unknown field extra/,
  );
  assert.throws(
    () => new KmsSignerService({ keyId: "test-key", signDigest: async () => new Uint8Array() }, {
      ...kmsConfig(),
      trustedSignerAddress: "0x0000000000000000000000000000000000000000",
    }),
    /must not be the zero address/,
  );

  const signer = signerWithProvider(async () => encodeDerSignature(1n, 1n));
  await assert.rejects(
    signer.signQuote(Object.create(signInput())),
    /Signer input.quote must be an own field/,
  );
});

test("KmsSignerService maps provider failures and rejects malformed verification signatures", async () => {
  const signer = signerWithProvider(async () => {
    throw new Error("provider detail must not escape");
  });

  await assert.rejects(
    signer.signQuote(signInput("q_provider_failure")),
    (error) => error?.code === "SIGNER_UNAVAILABLE" && !error.message.includes("provider detail"),
  );
  assert.equal(await signer.verifyQuoteSignature(quote, "0x1234"), false);
});

test("decodeDERSignature accepts canonical secp256k1 integers and rejects malformed DER", () => {
  const valid = decodeDERSignature(encodeDerSignature(1n, 2n));
  assert.deepEqual(valid, { r: 1n, s: 2n });

  const malformed = [
    undefined,
    new Uint8Array(),
    Uint8Array.from([0x31, 0x06, 0x02, 0x01, 0x01, 0x02, 0x01, 0x01]),
    Uint8Array.from([0x30, 0x07, 0x02, 0x01, 0x01, 0x02, 0x01, 0x01]),
    Uint8Array.from([0x30, 0x81, 0x06, 0x02, 0x01, 0x01, 0x02, 0x01, 0x01]),
    Uint8Array.from([0x30, 0x06, 0x02, 0x01, 0x80, 0x02, 0x01, 0x01]),
    Uint8Array.from([0x30, 0x06, 0x02, 0x01, 0x00, 0x02, 0x01, 0x01]),
    Uint8Array.from([0x30, 0x07, 0x02, 0x02, 0x00, 0x01, 0x02, 0x01, 0x01]),
    Uint8Array.from([0x30, 0x07, 0x02, 0x01, 0x01, 0x02, 0x01, 0x01, 0x00]),
    encodeDerSignature(secp256k1n, 1n),
  ];
  for (const value of malformed) {
    assert.throws(
      () => decodeDERSignature(value),
      (error) => error?.code === "SIGNER_UNAVAILABLE",
    );
  }
});

function signerWithProvider(signDigest) {
  return new KmsSignerService({ keyId: "local-test-key", signDigest }, kmsConfig());
}

function kmsConfig() {
  return {
    settlementAddress,
    trustedSignerAddress: account.address,
  };
}

function signInput(quoteId = "q_kms") {
  return { quote, quoteId, snapshotId: "snapshot_kms" };
}

function hexDigest(digest) {
  return `0x${Buffer.from(digest).toString("hex")}`;
}

function ethereumSignatureToDer(signature) {
  return encodeDerSignature(
    BigInt(`0x${signature.slice(2, 66)}`),
    BigInt(`0x${signature.slice(66, 130)}`),
  );
}

function encodeDerSignature(r, s) {
  const rInteger = encodeDerInteger(r);
  const sInteger = encodeDerInteger(s);
  const body = Buffer.concat([rInteger, sInteger]);
  return new Uint8Array(Buffer.concat([Buffer.from([0x30, body.length]), body]));
}

function encodeDerInteger(value) {
  let hex = value.toString(16);
  if (hex.length % 2 !== 0) hex = `0${hex}`;
  let bytes = Buffer.from(hex, "hex");
  if ((bytes[0] & 0x80) !== 0) bytes = Buffer.concat([Buffer.from([0]), bytes]);
  return Buffer.concat([Buffer.from([0x02, bytes.length]), bytes]);
}
