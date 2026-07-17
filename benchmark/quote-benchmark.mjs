#!/usr/bin/env node

import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { buildServer } from "../backend/dist/main.js";

const sampleSize = readPositiveInteger("RFQ_BENCHMARK_QUOTE_REQUESTS", 100);
const warmupSize = readPositiveInteger("RFQ_BENCHMARK_QUOTE_WARMUP_REQUESTS", 10);
const concurrency = readPositiveInteger("RFQ_BENCHMARK_QUOTE_CONCURRENCY", 5);
const maxP50Ms = readPositiveInteger("RFQ_BENCHMARK_MAX_P50_MS", 10);
const maxP99Ms = readPositiveInteger("RFQ_BENCHMARK_MAX_P99_MS", 50);
const maxErrorCount = readNonNegativeInteger("RFQ_BENCHMARK_MAX_ERRORS", 0);

const quoteRequest = {
  chainId: 1,
  user: "0x0000000000000000000000000000000000000001",
  tokenIn: "0x0000000000000000000000000000000000000002",
  tokenOut: "0x0000000000000000000000000000000000000003",
  amountIn: "1000000000",
  slippageBps: 50,
};

const server = buildServer({
  logger: false,
  rateLimit: false,
});
await server.ready();

try {
  const warmup = await runBatch(warmupSize, concurrency, "warmup");
  assert.ok(warmup.errors <= maxErrorCount, `quote benchmark warmup errors ${warmup.errors} exceeded ${maxErrorCount}`);

  const batchStartedAt = performance.now();
  const measured = await runBatch(sampleSize, concurrency, "measured");
  const durationMs = performance.now() - batchStartedAt;
  measured.latencies.sort((left, right) => left - right);
  const summary = {
    route: "POST /quote",
    mode: "in-process Fastify inject baseline",
    samples: sampleSize,
    warmupSamples: warmupSize,
    concurrency: Math.min(concurrency, sampleSize),
    errors: measured.errors,
    throughputRps: round(sampleSize / (durationMs / 1_000)),
    p50Ms: round(latencyAt(measured.latencies, 0.5)),
    p95Ms: round(latencyAt(measured.latencies, 0.95)),
    p99Ms: round(latencyAt(measured.latencies, 0.99)),
    maxMs: round(measured.latencies.at(-1) ?? 0),
    thresholds: {
      maxP50Ms,
      maxP99Ms,
      maxErrorCount,
    },
  };

  console.log(JSON.stringify(summary, null, 2));
  assert.ok(summary.errors <= maxErrorCount, `quote benchmark errors ${summary.errors} exceeded ${maxErrorCount}`);
  assert.ok(summary.p50Ms <= maxP50Ms, `quote benchmark p50 ${summary.p50Ms}ms exceeded ${maxP50Ms}ms`);
  assert.ok(summary.p99Ms <= maxP99Ms, `quote benchmark p99 ${summary.p99Ms}ms exceeded ${maxP99Ms}ms`);
} finally {
  await server.close();
}

async function runBatch(size, workerCount, phase) {
  const latencies = [];
  let errors = 0;
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < size) {
      const index = nextIndex;
      nextIndex += 1;
      const startedAt = performance.now();
      const response = await server.inject({
        method: "POST",
        url: "/quote",
        headers: {
          "content-type": "application/json",
          "idempotency-key": `quote_benchmark_${phase}_${String(index).padStart(8, "0")}`,
        },
        payload: quoteRequest,
      });
      latencies.push(performance.now() - startedAt);
      if (response.statusCode !== 200) errors += 1;
    }
  }

  await Promise.all(Array.from({ length: Math.min(workerCount, size) }, worker));
  return { errors, latencies };
}

function latencyAt(values, quantile) {
  if (values.length === 0) return 0;
  const index = Math.ceil(values.length * quantile) - 1;
  return values[Math.max(0, Math.min(index, values.length - 1))];
}

function round(value) {
  return Math.round(value * 100) / 100;
}

function readPositiveInteger(name, fallback) {
  const value = readNonNegativeInteger(name, fallback);
  assert.ok(value > 0, `${name} must be greater than 0`);
  return value;
}

function readNonNegativeInteger(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;

  const value = Number(raw);
  assert.ok(Number.isInteger(value) && value >= 0, `${name} must be a non-negative integer`);
  return value;
}
