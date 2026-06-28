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
test -s backend/test/quote-service.test.mjs
test -s backend/test/pnl.test.mjs
test -s backend/test/rate-limit.test.mjs
test -s backend/test/settlement-event.test.mjs
test -s backend/test/settlement-verifier.test.mjs
test -s backend/src/modules/health/readiness.service.ts
grep -q 'marketDataService: MarketDataService' backend/src/modules/health/readiness.service.ts
grep -q 'signerService: SignerService' backend/src/modules/health/readiness.service.ts
grep -q 'checkMarketData' backend/src/modules/health/readiness.service.ts
grep -q 'checkSigner' backend/src/modules/health/readiness.service.ts
grep -q 'maxSnapshotAgeMs' backend/src/modules/health/readiness.service.ts
grep -q 'readiness_probe' backend/src/modules/health/readiness.service.ts
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
grep -q 'getMarketSnapshotIssue' backend/src/modules/market-data/market-data.service.ts
grep -q 'mid price is invalid' backend/src/modules/market-data/market-data.service.ts
grep -q 'liquidity is invalid' backend/src/modules/market-data/market-data.service.ts
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
test -s scripts/check-api-error-consistency.mjs
test -s scripts/smoke-api.mjs
test -s scripts/smoke-api-local.sh
test -s infra/docker/backend.Dockerfile
test -s infra/docker/frontend.Dockerfile
grep -q 'ENV HOST=0.0.0.0' infra/docker/backend.Dockerfile
grep -q 'ENV PORT=3000' infra/docker/backend.Dockerfile
grep -q 'host.docker.internal:host-gateway' docker-compose.yml
test -s infra/prometheus/prometheus.yml
test -s infra/prometheus/rules/rfq-alerts.yml
test -s infra/grafana/provisioning/datasources/prometheus.yml
test -s infra/k8s/backend-deployment.yaml
test -s infra/k8s/backend-secret.yaml
test -s infra/helm/rfq-market-maker/Chart.yaml
test -s scripts/smoke-api.sh

