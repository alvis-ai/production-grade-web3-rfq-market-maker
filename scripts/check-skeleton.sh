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
test -s backend/test/pnl.test.mjs
test -s backend/test/rate-limit.test.mjs
test -s backend/test/settlement-event.test.mjs
test -s backend/test/settlement-verifier.test.mjs
test -s backend/src/modules/health/readiness.service.ts
grep -q 'marketDataService: MarketDataService' backend/src/modules/health/readiness.service.ts
grep -q 'checkMarketData' backend/src/modules/health/readiness.service.ts
grep -q 'maxSnapshotAgeMs' backend/src/modules/health/readiness.service.ts
grep -q 'pnl: "ok"' backend/src/modules/health/readiness.service.ts
grep -q 'settlementEventStore: "ok"' backend/src/modules/health/readiness.service.ts
test -s backend/src/modules/quote/quote.service.ts
test -s backend/src/modules/quote/quote-identity.ts
test -s backend/src/modules/quote/quote.repository.ts
test -s backend/src/modules/execution/execution.service.ts
test -s backend/src/modules/inventory/inventory.service.ts
test -s backend/src/modules/hedge/hedge.service.ts
test -s backend/src/modules/metrics/metrics.service.ts
test -s backend/src/modules/pnl/pnl.service.ts
test -s backend/src/modules/settlement/settlement-event.service.ts
test -s backend/src/modules/settlement/settlement-verifier.service.ts
test -s backend/src/modules/market-data/market-data.service.ts
test -s backend/src/modules/rate-limit/rate-limit.service.ts
test -s backend/src/shared/errors/api-error.ts
test -s backend/src/modules/routing/routing.engine.ts
test -s backend/src/shared/validation/quote-request.ts
test -s backend/src/shared/validation/submit-request.ts
test -s frontend/src/lib/rfq.ts
test -s frontend/src/lib/errors.ts
test -s frontend/src/pages/QuotePage.tsx
test -s sdk/src/abi.ts
test -s sdk/src/eip712.ts
test -s sdk/src/index.ts
test -s sdk/src/settlement.ts
test -s sdk/test/sdk.test.mjs
test -s contracts/src/RFQSettlement.sol
test -s contracts/test/RFQSettlement.t.sol
test -s contracts/test/Deploy.t.sol
test -s examples/quote-request.json
test -s examples/submit-request.json
test -s scripts/check-eip712-consistency.mjs
test -s scripts/smoke-api.mjs
test -s scripts/smoke-api-local.sh
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
grep -q 'server.get("/settlements/:settlementEventId"' backend/src/main.ts
grep -q 'server.get("/hedges/:hedgeOrderId"' backend/src/main.ts
grep -q 'server.get("/pnl"' backend/src/main.ts
grep -q 'server.get("/ready"' backend/src/main.ts
grep -q 'readiness.status === "degraded"' backend/src/main.ts
grep -q 'server.get("/metrics"' backend/src/main.ts
grep -q 'validateQuoteRequest' backend/src/main.ts
grep -q 'validateSubmitQuoteRequest' backend/src/main.ts
grep -q 'InMemoryRateLimiter' backend/src/main.ts
grep -q 'RATE_LIMITED' backend/src/main.ts
grep -q 'retry-after' backend/src/main.ts
grep -q 'signature must be 65 bytes' backend/src/shared/validation/submit-request.ts
grep -q 'readPositiveUint' backend/src/shared/validation/submit-request.ts
grep -q 'greater than or equal to quote.minAmountOut' backend/src/shared/validation/submit-request.ts
grep -q 'QUOTE_EXPIRED' backend/src/shared/validation/submit-request.ts
grep -q 'InMemoryQuoteRepository' backend/src/main.ts
grep -q 'new InventoryService' backend/src/main.ts
grep -q 'new HedgeService' backend/src/main.ts
grep -q 'recordSettlement' backend/src/main.ts
grep -q 'recordInventoryPosition' backend/src/main.ts
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
grep -q 'x-trace-id' backend/src/main.ts
grep -q 'requestTraceId' backend/src/main.ts
grep -q 'traceId: string' backend/src/shared/errors/api-error.ts
grep -q 'HEDGE_NOT_FOUND' backend/src/shared/errors/api-error.ts
grep -q 'SETTLEMENT_EVENT_NOT_FOUND' backend/src/shared/errors/api-error.ts
grep -q 'getSnapshot' backend/src/modules/quote/quote.service.ts
grep -q 'assertFreshSnapshot' backend/src/modules/quote/quote.service.ts
grep -q 'maxSnapshotAgeMs' backend/src/modules/quote/quote.service.ts
grep -q 'MARKET_DATA_UNAVAILABLE' backend/src/modules/quote/quote.service.ts
grep -q 'selectRoute' backend/src/modules/quote/quote.service.ts
grep -q 'quoteRepository.saveRequested' backend/src/modules/quote/quote.service.ts
grep -q 'quoteRepository.saveSigned' backend/src/modules/quote/quote.service.ts
grep -q 'class QuoteIdentityGenerator' backend/src/modules/quote/quote-identity.ts
grep -q 'randomUint64' backend/src/modules/quote/quote-identity.ts
grep -q 'class InMemoryQuoteRepository' backend/src/modules/quote/quote.repository.ts
grep -q 'class BasicRiskEngine' backend/src/modules/risk/risk.engine.ts
grep -q 'class InMemoryRateLimiter' backend/src/modules/rate-limit/rate-limit.service.ts
grep -q 'maxQuoteRequests' backend/src/modules/rate-limit/rate-limit.service.ts
grep -q 'maxSubmitRequests' backend/src/modules/rate-limit/rate-limit.service.ts
grep -q 'maxStatusRequests' backend/src/modules/rate-limit/rate-limit.service.ts
grep -q 'CHAIN_NOT_ENABLED' backend/src/modules/risk/risk.engine.ts
grep -q 'TOKEN_NOT_ALLOWED' backend/src/modules/risk/risk.engine.ts
grep -q 'AMOUNT_IN_LIMIT_EXCEEDED' backend/src/modules/risk/risk.engine.ts
grep -q 'SLIPPAGE_TOO_WIDE' backend/src/modules/risk/risk.engine.ts
grep -q 'TOXIC_FLOW_RESTRICTED_USER' backend/src/modules/risk/risk.engine.ts
grep -q 'TOXIC_FLOW_SCORE_EXCEEDED' backend/src/modules/risk/risk.engine.ts
grep -q 'toxicFlowScores' backend/src/modules/risk/risk.engine.ts
grep -q 'restrictedUsers' backend/src/modules/risk/risk.engine.ts
grep -q 'class LocalEIP712SignerService' backend/src/modules/signer/signer.service.ts
grep -q 'privateKeyToAccount' backend/src/modules/signer/signer.service.ts
grep -q 'ProductionGradeRFQ' backend/src/modules/signer/signer.service.ts
grep -q 'RISK_REJECTED' backend/src/modules/quote/quote.service.ts
grep -q 'requireSubmittableSignedQuote' backend/src/modules/quote/quote.service.ts
grep -q 'findSignedQuoteByUserNonce' backend/src/modules/quote/quote.repository.ts
grep -q 'applySettlement' backend/src/modules/execution/execution.service.ts
grep -q 'applySettlementEvent' backend/src/modules/execution/execution.service.ts
grep -q 'settlementVerifier.verify' backend/src/modules/execution/execution.service.ts
grep -q 'class SettlementEventService' backend/src/modules/settlement/settlement-event.service.ts
grep -q 'getSettlementEvent' backend/src/modules/settlement/settlement-event.service.ts
grep -q 'eventKey' backend/src/modules/settlement/settlement-event.service.ts
grep -q 'class LocalSettlementVerifier' backend/src/modules/settlement/settlement-verifier.service.ts
grep -q 'TOKEN_NOT_WHITELISTED' backend/src/modules/settlement/settlement-verifier.service.ts
grep -q 'SETTLEMENT_REVERTED' backend/src/modules/settlement/settlement-verifier.service.ts
grep -q 'createHedgeIntent' backend/src/modules/execution/execution.service.ts
grep -q 'hedgeOrderId: hedgeResult.hedgeOrderId' backend/src/modules/execution/execution.service.ts
grep -q 'getHedgeIntent' backend/src/modules/hedge/hedge.service.ts
grep -q 'class PnlService' backend/src/modules/pnl/pnl.service.ts
grep -q 'recordSettlement' backend/src/modules/pnl/pnl.service.ts
grep -q 'simulated_mid_price_v1' backend/src/modules/pnl/pnl.service.ts
grep -q 'rfq_quote_errors_total' backend/src/modules/metrics/metrics.service.ts
grep -q 'rfq_quote_latency_seconds' backend/src/modules/metrics/metrics.service.ts
grep -q 'rfq_quote_rejections_total' backend/src/modules/metrics/metrics.service.ts
grep -q 'rfq_submit_latency_seconds' backend/src/modules/metrics/metrics.service.ts
grep -q 'recordQuoteLatency' backend/src/main.ts
grep -q 'recordQuoteRejection' backend/src/main.ts
grep -q 'recordSubmitLatency' backend/src/main.ts
grep -q 'rfq_settlements_total' backend/src/modules/metrics/metrics.service.ts
grep -q 'rfq_hedge_intents_total' backend/src/modules/metrics/metrics.service.ts
grep -q 'rfq_inventory_balance' backend/src/modules/metrics/metrics.service.ts
grep -q 'rfq_pnl_trades_total' backend/src/modules/metrics/metrics.service.ts
grep -q 'rfq_realized_pnl_token_out' backend/src/modules/metrics/metrics.service.ts
grep -q 'rfqClient.quote' frontend/src/pages/QuotePage.tsx
grep -q 'rfqClient.submit' frontend/src/pages/QuotePage.tsx
grep -q 'rfqClient.getQuote' frontend/src/pages/QuotePage.tsx
grep -q 'RFQClientError' frontend/src/lib/errors.ts
grep -q 'traceId' frontend/src/lib/errors.ts
grep -q 'toUIError' frontend/src/pages/QuotePage.tsx
grep -q 'setQuoteStatus(status)' frontend/src/pages/QuotePage.tsx
grep -q 'rfqClient.getSettlement' frontend/src/pages/QuotePage.tsx
grep -q 'rfqClient.getHedge' frontend/src/pages/QuotePage.tsx
grep -q 'rfqClient.pnl' frontend/src/pages/QuotePage.tsx
grep -q 'Hedge Status' frontend/src/components/QuoteStatusPanel.tsx
grep -q 'Settlement Status' frontend/src/components/QuoteStatusPanel.tsx
grep -q 'Realized PnL' frontend/src/components/QuoteStatusPanel.tsx
grep -q 'role="alert"' frontend/src/components/QuoteStatusPanel.tsx
grep -q 'error-box' frontend/src/app/styles.css
grep -q 'export { RFQClient' sdk/src/index.ts
grep -q 'rfqSettlementAbi' sdk/src/index.ts
grep -q 'buildSubmitQuoteArgs' sdk/src/index.ts
grep -q 'buildQuoteTypedData' sdk/src/eip712.ts
grep -q 'ProductionGradeRFQ' sdk/src/eip712.ts
grep -q 'RFQClientError' sdk/test/sdk.test.mjs
grep -q 'buildQuoteTypedData' sdk/test/sdk.test.mjs
grep -q 'buildSubmitQuoteArgs' sdk/test/sdk.test.mjs
grep -q 'recoverTypedDataAddress' sdk/test/sdk.test.mjs
grep -q 'verifyTypedData' sdk/test/sdk.test.mjs
grep -q 'submitQuote' sdk/src/abi.ts
grep -q 'setTokenWhitelist' sdk/src/abi.ts
grep -q 'async submit' sdk/src/client.ts
grep -q 'async getQuote' sdk/src/client.ts
grep -q 'async getSettlement' sdk/src/client.ts
grep -q 'async getHedge' sdk/src/client.ts
grep -q 'async pnl' sdk/src/client.ts
grep -q 'async health' sdk/src/client.ts
grep -q 'async ready' sdk/src/client.ts
grep -q 'isReadinessResponse' sdk/src/client.ts
grep -q 'async metrics' sdk/src/client.ts
grep -q 'traceId: string' sdk/src/types.ts
grep -q 'client.health' sdk/test/sdk.test.mjs
grep -q 'client.getSettlement' sdk/test/sdk.test.mjs
grep -q 'client.getHedge' sdk/test/sdk.test.mjs
grep -q 'client.pnl' sdk/test/sdk.test.mjs
grep -q 'client.ready' sdk/test/sdk.test.mjs
grep -q 'degraded readiness payloads' sdk/test/sdk.test.mjs
grep -q 'client.metrics' sdk/test/sdk.test.mjs
grep -q 'function submitQuote' contracts/src/RFQSettlement.sol
grep -q 'function setTokenWhitelist' contracts/src/RFQSettlement.sol
grep -q 'function setPaused' contracts/src/RFQSettlement.sol
grep -q 'ecrecover' contracts/src/RFQSettlement.sol
grep -q 'transferFrom' contracts/src/RFQSettlement.sol
grep -q 'testSubmitQuoteTransfersTokensAndConsumesNonce' contracts/test/RFQSettlement.t.sol
grep -q 'testSubmitQuoteRejectsReplay' contracts/test/RFQSettlement.t.sol
grep -q 'testSubmitQuoteRejectsUntrustedSigner' contracts/test/RFQSettlement.t.sol
grep -q 'testSubmitQuoteRejectsExpiredQuote' contracts/test/RFQSettlement.t.sol
grep -q 'testSubmitQuoteRejectsWrongChainId' contracts/test/RFQSettlement.t.sol
grep -q 'testSubmitQuoteRejectsUnwhitelistedToken' contracts/test/RFQSettlement.t.sol
grep -q 'testSubmitQuoteRejectsAmountOutBelowMinimum' contracts/test/RFQSettlement.t.sol
grep -q 'contract DeployRFQSettlement' contracts/script/Deploy.s.sol
grep -q 'RFQ_TRUSTED_SIGNER' contracts/script/Deploy.s.sol
grep -q 'RFQ_TOKEN_WHITELIST_JSON' contracts/script/Deploy.s.sol
grep -q 'testDeployInitializesTrustedSignerAndWhitelist' contracts/test/Deploy.t.sol
grep -q 'contract-test' Makefile
grep -q 'backend-build' Makefile
grep -q 'backend-test' Makefile
grep -q 'eip712-check' Makefile
grep -q 'smoke-api-local' Makefile
grep -q 'forge test' .github/workflows/contract-ci.yml
grep -q 'make backend-typecheck' .github/workflows/backend-ci.yml
grep -q 'make backend-test' .github/workflows/backend-ci.yml
grep -q 'make eip712-check' .github/workflows/backend-ci.yml
grep -q 'make sdk-typecheck' .github/workflows/backend-ci.yml
grep -q 'make sdk-test' .github/workflows/backend-ci.yml
grep -q 'make frontend-build' .github/workflows/backend-ci.yml
grep -q 'make smoke-api-local' .github/workflows/backend-ci.yml
grep -q 'make docs-check' .github/workflows/docs-ci.yml
grep -q 'QUOTE_TYPEHASH' scripts/check-eip712-consistency.mjs
grep -q 'backend signer Quote fields must match SDK Quote fields' scripts/check-eip712-consistency.mjs
grep -q 'typescript-check' Makefile
grep -q '65-byte EIP-712 signature' docs/api/openapi.yaml
grep -q 'amountOut must be greater than or equal to minAmountOut' docs/api/openapi.yaml
grep -q 'Signed quote not found' docs/api/openapi.yaml
grep -q 'settlement verification' docs/api/openapi.yaml
grep -q 'Market data snapshot used for the quote' docs/api/openapi.yaml
grep -q 'stale' docs/api/openapi.yaml
grep -q 'getReadiness' docs/api/openapi.yaml
grep -q 'ReadinessResponse' docs/api/openapi.yaml
grep -q 'not ready because at least one quote dependency is degraded' docs/api/openapi.yaml
grep -q 'getHedgeIntent' docs/api/openapi.yaml
grep -q 'HedgeIntentStatus' docs/api/openapi.yaml
grep -q 'HEDGE_NOT_FOUND' docs/api/openapi.yaml
grep -q 'getSettlementEvent' docs/api/openapi.yaml
grep -q 'SettlementEventStatus' docs/api/openapi.yaml
grep -q 'SETTLEMENT_EVENT_NOT_FOUND' docs/api/openapi.yaml
grep -q 'getPnlSummary' docs/api/openapi.yaml
grep -q 'PnlSummary' docs/api/openapi.yaml
grep -q 'PnlTradeRecord' docs/api/openapi.yaml
grep -q 'IntString' docs/api/openapi.yaml
grep -q 'Internal rejection reason for rejected quote records' docs/api/openapi.yaml
grep -q 'QUOTE_ALREADY_USED' docs/api/openapi.yaml
grep -q 'pattern: "^tr_.+"' docs/api/openapi.yaml
grep -q 'allowBuilds' pnpm-workspace.yaml
grep -q 'onlyBuiltDependencies' pnpm-workspace.yaml
grep -q 'RFQ_SIGNER_PRIVATE_KEY' .env.example
grep -q 'HOST=127.0.0.1' .env.example
grep -q '"viem"' backend/package.json
grep -q '"@types/react"' frontend/package.json
grep -q 'scripts/smoke-api.mjs' scripts/smoke-api.sh
grep -q 'scripts/smoke-api.mjs' scripts/smoke-api-local.sh
grep -q '/health' scripts/smoke-api.mjs
grep -q '/ready' scripts/smoke-api-local.sh
grep -q 'readiness status' scripts/smoke-api.mjs
grep -q 'settlement status' scripts/smoke-api.mjs
grep -q 'hedge status' scripts/smoke-api.mjs
grep -q 'pnl status' scripts/smoke-api.mjs
grep -q 'rfq_pnl_trades_total 1' scripts/smoke-api.mjs
grep -q 'rfq_realized_pnl_token_out' scripts/smoke-api.mjs
grep -q 'rfq_submit_accepted_total 1' scripts/smoke-api.mjs
grep -q 'QUOTE_ALREADY_USED' scripts/smoke-api.mjs
grep -q 'rfq_submit_errors_total 1' scripts/smoke-api.mjs
grep -q 'rfq_quote_latency_seconds_count 1' scripts/smoke-api.mjs
grep -q 'rfq_submit_latency_seconds_count 2' scripts/smoke-api.mjs
grep -q 'rfq_inventory_balance' scripts/smoke-api.mjs
grep -q 'rfq_inventory_balance' backend/test/api.test.mjs
grep -q 'quoteStatus.status' scripts/smoke-api.mjs
grep -q 'buildServer' backend/test/api.test.mjs
grep -q 'settlement constraints before simulated settlement' backend/test/api.test.mjs
grep -q 'LocalSettlementVerifier accepts contract-shaped settlement quotes' backend/test/settlement-verifier.test.mjs
grep -q 'RISK_REJECTED' backend/test/api.test.mjs
grep -q 'SLIPPAGE_TOO_WIDE' backend/test/api.test.mjs
grep -q 'stale market data' backend/test/api.test.mjs
grep -q 'degrades readiness when market data is stale' backend/test/api.test.mjs
grep -q 'toxic-flow users' backend/test/api.test.mjs
grep -q 'TOXIC_FLOW_SCORE_EXCEEDED' backend/test/api.test.mjs
grep -q 'TOKEN_IN_INVENTORY_LIMIT_EXCEEDED' backend/test/api.test.mjs
grep -q 'trace ids' backend/test/api.test.mjs
grep -q 'settlement shape' backend/test/api.test.mjs
grep -q 'expired submit quotes' backend/test/api.test.mjs
grep -q 'unissued submit quotes' backend/test/api.test.mjs
grep -q 'replayed submit quotes' backend/test/api.test.mjs
grep -q 'same millisecond' backend/test/api.test.mjs
grep -q 'rate limits quote requests by client' backend/test/api.test.mjs
grep -q 'rate limits submit requests before validation and settlement' backend/test/api.test.mjs
grep -q 'rate limits quote status requests by client' backend/test/api.test.mjs
grep -q 'signed realized PnL' backend/test/pnl.test.mjs
grep -q 'applies each chain event idempotently' backend/test/settlement-event.test.mjs
grep -q 'InMemoryRateLimiter enforces endpoint-specific windows' backend/test/rate-limit.test.mjs
grep -q 'restricted toxic-flow users' backend/test/risk.test.mjs
grep -q 'toxic-flow score threshold' backend/test/risk.test.mjs
grep -q 'rfq_quote_requests_total' infra/prometheus/rules/rfq-alerts.yml
grep -q 'RFQQuoteLatencyP95High' infra/prometheus/rules/rfq-alerts.yml
grep -q 'RFQQuoteRiskRejectSpike' infra/prometheus/rules/rfq-alerts.yml
grep -q 'kind: Deployment' infra/k8s/backend-deployment.yaml
grep -q 'path: /ready' infra/k8s/backend-deployment.yaml
grep -q 'path: /ready' infra/helm/rfq-market-maker/templates/deployment.yaml
grep -q 'name: rfq-market-maker' infra/helm/rfq-market-maker/Chart.yaml

echo "skeleton check passed"
