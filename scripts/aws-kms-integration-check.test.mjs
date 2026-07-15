import assert from "node:assert/strict";
import test from "node:test";
import { LocalEIP712SignerService } from "../backend/dist/modules/signer/signer.service.js";
import { runAwsKmsIntegrationCheck } from "./aws-kms-integration-check.mjs";

const privateKey = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const settlementAddress = "0x0000000000000000000000000000000000000004";
const trustedSignerAddress = "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266";
const baseEnvironment = {
  RFQ_AWS_KMS_INTEGRATION_CONFIRM: "sign-eip712-digest",
  RFQ_SETTLEMENT_ADDRESS: settlementAddress,
  RFQ_TRUSTED_SIGNER_ADDRESS: trustedSignerAddress,
  RFQ_AWS_KMS_KEY_ID: "alias/rfq-production-signer",
  RFQ_AWS_KMS_REGION: "us-east-1",
  RFQ_AWS_KMS_INTEGRATION_CHAIN_ID: "1",
  RFQ_AWS_KMS_INTEGRATION_USER: "0x0000000000000000000000000000000000000001",
  RFQ_AWS_KMS_INTEGRATION_TOKEN_IN: "0x0000000000000000000000000000000000000002",
  RFQ_AWS_KMS_INTEGRATION_TOKEN_OUT: "0x0000000000000000000000000000000000000003",
  RFQ_AWS_KMS_INTEGRATION_AMOUNT_IN: "1000",
  RFQ_AWS_KMS_INTEGRATION_AMOUNT_OUT: "998",
  RFQ_AWS_KMS_INTEGRATION_MIN_AMOUNT_OUT: "990",
};

test("AWS KMS canary uses production runtime config and independently recovers the trusted signer", async () => {
  let closed = 0;
  const result = await runAwsKmsIntegrationCheck(baseEnvironment, {
    now: () => 1_700_000_000_000,
    randomBytes: (size) => Uint8Array.from({ length: size }, (_, index) => index + 1),
    createSignerRuntime(config) {
      assert.equal(config.mode, "aws-kms");
      assert.equal(config.keyId, "alias/rfq-production-signer");
      assert.equal(config.region, "us-east-1");
      assert.equal(config.trustedSignerAddress, trustedSignerAddress);
      return {
        service: new LocalEIP712SignerService({ privateKey, settlementAddress }),
        close() { closed += 1; },
      };
    },
  });

  assert.equal(result.status, "ok");
  assert.equal(result.mode, "aws-kms");
  assert.equal(result.chainId, 1);
  assert.equal(result.deadline, 1_700_000_010);
  assert.equal(result.signerAddress, trustedSignerAddress);
  assert.equal(result.settlementAddress, settlementAddress);
  assert.match(result.quoteId, /^q_kms_canary_[a-z0-9]+_[0-9a-f]{8}$/);
  assert.match(result.snapshotId, /^snapshot_kms_canary_[a-z0-9]+_[0-9a-f]{8}$/);
  assert.match(result.quoteDigest, /^0x[0-9a-f]{64}$/);
  assert.match(result.signatureHash, /^0x[0-9a-f]{64}$/);
  assert.deepEqual(Object.keys(result).sort(), [
    "chainId",
    "deadline",
    "mode",
    "quoteDigest",
    "quoteId",
    "settlementAddress",
    "signatureHash",
    "signerAddress",
    "snapshotId",
    "status",
  ]);
  assert.equal(closed, 1);
  assert.doesNotMatch(JSON.stringify(result), /rfq-production-signer|ac0974|signature\"/i);
});

test("AWS KMS canary rejects missing acknowledgement and malformed quote inputs before runtime creation", async () => {
  let runtimeCalls = 0;
  const dependencies = { createSignerRuntime() { runtimeCalls += 1; throw new Error("unreachable"); } };
  await assert.rejects(
    runAwsKmsIntegrationCheck({ ...baseEnvironment, RFQ_AWS_KMS_INTEGRATION_CONFIRM: "no" }, dependencies),
    /sign-eip712-digest is required/,
  );
  await assert.rejects(
    runAwsKmsIntegrationCheck({
      ...baseEnvironment,
      RFQ_AWS_KMS_INTEGRATION_TOKEN_OUT: baseEnvironment.RFQ_AWS_KMS_INTEGRATION_TOKEN_IN,
    }, dependencies),
    /distinct addresses/,
  );
  await assert.rejects(
    runAwsKmsIntegrationCheck({ ...baseEnvironment, RFQ_AWS_KMS_INTEGRATION_MIN_AMOUNT_OUT: "999" }, dependencies),
    /amountOut must be greater than or equal/,
  );
  assert.equal(runtimeCalls, 0);
});

test("AWS KMS canary closes the runtime and redacts provider failure details", async () => {
  let closed = 0;
  const leakedDetails = "alias/rfq-production-signer AWS_SECRET_ACCESS_KEY=do-not-print";
  await assert.rejects(
    runAwsKmsIntegrationCheck(baseEnvironment, {
      now: () => 1_700_000_000_000,
      randomBytes: (size) => new Uint8Array(size).fill(1),
      createSignerRuntime() {
        return {
          service: {
            async signQuote() { throw new Error(leakedDetails); },
            async verifyQuoteSignature() { return false; },
          },
          close() { closed += 1; },
        };
      },
    }),
    (error) => {
      assert.equal(error.message, "AWS KMS integration signing or recovery failed");
      assert.doesNotMatch(error.stack ?? "", /rfq-production-signer|do-not-print/);
      return true;
    },
  );
  assert.equal(closed, 1);
});

test("AWS KMS canary rejects a valid signature from an unexpected key", async () => {
  const otherKey = `0x${"11".repeat(32)}`;
  await assert.rejects(
    runAwsKmsIntegrationCheck(baseEnvironment, {
      now: () => 1_700_000_000_000,
      randomBytes: (size) => new Uint8Array(size).fill(2),
      createSignerRuntime() {
        return {
          service: new LocalEIP712SignerService({ privateKey: otherKey, settlementAddress }),
        };
      },
    }),
    /AWS KMS integration signing or recovery failed/,
  );
});

test("AWS KMS canary redacts runtime close failures", async () => {
  await assert.rejects(
    runAwsKmsIntegrationCheck(baseEnvironment, {
      now: () => 1_700_000_000_000,
      randomBytes: (size) => new Uint8Array(size).fill(3),
      createSignerRuntime() {
        return {
          service: new LocalEIP712SignerService({ privateKey, settlementAddress }),
          close() { throw new Error("alias/rfq-production-signer close secret"); },
        };
      },
    }),
    (error) => {
      assert.equal(error.message, "AWS KMS integration signing or recovery failed");
      assert.doesNotMatch(error.stack ?? "", /rfq-production-signer|close secret/);
      return true;
    },
  );
});
