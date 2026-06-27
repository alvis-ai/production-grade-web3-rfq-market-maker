.PHONY: help docs-check tree workspace-check skeleton-check backend-typecheck sdk-typecheck frontend-build typescript-check contract-build contract-test smoke-api

help:
	@echo "Production-Grade Web3 RFQ Market Maker"
	@echo ""
	@echo "Available targets:"
	@echo "  docs-check  Count Mermaid diagrams and RFQ interview questions"
	@echo "  tree        Print the first three levels of repository files"
	@echo "  workspace-check  Verify expected workspace manifests exist"
	@echo "  skeleton-check  Verify required skeleton entrypoints exist"
	@echo "  backend-typecheck  Typecheck backend package"
	@echo "  sdk-typecheck  Typecheck SDK package"
	@echo "  frontend-build  Build frontend package"
	@echo "  typescript-check  Run backend, SDK, and frontend checks"
	@echo "  contract-build  Build Foundry contracts"
	@echo "  contract-test   Run Foundry contract tests offline"
	@echo "  smoke-api       Exercise health, quote, submit, and metrics endpoints"

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

backend-typecheck:
	@CI=true pnpm --dir backend typecheck

sdk-typecheck:
	@CI=true pnpm --dir sdk typecheck

frontend-build:
	@CI=true pnpm --dir frontend build

typescript-check: backend-typecheck sdk-typecheck frontend-build

contract-build:
	@cd contracts && forge build

contract-test: contract-build
	@cd contracts && forge test --offline

smoke-api:
	@sh scripts/smoke-api.sh
