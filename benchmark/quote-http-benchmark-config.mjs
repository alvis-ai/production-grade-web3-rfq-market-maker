import { readFile } from "node:fs/promises";

const quoteFields = ["chainId", "user", "tokenIn", "tokenOut", "amountIn", "slippageBps"];
const apiKeyPattern = /^[A-Za-z0-9_-]{3,64}\.[A-Za-z0-9_-]{32,128}$/;
const defaultQuoteRequest = JSON.parse(
  await readFile(new URL("../examples/quote-request.json", import.meta.url), "utf8"),
);

export function readBenchmarkConfig(env) {
  return {
    baseUrl: readBaseUrl(env, "RFQ_HTTP_BENCHMARK_API_URL", "http://127.0.0.1:3000"),
    apiKey: readOptionalApiKey(env, "RFQ_HTTP_BENCHMARK_API_KEY"),
    requests: readInteger(env, "RFQ_HTTP_BENCHMARK_QUOTE_REQUESTS", 100, 1, 1_000_000),
    warmupRequests: readInteger(env, "RFQ_HTTP_BENCHMARK_QUOTE_WARMUP_REQUESTS", 10, 1, 100_000),
    concurrency: readInteger(env, "RFQ_HTTP_BENCHMARK_QUOTE_CONCURRENCY", 5, 1, 10_000),
    requestTimeoutMs: readInteger(env, "RFQ_HTTP_BENCHMARK_REQUEST_TIMEOUT_MS", 5_000, 100, 120_000),
    maxP50Ms: readPositiveNumber(env, "RFQ_HTTP_BENCHMARK_MAX_P50_MS", 10),
    maxP99Ms: readPositiveNumber(env, "RFQ_HTTP_BENCHMARK_MAX_P99_MS", 50),
    maxErrors: readInteger(env, "RFQ_HTTP_BENCHMARK_MAX_ERRORS", 0, 0, 1_000_000),
    enforceSlo: readBoolean(env, "RFQ_HTTP_BENCHMARK_ENFORCE_SLO", true),
    collectMetrics: readBoolean(env, "RFQ_HTTP_BENCHMARK_COLLECT_METRICS", true),
    quoteRequest: readQuoteRequest(env),
  };
}

export function assertRecord(value, label) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
}

function readQuoteRequest(env) {
  const serialized = readOwn(env, "RFQ_HTTP_BENCHMARK_QUOTE_JSON");
  let request;
  try {
    request = serialized === undefined ? { ...defaultQuoteRequest } : JSON.parse(serialized);
  } catch {
    throw new Error("RFQ_HTTP_BENCHMARK_QUOTE_JSON must be valid JSON");
  }
  assertRecord(request, "HTTP quote benchmark quote request");
  for (const field of quoteFields) {
    if (!Object.prototype.hasOwnProperty.call(request, field)) {
      throw new Error(`HTTP quote benchmark quote request.${field} must be an own field`);
    }
  }
  const unknownField = Object.keys(request).find((field) => !quoteFields.includes(field));
  if (unknownField) throw new Error(`HTTP quote benchmark quote request contains unknown field ${unknownField}`);
  if (!Number.isSafeInteger(request.chainId) || request.chainId <= 0) {
    throw new Error("HTTP quote benchmark quote request.chainId must be a positive safe integer");
  }
  for (const field of ["user", "tokenIn", "tokenOut"]) {
    if (typeof request[field] !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(request[field])) {
      throw new Error(`HTTP quote benchmark quote request.${field} must be a 20-byte hex address`);
    }
  }
  if (request.tokenIn.toLowerCase() === request.tokenOut.toLowerCase()) {
    throw new Error("HTTP quote benchmark token pair must contain distinct addresses");
  }
  if (typeof request.amountIn !== "string" || !/^[1-9][0-9]*$/.test(request.amountIn)) {
    throw new Error("HTTP quote benchmark quote request.amountIn must be a positive uint string");
  }
  if (!Number.isSafeInteger(request.slippageBps) || request.slippageBps < 0 || request.slippageBps > 10_000) {
    throw new Error("HTTP quote benchmark quote request.slippageBps must be between 0 and 10000");
  }
  return request;
}

function readBaseUrl(env, field, fallback) {
  const value = readOwn(env, field) ?? fallback;
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${field} must be an absolute HTTP(S) URL`);
  }
  const loopbackHosts = ["127.0.0.1", "localhost", "[::1]", "::1"];
  const localHttp = parsed.protocol === "http:" && loopbackHosts.includes(parsed.hostname);
  if ((!localHttp && parsed.protocol !== "https:") || parsed.username || parsed.password || parsed.search ||
      parsed.hash || parsed.hostname.includes("*")) {
    throw new Error(`${field} must use HTTPS, or HTTP on loopback, without credentials, wildcard, query, or fragment`);
  }
  parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  return parsed;
}

function readOptionalApiKey(env, field) {
  const value = readOwn(env, field);
  if (value === undefined || value.length === 0) return undefined;
  if (value.trim() !== value || !apiKeyPattern.test(value)) {
    throw new Error(`${field} must use keyId.secret format with a 32-128 character secret`);
  }
  return value;
}

function readInteger(env, field, fallback, min, max) {
  const value = readOwn(env, field);
  if (value === undefined || value.length === 0) return fallback;
  if (!/^(0|[1-9][0-9]*)$/.test(value)) throw new Error(`${field} must be an integer between ${min} and ${max}`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${field} must be an integer between ${min} and ${max}`);
  }
  return parsed;
}

function readPositiveNumber(env, field, fallback) {
  const value = readOwn(env, field);
  if (value === undefined || value.length === 0) return fallback;
  if (!/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(value)) throw new Error(`${field} must be a positive number`);
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${field} must be a positive number`);
  return parsed;
}

function readBoolean(env, field, fallback) {
  const value = readOwn(env, field);
  if (value === undefined || value.length === 0) return fallback;
  if (value !== "true" && value !== "false") throw new Error(`${field} must be true or false`);
  return value === "true";
}

function readOwn(env, field) {
  if (!Object.prototype.hasOwnProperty.call(env, field)) return undefined;
  const value = env[field];
  if (value !== undefined && typeof value !== "string") throw new Error(`${field} must be a primitive string`);
  return value;
}
