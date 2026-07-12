import assert from "node:assert/strict";
import test from "node:test";
import { SignCommand } from "@aws-sdk/client-kms";
import {
  assertAwsKmsSignerProviderConfig,
  AwsKmsSignerProvider,
} from "../dist/modules/signer/aws-kms-signer.provider.js";

const config = {
  keyId: "alias/rfq-production-signer",
  region: "us-east-1",
  maxAttempts: 3,
};
const derSignature = Uint8Array.from([0x30, 0x06, 0x02, 0x01, 0x01, 0x02, 0x01, 0x02]);

test("AwsKmsSignerProvider sends an EIP-712 digest with fixed KMS signing parameters", async () => {
  const commands = [];
  const provider = new AwsKmsSignerProvider(config, {
    async send(command) {
      commands.push(command);
      return {
        $metadata: {},
        KeyId: "arn:aws:kms:us-east-1:123456789012:key/example",
        Signature: derSignature,
        SigningAlgorithm: "ECDSA_SHA_256",
      };
    },
  });
  const digest = Uint8Array.from({ length: 32 }, (_, index) => index);

  const result = await provider.signDigest(digest);

  assert.deepEqual(result, derSignature);
  assert.notEqual(result, derSignature);
  assert.equal(commands.length, 1);
  assert.ok(commands[0] instanceof SignCommand);
  assert.equal(commands[0].input.KeyId, config.keyId);
  assert.equal(commands[0].input.MessageType, "DIGEST");
  assert.equal(commands[0].input.SigningAlgorithm, "ECDSA_SHA_256");
  assert.deepEqual(commands[0].input.Message, digest);
});

test("AwsKmsSignerProvider rejects unsafe digest and malformed KMS responses", async () => {
  const provider = new AwsKmsSignerProvider(config, {
    async send() {
      return { $metadata: {} };
    },
  });

  await assert.rejects(provider.signDigest(new Uint8Array(31)), /exactly 32 bytes/);
  await assert.rejects(provider.signDigest(new Uint8Array(32)), /must include signature bytes/);

  const wrongAlgorithm = new AwsKmsSignerProvider(config, {
    async send() {
      return { $metadata: {}, Signature: derSignature, SigningAlgorithm: "ECDSA_SHA_384" };
    },
  });
  await assert.rejects(wrongAlgorithm.signDigest(new Uint8Array(32)), /unexpected signing algorithm/);
});

test("AwsKmsSignerProvider validates closed runtime config and client dependencies", () => {
  const invalidConfigs = [
    undefined,
    [],
    { ...config, extra: true },
    { ...config, keyId: "replace-with-key" },
    { ...config, keyId: "bad key" },
    { ...config, region: "localhost" },
    { ...config, maxAttempts: 0 },
    { ...config, maxAttempts: 11 },
  ];
  for (const value of invalidConfigs) {
    assert.throws(() => assertAwsKmsSignerProviderConfig(value));
  }
  assert.throws(() => new AwsKmsSignerProvider(config, {}), /client.send must be a function/);
});

test("AwsKmsSignerProvider does not destroy an injected client it does not own", () => {
  let destroyCalls = 0;
  const provider = new AwsKmsSignerProvider(config, {
    async send() {
      return { $metadata: {}, Signature: derSignature };
    },
    destroy() {
      destroyCalls += 1;
    },
  });

  provider.close();
  assert.equal(destroyCalls, 0);
});
