#!/usr/bin/env sh
set -eu

run_step() {
  echo "==> $*"
  "$@"
}

run_step make skeleton-check
run_step make examples-check
run_step make config-check
run_step make docs-check
run_step make book-template-check
run_step make adr-check
run_step make security-check
run_step make metrics-check
run_step make runbook-check
run_step make grafana-check
run_step make deployment-check
run_step make ci-check
run_step make compose-check
run_step make cex-orderbook-check
run_step make price-normalization-check
run_step make risk-policy-check
run_step make pnl-valuation-check
run_step make kms-signer-check
run_step make settlement-indexer-check
run_step make api-auth-check
run_step make eip712-check
run_step make contract-abi-check
run_step make rate-limit-check
run_step make api-error-check
run_step make api-schema-check
run_step make api-route-check
run_step make database-schema-check
run_step make reconciliation-check
run_step make benchmark-quote
run_step make benchmark-submit
run_step make backend-test
run_step make sdk-test
run_step make frontend-test
run_step make smoke-api-local

if command -v forge >/dev/null 2>&1; then
  run_step make contract-test
else
  echo "==> forge not found; skipping contract-test in local verify"
fi
