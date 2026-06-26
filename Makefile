.PHONY: help docs-check tree

help:
	@echo "Production-Grade Web3 RFQ Market Maker"
	@echo ""
	@echo "Available targets:"
	@echo "  docs-check  Count Mermaid diagrams and RFQ interview questions"
	@echo "  tree        Print the first three levels of repository files"

docs-check:
	@echo "Mermaid blocks:"
	@grep -R "^\`\`\`mermaid" -n book docs | wc -l
	@echo "RFQ interview questions:"
	@grep -E "^## [0-9]+\\." docs/interview/rfq-questions.md | wc -l

tree:
	@find . -maxdepth 3 -type f | sort
