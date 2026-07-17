import { readFile } from "node:fs/promises";

export const backendMetricsSourcePaths = [
  "backend/src/modules/metrics/metrics.service.ts",
  "backend/src/modules/metrics/metrics-contract.ts",
  "backend/src/modules/metrics/metrics-validation.ts",
  "backend/src/modules/metrics/prometheus-metrics.ts",
];

export async function readBackendMetricsSource() {
  return (await Promise.all(backendMetricsSourcePaths.map((path) => readFile(path, "utf8")))).join("\n");
}
