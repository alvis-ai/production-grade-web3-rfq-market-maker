#!/usr/bin/env node

import { randomBytes } from "node:crypto";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";
import { assertRecord, readBenchmarkConfig } from "./quote-http-benchmark-config.mjs";
import { parseQuoteMetrics, summarizeQuoteMetricsDelta } from "./quote-http-metrics.mjs";

export { parseQuoteMetrics, summarizeQuoteMetricsDelta } from "./quote-http-metrics.mjs";

export async function runHttpQuoteBenchmark(env = process.env, dependencies = {}) {
  assertRecord(env, "HTTP quote benchmark environment");
  assertRecord(dependencies, "HTTP quote benchmark dependencies");
  const config = readBenchmarkConfig(env);
  const fetchImpl = dependencies.fetch ?? globalThis.fetch;
  const now = dependencies.now ?? performance.now.bind(performance);
  const random = dependencies.randomBytes ?? randomBytes;
  if (typeof fetchImpl !== "function") throw new Error("HTTP quote benchmark fetch must be a function");
  if (typeof now !== "function") throw new Error("HTTP quote benchmark clock must be a function");
  if (typeof random !== "function") throw new Error("HTTP quote benchmark randomBytes must be a function");

  const readiness = await requestJson(fetchImpl, config, "GET", "/ready");
  if (readiness.status !== "ready" || !isReadyComponents(readiness.components)) {
    throw new Error("HTTP quote benchmark target readiness is degraded");
  }

  const runId = readRandomHex(random, 8);
  const warmup = await runBatch(fetchImpl, now, config, runId, "warmup", config.warmupRequests);
  const baselineMetrics = config.collectMetrics
    ? parseQuoteMetrics(await requestText(fetchImpl, config, "GET", "/metrics"))
    : undefined;

  const batchStartedAt = readClock(now);
  const measured = await runBatch(fetchImpl, now, config, runId, "measured", config.requests);
  const durationMs = readClock(now) - batchStartedAt;
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    throw new Error("HTTP quote benchmark measured duration must be positive");
  }
  measured.latencies.sort((left, right) => left - right);

  const finalMetrics = config.collectMetrics
    ? parseQuoteMetrics(await requestText(fetchImpl, config, "GET", "/metrics"))
    : undefined;
  const observability = baselineMetrics && finalMetrics
    ? summarizeQuoteMetricsDelta(baselineMetrics, finalMetrics)
    : undefined;
  const p50Ms = round(latencyAt(measured.latencies, 0.50));
  const p95Ms = round(latencyAt(measured.latencies, 0.95));
  const p99Ms = round(latencyAt(measured.latencies, 0.99));
  const violations = [
    ...(warmup.errors > config.maxErrors ? [`warmup errors ${warmup.errors} exceeded ${config.maxErrors}`] : []),
    ...(measured.errors > config.maxErrors ? [`measured errors ${measured.errors} exceeded ${config.maxErrors}`] : []),
    ...(p50Ms > config.maxP50Ms ? [`p50 ${p50Ms}ms exceeded ${config.maxP50Ms}ms`] : []),
    ...(p99Ms > config.maxP99Ms ? [`p99 ${p99Ms}ms exceeded ${config.maxP99Ms}ms`] : []),
  ];

  return {
    route: "POST /quote",
    mode: "external HTTP dependency-stack benchmark",
    targetOrigin: config.baseUrl.origin,
    samples: config.requests,
    warmupSamples: config.warmupRequests,
    concurrency: Math.min(config.concurrency, config.requests),
    errors: measured.errors,
    warmupErrors: warmup.errors,
    throughputRps: round(config.requests / (durationMs / 1_000)),
    p50Ms,
    p95Ms,
    p99Ms,
    maxMs: round(measured.latencies.at(-1) ?? 0),
    statusCounts: sortedCounter(measured.statusCounts),
    errorCodes: sortedCounter(measured.errorCodes),
    ...(observability === undefined ? {} : { observability }),
    slo: {
      enforced: config.enforceSlo,
      passed: violations.length === 0,
      maxP50Ms: config.maxP50Ms,
      maxP99Ms: config.maxP99Ms,
      maxErrors: config.maxErrors,
      violations,
    },
  };
}

