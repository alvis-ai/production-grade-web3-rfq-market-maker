.PHONY: help verify docs-check book-template-check adr-check security-check transport-security-check logging-check metrics-check runbook-check grafana-check deployment-check container-runtime-check ci-check tree workspace-check skeleton-check examples-check config-check compose-check cex-orderbook-check hedge-planning-check hedge-execution-check chainlink-canary-check binance-testnet-check aws-kms-canary-check target-api-quote-check target-settlement-check price-normalization-check risk-policy-check pnl-valuation-check kms-signer-check settlement-indexer-check submit-reservation-check api-composition-check sdk-composition-check api-auth-check eip712-check contract-abi-check contract-deployment-check rate-limit-check api-error-check api-schema-check api-route-check database-schema-check reconciliation-check reconciliation-integration-check hedge-net-pnl-integration-check analytics-integration-check cex-orderbook-integration-check chainlink-integration-check binance-testnet-integration-check aws-kms-integration-check target-api-quote-integration-check target-settlement-integration-check contract-deployment-integration-check settlement-e2e benchmark-quote benchmark-submit backend-build backend-test backend-typecheck sdk-build sdk-test sdk-typecheck frontend-build frontend-test frontend-e2e typescript-check contract-build contract-test smoke-api smoke-api-local db-migrate

