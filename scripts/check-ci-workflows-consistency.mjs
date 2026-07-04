#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const workflows = {
  backend: await readFile(".github/workflows/backend-ci.yml", "utf8"),
  docs: await readFile(".github/workflows/docs-ci.yml", "utf8"),
  contract: await readFile(".github/workflows/contract-ci.yml", "utf8"),
};

for (const [name, source] of Object.entries(workflows)) {
  assertContains(source, [
    "pull_request:",
    "push:",
    "- main",
    "- master",
    "runs-on: ubuntu-latest",
    "uses: actions/checkout@v4",
    "uses: actions/setup-node@v4",
    'node-version: "22"',
  ], `.github/workflows/${name}-ci.yml`);
}

assertContains(workflows.backend, [
  'name: Backend CI',
  '- "backend/**"',
  '- "benchmark/**"',
  '- "frontend/**"',
  '- "sdk/**"',
  '- "infra/**"',
  '- "scripts/**"',
  '- "package.json"',
  '- "pnpm-lock.yaml"',
  '- "pnpm-workspace.yaml"',
  '- "docker-compose.yml"',
  '- ".env.example"',
  '- "README.md"',
  "run: corepack enable",
  "run: pnpm install --frozen-lockfile",
  "run: make verify",
], ".github/workflows/backend-ci.yml");

assertContains(workflows.docs, [
  'name: Docs CI',
  '- "book/**"',
  '- "docs/**"',
  '- "examples/**"',
  '- "benchmark/**"',
  '- "infra/prometheus/**"',
  '- "infra/grafana/**"',
  '- "infra/k8s/**"',
  '- "infra/helm/**"',
  '- "backend/src/modules/rate-limit/rate-limit.service.ts"',
  '- "backend/src/main.ts"',
  '- "sdk/src/client.ts"',
  '- "sdk/src/types.ts"',
  '- "sdk/test/sdk-client-config.test.mjs"',
  '- "sdk/test/sdk-client-errors.test.mjs"',
  '- "sdk/test/sdk-client-requests.test.mjs"',
  '- "sdk/test/sdk-client-accounting-responses.test.mjs"',
  '- "sdk/test/sdk-client-responses.test.mjs"',
  '- "sdk/test/sdk-client-status-responses.test.mjs"',
  '- "sdk/test/sdk-settlement.test.mjs"',
  '- "sdk/test/sdk.test.mjs"',
  '- "scripts/check-api-error-consistency.mjs"',
  '- "scripts/check-api-route-consistency.mjs"',
  '- "scripts/check-api-schema-consistency.mjs"',
  '- "scripts/check-ci-workflows-consistency.mjs"',
  '- "scripts/check-config-consistency.mjs"',
  '- "scripts/check-database-schema-consistency.mjs"',
  '- "scripts/check-deployment-manifests-consistency.mjs"',
  '- "scripts/check-examples-consistency.mjs"',
  '- "scripts/check-grafana-dashboard-consistency.mjs"',
  '- "scripts/check-metrics-consistency.mjs"',
  '- "scripts/check-rate-limit-consistency.mjs"',
  '- "scripts/check-runbook-consistency.mjs"',
  '- "scripts/check-security-docs-consistency.mjs"',
  "run: make skeleton-check",
  "run: make examples-check",
  "run: make config-check",
  "run: make api-error-check",
  "run: make rate-limit-check",
  "run: make api-schema-check",
  "run: make api-route-check",
  "run: make database-schema-check",
  "run: make docs-check",
  "run: make book-template-check",
  "run: make adr-check",
  "run: make security-check",
  "run: make metrics-check",
  "run: make runbook-check",
  "run: make grafana-check",
  "run: make deployment-check",
  "run: make ci-check",
], ".github/workflows/docs-ci.yml");

assertContains(workflows.contract, [
  'name: Contract CI',
  '- "contracts/**"',
  '- "backend/src/modules/signer/signer.service.ts"',
  '- "sdk/src/abi.ts"',
  '- "sdk/src/eip712.ts"',
  '- "scripts/check-contract-abi-consistency.mjs"',
  '- "scripts/check-eip712-consistency.mjs"',
  '- "Makefile"',
  "uses: foundry-rs/foundry-toolchain@v1",
  "version: stable",
  "FOUNDRY_DISABLE_NIGHTLY_WARNING",
  "run: forge fmt --check",
  "run: make eip712-check",
  "run: make contract-abi-check",
  "run: forge build",
  "run: forge test",
], ".github/workflows/contract-ci.yml");

console.log("CI workflows consistency check passed");

function assertContains(source, needles, label) {
  for (const needle of needles) {
    assert.ok(source.includes(needle), `${label} must include ${needle}`);
  }
}