async function runBatch(fetchImpl, now, config, runId, phase, size) {
  const latencies = [];
  const statusCounts = new Map();
  const errorCodes = new Map();
  let errors = 0;
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < size) {
      const index = nextIndex;
      nextIndex += 1;
      const startedAt = readClock(now);
      try {
        const response = await fetchImpl(buildUrl(config.baseUrl, "/quote"), {
          method: "POST",
          headers: requestHeaders(config, `http_benchmark_${runId}_${phase}_${String(index).padStart(8, "0")}`),
          body: JSON.stringify(config.quoteRequest),
          redirect: "error",
          signal: AbortSignal.timeout(config.requestTimeoutMs),
        });
        increment(statusCounts, response.status.toString());
        if (!response.ok) {
          errors += 1;
          increment(errorCodes, await responseErrorCode(response));
        } else {
          await response.text();
        }
      } catch {
        errors += 1;
        increment(statusCounts, "network_error");
        increment(errorCodes, "NETWORK_ERROR");
      } finally {
        latencies.push(readClock(now) - startedAt);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(config.concurrency, size) }, worker));
  return { errors, errorCodes, latencies, statusCounts };
}

async function requestJson(fetchImpl, config, method, path) {
  const response = await fetchImpl(buildUrl(config.baseUrl, path), {
    method,
    headers: config.apiKey === undefined ? {} : { "x-api-key": config.apiKey },
    redirect: "error",
    signal: AbortSignal.timeout(config.requestTimeoutMs),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${method} ${path} failed with HTTP ${response.status}`);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${method} ${path} returned malformed JSON`);
  }
}

async function requestText(fetchImpl, config, method, path) {
  const response = await fetchImpl(buildUrl(config.baseUrl, path), {
    method,
    headers: config.apiKey === undefined ? {} : { "x-api-key": config.apiKey },
    redirect: "error",
    signal: AbortSignal.timeout(config.requestTimeoutMs),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${method} ${path} failed with HTTP ${response.status}`);
  return text;
}

function requestHeaders(config, idempotencyKey) {
  return {
    "content-type": "application/json",
    "idempotency-key": idempotencyKey,
    ...(config.apiKey === undefined ? {} : { "x-api-key": config.apiKey }),
  };
}

async function responseErrorCode(response) {
  try {
    const payload = JSON.parse(await response.text());
    return typeof payload.code === "string" && /^[A-Z0-9_]{1,64}$/.test(payload.code)
      ? payload.code
      : `HTTP_${response.status}`;
  } catch {
    return `HTTP_${response.status}`;
  }
}

function readRandomHex(random, size) {
  const value = random(size);
  if (!(value instanceof Uint8Array) || value.length !== size) {
    throw new Error(`HTTP quote benchmark randomBytes must return ${size} bytes`);
  }
  return Buffer.from(value).toString("hex");
}

function readClock(now) {
  const value = now();
  if (!Number.isFinite(value)) throw new Error("HTTP quote benchmark clock must return a finite number");
  return value;
}

function isReadyComponents(components) {
  return typeof components === "object" && components !== null && !Array.isArray(components) &&
    Object.values(components).length > 0 && Object.values(components).every((value) => value === "ok");
}

function buildUrl(baseUrl, path) {
  const prefix = baseUrl.pathname === "/" ? "" : baseUrl.pathname;
  return `${baseUrl.origin}${prefix}${path}`;
}

function latencyAt(values, quantile) {
  if (values.length === 0) return 0;
  const index = Math.ceil(values.length * quantile) - 1;
  return values[Math.max(0, Math.min(index, values.length - 1))];
}

function increment(counter, key) {
  counter.set(key, (counter.get(key) ?? 0) + 1);
}

function sortedCounter(counter) {
  return Object.fromEntries([...counter.entries()].sort(([left], [right]) => left.localeCompare(right)));
}

function round(value) {
  return Math.round(value * 100) / 100;
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : undefined;
if (invokedPath === import.meta.url) {
  const summary = await runHttpQuoteBenchmark();
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  if (summary.slo.enforced && !summary.slo.passed) process.exitCode = 1;
}
