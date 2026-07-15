#!/usr/bin/env node

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";
import {
  createSignerRuntime,
  readSignerRuntimeConfig,
} from "../backend/dist/modules/signer/signer-runtime.js";
import {
  assertSignature,
  hashQuoteSignature,
  hashQuoteTypedData,
  recoverQuoteSigner,
} from "../backend/dist/modules/signer/signer.service.js";

const confirmation = "sign-eip712-digest";

export async function runAwsKmsIntegrationCheck(
  env = process.env,
  dependencies = {},
) {
  assertEnvironment(env);
  if (readOwn(env, "RFQ_AWS_KMS_INTEGRATION_CONFIRM") !== confirmation) {
    throw new Error(
      `RFQ_AWS_KMS_INTEGRATION_CONFIRM=${confirmation} is required because this check invokes AWS KMS Sign`,
    );
  }

  const runtimeConfig = readSignerRuntimeConfig({
    NODE_ENV: "production",
    RFQ_SIGNER_MODE: "aws-kms",
    RFQ_SETTLEMENT_ADDRESS: readRequired(env, "RFQ_SETTLEMENT_ADDRESS"),
    RFQ_TRUSTED_SIGNER_ADDRESS: readRequired(env, "RFQ_TRUSTED_SIGNER_ADDRESS"),
    RFQ_AWS_KMS_KEY_ID: readRequired(env, "RFQ_AWS_KMS_KEY_ID"),
    RFQ_AWS_KMS_REGION: readRequired(env, "RFQ_AWS_KMS_REGION"),
    ...(readOwn(env, "RFQ_AWS_KMS_MAX_ATTEMPTS") === undefined
      ? {}
      : { RFQ_AWS_KMS_MAX_ATTEMPTS: readOwn(env, "RFQ_AWS_KMS_MAX_ATTEMPTS") }),
  });
  assert.equal(runtimeConfig.mode, "aws-kms", "AWS KMS integration check requires aws-kms runtime mode");

  const now = dependencies.now ?? Date.now;
  const random = dependencies.randomBytes ?? randomBytes;
  const runtimeFactory = dependencies.createSignerRuntime ?? createSignerRuntime;
  assert.equal(typeof now, "function", "AWS KMS integration clock must be a function");
  assert.equal(typeof random, "function", "AWS KMS integration randomBytes must be a function");
  assert.equal(typeof runtimeFactory, "function", "AWS KMS integration runtime factory must be a function");

  const nowMs = now();
  if (!Number.isSafeInteger(nowMs) || nowMs <= 0) {
    throw new Error("AWS KMS integration current time must be a positive safe integer");
  }
  const ttlSeconds = readInteger(env, "RFQ_AWS_KMS_INTEGRATION_TTL_SECONDS", 10, 1, 60);
  const chainId = readInteger(env, "RFQ_AWS_KMS_INTEGRATION_CHAIN_ID", undefined, 1, Number.MAX_SAFE_INTEGER);
  const user = readAddress(env, "RFQ_AWS_KMS_INTEGRATION_USER");
  const tokenIn = readAddress(env, "RFQ_AWS_KMS_INTEGRATION_TOKEN_IN");
  const tokenOut = readAddress(env, "RFQ_AWS_KMS_INTEGRATION_TOKEN_OUT");
  assert.notEqual(tokenIn, tokenOut, "AWS KMS integration token pair must contain distinct addresses");
  const amountIn = readPositiveUInt(env, "RFQ_AWS_KMS_INTEGRATION_AMOUNT_IN");
  const amountOut = readPositiveUInt(env, "RFQ_AWS_KMS_INTEGRATION_AMOUNT_OUT");
  const minAmountOut = readPositiveUInt(env, "RFQ_AWS_KMS_INTEGRATION_MIN_AMOUNT_OUT");
  assert.equal(
    BigInt(amountOut) >= BigInt(minAmountOut),
    true,
    "AWS KMS integration amountOut must be greater than or equal to minAmountOut",
  );

  const suffix = `${nowMs.toString(36)}_${readRandomHex(random, 4)}`;
  const quoteId = `q_kms_canary_${suffix}`;
  const snapshotId = `snapshot_kms_canary_${suffix}`;
  const nonce = (BigInt(`0x${readRandomHex(random, 16)}`) + 1n).toString();
  const deadline = Math.floor(nowMs / 1_000) + ttlSeconds;
  const quote = {
    user,
    tokenIn,
    tokenOut,
    amountIn,
    amountOut,
    minAmountOut,
    nonce,
    deadline,
    chainId,
  };
  const input = {
    quote,
    quoteId,
    snapshotId,
    riskDecisionId: `rd_${quoteId}`,
    riskPolicyVersion: readSafeVersion(env, "RFQ_AWS_KMS_INTEGRATION_RISK_POLICY_VERSION", "kms-canary-v1"),
    traceId: `tr_${quoteId}`,
  };
  const quoteDigest = hashQuoteTypedData(quote, runtimeConfig.settlementAddress);
  let runtime;
  let result;
  let failed = false;

  try {
    runtime = runtimeFactory(runtimeConfig);
    assertRuntime(runtime);
    const signature = await runtime.service.signQuote(input);
    assertSignature(signature);
    const recovered = await recoverQuoteSigner(quote, runtimeConfig.settlementAddress, signature);
    if (recovered.toLowerCase() !== runtimeConfig.trustedSignerAddress) {
      throw new Error("AWS KMS signature recovered an unexpected signer");
    }
    if (!await runtime.service.verifyQuoteSignature(quote, signature)) {
      throw new Error("AWS KMS runtime rejected its returned signature");
    }
    result = {
      status: "ok",
      mode: "aws-kms",
      chainId,
      quoteId,
      snapshotId,
      deadline,
      settlementAddress: runtimeConfig.settlementAddress,
      signerAddress: recovered.toLowerCase(),
      quoteDigest,
      signatureHash: hashQuoteSignature(signature),
    };
  } catch {
    failed = true;
  }
  try {
    await runtime?.close?.();
  } catch {
    failed = true;
  }
  if (failed || result === undefined) {
    throw new Error("AWS KMS integration signing or recovery failed");
  }
  return result;
}

