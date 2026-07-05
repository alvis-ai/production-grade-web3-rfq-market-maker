import assert from "node:assert/strict";
import test from "node:test";
import { buildServer } from "../dist/main.js";

test("production startup requires explicit signer configuration", () => {
  const originalEnv = {
    NODE_ENV: process.env.NODE_ENV,
    RFQ_SIGNER_PRIVATE_KEY: process.env.RFQ_SIGNER_PRIVATE_KEY,
    RFQ_SETTLEMENT_ADDRESS: process.env.RFQ_SETTLEMENT_ADDRESS,
    RFQ_QUOTE_TTL_SECONDS: process.env.RFQ_QUOTE_TTL_SECONDS,
    RFQ_BODY_LIMIT_BYTES: process.env.RFQ_BODY_LIMIT_BYTES,
    RFQ_CORS_ALLOWED_ORIGINS: process.env.RFQ_CORS_ALLOWED_ORIGINS,
    RFQ_ENABLE_HSTS: process.env.RFQ_ENABLE_HSTS,
  };

  try {
    process.env.NODE_ENV = "production";
    delete process.env.RFQ_SIGNER_PRIVATE_KEY;
    delete process.env.RFQ_SETTLEMENT_ADDRESS;
    delete process.env.RFQ_QUOTE_TTL_SECONDS;
    delete process.env.RFQ_BODY_LIMIT_BYTES;
    delete process.env.RFQ_CORS_ALLOWED_ORIGINS;
    delete process.env.RFQ_ENABLE_HSTS;

    assert.throws(
      () => buildServer({ logger: false }),
      /RFQ_SIGNER_PRIVATE_KEY is required when NODE_ENV=production/,
    );

    process.env.RFQ_SIGNER_PRIVATE_KEY =
      "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

    assert.throws(
      () => buildServer({ logger: false }),
      /RFQ_SETTLEMENT_ADDRESS is required when NODE_ENV=production/,
    );

    process.env.RFQ_SIGNER_PRIVATE_KEY = "replace-with-production-signer-private-key";
    process.env.RFQ_SETTLEMENT_ADDRESS = "0x0000000000000000000000000000000000000004";

    assert.throws(
      () => buildServer({ logger: false }),
      /RFQ_SIGNER_PRIVATE_KEY must be a 32-byte hex string when NODE_ENV=production/,
    );

    process.env.RFQ_SIGNER_PRIVATE_KEY =
      "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
    process.env.RFQ_SETTLEMENT_ADDRESS = "replace-with-rfq-settlement-address";

    assert.throws(
      () => buildServer({ logger: false }),
      /RFQ_SETTLEMENT_ADDRESS must be a 20-byte hex address when NODE_ENV=production/,
    );
  } finally {
    restoreEnv("NODE_ENV", originalEnv.NODE_ENV);
    restoreEnv("RFQ_SIGNER_PRIVATE_KEY", originalEnv.RFQ_SIGNER_PRIVATE_KEY);
    restoreEnv("RFQ_SETTLEMENT_ADDRESS", originalEnv.RFQ_SETTLEMENT_ADDRESS);
    restoreEnv("RFQ_QUOTE_TTL_SECONDS", originalEnv.RFQ_QUOTE_TTL_SECONDS);
    restoreEnv("RFQ_BODY_LIMIT_BYTES", originalEnv.RFQ_BODY_LIMIT_BYTES);
    restoreEnv("RFQ_CORS_ALLOWED_ORIGINS", originalEnv.RFQ_CORS_ALLOWED_ORIGINS);
    restoreEnv("RFQ_ENABLE_HSTS", originalEnv.RFQ_ENABLE_HSTS);
  }
});

test("non-local startup requires explicit signer configuration", () => {
  const originalEnv = {
    NODE_ENV: process.env.NODE_ENV,
    RFQ_SIGNER_PRIVATE_KEY: process.env.RFQ_SIGNER_PRIVATE_KEY,
    RFQ_SETTLEMENT_ADDRESS: process.env.RFQ_SETTLEMENT_ADDRESS,
  };

  try {
    process.env.NODE_ENV = "staging";
    delete process.env.RFQ_SIGNER_PRIVATE_KEY;
    delete process.env.RFQ_SETTLEMENT_ADDRESS;

    assert.throws(
      () => buildServer({ logger: false }),
      /RFQ_SIGNER_PRIVATE_KEY is required when NODE_ENV=staging/,
    );

    process.env.RFQ_SIGNER_PRIVATE_KEY =
      "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

    assert.throws(
      () => buildServer({ logger: false }),
      /RFQ_SETTLEMENT_ADDRESS is required when NODE_ENV=staging/,
    );
  } finally {
    restoreEnv("NODE_ENV", originalEnv.NODE_ENV);
    restoreEnv("RFQ_SIGNER_PRIVATE_KEY", originalEnv.RFQ_SIGNER_PRIVATE_KEY);
    restoreEnv("RFQ_SETTLEMENT_ADDRESS", originalEnv.RFQ_SETTLEMENT_ADDRESS);
  }
});

function restoreEnv(name, value) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}
