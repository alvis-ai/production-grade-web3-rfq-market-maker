import {
  latencyBucketsSeconds,
  type HistogramState,
} from "./metrics-contract.js";

export function createHistogramState(): HistogramState {
  return {
    sum: 0,
    count: 0,
    buckets: latencyBucketsSeconds.map(() => 0),
  };
}

export function recordHistogram(state: HistogramState, value: number): void {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error("Metrics histogram observation must be a finite number");
  }
  const normalized = Math.max(0, value);
  state.count += 1;
  state.sum += normalized;
  for (let index = 0; index < latencyBucketsSeconds.length; index += 1) {
    if (normalized <= latencyBucketsSeconds[index]!) state.buckets[index] += 1;
  }
}

export function renderHistogram(name: string, state: HistogramState): string[] {
  const lines = latencyBucketsSeconds.map((bucket, index) => {
    return `${name}_bucket{le="${bucket}"} ${state.buckets[index]}`;
  });
  return [
    ...lines,
    `${name}_bucket{le="+Inf"} ${state.count}`,
    `${name}_sum ${formatMetricNumber(state.sum)}`,
    `${name}_count ${state.count}`,
  ];
}

function formatMetricNumber(value: number): string {
  if (Number.isInteger(value)) return value.toString();
  return value.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
}