help:
	@echo "Production-Grade Web3 RFQ Market Maker"
	@echo ""
	@echo "Available targets:"
	@echo "  verify      Run the repository quality gate"
	@echo "  docs-check  Count Mermaid diagrams and RFQ interview questions"
	@echo "  book-template-check  Verify book chapters follow the standard template"
	@echo "  adr-check  Verify ADR numbering and template consistency"
	@echo "  security-check  Verify security docs cover required production controls"
	@echo "  transport-security-check  Verify production dependency TLS across runtime and deployment"
	@echo "  logging-check  Verify structured logging, redaction, trace correlation, and deployment config"
	@echo "  metrics-check  Verify backend metrics, alert rules, and monitoring docs match"
	@echo "  runbook-check  Verify alert rules have actionable runbook coverage"
	@echo "  grafana-check  Verify Grafana dashboards cover backend metrics"
	@echo "  deployment-check  Verify Kubernetes and Helm deployment manifests"
	@echo "  container-runtime-check  Build and probe restricted application images"
	@echo "  ci-check  Verify GitHub Actions workflow coverage"
	@echo "  tree        Print the first three levels of repository files"
	@echo "  workspace-check  Verify expected workspace manifests exist"
	@echo "  skeleton-check  Verify required skeleton entrypoints exist"
	@echo "  examples-check  Verify example API payloads match public schemas"
	@echo "  config-check  Verify local and deployment configuration defaults match"
	@echo "  compose-check  Verify Docker Compose configuration"
	@echo "  cex-orderbook-check  Verify CEX freshness, quorum, metrics, and deployment controls"
	@echo "  hedge-planning-check Verify USD-reference hedge direction across runtime, repair, and deployment"
	@echo "  hedge-execution-check Verify route decimals and quantized terminal fill integrity"
	@echo "  price-normalization-check  Verify token decimals and USD-notional pricing controls"
	@echo "  risk-policy-check  Verify chain-scoped token limits and runtime policy controls"
	@echo "  pnl-valuation-check Verify snapshot-bound cross-decimal PnL controls"
	@echo "  kms-signer-check Verify production KMS signer and workload-identity controls"
	@echo "  settlement-indexer-check Verify durable chain cursor and reorg recovery controls"
	@echo "  submit-reservation-check Verify cross-replica submit ownership controls"
	@echo "  api-composition-check Verify gateway composition-root responsibility boundaries"
	@echo "  sdk-composition-check Verify SDK client responsibility boundaries"
	@echo "  api-auth-check Verify scoped API-key auth across backend, SDK, docs, and deployment"
	@echo "  eip712-check  Verify backend, SDK, and contract EIP-712 schemas match"
	@echo "  contract-abi-check  Verify SDK contract ABIs match Solidity integration surfaces"
	@echo "  rate-limit-check  Verify API rate limit defaults and HTTP contract"
	@echo "  api-error-check  Verify backend, OpenAPI, and error docs share error codes"
	@echo "  api-schema-check  Verify backend, SDK, and OpenAPI schemas match"
	@echo "  api-route-check  Verify backend, SDK, OpenAPI, and smoke routes match"
	@echo "  database-schema-check  Verify database schema matches API state surfaces"
	@echo "  reconciliation-check  Verify settlement-to-quote and settlement-to-PnL repair flows"
	@echo "  reconciliation-integration-check  Verify durable repair and reorg replacement against PostgreSQL"
	@echo "  analytics-integration-check  Verify PostgreSQL -> Redpanda -> ClickHouse against running dependencies"
	@echo "  cex-orderbook-integration-check  Verify the live Binance + Coinbase Level-2 quorum"
	@echo "  chainlink-integration-check  Read and verify one configured target Chainlink feed"
	@echo "  chainlink-canary-check  Test the Chainlink target canary without contacting an RPC"
	@echo "  binance-testnet-integration-check  Place and cancel one non-marketable Binance Spot Testnet order"
	@echo "  binance-testnet-check  Test the Binance Spot Testnet canary with protocol fixtures"
	@echo "  aws-kms-integration-check  Sign and recover one synthetic quote with the target AWS KMS key"
	@echo "  aws-kms-canary-check  Test the AWS KMS canary without contacting AWS"
	@echo "  target-api-quote-integration-check  Request and verify one signed quote from the target API"
	@echo "  target-api-quote-check  Test the target API quote canary without contacting a target API"
	@echo "  target-settlement-integration-check  Broadcast and verify one bounded staging/testnet settlement"
	@echo "  target-settlement-check  Test the target settlement canary without broadcasting"
	@echo "  contract-deployment-integration-check  Verify one live-chain RFQ contract deployment"
	@echo "  contract-deployment-check  Test target-chain deployment verification with protocol fixtures"
	@echo "  settlement-e2e  Verify quote-to-receipt settlement against a temporary Anvil chain"
	@echo "  benchmark-quote  Run a local POST /quote latency benchmark"
	@echo "  benchmark-submit Run a local POST /submit latency benchmark"
	@echo "  backend-build  Build backend package"
	@echo "  backend-test  Run backend API tests"
	@echo "  backend-typecheck  Typecheck backend package"
	@echo "  sdk-test  Run SDK unit tests"
	@echo "  sdk-typecheck  Typecheck SDK package"
	@echo "  frontend-build  Build frontend package"
	@echo "  frontend-test   Run frontend validation tests"
	@echo "  frontend-e2e    Run the browser RFQ flow against a local backend"
	@echo "  typescript-check  Run backend, SDK, and frontend checks"
	@echo "  contract-build  Build Foundry contracts"
	@echo "  contract-test   Run Foundry contract tests offline"
	@echo "  smoke-api       Exercise health, quote, submit, and metrics endpoints"
	@echo "  smoke-api-local Build, start backend locally, run smoke-api, and stop backend"
	@echo "  db-migrate      Run pending database migrations"

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

transport-security-check:
	@node scripts/check-transport-security-consistency.mjs

logging-check:
	@node scripts/check-logging-consistency.mjs

metrics-check:
	@node scripts/check-metrics-consistency.mjs

runbook-check:
	@node scripts/check-runbook-consistency.mjs

grafana-check:
	@node scripts/check-grafana-dashboard-consistency.mjs

deployment-check:
	@node scripts/check-deployment-manifests-consistency.mjs

