import assert from "node:assert/strict";
import test from "node:test";
import { privateKeyToAccount } from "viem/accounts";
import {
  createSignerRuntime,
  readSignerRuntimeConfig,
} from "../dist/modules/signer/signer-runtime.js";

const privateKey = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const settlementAddress = "0x0000000000000000000000000000000000000004";
const trustedSignerAddress = privateKeyToAccount(privateKey).address;
const overlapSignerAddresses = [
  "0x00000000000000000000000000000000000000aa",
  "0x00000000000000000000000000000000000000bb",
];

test("signer runtime keeps local defaults inside local environments only", async () => {
  const config = readSignerRuntimeConfig({});
  assert.equal(config.mode, "local");
  assert.equal(config.privateKey, privateKey);
  assert.equal(config.settlementAddress, settlementAddress);
  assert.equal(config.trustedSignerAddress, trustedSignerAddress.toLowerCase());
  assert.deepEqual(config.trustedSignerOverlapAddresses, []);

  const runtime = createSignerRuntime(config);
  const quote = fixedQuote();
  const signature = await runtime.service.signQuote({ quote, quoteId: "q_runtime", snapshotId: "snapshot_runtime" });
  assert.equal(await runtime.service.verifyQuoteSignature(quote, signature), true);
});

test("signer runtime reads only own environment fields", () => {
  const inherited = Object.create({
    NODE_ENV: "production",
    RFQ_SIGNER_MODE: "aws-kms",
    RFQ_AWS_KMS_KEY_ID: "alias/inherited",
  });
  assert.equal(readSignerRuntimeConfig(inherited).mode, "local");
});

test("signer runtime requires AWS KMS or explicit injection outside local environments", () => {
  assert.throws(
    () => readSignerRuntimeConfig({ NODE_ENV: "production" }),
    /RFQ_SIGNER_MODE must be local, aws-kms, remote, or external/,
  );
  assert.throws(
    () => readSignerRuntimeConfig({ NODE_ENV: "production", RFQ_SIGNER_MODE: "local" }),
    /local is not allowed/,
  );
  assert.throws(
    () => readSignerRuntimeConfig({
      ...awsEnvironment(),
      RFQ_SIGNER_PRIVATE_KEY: privateKey,
    }),
    /must not be configured/,
  );
});

test("remote signer mode isolates KMS material behind a bounded authenticated origin", () => {
  const remote = {
    NODE_ENV: "production",
    RFQ_SIGNER_MODE: "remote",
    RFQ_SETTLEMENT_ADDRESS: settlementAddress,
    RFQ_TRUSTED_SIGNER_ADDRESS: trustedSignerAddress,
    RFQ_SIGNER_SERVICE_URL: "https://rfq-signer.example.internal",
    RFQ_SIGNER_SERVICE_TOKEN: "a".repeat(43),
    RFQ_SIGNER_SERVICE_REQUEST_TIMEOUT_MS: "2500",
    RFQ_SIGNER_SERVICE_MAX_CONNECTIONS: "24",
  };
  assert.deepEqual(readSignerRuntimeConfig(remote), {
    mode: "remote",
    settlementAddress,
    trustedSignerAddress: trustedSignerAddress.toLowerCase(),
    trustedSignerOverlapAddresses: [],
    baseUrl: "https://rfq-signer.example.internal",
    allowInsecureHttp: false,
    authToken: "a".repeat(43),
    requestTimeoutMs: 2500,
    maxConnections: 24,
  });
  assert.throws(
    () => readSignerRuntimeConfig({ ...remote, RFQ_SIGNER_SERVICE_URL: "http://rfq-signer.example.internal" }),
    /HTTPS origin/,
  );
  assert.equal(readSignerRuntimeConfig({
    ...remote,
    NODE_ENV: "development",
    RFQ_SIGNER_SERVICE_URL: "http://rfq-signer:3006",
    RFQ_SIGNER_SERVICE_ALLOW_INSECURE_HTTP: "true",
  }).allowInsecureHttp, true);
  assert.throws(
    () => readSignerRuntimeConfig({ ...remote, RFQ_SIGNER_SERVICE_ALLOW_INSECURE_HTTP: "true" }),
    /only in local environments/,
  );
  assert.throws(
    () => readSignerRuntimeConfig({ ...remote, RFQ_SIGNER_SERVICE_TOKEN: "short" }),
    /RFQ_SIGNER_SERVICE_TOKEN/,
  );
  assert.throws(
    () => readSignerRuntimeConfig({ ...remote, RFQ_SIGNER_SERVICE_MAX_CONNECTIONS: "257" }),
    /RFQ_SIGNER_SERVICE_MAX_CONNECTIONS/,
  );
  assert.throws(
    () => readSignerRuntimeConfig({ ...remote, RFQ_AWS_KMS_KEY_ID: "alias/conflict" }),
    /RFQ_AWS_KMS_\*/,
  );
  assert.throws(
    () => readSignerRuntimeConfig({ ...awsEnvironment(), RFQ_SIGNER_SERVICE_URL: "https://conflict.example.com" }),
    /RFQ_SIGNER_SERVICE_\*/,
  );
});

test("signer runtime parses complete AWS KMS configuration without private key material", () => {
  const config = readSignerRuntimeConfig(awsEnvironment());
  assert.deepEqual(config, {
    mode: "aws-kms",
    settlementAddress,
    trustedSignerAddress: trustedSignerAddress.toLowerCase(),
    trustedSignerOverlapAddresses: [],
    keyId: "alias/rfq-production-signer",
    region: "us-east-1",
    maxAttempts: 4,
  });
  assert.equal(Object.hasOwn(config, "privateKey"), false);
});

