import { readFile } from "node:fs/promises";

export const backendGatewaySourcePaths = [
  "backend/src/main.ts",
  "backend/src/api/http-boundary.ts",
  "backend/src/api/trading-routes.ts",
  "backend/src/api/quote-control-routes.ts",
  "backend/src/api/toxic-flow-score-routes.ts",
  "backend/src/runtime/environment.ts",
  "backend/src/runtime/gateway-application.ts",
  "backend/src/runtime/gateway-hedge-risk.ts",
  "backend/src/runtime/gateway-hot-state.ts",
  "backend/src/runtime/gateway-market-data.ts",
  "backend/src/runtime/gateway-quote-admission.ts",
  "backend/src/runtime/gateway-risk-runtime.ts",
  "backend/src/runtime/gateway-settlement-indexer-risk.ts",
  "backend/src/runtime/gateway-runtime.ts",
  "backend/src/runtime/market-runtime.ts",
  "backend/src/runtime/process-shutdown.ts",
  "backend/src/runtime/server-process.ts",
];

export async function readBackendGatewaySource() {
  return (await Promise.all(backendGatewaySourcePaths.map((path) => readFile(path, "utf8")))).join("\n");
}
