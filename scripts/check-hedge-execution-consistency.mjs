#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const paths = {
  route: "backend/src/modules/hedge/hedge-route.ts",
  worker: "backend/src/modules/hedge/hedge-worker.ts",
  runtime: "backend/src/hedge-worker-main.ts",
  routeTest: "backend/test/hedge-route.test.mjs",
  workerTest: "backend/test/hedge-worker.test.mjs",
  runtimeTest: "backend/test/hedge-worker-runtime.test.mjs",
  compose: "docker-compose.yml",
  k8sConfig: "infra/k8s/configmap.yaml",
  k8sDeployment: "infra/k8s/hedge-worker-deployment.yaml",
  helmDeployment: "infra/helm/rfq-market-maker/templates/hedge-worker-deployment.yaml",
  readme: "README.md",
  hedgeBook: "book/Volume5-BackendEngineering/Chapter07-Hedge-Service.md",
  kubernetesBook: "book/Volume7-ProductionDeployment/Chapter02-Kubernetes.md",
  runbook: "book/Volume7-ProductionDeployment/Chapter05-Runbook.md",
};

const entries = await Promise.all(
  Object.entries(paths).map(async ([name, path]) => [name, await readFile(path, "utf8")]),
);
const source = Object.fromEntries(entries);

assert.match(source.route, /validateTokenRegistry\(registry: TokenRegistry\)/);
assert.match(source.route, /metadata\.decimals !== route\.tokenDecimals/);
assert.match(source.route, /export function quantizeHedgeAmount/);
assert.match(source.route, /quantized\.toString\(\) as UIntString/);
assert.match(source.worker, /const targetAmount = quantizeHedgeAmount\(job\.amount, route\)/);
assert.match(source.worker, /filledAmount === undefined \|\| filledAmount !== targetAmount/);
assert.match(source.worker, /completeFilled[\s\S]*filledAmount/);

assert.match(source.runtime, /readRequired\(env, "RFQ_TOKEN_REGISTRY_JSON"\)/);
assert.match(source.runtime, /routes\.validateTokenRegistry\(tokenRegistry\)/);
assert.match(source.routeTest, /binds route decimals to the shared token registry/);
assert.match(source.workerTest, /requires FILLED cumulative quantity to equal the quantized target/);
assert.match(source.workerTest, /permits only sub-step dust between intent and a complete venue fill/);
assert.match(source.runtimeTest, /RFQ_TOKEN_REGISTRY_JSON is required/);
assert.match(source.runtimeTest, /does not match token registry decimals/);

assert.match(source.compose, /hedge-worker:[\s\S]*RFQ_TOKEN_REGISTRY_JSON:[\s\S]*RFQ_HEDGE_ROUTES_JSON:/);
assert.match(source.k8sConfig, /RFQ_TOKEN_REGISTRY_JSON:/);
assert.match(source.k8sConfig, /RFQ_HEDGE_ROUTES_JSON:/);
assert.match(source.k8sDeployment, /configMapRef:[\s\S]*name: rfq-backend-config/);
assert.match(source.helmDeployment, /name: RFQ_TOKEN_REGISTRY_JSON/);
assert.match(source.helmDeployment, /env\.RFQ_TOKEN_REGISTRY_JSON is required for hedge route decimals/);

for (const [name, needle] of [
  ["readme", /quantized target/],
  ["hedgeBook", /quantized target/],
  ["kubernetesBook", /route decimals/],
  ["runbook", /registry\/route decimals mismatch/],
]) {
  assert.match(source[name], needle, `${paths[name]} must document hedge quantity integrity`);
}

console.log("Hedge execution consistency check passed");