container-runtime-check:
	@docker build --file infra/docker/backend.Dockerfile --tag rfq-backend-rootless:check .
	@docker build --file infra/docker/frontend.Dockerfile --tag rfq-frontend-rootless:check .
	@BACKEND_IMAGE_REF=rfq-backend-rootless:check FRONTEND_IMAGE_REF=rfq-frontend-rootless:check sh scripts/container-runtime-check.sh

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

cex-orderbook-check:
	@node scripts/check-cex-orderbook-consistency.mjs

hedge-planning-check:
	@node scripts/check-hedge-planning-consistency.mjs

hedge-execution-check:
	@node scripts/check-hedge-execution-consistency.mjs

price-normalization-check:
	@node scripts/check-price-normalization-consistency.mjs

risk-policy-check:
	@node scripts/check-risk-policy-consistency.mjs

pnl-valuation-check:
	@node scripts/check-pnl-valuation-consistency.mjs

kms-signer-check:
	@node scripts/check-kms-signer-consistency.mjs

settlement-indexer-check:
	@node scripts/check-settlement-indexer-consistency.mjs

submit-reservation-check:
	@node scripts/check-submit-reservation-consistency.mjs

api-composition-check:
	@node scripts/check-api-composition-consistency.mjs

sdk-composition-check:
	@node scripts/check-sdk-composition-consistency.mjs

api-auth-check:
	@node scripts/check-api-auth-consistency.mjs

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

reconciliation-integration-check: backend-build
	@node scripts/reconciliation-integration-check.mjs

hedge-net-pnl-integration-check: backend-build
	@node scripts/hedge-net-pnl-integration-check.mjs

analytics-integration-check: backend-build
	@node scripts/analytics-integration-check.mjs

cex-orderbook-integration-check: backend-build
	@node scripts/cex-orderbook-integration-check.mjs

chainlink-integration-check: backend-build
	@node scripts/chainlink-integration-check.mjs

chainlink-canary-check: backend-build
	@node --test scripts/chainlink-integration-check.test.mjs

binance-testnet-integration-check: backend-build
	@node scripts/binance-testnet-integration-check.mjs

binance-testnet-check: backend-build
	@node --test scripts/binance-testnet-integration-check.test.mjs

aws-kms-integration-check: backend-build
	@node scripts/aws-kms-integration-check.mjs

aws-kms-canary-check: backend-build
	@node --test scripts/aws-kms-integration-check.test.mjs

target-api-quote-integration-check: sdk-build
	@node scripts/target-api-quote-integration-check.mjs

target-api-quote-check: sdk-build
	@node --test scripts/target-api-quote-integration-check.test.mjs

target-settlement-integration-check: sdk-build
	@node scripts/target-settlement-integration-check.mjs

target-settlement-check: sdk-build
	@node --test scripts/target-settlement-integration-check.test.mjs

contract-deployment-integration-check: backend-build contract-build
	@node scripts/contract-deployment-integration-check.mjs

contract-deployment-check: backend-build contract-build
	@node --test scripts/contract-deployment-integration-check.test.mjs

settlement-e2e: backend-build contract-build
	@sh scripts/settlement-e2e.sh

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

sdk-build:
	@CI=true pnpm --dir sdk build

sdk-test:
	@CI=true pnpm --dir sdk test

frontend-build:
	@CI=true pnpm --dir frontend build

frontend-test: frontend-build
	@CI=true pnpm --dir frontend test

frontend-e2e: backend-build
	@pnpm --dir frontend e2e

typescript-check: backend-typecheck sdk-typecheck frontend-build

contract-build:
	@cd contracts && FOUNDRY_DISABLE_NIGHTLY_WARNING=1 forge build

contract-test: contract-build
	@cd contracts && FOUNDRY_DISABLE_NIGHTLY_WARNING=1 forge test --offline

smoke-api:
	@sh scripts/smoke-api.sh

smoke-api-local: backend-build
	@sh scripts/smoke-api-local.sh

db-migrate: backend-build
	@node backend/dist/db/migrate.js
