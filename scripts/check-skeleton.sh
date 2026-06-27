#!/usr/bin/env sh
set -eu

test -s package.json
test -s pnpm-workspace.yaml
test -s pnpm-lock.yaml
test -s .env.example
test -s .github/workflows/backend-ci.yml
test -s .github/workflows/contract-ci.yml
test -s .github/workflows/docs-ci.yml
test -s backend/src/main.ts
test -s backend/test/api.test.mjs
test -s backend/src/modules/quote/quote.service.ts
test -s backend/src/modules/quote/quote.repository.ts
test -s backend/src/modules/execution/execution.service.ts
test -s backend/src/modules/inventory/inventory.service.ts
test -s backend/src/modules/hedge/hedge.service.ts
test -s backend/src/modules/metrics/metrics.service.ts
test -s backend/src/modules/market-data/market-data.service.ts
test -s backend/src/shared/errors/api-error.ts
test -s backend/src/modules/routing/routing.engine.ts
test -s backend/src/shared/validation/quote-request.ts
test -s backend/src/shared/validation/submit-request.ts
test -s frontend/src/lib/rfq.ts
test -s frontend/src/pages/QuotePage.tsx
test -s sdk/src/abi.ts
test -s sdk/src/eip712.ts
test -s sdk/src/index.ts
test -s sdk/src/settlement.ts
test -s sdk/test/sdk.test.mjs
test -s contracts/src/RFQSettlement.sol
test -s contracts/test/RFQSettlement.t.sol
test -s examples/quote-request.json
test -s examples/submit-request.json
test -s scripts/smoke-api.mjs
test -s infra/docker/backend.Dockerfile
test -s infra/docker/frontend.Dockerfile
test -s infra/prometheus/prometheus.yml
test -s infra/prometheus/rules/rfq-alerts.yml
test -s infra/grafana/provisioning/datasources/prometheus.yml
test -s infra/k8s/backend-deployment.yaml
test -s infra/helm/rfq-market-maker/Chart.yaml
test -s scripts/smoke-api.sh

