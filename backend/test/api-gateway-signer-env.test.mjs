import assert from "node:assert/strict";
import test from "node:test";
import { buildServer } from "../dist/main.js";
import {
  localTestSignerService,
  signerRuntimeEnvNames,
  testSettlementAddress,
  testSignerPrivateKey,
  testTrustedSignerAddress,
} from "./helpers/signer-runtime-fixtures.mjs";

test("production startup requires explicit AWS KMS signer identity without private key material", () => {
  const names = ["NODE_ENV", "DATABASE_URL", ...signerRuntimeEnvNames];
  const original = saveEnv(names);
  try {
    process.env.NODE_ENV = "production";
    delete process.env.DATABASE_URL;
    clearSignerEnvironment();

    assert.throws(
      () => buildServer({ logger: false }),
      /RFQ_SIGNER_MODE must be local, aws-kms, or external/,
    );

    process.env.RFQ_SIGNER_MODE = "local";
    process.env.RFQ_SIGNER_PRIVATE_KEY = testSignerPrivateKey;
    process.env.RFQ_SETTLEMENT_ADDRESS = testSettlementAddress;
    assert.throws(
      () => buildServer({ logger: false }),
      /RFQ_SIGNER_MODE=local is not allowed when NODE_ENV=production/,
    );

    configureBaseAwsEnvironment();
    delete process.env.RFQ_SETTLEMENT_ADDRESS;
    assert.throws(() => buildServer({ logger: false }), /RFQ_SETTLEMENT_ADDRESS/);

    configureBaseAwsEnvironment();
    delete process.env.RFQ_TRUSTED_SIGNER_ADDRESS;
    assert.throws(() => buildServer({ logger: false }), /RFQ_TRUSTED_SIGNER_ADDRESS/);

    configureBaseAwsEnvironment();
    delete process.env.RFQ_AWS_KMS_KEY_ID;
    assert.throws(() => buildServer({ logger: false }), /RFQ_AWS_KMS_KEY_ID/);

    configureBaseAwsEnvironment();
    delete process.env.RFQ_AWS_KMS_REGION;
    assert.throws(() => buildServer({ logger: false }), /RFQ_AWS_KMS_REGION/);

    configureBaseAwsEnvironment();
    process.env.RFQ_SIGNER_PRIVATE_KEY = testSignerPrivateKey;
    assert.throws(() => buildServer({ logger: false }), /RFQ_SIGNER_PRIVATE_KEY must not be configured/);

    configureBaseAwsEnvironment();
    process.env.RFQ_AWS_KMS_KEY_ID = "replace-with-production-kms-key";
    assert.throws(() => buildServer({ logger: false }), /RFQ_AWS_KMS_KEY_ID/);

    configureBaseAwsEnvironment();
    process.env.RFQ_TRUSTED_SIGNER_ADDRESS = "0x0000000000000000000000000000000000000000";
    assert.throws(() => buildServer({ logger: false }), /must not be the zero address/);
  } finally {
    restoreEnv(original);
  }
});

test("non-local external signer mode requires explicit injection and identity", () => {
  const names = ["NODE_ENV", "DATABASE_URL", ...signerRuntimeEnvNames];
  const original = saveEnv(names);
  try {
    process.env.NODE_ENV = "staging";
    delete process.env.DATABASE_URL;
    clearSignerEnvironment();
    process.env.RFQ_SIGNER_MODE = "external";
    process.env.RFQ_SETTLEMENT_ADDRESS = testSettlementAddress;
    process.env.RFQ_TRUSTED_SIGNER_ADDRESS = testTrustedSignerAddress;

    assert.throws(
      () => buildServer({ logger: false }),
      /RFQ_SIGNER_MODE=external requires an injected signerService/,
    );
    assert.throws(
      () => buildServer({ logger: false, signerService: localTestSignerService() }),
      /DATABASE_URL is required when NODE_ENV=staging/,
    );
  } finally {
    restoreEnv(original);
  }
});

function configureBaseAwsEnvironment() {
  clearSignerEnvironment();
  process.env.RFQ_SIGNER_MODE = "aws-kms";
  process.env.RFQ_SETTLEMENT_ADDRESS = testSettlementAddress;
  process.env.RFQ_TRUSTED_SIGNER_ADDRESS = testTrustedSignerAddress;
  process.env.RFQ_AWS_KMS_KEY_ID = "alias/rfq-production-signer";
  process.env.RFQ_AWS_KMS_REGION = "us-east-1";
}

function clearSignerEnvironment() {
  for (const name of signerRuntimeEnvNames) delete process.env[name];
}

function saveEnv(names) {
  return Object.fromEntries(names.map((name) => [name, process.env[name]]));
}

function restoreEnv(values) {
  for (const [name, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}
