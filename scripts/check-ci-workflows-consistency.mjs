#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const workflows = {
  backend: await readFile(".github/workflows/backend-ci.yml", "utf8"),
  docs: await readFile(".github/workflows/docs-ci.yml", "utf8"),
  contract: await readFile(".github/workflows/contract-ci.yml", "utf8"),
  frontendE2E: await readFile(".github/workflows/frontend-e2e.yml", "utf8"),
  release: await readFile(".github/workflows/release.yml", "utf8"),
};
const dependabot = await readFile(".github/dependabot.yml", "utf8");

for (const [filename, source] of Object.entries({
  "backend-ci.yml": workflows.backend,
  "docs-ci.yml": workflows.docs,
  "contract-ci.yml": workflows.contract,
  "frontend-e2e.yml": workflows.frontendE2E,
})) {
  assertContains(source, [
    "pull_request:",
    "push:",
    "- main",
    "- master",
    "runs-on: ubuntu-latest",
    "contents: read",
    "persist-credentials: false",
    'node-version: "22"',
    "package-manager-cache: false",
  ], `.github/workflows/${filename}`);
}

for (const [name, source] of Object.entries(workflows)) {
  const filename = name === "release"
    ? "release.yml"
    : name === "frontendE2E"
      ? "frontend-e2e.yml"
      : `${name}-ci.yml`;
  assertActionsPinned(source, `.github/workflows/${filename}`);
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
  "submodules: recursive",
], ".github/workflows/backend-ci.yml");

assertContains(workflows.docs, [
  'name: Docs CI',
  "submodules: recursive",
  '- "book/**"',
  '- "docs/**"',
  '- "examples/**"',
  '- "benchmark/**"',
  '- "infra/prometheus/**"',
  '- "infra/grafana/**"',
  '- "infra/k8s/**"',
  '- "infra/helm/**"',
  '- "backend/src/modules/rate-limit/rate-limit.service.ts"',
  '- "backend/src/modules/auth/**"',
  '- "backend/src/modules/signer/**"',
  '- "backend/src/modules/indexer/**"',
  '- "backend/src/modules/hedge/**"',
  '- "backend/src/hedge-worker-main.ts"',
  '- "backend/test/hedge*.test.mjs"',
  '- "backend/src/modules/execution/*submit-reservation*"',
  '- "backend/src/settlement-indexer-main.ts"',
  '- "backend/src/*-main.ts"',
  '- "backend/src/shared/logger/**"',
  '- "backend/src/modules/risk/toxic-flow-analyzer.worker.ts"',
  '- "backend/src/modules/analytics/analytics-outbox.publisher.ts"',
  '- "backend/src/modules/hedge/hedge-worker.ts"',
  '- "backend/src/modules/hedge/hedge-fee-worker.ts"',
  '- "backend/src/modules/reconciliation/post-trade-reconciliation.worker.ts"',
  '- "backend/src/modules/market-data/cex-orderbook/cex-orderbook-monitor.ts"',
  '- "backend/src/db/pool.ts"',
  '- "backend/src/db/migrations/**"',
  '- "backend/test/*submit-reservation*"',
  '- "backend/test/submit-concurrency.test.mjs"',
  '- "backend/test/gateway-settlement-policy.test.mjs"',
  '- "backend/test/market-runtime.test.mjs"',
  '- "backend/test/structured-logger.test.mjs"',
  '- "backend/test/toxic-flow-analyzer-worker.test.mjs"',
  '- "backend/src/main.ts"',
  '- "backend/src/api/**"',
  '- "backend/src/runtime/**"',
  '- "backend/src/modules/quote/quote.service.ts"',
  '- "backend/src/modules/quote/quote-service-*.ts"',
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
  '- "scripts/check-api-auth-consistency.mjs"',
  '- "scripts/check-api-composition-consistency.mjs"',
  '- "scripts/lib/**"',
  '- "scripts/check-api-route-consistency.mjs"',
  '- "scripts/check-api-schema-consistency.mjs"',
  '- "scripts/check-ci-workflows-consistency.mjs"',
  '- "scripts/check-config-consistency.mjs"',
  '- "scripts/check-database-schema-consistency.mjs"',
  '- "scripts/check-deployment-manifests-consistency.mjs"',
  '- "scripts/check-examples-consistency.mjs"',
  '- "scripts/check-grafana-dashboard-consistency.mjs"',
  '- "scripts/check-hedge-execution-consistency.mjs"',
  '- "scripts/check-metrics-consistency.mjs"',
  '- "scripts/check-kms-signer-consistency.mjs"',
  '- "scripts/check-logging-consistency.mjs"',
  '- "scripts/check-settlement-indexer-consistency.mjs"',
  '- "scripts/check-submit-reservation-consistency.mjs"',
  '- "scripts/check-rate-limit-consistency.mjs"',
  '- "scripts/check-runbook-consistency.mjs"',
  '- "scripts/check-security-docs-consistency.mjs"',
  '- "scripts/check-transport-security-consistency.mjs"',
  '- "backend/test/api-execution-env.test.mjs"',
  '- "scripts/settlement-e2e.mjs"',
  '- "scripts/settlement-e2e.sh"',
  '- "contracts/script/LocalE2EToken.s.sol"',
  '- ".github/workflows/release.yml"',
  '- ".github/workflows/frontend-e2e.yml"',
  '- ".github/dependabot.yml"',
  '- "backend/package.json"',
  '- "pnpm-lock.yaml"',
  "run: make skeleton-check",
  "run: make examples-check",
  "run: make config-check",
  "run: make hedge-execution-check",
  "run: make kms-signer-check",
  "run: make settlement-indexer-check",
  "run: make submit-reservation-check",
  "run: make api-composition-check",
  "run: make api-auth-check",
  "run: make api-error-check",
  "run: make rate-limit-check",
  "run: make api-schema-check",
  "run: make api-route-check",
  "run: make database-schema-check",
  "run: make docs-check",
  "run: make book-template-check",
  "run: make adr-check",
  "run: make security-check",
  "run: make transport-security-check",
  "run: make logging-check",
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
  '- "backend/src/modules/settlement/settlement-verifier.service.ts"',
  '- "backend/src/runtime/gateway-application.ts"',
  '- "backend/src/runtime/gateway-runtime.ts"',
  '- "backend/src/runtime/market-runtime.ts"',
  '- "backend/test/gateway-settlement-policy.test.mjs"',
  '- "backend/test/market-runtime.test.mjs"',
  '- "scripts/settlement-e2e.mjs"',
  '- "scripts/settlement-e2e.sh"',
  '- "package.json"',
  '- "pnpm-lock.yaml"',
  '- "pnpm-workspace.yaml"',
  '- "sdk/src/abi.ts"',
  '- "sdk/src/eip712.ts"',
  '- "scripts/check-contract-abi-consistency.mjs"',
  '- "scripts/check-eip712-consistency.mjs"',
  '- ".gitmodules"',
  '- "Makefile"',
  "version: stable",
  "pnpm install --frozen-lockfile",
  "FOUNDRY_DISABLE_NIGHTLY_WARNING",
  "submodules: recursive",
  "run: forge fmt --check",
  "run: make eip712-check",
  "run: make contract-abi-check",
  "run: forge build",
  "run: forge test",
  "run: make settlement-e2e",
], ".github/workflows/contract-ci.yml");