grep -q 'server.post("/quote"' backend/src/main.ts
grep -q 'server.post("/submit"' backend/src/main.ts
grep -q 'server.get("/quote/:quoteId"' backend/src/main.ts
grep -q 'quoteService.getQuoteStatus' backend/src/main.ts
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
grep -q 'settlementEventResult.duplicate' backend/src/main.ts
grep -q 'markPostSettlementQuoteStatus' backend/src/main.ts
grep -q 'markSettlementRejectedQuoteFailed' backend/src/main.ts
grep -q 'recordInventoryPosition' backend/src/main.ts
grep -q 'reply.code(202)' backend/src/main.ts
grep -q '"submitted"' backend/src/main.ts
grep -q '"settled"' backend/src/main.ts
grep -q 'StaticMarketDataService' backend/src/main.ts
grep -q 'pricingEngine?: PricingEngine' backend/src/main.ts
grep -q 'quoteRepository?: QuoteRepository' backend/src/main.ts
grep -q 'routingEngine?: RoutingEngine' backend/src/main.ts
grep -q 'InternalInventoryRoutingEngine' backend/src/main.ts
grep -q 'BasicRiskEngine' backend/src/main.ts
grep -q 'LocalEIP712SignerService' backend/src/main.ts
grep -q 'ObservedSignerService' backend/src/main.ts
grep -q 'RFQ_SIGNER_PRIVATE_KEY' backend/src/main.ts
grep -q 'RFQ_SETTLEMENT_ADDRESS' backend/src/main.ts
grep -q 'RFQ_QUOTE_TTL_SECONDS' backend/src/main.ts
grep -q 'readQuoteTtlSeconds' backend/src/main.ts
grep -q 'RFQ_BODY_LIMIT_BYTES' backend/src/main.ts
grep -q 'readBodyLimitBytes' backend/src/main.ts
grep -q 'defaultBodyLimitBytes' backend/src/main.ts
grep -q 'RFQ_CORS_ALLOWED_ORIGINS' backend/src/main.ts
grep -q 'readCorsAllowedOrigins' backend/src/main.ts
grep -q 'defaultCorsAllowedOrigins' backend/src/main.ts
grep -q 'applyCorsHeaders' backend/src/main.ts
grep -q 'access-control-allow-origin' backend/src/main.ts
grep -Fq 'server.options("/*"' backend/src/main.ts
grep -q 'RFQ_ENABLE_HSTS' backend/src/main.ts
grep -q 'readEnableHsts' backend/src/main.ts
grep -q 'defaultEnableHsts' backend/src/main.ts
grep -q 'applySecurityHeaders' backend/src/main.ts
grep -q 'cache-control' backend/src/main.ts
grep -q 'x-content-type-options' backend/src/main.ts
grep -q 'strict-transport-security' backend/src/main.ts
grep -q 'server.setErrorHandler' backend/src/main.ts
grep -q 'frameworkErrorToAPIError' backend/src/main.ts
grep -q 'FST_ERR_CTP_BODY_TOO_LARGE' backend/src/main.ts
grep -q 'requireProductionEnv' backend/src/main.ts
grep -q 'requireProductionPrivateKey' backend/src/main.ts
grep -q 'requireProductionAddress' backend/src/main.ts
grep -q 'NODE_ENV=production' backend/src/main.ts
grep -q 'HOST' backend/src/main.ts
grep -q 'x-trace-id' backend/src/main.ts
grep -q 'server.addHook("onRequest"' backend/src/main.ts
grep -q 'requestTraceId' backend/src/main.ts
grep -q 'traceId: string' backend/src/shared/errors/api-error.ts
grep -q 'HEDGE_NOT_FOUND' backend/src/shared/errors/api-error.ts
grep -q 'HEDGE_STORE_UNAVAILABLE' backend/src/shared/errors/api-error.ts
grep -q 'SETTLEMENT_EVENT_NOT_FOUND' backend/src/shared/errors/api-error.ts
grep -q 'SETTLEMENT_EVENT_STORE_UNAVAILABLE' backend/src/shared/errors/api-error.ts
grep -q 'PNL_STORE_UNAVAILABLE' backend/src/shared/errors/api-error.ts
grep -q 'getSnapshot' backend/src/modules/quote/quote.service.ts
grep -q 'getUsableSnapshot' backend/src/modules/quote/quote.service.ts
grep -q 'marketDataFailure' backend/src/modules/quote/quote.service.ts
grep -q 'assertUsableSnapshot' backend/src/modules/quote/quote.service.ts
grep -q 'getMarketSnapshotIssue' backend/src/modules/quote/quote.service.ts
grep -q 'maxSnapshotAgeMs' backend/src/modules/quote/quote.service.ts
grep -q 'MARKET_DATA_UNAVAILABLE' backend/src/modules/quote/quote.service.ts
grep -q 'ROUTING_UNAVAILABLE' backend/src/modules/quote/quote.service.ts
grep -q 'routingFailure' backend/src/modules/quote/quote.service.ts
grep -q 'PRICING_UNAVAILABLE' backend/src/modules/quote/quote.service.ts
grep -q 'pricingFailure' backend/src/modules/quote/quote.service.ts
grep -q 'evaluateRisk' backend/src/modules/quote/quote.service.ts
grep -q 'RISK_ENGINE_UNAVAILABLE' backend/src/modules/quote/quote.service.ts
grep -q 'saveRejectedQuoteBestEffort' backend/src/modules/quote/quote.service.ts
grep -q 'selectRoute' backend/src/modules/quote/quote.service.ts
grep -q 'quoteRepository.saveRequested' backend/src/modules/quote/quote.service.ts
grep -q 'quoteRepository.saveSigned' backend/src/modules/quote/quote.service.ts
grep -q 'quoteRepository.markFailed' backend/src/modules/quote/quote.service.ts
grep -q 'markQuoteFailedBestEffort' backend/src/modules/quote/quote.service.ts
grep -q 'quoteStoreFailure' backend/src/modules/quote/quote.service.ts
grep -q 'QUOTE_STORE_UNAVAILABLE' backend/src/modules/quote/quote.service.ts
grep -q 'quoteFailureCode' backend/src/modules/quote/quote.service.ts
grep -q 'quoteTtlSeconds' backend/src/modules/quote/quote.service.ts
grep -q 'defaultQuoteServiceConfig' backend/src/modules/quote/quote.service.ts
grep -q 'class QuoteIdentityGenerator' backend/src/modules/quote/quote-identity.ts
grep -q 'randomUint64' backend/src/modules/quote/quote-identity.ts
grep -q 'class InMemoryQuoteRepository' backend/src/modules/quote/quote.repository.ts
grep -q 'markFailed' backend/src/modules/quote/quote.repository.ts
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
grep -q 'class ObservedSignerService' backend/src/modules/signer/signer.service.ts
grep -q 'SIGNER_UNAVAILABLE' backend/src/modules/signer/signer.service.ts
grep -q 'privateKeyToAccount' backend/src/modules/signer/signer.service.ts
grep -q 'ProductionGradeRFQ' backend/src/modules/signer/signer.service.ts
grep -q 'RISK_REJECTED' backend/src/modules/quote/quote.service.ts
grep -q 'requireSubmittableSignedQuote' backend/src/modules/quote/quote.service.ts
grep -q 'QUOTE_FAILED' backend/src/modules/quote/quote.service.ts
grep -q 'findSignedQuoteByUserNonce' backend/src/modules/quote/quote.repository.ts
grep -q 'applySettlement' backend/src/modules/execution/execution.service.ts
grep -q 'applySettlementEvent' backend/src/modules/execution/execution.service.ts
grep -q 'settlementVerifier.verify' backend/src/modules/execution/execution.service.ts
grep -q 'SETTLEMENT_UNAVAILABLE' backend/src/modules/execution/execution.service.ts
grep -q 'SettlementEventStore' backend/src/modules/execution/execution.service.ts
grep -q 'settlementEventStoreFailure' backend/src/modules/execution/execution.service.ts
grep -q 'class SettlementEventService' backend/src/modules/settlement/settlement-event.service.ts
grep -q 'interface SettlementEventStore' backend/src/modules/settlement/settlement-event.service.ts
grep -q 'getSettlementEvent' backend/src/modules/settlement/settlement-event.service.ts
grep -q 'eventKey' backend/src/modules/settlement/settlement-event.service.ts
grep -q 'class LocalSettlementVerifier' backend/src/modules/settlement/settlement-verifier.service.ts
grep -q 'TOKEN_NOT_WHITELISTED' backend/src/modules/settlement/settlement-verifier.service.ts
grep -q 'SETTLEMENT_REVERTED' backend/src/modules/settlement/settlement-verifier.service.ts
grep -q 'createHedgeIntent' backend/src/modules/execution/execution.service.ts
grep -q 'hedgeOrderId: hedgeResult?.hedgeOrderId' backend/src/modules/execution/execution.service.ts
grep -q 'getHedgeIntent' backend/src/modules/hedge/hedge.service.ts
grep -q 'interface PnlStore' backend/src/modules/pnl/pnl.service.ts
grep -q 'class PnlService' backend/src/modules/pnl/pnl.service.ts
grep -q 'recordSettlement' backend/src/modules/pnl/pnl.service.ts
grep -q 'simulated_mid_price_v1' backend/src/modules/pnl/pnl.service.ts
grep -q 'rfq_quote_errors_total' backend/src/modules/metrics/metrics.service.ts
grep -q 'rfq_quote_latency_seconds' backend/src/modules/metrics/metrics.service.ts
grep -q 'rfq_quote_rejections_total' backend/src/modules/metrics/metrics.service.ts
grep -q 'rfq_submit_latency_seconds' backend/src/modules/metrics/metrics.service.ts
grep -q 'rfq_signer_requests_total' backend/src/modules/metrics/metrics.service.ts
grep -q 'rfq_signer_errors_total' backend/src/modules/metrics/metrics.service.ts
grep -q 'rfq_signer_latency_seconds' backend/src/modules/metrics/metrics.service.ts
grep -q 'recordQuoteLatency' backend/src/main.ts
grep -q 'recordQuoteRejection' backend/src/main.ts
grep -q 'recordSubmitLatency' backend/src/main.ts
grep -q 'quoteService.markQuoteFailed' backend/src/main.ts
grep -q 'SETTLEMENT_REVERTED' backend/src/main.ts
grep -q 'rfq_settlements_total' backend/src/modules/metrics/metrics.service.ts
grep -q 'rfq_settlements_total' book/Volume5-BackendEngineering/Chapter08-Metrics-Service.md
grep -q 'rfq_settlements_total' book/Volume7-ProductionDeployment/Chapter03-Monitoring.md
grep -q 'rfq_hedge_intents_total' backend/src/modules/metrics/metrics.service.ts
grep -q 'rfq_hedge_intents_total' book/Volume5-BackendEngineering/Chapter08-Metrics-Service.md
grep -q 'rfq_hedge_intents_total' book/Volume7-ProductionDeployment/Chapter03-Monitoring.md
grep -q 'rfq_hedge_intent_errors_total' backend/src/modules/metrics/metrics.service.ts
grep -q 'rfq_hedge_intent_errors_total' book/Volume5-BackendEngineering/Chapter08-Metrics-Service.md
grep -q 'rfq_hedge_intent_errors_total' book/Volume7-ProductionDeployment/Chapter03-Monitoring.md
grep -q 'recordHedgeIntentError' backend/src/main.ts
grep -q 'rfq_quote_status_update_errors_total' backend/src/modules/metrics/metrics.service.ts
grep -q 'recordQuoteStatusUpdateError' backend/src/main.ts
grep -q 'rfq_inventory_balance' backend/src/modules/metrics/metrics.service.ts
grep -q 'rfq_inventory_balance' book/Volume5-BackendEngineering/Chapter08-Metrics-Service.md
grep -q 'rfq_inventory_balance' book/Volume7-ProductionDeployment/Chapter03-Monitoring.md
grep -q 'rfq_pnl_trades_total' backend/src/modules/metrics/metrics.service.ts
grep -q 'rfq_pnl_record_errors_total' backend/src/modules/metrics/metrics.service.ts
grep -q 'recordPnlRecordError' backend/src/main.ts
grep -q 'rfq_realized_pnl_token_out' backend/src/modules/metrics/metrics.service.ts
! grep -q 'rfq_settlement_event_lag_seconds' book/Volume7-ProductionDeployment/Chapter03-Monitoring.md
! grep -q 'rfq_inventory_exposure_usd' book/Volume5-BackendEngineering/Chapter08-Metrics-Service.md
! grep -q 'rfq_inventory_exposure_usd' book/Volume7-ProductionDeployment/Chapter03-Monitoring.md
! grep -q 'rfq_hedge_lag_seconds' book/Volume5-BackendEngineering/Chapter08-Metrics-Service.md
! grep -q 'rfq_hedge_lag_seconds' book/Volume7-ProductionDeployment/Chapter03-Monitoring.md
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
grep -q 'export const rfqErrorCodes' sdk/src/types.ts
grep -q 'export type RFQErrorCode' sdk/src/types.ts
grep -q 'code: RFQErrorCode' sdk/src/types.ts
grep -q 'rfqErrorCodeSet.has' sdk/src/client.ts
grep -q 'RFQClientErrorCode' sdk/src/client.ts
grep -q 'client.health' sdk/test/sdk.test.mjs
grep -q 'client.getSettlement' sdk/test/sdk.test.mjs
grep -q 'client.getHedge' sdk/test/sdk.test.mjs
grep -q 'client.pnl' sdk/test/sdk.test.mjs
grep -q 'client.ready' sdk/test/sdk.test.mjs
grep -q 'degraded readiness payloads' sdk/test/sdk.test.mjs
grep -q 'falls back for unknown API error codes' sdk/test/sdk.test.mjs
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
grep -q 'make api-error-check' .github/workflows/backend-ci.yml
grep -q 'make sdk-typecheck' .github/workflows/backend-ci.yml
grep -q 'make sdk-test' .github/workflows/backend-ci.yml
grep -q 'make frontend-build' .github/workflows/backend-ci.yml
grep -q 'make smoke-api-local' .github/workflows/backend-ci.yml
grep -Fq '"infra/**"' .github/workflows/backend-ci.yml
grep -Fq '"docker-compose.yml"' .github/workflows/backend-ci.yml
grep -Fq '".env.example"' .github/workflows/backend-ci.yml
grep -Fq '"README.md"' .github/workflows/backend-ci.yml
grep -q '      - master' .github/workflows/backend-ci.yml
grep -q '      - master' .github/workflows/docs-ci.yml
grep -q '      - master' .github/workflows/contract-ci.yml
grep -q 'make api-error-check' .github/workflows/docs-ci.yml
grep -q 'make docs-check' .github/workflows/docs-ci.yml
grep -q 'QUOTE_TYPEHASH' scripts/check-eip712-consistency.mjs
grep -q 'backend signer Quote fields must match SDK Quote fields' scripts/check-eip712-consistency.mjs
grep -q 'OpenAPI ErrorResponse enum must match backend RFQErrorCode' scripts/check-api-error-consistency.mjs
grep -q 'SDK rfqErrorCodes array must match backend RFQErrorCode' scripts/check-api-error-consistency.mjs
grep -q 'SDK rfqErrorCodes constant array not found' scripts/check-api-error-consistency.mjs
grep -q 'docs/api/errors.md table must match backend RFQErrorCode' scripts/check-api-error-consistency.mjs
grep -q 'typescript-check' Makefile
grep -q 'api-error-check' Makefile
grep -q '65-byte EIP-712 signature' docs/api/openapi.yaml
grep -q 'amountOut must be greater than or equal to minAmountOut' docs/api/openapi.yaml
grep -q 'Signed quote not found' docs/api/openapi.yaml
grep -q 'settlement verification' docs/api/openapi.yaml
grep -q 'SETTLEMENT_UNAVAILABLE' docs/api/openapi.yaml
grep -q 'SETTLEMENT_UNAVAILABLE' docs/api/errors.md
grep -q 'Market data snapshot used for the quote' docs/api/openapi.yaml
grep -q 'routing unavailable' docs/api/openapi.yaml
grep -q 'ROUTING_UNAVAILABLE' docs/api/errors.md
grep -q 'QUOTE_STORE_UNAVAILABLE' docs/api/openapi.yaml
grep -q 'QUOTE_STORE_UNAVAILABLE' docs/api/errors.md

