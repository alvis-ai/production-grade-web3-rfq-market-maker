.PHONY: help docs-check tree workspace-check skeleton-check smoke-api

help:
	@echo "Production-Grade Web3 RFQ Market Maker"
	@echo ""
	@echo "Available targets:"
	@echo "  docs-check  Count Mermaid diagrams and RFQ interview questions"
	@echo "  tree        Print the first three levels of repository files"
	@echo "  workspace-check  Verify expected workspace manifests exist"
	@echo "  skeleton-check  Verify required skeleton entrypoints exist"
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

smoke-api:
	@sh scripts/smoke-api.sh