assertContains(workflows.frontendE2E, [
  "name: Frontend E2E",
  "permissions: {}",
  '- "backend/**"',
  '- "frontend/**"',
  '- "sdk/**"',
  "submodules: recursive",
  "persist-credentials: false",
  "pnpm install --frozen-lockfile",
  "playwright install --with-deps chromium",
  "run: make frontend-e2e",
  "frontend/playwright-report",
  "frontend/test-results",
  "if-no-files-found: ignore",
], ".github/workflows/frontend-e2e.yml");

assertContains(workflows.release, [
  "name: Release Artifacts",
  "workflow_dispatch:",
  '- "v*.*.*"',
  "cancel-in-progress: false",
  "permissions: {}",
  "verify:",
  "FOUNDRY_DISABLE_NIGHTLY_WARNING",
  "pnpm install --frozen-lockfile",
  "run: make verify",
  "playwright install --with-deps chromium",
  "run: make frontend-e2e",
  "needs: verify",
  "actions: read",
  "contents: read",
  "id-token: write",
  "packages: write",
  "submodules: recursive",
  "persist-credentials: false",
  "registry: ghcr.io",
  "flavor: latest=false",
  "type=sha,format=long,prefix=sha-",
  "file: infra/docker/backend.Dockerfile",
  "file: infra/docker/frontend.Dockerfile",
  "platforms: linux/amd64",
  "push: true",
  "sbom: true",
  "provenance: mode=max",
  "Verify restricted container runtimes",
  'docker pull "${BACKEND_IMAGE_REF}"',
  'docker pull "${FRONTEND_IMAGE_REF}"',
  "sh scripts/container-runtime-check.sh",
  'cosign sign --yes "${BACKEND_IMAGE}@${DIGEST}"',
  'cosign sign --yes "${FRONTEND_IMAGE}@${DIGEST}"',
  "helm lint infra/helm/rfq-market-maker",
  "helm template rfq-market-maker infra/helm/rfq-market-maker",
  "--kube-version 1.31.0",
  '--set-string image.digest="${BACKEND_DIGEST}"',
  '--set-string frontend.image.digest="${FRONTEND_DIGEST}"',
  "helm package infra/helm/rfq-market-maker",
  "helm push",
  "release-manifest.json",
  "if-no-files-found: error",
], ".github/workflows/release.yml");
assert.ok(
  workflows.release.indexOf("Verify restricted container runtimes")
    < workflows.release.indexOf("Sign backend image digest"),
  "release workflow must verify both restricted image runtimes before signing either digest",
);
assert.ok(
  !workflows.release.includes("pull_request:"),
  "release workflow must never expose publishing credentials to pull requests",
);

assertContains(dependabot, [
  "package-ecosystem: github-actions",
  "package-ecosystem: npm",
  "package-ecosystem: docker",
  "interval: weekly",
], ".github/dependabot.yml");

console.log("CI workflows consistency check passed");

function assertContains(source, needles, label) {
  for (const needle of needles) {
    assert.ok(source.includes(needle), `${label} must include ${needle}`);
  }
}

function assertActionsPinned(source, label) {
  const actionLines = source.match(/^\s*(?:-\s+)?uses:\s+\S+.*$/gm) ?? [];
  assert.ok(actionLines.length > 0, `${label} must use at least one action`);
  for (const line of actionLines) {
    assert.match(
      line,
      /uses:\s+[A-Za-z0-9_.-]+\/[A-Za-z0-9_./-]+@[0-9a-f]{40}\s+#\s+v\S+$/,
      `${label} action references must use a full commit SHA with an audited version comment: ${line.trim()}`,
    );
  }
}