grep -q 'server.post("/quote"' backend/src/main.ts
grep -q 'server.post("/submit"' backend/src/main.ts
grep -q 'server.get("/quote/:quoteId"' backend/src/main.ts
grep -q 'server.get("/metrics"' backend/src/main.ts
grep -q 'validateQuoteRequest' backend/src/main.ts
grep -q 'validateSubmitQuoteRequest' backend/src/main.ts
grep -q 'InMemoryQuoteRepository' backend/src/main.ts
grep -q 'new InventoryService' backend/src/main.ts
grep -q 'new HedgeService' backend/src/main.ts
grep -q 'recordSettlement' backend/src/main.ts
grep -q 'reply.code(202)' backend/src/main.ts
grep -q '"submitted"' backend/src/main.ts
grep -q '"settled"' backend/src/main.ts
grep -q 'StaticMarketDataService' backend/src/main.ts
grep -q 'InternalInventoryRoutingEngine' backend/src/main.ts
grep -q 'BasicRiskEngine' backend/src/main.ts
grep -q 'LocalEIP712SignerService' backend/src/main.ts
grep -q 'RFQ_SIGNER_PRIVATE_KEY' backend/src/main.ts
grep -q 'RFQ_SETTLEMENT_ADDRESS' backend/src/main.ts
grep -q 'HOST' backend/src/main.ts
grep -q 'getSnapshot' backend/src/modules/quote/quote.service.ts
grep -q 'selectRoute' backend/src/modules/quote/quote.service.ts
grep -q 'quoteRepository.saveRequested' backend/src/modules/quote/quote.service.ts
grep -q 'quoteRepository.saveSigned' backend/src/modules/quote/quote.service.ts
grep -q 'class InMemoryQuoteRepository' backend/src/modules/quote/quote.repository.ts
grep -q 'class BasicRiskEngine' backend/src/modules/risk/risk.engine.ts
grep -q 'CHAIN_NOT_ENABLED' backend/src/modules/risk/risk.engine.ts
grep -q 'TOKEN_NOT_ALLOWED' backend/src/modules/risk/risk.engine.ts
grep -q 'AMOUNT_IN_LIMIT_EXCEEDED' backend/src/modules/risk/risk.engine.ts
grep -q 'SLIPPAGE_TOO_WIDE' backend/src/modules/risk/risk.engine.ts
grep -q 'class LocalEIP712SignerService' backend/src/modules/signer/signer.service.ts
grep -q 'privateKeyToAccount' backend/src/modules/signer/signer.service.ts
grep -q 'ProductionGradeRFQ' backend/src/modules/signer/signer.service.ts
grep -q 'RISK_REJECTED' backend/src/modules/quote/quote.service.ts
grep -q 'getQuoteIdForSignedQuote' backend/src/modules/quote/quote.service.ts
grep -q 'applySettlement' backend/src/modules/execution/execution.service.ts
grep -q 'createHedgeIntent' backend/src/modules/execution/execution.service.ts
grep -q 'rfq_quote_errors_total' backend/src/modules/metrics/metrics.service.ts
grep -q 'rfq_settlements_total' backend/src/modules/metrics/metrics.service.ts
grep -q 'rfq_hedge_intents_total' backend/src/modules/metrics/metrics.service.ts
grep -q 'rfqClient.quote' frontend/src/pages/QuotePage.tsx
grep -q 'rfqClient.submit' frontend/src/pages/QuotePage.tsx
grep -q 'rfqClient.getQuote' frontend/src/pages/QuotePage.tsx
grep -q 'setQuoteStatus(status)' frontend/src/pages/QuotePage.tsx
grep -q 'export { RFQClient' sdk/src/index.ts
grep -q 'rfqSettlementAbi' sdk/src/index.ts
grep -q 'buildSubmitQuoteArgs' sdk/src/index.ts
grep -q 'buildQuoteTypedData' sdk/src/eip712.ts
grep -q 'ProductionGradeRFQ' sdk/src/eip712.ts
grep -q 'RFQClientError' sdk/test/sdk.test.mjs
grep -q 'buildQuoteTypedData' sdk/test/sdk.test.mjs
grep -q 'buildSubmitQuoteArgs' sdk/test/sdk.test.mjs
grep -q 'submitQuote' sdk/src/abi.ts
grep -q 'setTokenWhitelist' sdk/src/abi.ts
grep -q 'async submit' sdk/src/client.ts
grep -q 'async getQuote' sdk/src/client.ts
grep -q 'function submitQuote' contracts/src/RFQSettlement.sol
grep -q 'function setTokenWhitelist' contracts/src/RFQSettlement.sol
grep -q 'function setPaused' contracts/src/RFQSettlement.sol
grep -q 'ecrecover' contracts/src/RFQSettlement.sol
grep -q 'transferFrom' contracts/src/RFQSettlement.sol
grep -q 'testSubmitQuoteTransfersTokensAndConsumesNonce' contracts/test/RFQSettlement.t.sol
grep -q 'testSubmitQuoteRejectsReplay' contracts/test/RFQSettlement.t.sol
grep -q 'testSubmitQuoteRejectsUntrustedSigner' contracts/test/RFQSettlement.t.sol
grep -q 'contract-test' Makefile
grep -q 'backend-build' Makefile
grep -q 'backend-test' Makefile
grep -q 'forge test' .github/workflows/contract-ci.yml
grep -q 'make backend-typecheck' .github/workflows/backend-ci.yml
grep -q 'make backend-test' .github/workflows/backend-ci.yml
grep -q 'make sdk-typecheck' .github/workflows/backend-ci.yml
grep -q 'make sdk-test' .github/workflows/backend-ci.yml
grep -q 'make frontend-build' .github/workflows/backend-ci.yml
grep -q 'make docs-check' .github/workflows/docs-ci.yml
grep -q 'typescript-check' Makefile
grep -q 'allowBuilds' pnpm-workspace.yaml
grep -q 'onlyBuiltDependencies' pnpm-workspace.yaml
grep -q 'RFQ_SIGNER_PRIVATE_KEY' .env.example
grep -q 'HOST=127.0.0.1' .env.example
grep -q '"viem"' backend/package.json
grep -q '"@types/react"' frontend/package.json
grep -q 'scripts/smoke-api.mjs' scripts/smoke-api.sh
grep -q 'rfq_submit_accepted_total 1' scripts/smoke-api.mjs
grep -q 'quoteStatus.status' scripts/smoke-api.mjs
grep -q 'buildServer' backend/test/api.test.mjs
grep -q 'RISK_REJECTED' backend/test/api.test.mjs
grep -q 'rfq_quote_requests_total' infra/prometheus/rules/rfq-alerts.yml
grep -q 'kind: Deployment' infra/k8s/backend-deployment.yaml
grep -q 'name: rfq-market-maker' infra/helm/rfq-market-maker/Chart.yaml

echo "skeleton check passed"
