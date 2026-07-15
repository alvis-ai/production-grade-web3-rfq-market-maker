#!/usr/bin/env node

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { RFQClient, buildQuoteTypedData } from "../sdk/dist/index.js";

const requireFromBackend = createRequire(new URL("../backend/package.json", import.meta.url));
const { hashTypedData, keccak256, recoverTypedDataAddress } = await import(
  pathToFileURL(requireFromBackend.resolve("viem")).href
);

const confirmation = "request-and-replay-quote";
const apiKeyPattern = /^[A-Za-z0-9_-]{3,64}\.[A-Za-z0-9_-]{32,128}$/;

export async function runTargetApiQuoteIntegrationCheck(env = process.env, dependencies = {}) {
  assertObject(env, "Target API quote integration environment");
  assertObject(dependencies, "Target API quote integration dependencies");
  if (readOwn(env, "RFQ_API_INTEGRATION_CONFIRM") !== confirmation) {
    throw new Error(
      `RFQ_API_INTEGRATION_CONFIRM=${confirmation} is required because this check creates a durable signed quote`,
    );
  }

  const baseUrl = readHttpsBaseUrl(env, "RFQ_API_INTEGRATION_BASE_URL");
  const apiKey = readApiKey(env, "RFQ_API_INTEGRATION_API_KEY");
  const settlementAddress = readAddress(env, "RFQ_SETTLEMENT_ADDRESS");
  const trustedSignerAddress = readAddress(env, "RFQ_TRUSTED_SIGNER_ADDRESS");
  const chainId = readInteger(env, "RFQ_API_INTEGRATION_CHAIN_ID", undefined, 1, Number.MAX_SAFE_INTEGER);
  const user = readAddress(env, "RFQ_API_INTEGRATION_USER");
  const tokenIn = readAddress(env, "RFQ_API_INTEGRATION_TOKEN_IN");
  const tokenOut = readAddress(env, "RFQ_API_INTEGRATION_TOKEN_OUT");
  assert.notEqual(tokenIn, tokenOut, "Target API quote integration token pair must contain distinct addresses");
  const amountIn = readPositiveUInt(env, "RFQ_API_INTEGRATION_AMOUNT_IN");
  const slippageBps = readInteger(env, "RFQ_API_INTEGRATION_SLIPPAGE_BPS", 10, 0, 10_000);
  const maxTtlSeconds = readInteger(env, "RFQ_API_INTEGRATION_MAX_TTL_SECONDS", 60, 1, 3_600);
  const maxClockSkewSeconds = readInteger(env, "RFQ_API_INTEGRATION_MAX_CLOCK_SKEW_SECONDS", 5, 0, 60);

  const now = dependencies.now ?? Date.now;
  const random = dependencies.randomBytes ?? randomBytes;
  const fetchImpl = dependencies.fetch ?? globalThis.fetch;
  assert.equal(typeof now, "function", "Target API quote integration clock must be a function");
  assert.equal(typeof random, "function", "Target API quote integration randomBytes must be a function");
  assert.equal(typeof fetchImpl, "function", "Target API quote integration fetch must be a function");

  const startedAtMs = readCurrentTime(now);
  const suffix = `${startedAtMs.toString(36)}_${readRandomHex(random, 6)}`;
  const idempotencyKey = `api_canary_${suffix}`;
  const traceId = `tr_api_canary_${suffix}`;
  const quoteRequest = { chainId, user, tokenIn, tokenOut, amountIn, slippageBps };
  const noRedirectFetch = (input, init) => fetchImpl(input, { ...init, redirect: "error" });
  const client = new RFQClient(baseUrl, { apiKey, fetch: noRedirectFetch, traceId });

  try {
    const readiness = await client.ready();
    if (readiness.status !== "ready" || Object.values(readiness.components).some((value) => value !== "ok")) {
      throw new Error("Target API readiness is degraded");
    }

    const quoteResponse = await client.quote(quoteRequest, { idempotencyKey });
    const replayResponse = await client.quote(quoteRequest, { idempotencyKey });
    assert.deepEqual(replayResponse, quoteResponse, "Target API must replay the exact signed quote response");

    const quoteStatus = await client.getQuote(quoteResponse.quoteId);
    assert.equal(quoteStatus.quoteId, quoteResponse.quoteId, "Target API quote status id");
    assert.equal(quoteStatus.status, "signed", "Target API quote lifecycle status");
    assert.equal(quoteStatus.snapshotId, quoteResponse.snapshotId, "Target API quote status snapshot id");
    assert.equal(quoteStatus.deadline, quoteResponse.deadline, "Target API quote status deadline");

    const completedAtMs = readCurrentTime(now);
    const completedAtSeconds = Math.floor(completedAtMs / 1_000);
    const latestAllowedDeadline = Math.floor(startedAtMs / 1_000) + maxTtlSeconds + maxClockSkewSeconds;
    assert.equal(
      quoteResponse.deadline > completedAtSeconds,
      true,
      "Target API quote must remain live after the immediate status read",
    );
    assert.equal(
      quoteResponse.deadline <= latestAllowedDeadline,
      true,
      "Target API quote deadline must remain within the reviewed TTL bound",
    );

    const quote = {
      user,
      tokenIn,
      tokenOut,
      amountIn,
      amountOut: quoteResponse.amountOut,
      minAmountOut: quoteResponse.minAmountOut,
      nonce: quoteResponse.nonce,
      deadline: quoteResponse.deadline,
      chainId,
    };
    const typedData = buildQuoteTypedData(quote, settlementAddress);
    const recoveredSigner = await recoverTypedDataAddress({
      ...typedData,
      signature: quoteResponse.signature,
    });
    assert.equal(
      recoveredSigner.toLowerCase(),
      trustedSignerAddress,
      "Target API quote must recover the reviewed trusted signer",
    );

    return {
      status: "ok",
      mode: "target-api",
      readiness: readiness.status,
      chainId,
      quoteId: quoteResponse.quoteId,
      snapshotId: quoteResponse.snapshotId,
      quoteStatus: quoteStatus.status,
      deadline: quoteResponse.deadline,
      settlementAddress,
      signerAddress: recoveredSigner.toLowerCase(),
      quoteDigest: hashTypedData(typedData),
      signatureHash: keccak256(quoteResponse.signature),
      idempotencyVerified: true,
    };
  } catch {
    throw new Error("Target API quote integration check failed");
  }
}

function assertObject(value, label) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
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

function readHttpsBaseUrl(env, field) {
  const value = readRequired(env, field);
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${field} must be an absolute HTTPS URL`);
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search || parsed.hash ||
      parsed.hostname.includes("*")) {
    throw new Error(`${field} must be an absolute HTTPS URL without credentials, wildcard, query, or fragment`);
  }
  const pathname = parsed.pathname === "/" ? "" : parsed.pathname.replace(/\/+$/, "");
  return `${parsed.origin}${pathname}`;
}

function readApiKey(env, field) {
  const value = readRequired(env, field);
  if (!apiKeyPattern.test(value)) {
    throw new Error(`${field} must use keyId.secret format with a 32-128 character secret`);
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

function readCurrentTime(now) {
  const value = now();
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error("Target API quote integration current time must be a positive safe integer");
  }
  return value;
}

function readRandomHex(random, size) {
  const value = random(size);
  if (!(value instanceof Uint8Array) || value.length !== size) {
    throw new Error(`Target API quote integration randomBytes must return ${size} bytes`);
  }
  return Buffer.from(value).toString("hex");
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : undefined;
if (invokedPath === import.meta.url) {
  const result = await runTargetApiQuoteIntegrationCheck();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