grep -q 'risk engine is unavailable' backend/test/api.test.mjs
grep -q 'RISK_ENGINE_UNAVAILABLE' backend/test/api.test.mjs
grep -q 'RISK_ENGINE_UNAVAILABLE' book/Volume5-BackendEngineering/Chapter04-Risk-Service.md
grep -q 'stale' docs/api/openapi.yaml
grep -q 'getReadiness' docs/api/openapi.yaml
grep -q 'ReadinessResponse' docs/api/openapi.yaml
grep -q 'not ready because at least one quote dependency is degraded' docs/api/openapi.yaml
grep -q 'signer sign/verify capability' docs/api/openapi.yaml
grep -q 'getHedgeIntent' docs/api/openapi.yaml
grep -q 'HedgeIntentStatus' docs/api/openapi.yaml
grep -q 'HEDGE_NOT_FOUND' docs/api/openapi.yaml
grep -q 'HEDGE_STORE_UNAVAILABLE' docs/api/openapi.yaml
grep -q 'HEDGE_STORE_UNAVAILABLE' docs/api/errors.md
grep -q 'Hedge intent creation failure does not roll back settlement' docs/api/openapi.yaml
grep -q 'getSettlementEvent' docs/api/openapi.yaml
grep -q 'SettlementEventStatus' docs/api/openapi.yaml
grep -q 'SETTLEMENT_EVENT_NOT_FOUND' docs/api/openapi.yaml
grep -q 'SETTLEMENT_EVENT_STORE_UNAVAILABLE' docs/api/openapi.yaml
grep -q 'SETTLEMENT_EVENT_STORE_UNAVAILABLE' docs/api/errors.md
grep -q 'PNL_STORE_UNAVAILABLE' docs/api/openapi.yaml
grep -q 'PNL_STORE_UNAVAILABLE' docs/api/errors.md
grep -q 'getPnlSummary' docs/api/openapi.yaml
grep -q 'PnlSummary' docs/api/openapi.yaml
grep -q 'PnlTradeRecord' docs/api/openapi.yaml
grep -q 'Every response includes an x-trace-id header' docs/api/openapi.yaml
grep -q 'Every HTTP response includes an `x-trace-id` header' README.md
grep -q 'assertTraceHeader' backend/test/api.test.mjs
grep -q 'onRequest` hook' book/Volume5-BackendEngineering/Chapter01-API-Gateway.md
grep -q 'Fastify parser' book/Volume5-BackendEngineering/Chapter01-API-Gateway.md
grep -q 'RFQ_BODY_LIMIT_BYTES' book/Volume5-BackendEngineering/Chapter01-API-Gateway.md
grep -q 'RFQ_CORS_ALLOWED_ORIGINS' book/Volume5-BackendEngineering/Chapter01-API-Gateway.md
grep -q 'CORS preflight' book/Volume5-BackendEngineering/Chapter01-API-Gateway.md
grep -q 'baseline security headers' book/Volume5-BackendEngineering/Chapter01-API-Gateway.md
grep -q 'RFQ_ENABLE_HSTS' book/Volume5-BackendEngineering/Chapter01-API-Gateway.md
grep -q 'IntString' docs/api/openapi.yaml
grep -q 'Internal rejection reason for rejected quote records' docs/api/openapi.yaml
grep -q 'QUOTE_ALREADY_USED' docs/api/openapi.yaml
grep -q 'QUOTE_FAILED' docs/api/openapi.yaml
grep -q 'pattern: "^tr_.+"' docs/api/openapi.yaml
grep -q 'allowBuilds' pnpm-workspace.yaml
grep -q 'onlyBuiltDependencies' pnpm-workspace.yaml
grep -q 'RFQ_SIGNER_PRIVATE_KEY' .env.example
grep -q 'RFQ_QUOTE_TTL_SECONDS=30' .env.example
grep -q 'RFQ_BODY_LIMIT_BYTES=32768' .env.example
grep -q 'RFQ_CORS_ALLOWED_ORIGINS=http://localhost:5173' .env.example
grep -q 'RFQ_ENABLE_HSTS=false' .env.example
grep -q 'HOST=127.0.0.1' .env.example
grep -q 'Production Configuration' README.md
grep -q 'rfq-backend-secrets' README.md
grep -q '32-byte hex string' README.md
grep -q '20-byte hex address' README.md
grep -q 'RFQ_QUOTE_TTL_SECONDS' README.md
grep -q 'RFQ_BODY_LIMIT_BYTES' README.md
grep -q 'RFQ_CORS_ALLOWED_ORIGINS' README.md
grep -q 'RFQ_ENABLE_HSTS' README.md
grep -q 'RFQ_QUOTE_TTL_SECONDS' docs/api/openapi.yaml
grep -q 'RFQ_CORS_ALLOWED_ORIGINS' docs/api/openapi.yaml
grep -q 'baseline browser security headers' docs/api/openapi.yaml
grep -q '"413":' docs/api/openapi.yaml
grep -q 'body too large' docs/api/errors.md
grep -q 'malformed JSON' docs/api/errors.md
grep -q 'CORS preflight origin' docs/api/errors.md
grep -q 'RFQ_QUOTE_TTL_SECONDS' book/Volume5-BackendEngineering/Chapter02-Quote-Service.md
grep -q 'RFQ_QUOTE_TTL_SECONDS' backend/test/api.test.mjs
grep -q 'configured quote TTL' backend/test/quote-service.test.mjs
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
grep -q 'rfq_signer_requests_total{operation="sign"} 1' scripts/smoke-api.mjs
grep -q 'rfq_signer_latency_seconds_count{operation="verify"} 1' scripts/smoke-api.mjs
grep -q 'rfq_submit_latency_seconds_count 2' scripts/smoke-api.mjs
grep -q 'rfq_inventory_balance' scripts/smoke-api.mjs
grep -q 'rfq_inventory_balance' backend/test/api.test.mjs
grep -q 'hedge intent creation fails' backend/test/api.test.mjs
grep -q 'hedge status store failures' backend/test/api.test.mjs
grep -q 'HEDGE_INTENT_FAILED' backend/test/api.test.mjs
grep -q 'HEDGE_INTENT_FAILED' book/Volume5-BackendEngineering/Chapter07-Hedge-Service.md
grep -q 'HEDGE_STORE_UNAVAILABLE' book/Volume5-BackendEngineering/Chapter07-Hedge-Service.md
grep -q 'post-settlement quote status persistence fails' backend/test/api.test.mjs
grep -q 'rfq_quote_status_update_errors_total' backend/test/api.test.mjs
grep -q 'Duplicate settlement events are idempotent' book/Volume5-BackendEngineering/Chapter06-Execution-Service.md
grep -q 'rfq_quote_status_update_errors_total' book/Volume5-BackendEngineering/Chapter08-Metrics-Service.md
grep -q 'quoteStatus.status' scripts/smoke-api.mjs
grep -q 'buildServer' backend/test/api.test.mjs
grep -q 'production startup requires explicit signer configuration' backend/test/api.test.mjs
grep -q 'RFQ_SIGNER_PRIVATE_KEY is required when NODE_ENV=production' backend/test/api.test.mjs
grep -q 'RFQ_SIGNER_PRIVATE_KEY must be a 32-byte hex string when NODE_ENV=production' backend/test/api.test.mjs
grep -q 'RFQ_SETTLEMENT_ADDRESS must be a 20-byte hex address when NODE_ENV=production' backend/test/api.test.mjs
grep -q 'marks requested quotes as failed when signer is unavailable' backend/test/quote-service.test.mjs
grep -q 'preserves signer errors when marking failed quotes fails' backend/test/quote-service.test.mjs
grep -q 'signing is unavailable' backend/test/api.test.mjs
grep -q 'preserves signer errors when failed quote persistence fails' backend/test/api.test.mjs
grep -q 'rfq_signer_errors_total' backend/test/api.test.mjs
grep -q 'settlement constraints before simulated settlement' backend/test/api.test.mjs
grep -q 'failed quote status persistence fails' backend/test/api.test.mjs
grep -q 'target_status="FAILED"' backend/test/api.test.mjs
grep -q 'settlement verifier failures' backend/test/api.test.mjs
grep -q 'SETTLEMENT_UNAVAILABLE' backend/test/api.test.mjs
grep -q 'SETTLEMENT_UNAVAILABLE' book/Volume5-BackendEngineering/Chapter06-Execution-Service.md
grep -q 'settlement event store failures' backend/test/api.test.mjs
grep -q 'settlement event write failures' backend/test/api.test.mjs
grep -q 'Settlement event store write failure' book/Volume5-BackendEngineering/Chapter06-Execution-Service.md
grep -q 'SETTLEMENT_EVENT_STORE_UNAVAILABLE' book/Volume5-BackendEngineering/Chapter06-Execution-Service.md
grep -q 'errorCode, "SETTLEMENT_REVERTED"' backend/test/api.test.mjs
grep -q 'retry.body.code, "QUOTE_FAILED"' backend/test/api.test.mjs
grep -q 'LocalSettlementVerifier accepts contract-shaped settlement quotes' backend/test/settlement-verifier.test.mjs
grep -q 'RISK_REJECTED' backend/test/api.test.mjs
grep -q 'risk rejection when rejected quote persistence fails' backend/test/api.test.mjs
grep -q 'Rejected quote persistence unavailable' book/Volume5-BackendEngineering/Chapter04-Risk-Service.md
grep -q 'SLIPPAGE_TOO_WIDE' backend/test/api.test.mjs
grep -q 'stale market data' backend/test/api.test.mjs
grep -q 'market data failures' backend/test/api.test.mjs
grep -q 'invalid market data before pricing and signing' backend/test/api.test.mjs
grep -q 'routing engine failures' backend/test/api.test.mjs
grep -q 'ROUTING_UNAVAILABLE' backend/test/api.test.mjs
grep -q 'ROUTING_UNAVAILABLE' book/Volume5-BackendEngineering/Chapter02-Quote-Service.md
grep -q 'quote store failures' backend/test/api.test.mjs
grep -q 'quote status store failures' backend/test/api.test.mjs
grep -q 'QUOTE_STORE_UNAVAILABLE' backend/test/api.test.mjs
grep -q 'QUOTE_STORE_UNAVAILABLE' book/Volume5-BackendEngineering/Chapter02-Quote-Service.md
grep -q 'Quote status store unavailable' book/Volume5-BackendEngineering/Chapter01-API-Gateway.md
grep -q 'pricing engine failures' backend/test/api.test.mjs
grep -q 'market data shape is invalid' backend/test/api.test.mjs
grep -q 'degrades readiness when market data is stale' backend/test/api.test.mjs
grep -q 'degrades readiness when signer probe fails' backend/test/api.test.mjs
grep -q 'readiness signer degraded' book/Volume5-BackendEngineering/Chapter01-API-Gateway.md
grep -q 'readiness signer degraded' book/Volume5-BackendEngineering/Chapter05-Signer-Service.md
grep -q 'toxic-flow users' backend/test/api.test.mjs
grep -q 'TOXIC_FLOW_SCORE_EXCEEDED' backend/test/api.test.mjs
grep -q 'TOKEN_IN_INVENTORY_LIMIT_EXCEEDED' backend/test/api.test.mjs
grep -q 'trace ids' backend/test/api.test.mjs
grep -q 'malformed JSON bodies' backend/test/api.test.mjs
grep -q 'oversized JSON bodies' backend/test/api.test.mjs
grep -q 'RFQ_BODY_LIMIT_BYTES' backend/test/api.test.mjs
grep -q 'CORS headers for allowed browser origins' backend/test/api.test.mjs
grep -q 'CORS preflight for allowed origins' backend/test/api.test.mjs
grep -q 'CORS preflight for disallowed origins' backend/test/api.test.mjs
grep -q 'RFQ_CORS_ALLOWED_ORIGINS' backend/test/api.test.mjs
grep -q 'security headers on successful responses' backend/test/api.test.mjs
grep -q 'emits HSTS when enabled' backend/test/api.test.mjs
grep -q 'RFQ_ENABLE_HSTS' backend/test/api.test.mjs
grep -q 'assertSecurityHeaders' backend/test/api.test.mjs
grep -q 'settlement shape' backend/test/api.test.mjs
grep -q 'expired submit quotes' backend/test/api.test.mjs
grep -q 'unissued submit quotes' backend/test/api.test.mjs
grep -q 'replayed submit quotes' backend/test/api.test.mjs
grep -q 'same millisecond' backend/test/api.test.mjs
grep -q 'rate limits quote requests by client' backend/test/api.test.mjs
grep -q 'rate limits submit requests before validation and settlement' backend/test/api.test.mjs
grep -q 'rate limits quote status requests by client' backend/test/api.test.mjs
grep -q 'PnL record creation fails' backend/test/api.test.mjs
grep -q 'PnL summary store failures' backend/test/api.test.mjs
grep -q 'rfq_pnl_record_errors_total' book/Volume5-BackendEngineering/Chapter08-Metrics-Service.md
grep -q 'PnL attribution after settlement is best-effort' book/Volume5-BackendEngineering/Chapter06-Execution-Service.md
grep -q 'signed realized PnL' backend/test/pnl.test.mjs
grep -q 'applies each chain event idempotently' backend/test/settlement-event.test.mjs
grep -q 'InMemoryRateLimiter enforces endpoint-specific windows' backend/test/rate-limit.test.mjs
grep -q 'restricted toxic-flow users' backend/test/risk.test.mjs
grep -q 'toxic-flow score threshold' backend/test/risk.test.mjs
grep -q 'rfq_quote_requests_total' infra/prometheus/rules/rfq-alerts.yml
grep -q 'RFQQuoteLatencyP95High' infra/prometheus/rules/rfq-alerts.yml
grep -q 'RFQQuoteRiskRejectSpike' infra/prometheus/rules/rfq-alerts.yml
grep -q 'RFQSignerErrors' infra/prometheus/rules/rfq-alerts.yml
grep -q 'RFQSignerLatencyP95High' infra/prometheus/rules/rfq-alerts.yml
grep -q 'RFQHedgeIntentErrors' infra/prometheus/rules/rfq-alerts.yml
grep -q 'rfq_hedge_intent_errors_total' infra/prometheus/rules/rfq-alerts.yml
grep -q 'RFQQuoteStatusUpdateErrors' infra/prometheus/rules/rfq-alerts.yml
grep -q 'rfq_quote_status_update_errors_total' infra/prometheus/rules/rfq-alerts.yml
grep -q 'RFQPnlRecordErrors' infra/prometheus/rules/rfq-alerts.yml
grep -q 'rfq_pnl_record_errors_total' infra/prometheus/rules/rfq-alerts.yml
grep -q 'uid: prometheus' infra/grafana/provisioning/datasources/prometheus.yml
grep -q '"uid": "prometheus"' infra/grafana/provisioning/dashboards/rfq-overview.json
grep -q 'rfq_settlements_total' infra/grafana/provisioning/dashboards/rfq-overview.json
grep -q 'rfq_hedge_intent_errors_total' infra/grafana/provisioning/dashboards/rfq-overview.json
grep -q 'rfq_quote_status_update_errors_total' infra/grafana/provisioning/dashboards/rfq-overview.json
grep -q 'rfq_pnl_record_errors_total' infra/grafana/provisioning/dashboards/rfq-overview.json
grep -q 'rfq_inventory_balance' infra/grafana/provisioning/dashboards/rfq-overview.json
grep -q 'rfq_realized_pnl_token_out' infra/grafana/provisioning/dashboards/rfq-overview.json
grep -q 'rfq_pnl_trades_total' infra/grafana/provisioning/dashboards/rfq-overview.json
grep -q 'Post-Settlement Persistence Drift' book/Volume7-ProductionDeployment/Chapter05-Runbook.md
grep -q 'settlement-to-quote reconciliation' book/Volume7-ProductionDeployment/Chapter05-Runbook.md
grep -q 'settlement-to-PnL reconciliation' book/Volume7-ProductionDeployment/Chapter05-Runbook.md
grep -q 'rfq-backend-secrets' book/Volume7-ProductionDeployment/Chapter02-Kubernetes.md
grep -q 'Missing or malformed signer Secret' book/Volume7-ProductionDeployment/Chapter02-Kubernetes.md
grep -q '32-byte hex string' book/Volume7-ProductionDeployment/Chapter02-Kubernetes.md
grep -q '20-byte hex address' book/Volume7-ProductionDeployment/Chapter02-Kubernetes.md
grep -q 'kind: Deployment' infra/k8s/backend-deployment.yaml
grep -q 'path: /ready' infra/k8s/backend-deployment.yaml
grep -q 'secretRef' infra/k8s/backend-deployment.yaml
grep -q 'rfq-backend-secrets' infra/k8s/backend-deployment.yaml
grep -q 'kind: Secret' infra/k8s/backend-secret.yaml
grep -q 'RFQ_SIGNER_PRIVATE_KEY' infra/k8s/backend-secret.yaml
grep -q 'RFQ_SETTLEMENT_ADDRESS' infra/k8s/backend-secret.yaml
grep -q 'RFQ_QUOTE_TTL_SECONDS' infra/k8s/configmap.yaml
grep -q 'RFQ_BODY_LIMIT_BYTES' infra/k8s/configmap.yaml
grep -q 'RFQ_CORS_ALLOWED_ORIGINS' infra/k8s/configmap.yaml
grep -q 'RFQ_ENABLE_HSTS' infra/k8s/configmap.yaml
grep -q 'HOST: "0.0.0.0"' infra/k8s/configmap.yaml
grep -q 'prometheus.io/scrape' infra/k8s/backend-service.yaml
grep -q 'prometheus.io/path' infra/k8s/backend-service.yaml
grep -q '/metrics' infra/k8s/backend-service.yaml
grep -q 'path: /ready' infra/helm/rfq-market-maker/templates/deployment.yaml
grep -q 'secretKeyRef' infra/helm/rfq-market-maker/templates/deployment.yaml
grep -q 'RFQ_SIGNER_PRIVATE_KEY' infra/helm/rfq-market-maker/templates/deployment.yaml
grep -q 'RFQ_SETTLEMENT_ADDRESS' infra/helm/rfq-market-maker/templates/deployment.yaml
grep -q 'RFQ_QUOTE_TTL_SECONDS' infra/helm/rfq-market-maker/values.yaml
grep -q 'RFQ_BODY_LIMIT_BYTES' infra/helm/rfq-market-maker/values.yaml
grep -q 'RFQ_CORS_ALLOWED_ORIGINS' infra/helm/rfq-market-maker/values.yaml
grep -q 'RFQ_ENABLE_HSTS' infra/helm/rfq-market-maker/values.yaml
grep -q 'HOST: "0.0.0.0"' infra/helm/rfq-market-maker/values.yaml
grep -q 'signerSecret' infra/helm/rfq-market-maker/values.yaml
grep -q 'rfq-backend-secrets' infra/helm/rfq-market-maker/values.yaml
grep -q 'baseline browser security headers' docs/security/audit-checklist.md
grep -q 'CORS origin allowlist' docs/security/audit-checklist.md
grep -q 'service.annotations' infra/helm/rfq-market-maker/templates/service.yaml
grep -q 'prometheus.io/scrape' infra/helm/rfq-market-maker/values.yaml
grep -q 'prometheus.io/path' infra/helm/rfq-market-maker/values.yaml
grep -q 'name: rfq-market-maker' infra/helm/rfq-market-maker/Chart.yaml

echo "skeleton check passed"
