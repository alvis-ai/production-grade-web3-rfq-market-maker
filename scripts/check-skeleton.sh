#!/usr/bin/env sh
set -eu

test -s package.json
test -s pnpm-workspace.yaml
test -s backend/src/main.ts
test -s backend/src/modules/quote/quote.service.ts
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
test -s contracts/src/RFQSettlement.sol
test -s examples/quote-request.json
test -s examples/submit-request.json
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
grep -q 'StaticMarketDataService' backend/src/main.ts
grep -q 'InternalInventoryRoutingEngine' backend/src/main.ts
grep -q 'getSnapshot' backend/src/modules/quote/quote.service.ts
grep -q 'selectRoute' backend/src/modules/quote/quote.service.ts
grep -q 'RISK_REJECTED' backend/src/modules/quote/quote.service.ts
grep -q 'rfq_quote_errors_total' backend/src/modules/metrics/metrics.service.ts
grep -q 'rfqClient.quote' frontend/src/pages/QuotePage.tsx
grep -q 'rfqClient.submit' frontend/src/pages/QuotePage.tsx
grep -q 'rfqClient.getQuote' frontend/src/pages/QuotePage.tsx
grep -q 'export { RFQClient' sdk/src/index.ts
grep -q 'rfqSettlementAbi' sdk/src/index.ts
grep -q 'buildSubmitQuoteArgs' sdk/src/index.ts
grep -q 'buildQuoteTypedData' sdk/src/eip712.ts
grep -q 'submitQuote' sdk/src/abi.ts
grep -q 'async submit' sdk/src/client.ts
grep -q 'async getQuote' sdk/src/client.ts
grep -q 'function submitQuote' contracts/src/RFQSettlement.sol
grep -q 'examples/quote-request.json' scripts/smoke-api.sh
grep -q 'rfq_quote_requests_total' infra/prometheus/rules/rfq-alerts.yml
grep -q 'kind: Deployment' infra/k8s/backend-deployment.yaml
grep -q 'name: rfq-market-maker' infra/helm/rfq-market-maker/Chart.yaml

echo "skeleton check passed"
