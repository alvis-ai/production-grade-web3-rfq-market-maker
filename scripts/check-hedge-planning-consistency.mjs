#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { readBackendGatewaySource } from "./lib/read-backend-gateway-source.mjs";

let [
  planner,
  execution,
  reconciliation,
  main,
  reconciliationMain,
  marketRuntime,
  compose,
  k8s,
  helm,
  envExample,
  readme,
  hedgeBook,
] = await Promise.all([
  "backend/src/modules/hedge/hedge-intent-planner.ts",
  "backend/src/modules/execution/execution.service.ts",
  "backend/src/modules/reconciliation/reconciliation.service.ts",
  "backend/src/main.ts",
  "backend/src/reconciliation-worker-main.ts",
  "backend/src/runtime/market-runtime.ts",
  "docker-compose.yml",
  "infra/k8s/configmap.yaml",
  "infra/helm/rfq-market-maker/values.yaml",
  ".env.example",
  "README.md",
  "book/Volume5-BackendEngineering/Chapter07-Hedge-Service.md",
].map((path) => readFile(path, "utf8")));
main = await readBackendGatewaySource();

assert.match(planner, /delta-neutral-v2/, "hedge planner must expose a versioned delta-neutral strategy");
assert.match(
  planner,
  /tokenOut\.usdReference[\s\S]*token:\s*input\.tokenIn[\s\S]*side:\s*"sell"[\s\S]*amount:\s*input\.amountIn/,
  "USD tokenOut flow must sell the received tokenIn amount",
);
assert.match(
  planner,
  /token:\s*input\.tokenOut[\s\S]*side:\s*"buy"[\s\S]*amount:\s*input\.amountOut/,
  "USD tokenIn flow must buy the paid tokenOut amount",
);
assert.match(planner, /HEDGE_REFERENCE_ASSET_AMBIGUOUS/, "pairs without a USD reference must fail closed");

assert.match(execution, /this\.hedgePlanner\.plan\(/, "submit execution must use the shared hedge planner");
assert.doesNotMatch(
  execution,
  /token:\s*request\.quote\.tokenOut[\s\S]{0,100}side:\s*"buy"/,
  "submit execution must not restore the legacy fixed output-token hedge",
);
assert.match(
  reconciliation,
  /this\.hedgePlanner\.plan\(hedgePlanInputFromSettlementEvent\(event\)\)/,
  "settlement reconciliation must use the shared hedge planner",
);
assert.match(main, /new DeltaNeutralHedgePlanner\(runtimeTokenRegistry\)/, "API runtime must inject its token registry");
assert.match(
  reconciliationMain,
  /new DeltaNeutralHedgePlanner\(tokenRegistry\)/,
  "reconciliation runtime must inject the same configured token registry",
);
assert.match(
  marketRuntime,
  /!tokenIn\.usdReference && !tokenOut\.usdReference[\s\S]*requires at least one approved USD reference token/,
  "managed pricing pairs must require a USD-reference leg",
);
assert.match(
  marketRuntime,
  /!tokenIn\.usdReference && !tokenOut\.usdReference[\s\S]*must include at least one USD-reference token/,
  "managed risk pairs must require a USD-reference leg",
);

for (const [label, source] of [
  ["docker-compose", compose],
  ["Kubernetes", k8s],
  ["Helm", helm],
  [".env.example", envExample],
]) {
  assert.match(
    source,
    /RFQ_HEDGE_ROUTES_JSON[=:][^\n]*"token":"0x0000000000000000000000000000000000000002"/,
    `${label} hedge route must cover the default non-reference token`,
  );
}

assert.match(readme, /delta-neutral-v2/, "README must document the active hedge strategy");
assert.match(hedgeBook, /delta-neutral-v2/, "hedge engineering chapter must document the active strategy");

console.log("Hedge planning consistency check passed");
