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
test -s frontend/src/lib/rfq.ts
test -s frontend/src/pages/QuotePage.tsx
test -s sdk/src/eip712.ts
test -s sdk/src/index.ts
test -s contracts/src/RFQSettlement.sol
test -s infra/docker/backend.Dockerfile
test -s infra/docker/frontend.Dockerfile
test -s infra/prometheus/prometheus.yml
test -s infra/prometheus/rules/rfq-alerts.yml
test -s infra/grafana/provisioning/datasources/prometheus.yml
test -s infra/k8s/backend-deployment.yaml
test -s infra/helm/rfq-market-maker/Chart.yaml

grep -q 'server.post("/quote"' backend/src/main.ts
grep -q 'server.post("/submit"' backend/src/main.ts
grep -q 'server.get("/quote/:quoteId"' backend/src/main.ts
grep -q 'server.get("/metrics"' backend/src/main.ts
grep -q 'rfqClient.quote' frontend/src/pages/QuotePage.tsx
grep -q 'rfqClient.submit' frontend/src/pages/QuotePage.tsx
grep -q 'rfqClient.getQuote' frontend/src/pages/QuotePage.tsx
grep -q 'export { RFQClient' sdk/src/index.ts
grep -q 'buildQuoteTypedData' sdk/src/eip712.ts
grep -q 'async submit' sdk/src/client.ts
grep -q 'async getQuote' sdk/src/client.ts
grep -q 'function submitQuote' contracts/src/RFQSettlement.sol
grep -q 'rfq_quote_requests_total' infra/prometheus/rules/rfq-alerts.yml
grep -q 'kind: Deployment' infra/k8s/backend-deployment.yaml
grep -q 'name: rfq-market-maker' infra/helm/rfq-market-maker/Chart.yaml

echo "skeleton check passed"
