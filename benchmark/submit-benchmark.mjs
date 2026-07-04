#!/usr/bin/env node

import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { buildServer } from "../backend/dist/main.js";
import { BasicRiskEngine, defaultBasicRiskPolicy } from "../backend/dist/modules/risk/risk.engine.js";

const sampleSize = readPositiveInteger("RFQ_BENCHMARK_SUBMIT_REQUESTS", 50);
const maxP95Ms = readPositiveInteger("RFQ_BENCHMARK_SUBMIT_MAX_P95_MS", 100);
const maxErrorCount = readNonNegativeInteger("RFQ_BENCHMARK_SUBMIT_MAX_ERRORS", 0);

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
  riskEngine: new BasicRiskEngine({
    ...defaultBasicRiskPolicy,
    maxAbsoluteInventory: BigInt(sampleSize) * 2_000_000_000n,
  }),
});
await server.ready();

try {
  const latencies = [];
  let quoteErrors = 0;
  let submitErrors = 0;

  for (let index = 0; index < sampleSize; index += 1) {
    const quoteResponse = await injectJson("POST", "/quote", quoteRequest);
    if (quoteResponse.statusCode !== 200) {
      quoteErrors += 1;
      continue;
    }

    const submitPayload = {
      quote: {
        user: quoteRequest.user,
        tokenIn: quoteRequest.tokenIn,
        tokenOut: quoteRequest.tokenOut,
        amountIn: quoteRequest.amountIn,
        amountOut: quoteResponse.body.amountOut,
        minAmountOut: quoteResponse.body.minAmountOut,
        nonce: quoteResponse.body.nonce,
        deadline: quoteResponse.body.deadline,
        chainId: quoteRequest.chainId,
      },
      signature: quoteResponse.body.signature,
    };
    const startedAt = performance.now();
    const submitResponse = await injectJson("POST", "/submit", submitPayload);
    latencies.push(performance.now() - startedAt);

    if (submitResponse.statusCode !== 202) {
      submitErrors += 1;
    }
  }

  latencies.sort((left, right) => left - right);
  const summary = {
    route: "POST /submit",
    setupRoute: "POST /quote",
    samples: sampleSize,
    measuredSamples: latencies.length,
    quoteErrors,
    submitErrors,
    errors: quoteErrors + submitErrors,
    p50Ms: round(latencyAt(latencies, 0.5)),
    p95Ms: round(latencyAt(latencies, 0.95)),
    maxMs: round(latencies.at(-1) ?? 0),
    thresholds: {
      maxP95Ms,
      maxErrorCount,
    },
  };

  console.log(JSON.stringify(summary, null, 2));
  assert.equal(summary.measuredSamples, sampleSize, "submit benchmark must measure every requested sample");
  assert.ok(summary.errors <= maxErrorCount, `submit benchmark errors ${summary.errors} exceeded ${maxErrorCount}`);
  assert.ok(summary.p95Ms <= maxP95Ms, `submit benchmark p95 ${summary.p95Ms}ms exceeded ${maxP95Ms}ms`);
} finally {
  await server.close();
}

async function injectJson(method, path, payload) {
  const response = await server.inject({
    method,
    url: path,
    headers: {
      "content-type": "application/json",
    },
    payload,
  });
  return {
    statusCode: response.statusCode,
    body: response.json(),
  };
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
