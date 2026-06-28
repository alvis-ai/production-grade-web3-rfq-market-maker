#!/usr/bin/env node

import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { buildServer } from "../backend/dist/main.js";

const sampleSize = readPositiveInteger("RFQ_BENCHMARK_QUOTE_REQUESTS", 100);
const maxP95Ms = readPositiveInteger("RFQ_BENCHMARK_MAX_P95_MS", 50);
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
  const latencies = [];
  let errors = 0;

  for (let index = 0; index < sampleSize; index += 1) {
    const startedAt = performance.now();
    const response = await server.inject({
      method: "POST",
      url: "/quote",
      headers: {
        "content-type": "application/json",
      },
      payload: quoteRequest,
    });
    latencies.push(performance.now() - startedAt);

    if (response.statusCode !== 200) {
      errors += 1;
    }
  }

  latencies.sort((left, right) => left - right);
  const summary = {
    route: "POST /quote",
    samples: sampleSize,
    errors,
    p50Ms: round(latencyAt(latencies, 0.5)),
    p95Ms: round(latencyAt(latencies, 0.95)),
    maxMs: round(latencies.at(-1) ?? 0),
    thresholds: {
      maxP95Ms,
      maxErrorCount,
    },
  };

  console.log(JSON.stringify(summary, null, 2));
  assert.ok(summary.errors <= maxErrorCount, `quote benchmark errors ${summary.errors} exceeded ${maxErrorCount}`);
  assert.ok(summary.p95Ms <= maxP95Ms, `quote benchmark p95 ${summary.p95Ms}ms exceeded ${maxP95Ms}ms`);
} finally {
  await server.close();
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