function assertEnvironment(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("AWS KMS integration environment must be an object");
  }
}

function assertRuntime(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value) ||
      typeof value.service !== "object" || value.service === null ||
      typeof value.service.signQuote !== "function" ||
      typeof value.service.verifyQuoteSignature !== "function" ||
      (value.close !== undefined && typeof value.close !== "function")) {
    throw new Error("AWS KMS integration runtime is invalid");
  }
}

function readOwn(env, field) {
  if (!Object.prototype.hasOwnProperty.call(env, field)) return undefined;
  const value = env[field];
  if (value !== undefined && typeof value !== "string") {
    throw new Error(`${field} must be a primitive string`);
  }
  return value;
}

function readRequired(env, field) {
  const value = readOwn(env, field);
  if (value === undefined || value.length === 0 || value.trim() !== value || value.startsWith("replace-with-")) {
    throw new Error(`${field} must be explicitly configured without surrounding whitespace`);
  }
  return value;
}

function readAddress(env, field) {
  const value = readRequired(env, field);
  if (!/^0x[0-9a-fA-F]{40}$/.test(value) || /^0x0{40}$/i.test(value)) {
    throw new Error(`${field} must be a non-zero 20-byte hex address`);
  }
  return value.toLowerCase();
}

function readPositiveUInt(env, field) {
  const value = readRequired(env, field);
  if (!/^[1-9][0-9]*$/.test(value) || value.length > 78) {
    throw new Error(`${field} must be a canonical positive uint256 string`);
  }
  if (BigInt(value) >= 1n << 256n) throw new Error(`${field} must fit uint256`);
  return value;
}

function readInteger(env, field, fallback, min, max) {
  const value = readOwn(env, field);
  if (value === undefined || value.length === 0) {
    if (fallback !== undefined) return fallback;
    throw new Error(`${field} is required`);
  }
  if (!/^(0|[1-9][0-9]*)$/.test(value)) throw new Error(`${field} must be an integer between ${min} and ${max}`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${field} must be an integer between ${min} and ${max}`);
  }
  return parsed;
}

function readSafeVersion(env, field, fallback) {
  const value = readOwn(env, field) ?? fallback;
  if (!/^[A-Za-z0-9_.:-]{1,128}$/.test(value)) {
    throw new Error(`${field} must be a safe version identifier`);
  }
  return value;
}

function readRandomHex(random, size) {
  const value = random(size);
  if (!(value instanceof Uint8Array) || value.length !== size) {
    throw new Error(`AWS KMS integration randomBytes must return ${size} bytes`);
  }
  return Buffer.from(value).toString("hex");
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : undefined;
if (invokedPath === import.meta.url) {
  const result = await runAwsKmsIntegrationCheck();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
