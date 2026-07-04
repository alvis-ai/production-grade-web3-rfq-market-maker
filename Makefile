.PHONY: help verify docs-check book-template-check adr-check security-check metrics-check runbook-check grafana-check deployment-check ci-check tree workspace-check skeleton-check examples-check config-check compose-check eip712-check contract-abi-check rate-limit-check api-error-check api-schema-check api-route-check database-schema-check reconciliation-check benchmark-quote benchmark-submit backend-build backend-test backend-typecheck sdk-test sdk-typecheck frontend-build frontend-test typescript-check contract-build contract-test smoke-api smoke-api-local

help:
	@echo "Production-Grade Web3 RFQ Market Maker"
	@echo ""
	@echo "Available targets:"
	@echo "  verify      Run the repository quality gate"
	@echo "  docs-check  Count Mermaid diagrams and RFQ interview questions"
	@echo "  book-template-check  Verify book chapters follow the standard template"
	@echo "  adr-check  Verify ADR numbering and template consistency"
	@echo "  security-check  Verify security docs cover required production controls"
	@echo "  metrics-check  Verify backend metrics, alert rules, and monitoring docs match"
	@echo "  runbook-check  Verify alert rules have actionable runbook coverage"
	@echo "  grafana-check  Verify Grafana dashboards cover backend metrics"
	@echo "  deployment-check  Verify Kubernetes and Helm deployment manifests"
	@echo "  ci-check  Verify GitHub Actions workflow coverage"
	@echo "  tree        Print the first three levels of repository files"
	@echo "  workspace-check  Verify expected workspace manifests exist"
	@echo "  skeleton-check  Verify required skeleton entrypoints exist"
	@echo "  examples-check  Verify example API payloads match public schemas"
	@echo "  config-check  Verify local and deployment configuration defaults match"
	@echo "  compose-check  Verify Docker Compose configuration"
	@echo "  eip712-check  Verify backend, SDK, and contract EIP-712 schemas match"
	@echo "  contract-abi-check  Verify SDK contract ABIs match Solidity integration surfaces"
	@echo "  rate-limit-check  Verify API rate limit defaults and HTTP contract"
	@echo "  api-error-check  Verify backend, OpenAPI, and error docs share error codes"
	@echo "  api-schema-check  Verify backend, SDK, and OpenAPI schemas match"
	@echo "  api-route-check  Verify backend, SDK, OpenAPI, and smoke routes match"
	@echo "  database-schema-check  Verify database schema matches API state surfaces"
	@echo "  reconciliation-check  Verify settlement-to-quote and settlement-to-PnL repair flows"
	@echo "  benchmark-quote  Run a local POST /quote latency benchmark"
	@echo "  benchmark-submit Run a local POST /submit latency benchmark"
	@echo "  backend-build  Build backend package"
	@echo "  backend-test  Run backend API tests"
	@echo "  backend-typecheck  Typecheck backend package"
	@echo "  sdk-test  Run SDK unit tests"
	@echo "  sdk-typecheck  Typecheck SDK package"
	@echo "  frontend-build  Build frontend package"
	@echo "  frontend-test   Run frontend validation tests"
	@echo "  typescript-check  Run backend, SDK, and frontend checks"
	@echo "  contract-build  Build Foundry contracts"
	@echo "  contract-test   Run Foundry contract tests offline"
	@echo "  smoke-api       Exercise health, quote, submit, and metrics endpoints"
	@echo "  smoke-api-local Build, start backend locally, run smoke-api, and stop backend"

verify:
	@sh scripts/verify.sh

docs-check:
	@echo "Mermaid blocks:"
	@grep -R "^\`\`\`mermaid" -n book docs | wc -l
	@echo "RFQ interview questions:"
	@grep -E "^## [0-9]+\\." docs/interview/rfq-questions.md | wc -l

book-template-check:
	@node scripts/check-book-template-consistency.mjs

adr-check:
	@node scripts/check-adr-consistency.mjs

security-check:
	@node scripts/check-security-docs-consistency.mjs

metrics-check:
	@node scripts/check-metrics-consistency.mjs

runbook-check:
	@node scripts/check-runbook-consistency.mjs

grafana-check:
	@node scripts/check-grafana-dashboard-consistency.mjs

deployment-check:
	@node scripts/check-deployment-manifests-consistency.mjs

ci-check:
	@node scripts/check-ci-workflows-consistency.mjs

tree:
	@find . -maxdepth 3 -type f | sort

workspace-check:
	@test -s package.json
	@test -s pnpm-workspace.yaml
	@test -s backend/package.json
	@test -s frontend/package.json
	@test -s sdk/package.json

skeleton-check:
	@sh scripts/check-skeleton.sh

examples-check:
	@node scripts/check-examples-consistency.mjs

config-check:
	@node scripts/check-config-consistency.mjs

compose-check:
	@docker compose config --quiet

eip712-check:
	@node scripts/check-eip712-consistency.mjs

contract-abi-check:
	@node scripts/check-contract-abi-consistency.mjs

rate-limit-check:
	@node scripts/check-rate-limit-consistency.mjs

api-error-check:
	@node scripts/check-api-error-consistency.mjs

api-schema-check:
	@node scripts/check-api-schema-consistency.mjs

api-route-check:
	@node scripts/check-api-route-consistency.mjs

database-schema-check:
	@node scripts/check-database-schema-consistency.mjs

reconciliation-check: backend-build
	@node scripts/reconciliation-check.mjs

benchmark-quote: backend-build
	@node benchmark/quote-benchmark.mjs

benchmark-submit: backend-build
	@node benchmark/submit-benchmark.mjs

backend-build:
	@CI=true pnpm --dir backend build

backend-test: backend-build
	@CI=true pnpm --dir backend test

backend-typecheck:
	@CI=true pnpm --dir backend typecheck

sdk-typecheck:
	@CI=true pnpm --dir sdk typecheck

sdk-test:
	@CI=true pnpm --dir sdk test

frontend-build:
	@CI=true pnpm --dir frontend build

frontend-test: frontend-build
	@CI=true pnpm --dir frontend test

typescript-check: backend-typecheck sdk-typecheck frontend-build

contract-build:
	@cd contracts && FOUNDRY_DISABLE_NIGHTLY_WARNING=1 forge build

contract-test: contract-build
	@cd contracts && FOUNDRY_DISABLE_NIGHTLY_WARNING=1 forge test --offline

smoke-api:
	@sh scripts/smoke-api.sh

smoke-api-local: backend-build
	@sh scripts/smoke-api-local.sh
