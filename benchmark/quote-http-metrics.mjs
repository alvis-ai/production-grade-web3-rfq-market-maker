export function parseQuoteMetrics(text) {
  if (typeof text !== "string") throw new Error("HTTP quote benchmark metrics payload must be a string");
  const stages = new Map();
  let pricingCacheHits = 0;
  let pricingCacheMisses = 0;

  for (const line of text.split(/\r?\n/)) {
    const sample = parsePrometheusSample(line);
    if (!sample) continue;
    if (sample.name === "rfq_pricing_cache_hits_total") pricingCacheHits = sample.value;
    if (sample.name === "rfq_pricing_cache_misses_total") pricingCacheMisses = sample.value;
    if (!sample.name.startsWith("rfq_quote_stage_latency_seconds_")) continue;
    const stage = sample.labels.stage;
    if (!stage) continue;
    const state = stages.get(stage) ?? { buckets: new Map(), sum: 0, count: 0 };
    if (sample.name.endsWith("_bucket") && sample.labels.le) {
      state.buckets.set(sample.labels.le, sample.value);
    } else if (sample.name.endsWith("_sum")) {
      state.sum = sample.value;
    } else if (sample.name.endsWith("_count")) {
      state.count = sample.value;
    }
    stages.set(stage, state);
  }

  return { pricingCacheHits, pricingCacheMisses, stages };
}

export function summarizeQuoteMetricsDelta(before, after) {
  const pricingCacheHits = nonNegativeDelta(after.pricingCacheHits, before.pricingCacheHits, "pricing cache hits");
  const pricingCacheMisses = nonNegativeDelta(
    after.pricingCacheMisses,
    before.pricingCacheMisses,
    "pricing cache misses",
  );
  const cacheTotal = pricingCacheHits + pricingCacheMisses;
  const stages = [];

  for (const [stage, finalState] of after.stages) {
    const initialState = before.stages.get(stage) ?? { buckets: new Map(), sum: 0, count: 0 };
    const count = nonNegativeDelta(finalState.count, initialState.count, `${stage} count`);
    if (count === 0) continue;
    const sum = nonNegativeDelta(finalState.sum, initialState.sum, `${stage} sum`);
    const bucketDeltas = [...finalState.buckets.entries()].map(([upperBound, value]) => ({
      upperBound,
      count: nonNegativeDelta(value, initialState.buckets.get(upperBound) ?? 0, `${stage} ${upperBound} bucket`),
    }));
    const p99UpperBoundSeconds = histogramUpperBound(bucketDeltas, count, 0.99);
    stages.push({
      stage,
      samples: count,
      averageMs: round((sum / count) * 1_000),
      p99UpperBoundMs: Number.isFinite(p99UpperBoundSeconds)
        ? round(p99UpperBoundSeconds * 1_000)
        : "+Inf",
    });
  }

  stages.sort((left, right) => left.stage.localeCompare(right.stage));
  return {
    pricingCacheHits,
    pricingCacheMisses,
    pricingCacheHitRatio: cacheTotal === 0 ? null : round(pricingCacheHits / cacheTotal),
    stages,
  };
}

function parsePrometheusSample(line) {
  if (!line || line.startsWith("#")) return undefined;
  const match = /^([a-zA-Z_:][a-zA-Z0-9_:]*)(?:\{([^}]*)\})?\s+([^\s]+)$/.exec(line);
  if (!match) return undefined;
  const value = Number(match[3]);
  if (!Number.isFinite(value) || value < 0) return undefined;
  const labels = {};
  for (const label of (match[2] ?? "").matchAll(/([a-zA-Z_][a-zA-Z0-9_]*)="((?:\\.|[^"])*)"/g)) {
    labels[label[1]] = label[2];
  }
  return { name: match[1], labels, value };
}

function histogramUpperBound(buckets, totalCount, quantile) {
  const target = Math.ceil(totalCount * quantile);
  const sorted = buckets
    .map(({ upperBound, count }) => ({ upperBound: upperBound === "+Inf" ? Number.POSITIVE_INFINITY : Number(upperBound), count }))
    .filter(({ upperBound }) => !Number.isNaN(upperBound))
    .sort((left, right) => left.upperBound - right.upperBound);
  return sorted.find(({ count }) => count >= target)?.upperBound ?? Number.POSITIVE_INFINITY;
}

function nonNegativeDelta(finalValue, initialValue, label) {
  const delta = finalValue - initialValue;
  if (!Number.isFinite(delta) || delta < 0) {
    throw new Error(`HTTP quote benchmark ${label} metric reset during measurement`);
  }
  return delta;
}

function round(value) {
  return Math.round(value * 100) / 100;
}
