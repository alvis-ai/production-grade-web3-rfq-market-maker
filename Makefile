.PHONY: help verify docs-check book-template-check tree workspace-check skeleton-check examples-check config-check compose-check eip712-check contract-abi-check api-error-check api-schema-check api-route-check database-schema-check backend-build backend-test backend-typecheck sdk-test sdk-typecheck frontend-build typescript-check contract-build contract-test smoke-api smoke-api-local

help:
	@echo "Production-Grade Web3 RFQ Market Maker"
	@echo ""
	@echo "Available targets:"
	@echo "  verify      Run the repository quality gate"
	@echo "  docs-check  Count Mermaid diagrams and RFQ interview questions"
	@echo "  book-template-check  Verify book chapters follow the standard template"
	@echo "  tree        Print the first three levels of repository files"
	@echo "  workspace-check  Verify expected workspace manifests exist"
	@echo "  skeleton-check  Verify required skeleton entrypoints exist"
	@echo "  examples-check  Verify example API payloads match public schemas"
	@echo "  config-check  Verify local and deployment configuration defaults match"
	@echo "  compose-check  Verify Docker Compose configuration"
	@echo "  eip712-check  Verify backend, SDK, and contract EIP-712 schemas match"
	@echo "  contract-abi-check  Verify SDK contract ABIs match Solidity integration surfaces"
	@echo "  api-error-check  Verify backend, OpenAPI, and error docs share error codes"
	@echo "  api-schema-check  Verify backend, SDK, and OpenAPI schemas match"
	@echo "  api-route-check  Verify backend, SDK, OpenAPI, and smoke routes match"
	@echo "  database-schema-check  Verify database schema matches API state surfaces"
	@echo "  backend-build  Build backend package"
	@echo "  backend-test  Run backend API tests"
	@echo "  backend-typecheck  Typecheck backend package"
	@echo "  sdk-test  Run SDK unit tests"
	@echo "  sdk-typecheck  Typecheck SDK package"
	@echo "  frontend-build  Build frontend package"
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

api-error-check:
	@node scripts/check-api-error-consistency.mjs

api-schema-check:
	@node scripts/check-api-schema-consistency.mjs

api-route-check:
	@node scripts/check-api-route-consistency.mjs

database-schema-check:
	@node scripts/check-database-schema-consistency.mjs

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

typescript-check: backend-typecheck sdk-typecheck frontend-build

contract-build:
	@cd contracts && forge build

contract-test: contract-build
	@cd contracts && forge test --offline

smoke-api:
	@sh scripts/smoke-api.sh

smoke-api-local: backend-build
	@sh scripts/smoke-api-local.sh