test("signer runtime parses a bounded trusted signer overlap window", () => {
  const config = readSignerRuntimeConfig({
    ...awsEnvironment(),
    RFQ_TRUSTED_SIGNER_OVERLAP_ADDRESSES: overlapSignerAddresses.join(","),
  });

  assert.deepEqual(config.trustedSignerOverlapAddresses, overlapSignerAddresses);
});

test("signer runtime rejects unsafe trusted signer overlap configuration", () => {
  const base = awsEnvironment();
  for (const value of [
    "",
    ` ${overlapSignerAddresses[0]}`,
    `${overlapSignerAddresses[0]} `,
    "0x0000000000000000000000000000000000000000",
    "0x00000000000000000000000000000000000000zz",
  ]) {
    assert.throws(
      () => readSignerRuntimeConfig({ ...base, RFQ_TRUSTED_SIGNER_OVERLAP_ADDRESSES: value }),
      /RFQ_TRUSTED_SIGNER_OVERLAP_ADDRESSES/,
    );
  }

  assert.throws(
    () => readSignerRuntimeConfig({
      ...base,
      RFQ_TRUSTED_SIGNER_OVERLAP_ADDRESSES: trustedSignerAddress.toUpperCase().replace("0X", "0x"),
    }),
    /must not duplicate/,
  );
  assert.throws(
    () => readSignerRuntimeConfig({
      ...base,
      RFQ_TRUSTED_SIGNER_OVERLAP_ADDRESSES:
        `${overlapSignerAddresses[0]},${overlapSignerAddresses[0].toUpperCase().replace("0X", "0x")}`,
    }),
    /must not duplicate/,
  );
  assert.throws(
    () => readSignerRuntimeConfig({
      ...base,
      RFQ_TRUSTED_SIGNER_OVERLAP_ADDRESSES: [1, 2, 3, 4, 5]
        .map((value) => `0x${value.toString(16).padStart(40, "0")}`)
        .join(","),
    }),
    /at most 4 addresses/,
  );
});

test("signer runtime rejects incomplete, placeholder, and ambiguous AWS KMS configuration", () => {
  const base = awsEnvironment();
  for (const field of [
    "RFQ_SETTLEMENT_ADDRESS",
    "RFQ_TRUSTED_SIGNER_ADDRESS",
    "RFQ_AWS_KMS_KEY_ID",
    "RFQ_AWS_KMS_REGION",
  ]) {
    const value = { ...base };
    delete value[field];
    assert.throws(() => readSignerRuntimeConfig(value), new RegExp(field));
  }
  assert.throws(
    () => readSignerRuntimeConfig({ ...base, RFQ_AWS_KMS_KEY_ID: "replace-with-key" }),
    /RFQ_AWS_KMS_KEY_ID/,
  );
  assert.throws(
    () => readSignerRuntimeConfig({ ...base, RFQ_AWS_KMS_MAX_ATTEMPTS: "01" }),
    /base-10 integer/,
  );
  assert.throws(
    () => readSignerRuntimeConfig({ ...base, RFQ_TRUSTED_SIGNER_ADDRESS: "0x0000000000000000000000000000000000000000" }),
    /zero address/,
  );
});

test("external signer mode requires injection and excludes conflicting KMS fields", () => {
  const external = {
    NODE_ENV: "production",
    RFQ_SIGNER_MODE: "external",
    RFQ_SETTLEMENT_ADDRESS: settlementAddress,
    RFQ_TRUSTED_SIGNER_ADDRESS: trustedSignerAddress,
  };
  assert.throws(() => readSignerRuntimeConfig(external), /requires an injected signerService/);
  assert.deepEqual(readSignerRuntimeConfig(external, { allowExternal: true }), {
    mode: "external",
    settlementAddress,
    trustedSignerAddress: trustedSignerAddress.toLowerCase(),
    trustedSignerOverlapAddresses: [],
  });
  assert.throws(
    () => readSignerRuntimeConfig({ ...external, RFQ_AWS_KMS_KEY_ID: "alias/conflict" }, { allowExternal: true }),
    /only allowed when RFQ_SIGNER_MODE=aws-kms/,
  );
  assert.throws(
    () => createSignerRuntime(readSignerRuntimeConfig(external, { allowExternal: true })),
    /must be supplied through buildServer/,
  );
});

function awsEnvironment() {
  return {
    NODE_ENV: "production",
    RFQ_SIGNER_MODE: "aws-kms",
    RFQ_SETTLEMENT_ADDRESS: settlementAddress,
    RFQ_TRUSTED_SIGNER_ADDRESS: trustedSignerAddress,
    RFQ_AWS_KMS_KEY_ID: "alias/rfq-production-signer",
    RFQ_AWS_KMS_REGION: "us-east-1",
    RFQ_AWS_KMS_MAX_ATTEMPTS: "4",
  };
}

function fixedQuote() {
  return {
    user: "0x0000000000000000000000000000000000000001",
    tokenIn: "0x0000000000000000000000000000000000000002",
    tokenOut: "0x0000000000000000000000000000000000000003",
    amountIn: "1000",
    amountOut: "998",
    minAmountOut: "990",
    nonce: "42",
    deadline: 4_102_444_800,
    chainId: 1,
  };
}
