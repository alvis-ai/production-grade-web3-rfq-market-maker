import assert from "node:assert/strict";
import test from "node:test";
import {
  parseQuoteMetrics,
  runHttpQuoteBenchmark,
  summarizeQuoteMetricsDelta,
} from "./quote-http-benchmark.mjs";

const quoteJson = JSON.stringify({
  chainId: 1,
  user: "0x0000000000000000000000000000000000000001",
  tokenIn: "0x0000000000000000000000000000000000000002",
  tokenOut: "0x0000000000000000000000000000000000000003",
  amountIn: "1000000000",
  slippageBps: 50,
});

test("HTTP quote benchmark measures a network path and correlates metric deltas", async () => {
  let metricsReads = 0;
  const requests = [];
  const clocks = [0, 1, 10, 10, 15, 15];
  const summary = await runHttpQuoteBenchmark(benchmarkEnv(), {
    now: () => clocks.shift(),
    randomBytes: (size) => new Uint8Array(size).fill(0xab),
    async fetch(url, init) {
      const parsed = new URL(url);
      requests.push({ path: parsed.pathname, init });
      if (parsed.pathname === "/ready") {
        return response(200, JSON.stringify({ status: "ready", components: { marketData: "ok", signer: "ok" } }));
      }
      if (parsed.pathname === "/metrics") {
        metricsReads += 1;
        return response(200, metricsReads === 1 ? baselineMetrics : finalMetrics);
      }
      return response(200, JSON.stringify({ quoteId: "q_1" }));
    },
  });

  assert.equal(summary.slo.passed, true);
  assert.equal(summary.p50Ms, 5);
  assert.equal(summary.p99Ms, 5);
  assert.equal(summary.throughputRps, 200);
  assert.deepEqual(summary.statusCounts, { 200: 1 });
  assert.equal(summary.observability.pricingCacheHits, 1);
  assert.equal(summary.observability.pricingCacheMisses, 0);
  assert.equal(summary.observability.pricingCacheHitRatio, 1);
  assert.deepEqual(summary.observability.stages, [{
    stage: "pricing",
    samples: 1,
    averageMs: 5,
    p99UpperBoundMs: 10,
  }]);
  const quoteRequests = requests.filter(({ path }) => path === "/quote");
  assert.equal(quoteRequests.length, 2);
  assert.notEqual(
    quoteRequests[0].init.headers["idempotency-key"],
    quoteRequests[1].init.headers["idempotency-key"],
  );
});

test("HTTP quote benchmark rejects unsafe targets and payloads before network access", async () => {
  let fetchAttempts = 0;
  const dependencies = {
    async fetch() {
      fetchAttempts += 1;
      throw new Error("unexpected fetch");
    },
  };

  await assert.rejects(
    runHttpQuoteBenchmark({ ...benchmarkEnv(), RFQ_HTTP_BENCHMARK_API_URL: "http://api.example.com" }, dependencies),
    /must use HTTPS, or HTTP on loopback/,
  );
  await assert.rejects(
    runHttpQuoteBenchmark({
      ...benchmarkEnv(),
      RFQ_HTTP_BENCHMARK_QUOTE_JSON: JSON.stringify({ ...JSON.parse(quoteJson), unexpected: true }),
    }, dependencies),
    /contains unknown field unexpected/,
  );
  assert.equal(fetchAttempts, 0);
});

test("HTTP quote benchmark rejects metric resets", () => {
  const before = parseQuoteMetrics(finalMetrics);
  const after = parseQuoteMetrics(baselineMetrics);
  assert.throws(
    () => summarizeQuoteMetricsDelta(before, after),
    /metric reset during measurement/,
  );
});

function benchmarkEnv() {
  return {
    RFQ_HTTP_BENCHMARK_API_URL: "http://127.0.0.1:3000",
    RFQ_HTTP_BENCHMARK_QUOTE_REQUESTS: "1",
    RFQ_HTTP_BENCHMARK_QUOTE_WARMUP_REQUESTS: "1",
    RFQ_HTTP_BENCHMARK_QUOTE_CONCURRENCY: "1",
    RFQ_HTTP_BENCHMARK_MAX_P50_MS: "10",
    RFQ_HTTP_BENCHMARK_MAX_P99_MS: "50",
    RFQ_HTTP_BENCHMARK_MAX_ERRORS: "0",
    RFQ_HTTP_BENCHMARK_ENFORCE_SLO: "true",
    RFQ_HTTP_BENCHMARK_COLLECT_METRICS: "true",
    RFQ_HTTP_BENCHMARK_QUOTE_JSON: quoteJson,
  };
}

function response(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return body;
    },
  };
}

const baselineMetrics = `
rfq_pricing_cache_hits_total 5
rfq_pricing_cache_misses_total 2
rfq_quote_stage_latency_seconds_bucket{stage="pricing",le="0.005"} 9
rfq_quote_stage_latency_seconds_bucket{stage="pricing",le="0.01"} 10
rfq_quote_stage_latency_seconds_bucket{stage="pricing",le="+Inf"} 10
rfq_quote_stage_latency_seconds_sum{stage="pricing"} 0.02
rfq_quote_stage_latency_seconds_count{stage="pricing"} 10
`;

const finalMetrics = `
rfq_pricing_cache_hits_total 6
rfq_pricing_cache_misses_total 2
rfq_quote_stage_latency_seconds_bucket{stage="pricing",le="0.005"} 9
rfq_quote_stage_latency_seconds_bucket{stage="pricing",le="0.01"} 11
rfq_quote_stage_latency_seconds_bucket{stage="pricing",le="+Inf"} 11
rfq_quote_stage_latency_seconds_sum{stage="pricing"} 0.025
rfq_quote_stage_latency_seconds_count{stage="pricing"} 11
`;
