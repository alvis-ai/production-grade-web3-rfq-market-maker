#!/usr/bin/env sh
set -eu

run_step() {
  echo "==> $*"
  "$@"
}

run_step make skeleton-check
run_step make examples-check
run_step make docs-check
run_step make compose-check
run_step make eip712-check
run_step make contract-abi-check
run_step make api-error-check
run_step make api-schema-check
run_step make database-schema-check
run_step make backend-test
run_step make sdk-test
run_step make frontend-build
run_step make smoke-api-local

if command -v forge >/dev/null 2>&1; then
  run_step make contract-test
else
  echo "==> forge not found; skipping contract-test in local verify"
fi
