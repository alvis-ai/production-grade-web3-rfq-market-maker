.PHONY: help docs-check tree workspace-check skeleton-check eip712-check api-error-check backend-build backend-test backend-typecheck sdk-test sdk-typecheck frontend-build typescript-check contract-build contract-test smoke-api smoke-api-local

help:
	@echo "Production-Grade Web3 RFQ Market Maker"
	@echo ""
	@echo "Available targets:"
	@echo "  docs-check  Count Mermaid diagrams and RFQ interview questions"
	@echo "  tree        Print the first three levels of repository files"
	@echo "  workspace-check  Verify expected workspace manifests exist"
	@echo "  skeleton-check  Verify required skeleton entrypoints exist"
	@echo "  eip712-check  Verify backend, SDK, and contract EIP-712 schemas match"
	@echo "  api-error-check  Verify backend, OpenAPI, and error docs share error codes"
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

docs-check:
	@echo "Mermaid blocks:"
	@grep -R "^\`\`\`mermaid" -n book docs | wc -l
	@echo "RFQ interview questions:"
	@grep -E "^## [0-9]+\\." docs/interview/rfq-questions.md | wc -l

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

eip712-check:
	@node scripts/check-eip712-consistency.mjs

api-error-check:
	@node scripts/check-api-error-consistency.mjs

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
