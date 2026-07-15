#!/usr/bin/env sh
set -eu

gateway_sources="backend/src/main.ts backend/src/api/http-boundary.ts backend/src/api/trading-routes.ts backend/src/api/quote-control-routes.ts backend/src/runtime/environment.ts backend/src/runtime/gateway-application.ts backend/src/runtime/gateway-market-data.ts backend/src/runtime/gateway-runtime.ts backend/src/runtime/market-runtime.ts backend/src/runtime/process-shutdown.ts backend/src/runtime/server-process.ts"
quote_service_sources="backend/src/modules/quote/quote.service.ts backend/src/modules/quote/quote-service-contract.ts backend/src/modules/quote/quote-service-errors.ts backend/src/modules/quote/quote-service-result-validation.ts backend/src/modules/quote/quote-risk-decision.ts"
sdk_client_sources="sdk/src/client.ts sdk/src/client-error.ts sdk/src/client-request.ts sdk/src/client-response-validation.ts sdk/src/client-trading-responses.ts sdk/src/client-accounting-responses.ts"

test -s package.json
test -s pnpm-workspace.yaml
test -s pnpm-lock.yaml
test -s .dockerignore
test -s .env.example
test -s benchmark/quote-benchmark.mjs
test -s benchmark/submit-benchmark.mjs
test -s .github/workflows/backend-ci.yml
test -s .github/workflows/contract-ci.yml
test -s .github/workflows/docs-ci.yml
test -s backend/src/main.ts
test -s backend/src/api/http-boundary.ts
test -s backend/src/api/trading-routes.ts
test -s backend/src/api/quote-control-routes.ts
test -s backend/src/runtime/environment.ts
test -s backend/src/runtime/gateway-application.ts
test -s backend/src/runtime/gateway-market-data.ts
test -s backend/src/runtime/gateway-runtime.ts
test -s backend/src/runtime/market-runtime.ts
test -s backend/src/runtime/server-process.ts
test -s scripts/check-api-composition-consistency.mjs
test -s scripts/lib/read-backend-gateway-source.mjs
test -s backend/src/hedge-worker-main.ts
test -s backend/src/db/migrations/003-hedge-worker-queue.sql
test -s backend/src/modules/hedge/binance-spot.adapter.ts
test -s backend/src/modules/hedge/binance-symbol-rules.ts
test -s backend/src/modules/hedge/hedge-intent-planner.ts
test -s backend/src/modules/hedge/hedge-route.ts
test -s backend/src/modules/hedge/hedge-worker.ts
test -s backend/src/modules/hedge/postgres-hedge-job.store.ts
test -s backend/test/binance-spot-adapter.test.mjs
test -s backend/test/binance-symbol-rules.test.mjs
test -s backend/test/hedge-intent-planner.test.mjs
test -s backend/test/database-migrate.test.mjs
test -s backend/test/hedge-route.test.mjs
test -s backend/test/hedge-worker.test.mjs
test -s backend/test/hedge-worker-runtime.test.mjs
test -s backend/test/postgres-hedge-job-store.test.mjs
test -s infra/k8s/hedge-worker-deployment.yaml
test -s infra/k8s/database-migration-secret.yaml
test -s infra/k8s/hedge-worker-service.yaml
test -s infra/k8s/hedge-worker-secret.yaml
test -s infra/k8s/hedge-worker-network-policy.yaml
test -s infra/helm/rfq-market-maker/templates/hedge-worker-deployment.yaml
test -s infra/helm/rfq-market-maker/templates/hedge-worker-service.yaml
test -s infra/helm/rfq-market-maker/templates/hedge-worker-network-policy.yaml
test -s backend/src/analytics-worker-main.ts
test -s scripts/analytics-integration-check.mjs
test -s backend/src/db/migrations/004-analytics-outbox.sql
test -s backend/src/modules/analytics/analytics-event.ts
test -s backend/src/modules/analytics/analytics-outbox.publisher.ts
test -s backend/src/modules/analytics/analytics-worker.metrics.ts
test -s backend/src/modules/analytics/clickhouse-analytics.sink.ts
test -s backend/src/modules/analytics/kafka-analytics.consumer.ts
test -s backend/src/modules/analytics/kafka-analytics.producer.ts
test -s backend/src/modules/analytics/postgres-analytics-outbox.store.ts
test -s backend/test/analytics-event.test.mjs
test -s backend/test/analytics-outbox-publisher.test.mjs
test -s backend/test/analytics-worker-metrics.test.mjs
test -s backend/test/analytics-worker-runtime.test.mjs
test -s backend/test/clickhouse-analytics-sink.test.mjs
test -s backend/test/kafka-analytics-consumer.test.mjs
test -s backend/test/kafka-analytics-producer.test.mjs
test -s backend/test/postgres-analytics-outbox-store.test.mjs
test -s infra/k8s/analytics-worker-deployment.yaml
test -s infra/k8s/analytics-worker-service.yaml
test -s infra/k8s/analytics-worker-secret.yaml
test -s infra/k8s/analytics-worker-network-policy.yaml
test -s infra/helm/rfq-market-maker/templates/analytics-worker-deployment.yaml
test -s infra/helm/rfq-market-maker/templates/analytics-worker-service.yaml
test -s infra/helm/rfq-market-maker/templates/analytics-worker-network-policy.yaml
grep -q 'CREATE TABLE analytics_outbox' backend/src/db/migrations/004-analytics-outbox.sql
grep -q 'enqueue_rfq_analytics_event' backend/src/db/migrations/004-analytics-outbox.sql
grep -q 'FOR UPDATE SKIP LOCKED' backend/src/modules/analytics/postgres-analytics-outbox.store.ts
grep -q 'idempotent: true' backend/src/modules/analytics/kafka-analytics.producer.ts
grep -q 'await this.sink.insertBatch(rows.slice' backend/src/modules/analytics/kafka-analytics.consumer.ts
grep -q 'ReplacingMergeTree(ingested_at)' backend/src/modules/analytics/clickhouse-analytics.sink.ts
grep -q 'rfq_analytics_outbox_pending' backend/src/modules/analytics/analytics-worker.metrics.ts
grep -q 'rfq-analytics-worker' infra/prometheus/prometheus.yml
grep -q 'analytics-integration-check: backend-build' Makefile
grep -q 'scripts/analytics-integration-check.mjs' Makefile
test -s backend/src/reconciliation-worker-main.ts
test -s scripts/reconciliation-integration-check.mjs
test -s backend/src/db/migrations/005-post-trade-reconciliation.sql
test -s backend/src/db/migrations/006-quote-snapshot-pnl.sql
test -s backend/src/db/migrations/024-hedge-net-pnl.sql
test -s backend/src/db/migrations/025-bounded-hedge-limit.sql
test -s backend/src/db/migrations/026-hedge-order-expiry.sql
test -s backend/src/db/migrations/027-signer-audit.sql
test -s backend/src/db/migrations/028-signer-risk-context.sql
test -s backend/src/modules/signer/signer-audit.store.ts
test -s backend/test/signer-audit-store.test.mjs
test -s backend/src/modules/hedge/hedge-net-pnl.ts
test -s backend/test/hedge-net-pnl.test.mjs
test -s scripts/hedge-net-pnl-integration-check.mjs
test -s backend/src/modules/pnl/quote-snapshot-valuation.provider.ts
test -s backend/test/quote-snapshot-pnl-valuation.test.mjs
test -s backend/test/postgres-market-snapshot-store.test.mjs
test -s backend/src/modules/reconciliation/post-trade-reconciliation.metrics.ts
test -s backend/src/modules/reconciliation/post-trade-reconciliation.worker.ts
test -s backend/src/modules/reconciliation/postgres-post-trade-reconciliation.store.ts
test -s backend/test/post-trade-reconciliation-metrics.test.mjs
test -s backend/test/post-trade-reconciliation-worker.test.mjs
test -s backend/test/postgres-post-trade-reconciliation-store.test.mjs
test -s backend/test/reconciliation-worker-runtime.test.mjs
test -s infra/k8s/reconciliation-worker-deployment.yaml
test -s infra/k8s/reconciliation-worker-service.yaml
test -s infra/k8s/reconciliation-worker-secret.yaml
test -s infra/k8s/reconciliation-worker-network-policy.yaml
test -s infra/helm/rfq-market-maker/templates/reconciliation-worker-deployment.yaml
test -s infra/helm/rfq-market-maker/templates/reconciliation-worker-service.yaml
test -s infra/helm/rfq-market-maker/templates/reconciliation-worker-network-policy.yaml
grep -q 'CREATE TABLE post_trade_reconciliation_jobs' backend/src/db/migrations/005-post-trade-reconciliation.sql
grep -q 'enqueue_post_trade_reconciliation_job' backend/src/db/migrations/005-post-trade-reconciliation.sql
grep -q 'FOR UPDATE SKIP LOCKED' backend/src/modules/reconciliation/postgres-post-trade-reconciliation.store.ts
grep -q 'stale_revision' backend/src/modules/reconciliation/post-trade-reconciliation.worker.ts
grep -q 'rfq_reconciliation_pending_jobs' backend/src/modules/reconciliation/post-trade-reconciliation.metrics.ts
grep -q 'rfq-reconciliation-worker' infra/prometheus/prometheus.yml
grep -q 'reconciliation-integration-check: backend-build' Makefile
grep -q 'scripts/reconciliation-integration-check.mjs' Makefile
grep -q 'hedge-net-pnl-integration-check: backend-build' Makefile
grep -q 'scripts/hedge-net-pnl-integration-check.mjs' Makefile
grep -q 'FOR UPDATE SKIP LOCKED' backend/src/modules/hedge/postgres-hedge-job.store.ts
grep -q 'adapter.queryOrder' backend/src/modules/hedge/hedge-worker.ts
grep -q 'adapter.validateLimitOrder' backend/src/modules/hedge/hedge-worker.ts
grep -q 'adapter.submitLimitOrder' backend/src/modules/hedge/hedge-worker.ts
grep -q 'adapter.cancelOrder' backend/src/modules/hedge/hedge-worker.ts
grep -q 'createHmac("sha256"' backend/src/modules/hedge/binance-spot.adapter.ts
grep -q 'origClientOrderId' backend/src/modules/hedge/binance-spot.adapter.ts
grep -q 'newClientOrderId' backend/src/modules/hedge/binance-spot.adapter.ts
grep -q '/api/v3/time' backend/src/modules/hedge/binance-spot.adapter.ts
grep -q 'hasVenueErrorCode(response, -1021)' backend/src/modules/hedge/binance-spot.adapter.ts
grep -q 'rfq_hedge_worker_jobs_total' backend/src/modules/hedge/hedge-worker.ts
grep -q 'rfq_hedge_worker_symbol_rules_valid' backend/src/modules/hedge/hedge-worker.ts
grep -q 'rfq_hedge_fee_pending' backend/src/modules/hedge/hedge-fee-worker.ts
grep -q 'rfq_hedge_fee_oldest_due_age_seconds' backend/src/modules/hedge/hedge-fee-worker.ts
test -s backend/test/api-error.test.mjs
test -s backend/test/api-gateway-env.test.mjs
test -s backend/test/api-gateway-signer-env.test.mjs
test -s backend/test/api-gateway.test.mjs
test -s backend/test/api-gateway-runtime.test.mjs
test -s backend/test/api-hedge.test.mjs
test -s backend/test/api-market-data.test.mjs
test -s backend/test/api-pnl.test.mjs
test -s backend/test/api-quote-dependencies.test.mjs
test -s backend/test/api-quote-identity.test.mjs
test -s backend/test/api-rate-limit.test.mjs
test -s backend/test/api-readiness.test.mjs
test -s backend/test/api-readiness-storage.test.mjs
test -s backend/test/api-risk.test.mjs
test -s backend/test/api-signer.test.mjs
test -s backend/test/api-status.test.mjs
test -s backend/test/api-submit-dependencies.test.mjs
test -s backend/test/api-submit-settlement-dependencies.test.mjs
test -s backend/test/api-submit.test.mjs
test -s backend/test/api-validation-gateway.test.mjs
test -s backend/test/api-validation.test.mjs
test -s backend/test/api.test.mjs
test -s backend/test/execution.test.mjs
test -s backend/test/execution-settlement-results.test.mjs
test -s backend/test/execution-validation.test.mjs
test -s backend/test/hedge.test.mjs
test -s backend/test/hedge-config-validation.test.mjs
test -s backend/test/hedge-input-shape-validation.test.mjs
test -s backend/test/hedge-validation.test.mjs
test -s backend/test/inventory.test.mjs
test -s backend/test/inventory-config-validation.test.mjs
test -s backend/test/inventory-replay-validation.test.mjs
test -s backend/test/inventory-validation.test.mjs
test -s backend/test/market-data.test.mjs
test -s backend/test/market-data-validation.test.mjs
test -s backend/test/market-snapshot-repository-validation.test.mjs
test -s backend/test/metrics.test.mjs
test -s backend/test/metrics-inventory-pnl-validation.test.mjs
test -s backend/test/metrics-validation.test.mjs
test -s backend/test/quote-identity.test.mjs
test -s backend/test/quote-repository-lifecycle.test.mjs
test -s backend/test/quote-repository.test.mjs
test -s backend/test/quote-repository-signed-validation.test.mjs
test -s backend/test/quote-repository-validation.test.mjs
test -s backend/test/quote-service-dependencies.test.mjs
test -s backend/test/quote-service-market-routing-dependencies.test.mjs
test -s backend/test/quote-service-pricing-dependencies.test.mjs
test -s backend/test/quote-service-risk-dependencies.test.mjs
test -s backend/test/quote-service-submit.test.mjs
test -s backend/test/quote-service.test.mjs
test -s backend/test/quote-service-dependency-config.test.mjs
test -s backend/test/quote-service-config.test.mjs
test -s backend/test/quote-status-repository-clear.test.mjs
test -s backend/test/quote-status-metadata-validation.test.mjs
test -s backend/test/quote-status-repository.test.mjs
test -s backend/test/quote-status-repository-validation.test.mjs
test -s backend/test/pnl.test.mjs
test -s backend/test/pnl-validation.test.mjs
test -s backend/test/pricing.test.mjs
test -s backend/test/pricing-config-validation.test.mjs
test -s backend/test/pricing-input-shape-validation.test.mjs
test -s backend/test/pricing-validation.test.mjs
test -s backend/test/rate-limit.test.mjs
test -s backend/test/readiness.test.mjs
test -s backend/test/readiness-validation.test.mjs
test -s backend/test/reconciliation-config.test.mjs
test -s backend/test/reconciliation-hedge.test.mjs
test -s backend/test/reconciliation-pnl.test.mjs
test -s backend/test/reconciliation-reorg.test.mjs
test -s backend/test/risk-decision.test.mjs
test -s backend/test/risk-runtime-validation.test.mjs
test -s backend/test/risk-validation.test.mjs
test -s backend/test/routing.test.mjs
test -s backend/test/settlement-event.test.mjs
test -s backend/test/settlement-event-lookup-validation.test.mjs
test -s backend/test/settlement-event-validation.test.mjs
test -s backend/test/settlement-event-reorg.test.mjs
test -s backend/test/settlement-verifier.test.mjs
test -s backend/test/settlement-verifier-policy-validation.test.mjs
test -s backend/test/settlement-verifier-validation.test.mjs
test -s backend/test/signer.test.mjs
test -s backend/test/signer-validation.test.mjs
test -s backend/test/kms-signer.test.mjs
test -s backend/test/aws-kms-signer-provider.test.mjs
test -s backend/test/signer-runtime.test.mjs
test -s backend/src/modules/signer/kms-signer.service.ts
test -s backend/src/modules/signer/aws-kms-signer.provider.ts
test -s backend/src/modules/signer/signer-runtime.ts
test -s backend/test/submit-concurrency.test.mjs
test -s backend/test/submit-options-validation.test.mjs
test -s backend/test/submit-schema-validation.test.mjs
test -s backend/test/submit-validation.test.mjs
test -s backend/test/validation.test.mjs
test -s backend/src/modules/health/readiness.service.ts
grep -q 'marketDataService: MarketDataService' backend/src/modules/health/readiness.service.ts
grep -q 'routingEngine: RoutingEngine' backend/src/modules/health/readiness.service.ts
grep -q 'pricingEngine: PricingEngine' backend/src/modules/health/readiness.service.ts
grep -q 'riskEngine: RiskEngine' backend/src/modules/health/readiness.service.ts
grep -q 'signerService: SignerService' backend/src/modules/health/readiness.service.ts
grep -q 'checkMarketData' backend/src/modules/health/readiness.service.ts
grep -q 'checkRouting' backend/src/modules/health/readiness.service.ts
grep -q 'checkPricing' backend/src/modules/health/readiness.service.ts
grep -q 'checkRisk' backend/src/modules/health/readiness.service.ts
grep -q 'checkSigner' backend/src/modules/health/readiness.service.ts
grep -q 'checkDependency' backend/src/modules/health/readiness.service.ts
grep -q 'maxSnapshotAgeMs' backend/src/modules/health/readiness.service.ts
grep -q 'maxSnapshotFutureSkewMs' backend/src/modules/health/readiness.service.ts
grep -q 'assertPositiveSafeInteger(config.maxSnapshotAgeMs, "maxSnapshotAgeMs")' backend/src/modules/health/readiness.service.ts
grep -q 'assertPositiveSafeInteger(config.maxSnapshotFutureSkewMs, "maxSnapshotFutureSkewMs")' backend/src/modules/health/readiness.service.ts
grep -q 'assertRecord(config, "config")' backend/src/modules/health/readiness.service.ts
grep -q 'assertRecord(deps, "deps")' backend/src/modules/health/readiness.service.ts
grep -q 'assertOwnFields(config, readinessServiceConfigFields, "config")' backend/src/modules/health/readiness.service.ts
grep -q 'assertOwnFields(deps, readinessServiceDepsFields, "deps")' backend/src/modules/health/readiness.service.ts
grep -q 'Readiness service ${path}.${field} must be an own field' backend/src/modules/health/readiness.service.ts
grep -q 'assertRecord(dependency, dependencyName)' backend/src/modules/health/readiness.service.ts
grep -q 'assertReadinessServiceDeps(deps)' backend/src/modules/health/readiness.service.ts
grep -q 'assertDependencyMethod(deps.metricsService, "metricsService", "checkHealth")' backend/src/modules/health/readiness.service.ts
grep -q 'cloneReadinessServiceDeps' backend/src/modules/health/readiness.service.ts
grep -q 'cloneReadinessServiceConfig' backend/src/modules/health/readiness.service.ts
grep -q 'readiness_probe' backend/src/modules/health/readiness.service.ts
grep -q 'probeSnapshot' backend/src/modules/health/readiness.service.ts
grep -q 'probeRoutePlan' backend/src/modules/health/readiness.service.ts
grep -q 'probePricing' backend/src/modules/health/readiness.service.ts
grep -q 'pricingStatus' backend/src/modules/health/readiness.service.ts
grep -q 'routingStatus' backend/src/modules/health/readiness.service.ts
grep -q 'riskStatus' backend/src/modules/health/readiness.service.ts
grep -q 'quoteRepositoryStatus' backend/src/modules/health/readiness.service.ts
grep -q 'settlementEventStoreStatus' backend/src/modules/health/readiness.service.ts
grep -q 'pnlStatus' backend/src/modules/health/readiness.service.ts
grep -q 'ReadinessService degrades the aggregate status when a dependency probe fails' backend/test/readiness.test.mjs
grep -q 'ReadinessService snapshots dependency object at construction' backend/test/readiness.test.mjs
grep -q 'ReadinessService snapshots readiness configuration at construction' backend/test/readiness.test.mjs
grep -q 'ReadinessService rejects unsafe freshness configuration at construction' backend/test/readiness-validation.test.mjs
grep -q 'ReadinessService rejects unsafe dependency configuration at construction' backend/test/readiness-validation.test.mjs
grep -q 'Readiness service config must be an object' backend/test/readiness-validation.test.mjs
grep -q 'Readiness service config.maxSnapshotAgeMs must be an own field' backend/test/readiness-validation.test.mjs
grep -q 'Readiness service config.probeRequest must be an own field' backend/test/readiness-validation.test.mjs
grep -q 'assertProbeFields(config)' backend/src/modules/health/readiness.service.ts
grep -q 'probeRequestFields = \["chainId", "user", "tokenIn", "tokenOut", "amountIn", "slippageBps"\]' backend/src/modules/health/readiness.service.ts
grep -q 'const probeSnapshotFields = \[' backend/src/modules/health/readiness.service.ts
grep -q '"marketSpreadBps"' backend/src/modules/health/readiness.service.ts
grep -q 'probeRoutePlanFields = \["routeId", "venue", "tokenIn", "tokenOut", "expectedLiquidityUsd"\]' backend/src/modules/health/readiness.service.ts
grep -q 'probePricingFields = \[' backend/src/modules/health/readiness.service.ts
grep -q 'probeQuoteFields = \[' backend/src/modules/health/readiness.service.ts
grep -q 'probeRequest: Object.create(defaultReadinessServiceConfig.probeRequest)' backend/test/readiness-validation.test.mjs
grep -q 'probeSnapshot: Object.create(defaultReadinessServiceConfig.probeSnapshot)' backend/test/readiness-validation.test.mjs
grep -q 'Readiness service marketDataService must be an object' backend/test/readiness-validation.test.mjs
grep -q 'Readiness service deps.marketDataService must be an own field' backend/test/readiness-validation.test.mjs
grep -q 'ReadinessService` snapshots its dependency map at construction' book/Volume5-BackendEngineering/Chapter01-API-Gateway.md
grep -q 'Required dependency entries must be own fields before method validation' book/Volume5-BackendEngineering/Chapter01-API-Gateway.md
grep -q 'ReadinessService` validates dependency methods at construction' book/Volume5-BackendEngineering/Chapter01-API-Gateway.md
grep -q 'nested probe payload required fields 在构造期 fail fast' book/Volume5-BackendEngineering/Chapter01-API-Gateway.md
grep -q 'snapshots `ReadinessServiceConfig` at construction after validation' book/Volume5-BackendEngineering/Chapter01-API-Gateway.md
grep -q 'ReadinessService` rejects malformed config, inherited config fields, malformed dependency map, inherited dependency entries and malformed dependency entries before reading freshness fields or probe methods' book/Volume5-BackendEngineering/Chapter01-API-Gateway.md
test -s backend/src/modules/quote/quote.service.ts
test -s backend/src/modules/quote/quote-service-contract.ts
test -s backend/src/modules/quote/quote-service-errors.ts
test -s backend/src/modules/quote/quote-service-result-validation.ts
test -s backend/src/modules/quote/quote-risk-decision.ts
test -s backend/src/modules/quote/quote-identity.ts
test -s backend/src/modules/quote/quote.repository.ts
grep -q 'checkHealth' backend/src/modules/quote/quote.repository.ts
test -s backend/src/modules/risk/risk-decision.repository.ts
grep -q 'interface RiskDecisionStore' backend/src/modules/risk/risk-decision.repository.ts
grep -q 'class InMemoryRiskDecisionRepository' backend/src/modules/risk/risk-decision.repository.ts
grep -q 'saveDecision(input: SaveRiskDecisionInput)' backend/src/modules/risk/risk-decision.repository.ts
grep -q 'findByQuoteId' backend/src/modules/risk/risk-decision.repository.ts
grep -q 'Risk decision conflict for' backend/src/modules/risk/risk-decision.repository.ts
grep -q 'assertObject(input, "input")' backend/src/modules/risk/risk-decision.repository.ts
grep -q 'assertObject(input.decision, "decision")' backend/src/modules/risk/risk-decision.repository.ts
grep -q 'riskDecisionInputFields = \["quoteId", "decision"\]' backend/src/modules/risk/risk-decision.repository.ts
grep -q 'riskDecisionFields = \["status", "policyVersion"\]' backend/src/modules/risk/risk-decision.repository.ts
grep -q 'rejectedRiskDecisionFields = \["reasonCode"\]' backend/src/modules/risk/risk-decision.repository.ts
grep -q 'assertOwnFields(input, riskDecisionInputFields, "input")' backend/src/modules/risk/risk-decision.repository.ts
grep -q 'assertOwnFields(input.decision, riskDecisionFields, "decision")' backend/src/modules/risk/risk-decision.repository.ts
grep -q 'assertOwnOptionalFields(input.decision, rejectedRiskDecisionFields, "decision")' backend/src/modules/risk/risk-decision.repository.ts
grep -q 'Risk decision ${path}.${field} must be an own field' backend/src/modules/risk/risk-decision.repository.ts
grep -q 'Risk decision ${path}.${field} must be an own field when provided' backend/src/modules/risk/risk-decision.repository.ts
grep -q 'maxSafeIdentifierLength = 128' backend/src/modules/risk/risk-decision.repository.ts
grep -Fq 'safeIdentifierPattern = /^[A-Za-z0-9_:-]+$/' backend/src/modules/risk/risk-decision.repository.ts
grep -q 'assertSafeIdentifier(input.quoteId, "quoteId")' backend/src/modules/risk/risk-decision.repository.ts
grep -q 'assertSafeIdentifier(buildRiskDecisionId(input.quoteId), "riskDecisionId")' backend/src/modules/risk/risk-decision.repository.ts
grep -q 'assertSafeIdentifier(quoteId, "quoteId")' backend/src/modules/risk/risk-decision.repository.ts
grep -q 'Risk decision ${field} must be a primitive string' backend/src/modules/risk/risk-decision.repository.ts
grep -q 'riskDecisionStore: RiskDecisionStore' $quote_service_sources
grep -q 'persistQuoteRiskDecision' $quote_service_sources
grep -q 'riskDecisionStoreStatus' backend/src/modules/health/readiness.service.ts
grep -q 'riskDecisionStore' backend/src/modules/metrics/metrics.service.ts
grep -q 'InMemoryRiskDecisionRepository stores idempotent approved and rejected decisions' backend/test/risk-decision.test.mjs
grep -q 'InMemoryRiskDecisionRepository rejects malformed decision payload envelopes before storing' backend/test/risk-decision.test.mjs
grep -q 'InMemoryRiskDecisionRepository rejects inherited decision payload fields before storing' backend/test/risk-decision.test.mjs
grep -q 'Risk decision input.quoteId must be an own field' backend/test/risk-decision.test.mjs
grep -q 'Risk decision decision.status must be an own field' backend/test/risk-decision.test.mjs
grep -q 'Risk decision decision.reasonCode must be an own field when provided' backend/test/risk-decision.test.mjs
grep -q 'Risk decision quoteId must be a primitive string' backend/test/risk-decision.test.mjs
grep -q 'Risk decision quoteId must contain only letters, numbers, underscore, colon, or hyphen' backend/test/risk-decision.test.mjs
grep -q 'Risk decision riskDecisionId must be 128 characters or fewer' backend/test/risk-decision.test.mjs
grep -q 'QuoteService persists approved and rejected risk decisions before signer boundary' backend/test/quote-service-risk-dependencies.test.mjs
grep -q 'QuoteService blocks signer when risk decision persistence fails' backend/test/quote-service-risk-dependencies.test.mjs
grep -q 'RFQ API marks requested quotes failed when risk decision audit store fails' backend/test/api-quote-dependencies.test.mjs
grep -q 'persists RiskDecisionStore audit records before signer' book/Volume5-BackendEngineering/Chapter02-Quote-Service.md
grep -q 'best-effort 将 requested quote 标记为 `failed`，并阻断 Signer' book/Volume5-BackendEngineering/Chapter02-Quote-Service.md
grep -q 'RiskDecisionStore mirrors the PostgreSQL risk_decisions contract' book/Volume5-BackendEngineering/Chapter04-Risk-Service.md
grep -q 'Risk decision audit persistence rejects malformed root payloads, missing `decision` objects, inherited `quoteId` / `decision` fields' book/Volume5-BackendEngineering/Chapter04-Risk-Service.md
grep -q 'validates `quoteId` as an own primitive-string `SafeIdentifier` and validates the derived `riskDecisionId`' book/Volume5-BackendEngineering/Chapter04-Risk-Service.md
grep -q 'Risk Engine dependency failure or malformed `RiskDecision` output' book/Volume5-BackendEngineering/Chapter04-Risk-Service.md
test -s backend/src/modules/execution/execution.service.ts
test -s backend/src/modules/inventory/inventory.service.ts
test -s backend/src/modules/inventory/postgres-inventory.service.ts
grep -q 'checkHealth' backend/src/modules/inventory/inventory.service.ts
grep -q 'InventoryService calculates bounded quote skew by inventory direction' backend/test/inventory.test.mjs
grep -q 'assertObject(config, "config")' backend/src/modules/inventory/inventory.service.ts
grep -q 'inventoryServiceConfigFields = \["skewUnit", "maxPositiveSkewBps", "maxNegativeSkewBps"\]' backend/src/modules/inventory/inventory.service.ts
grep -q 'settlementDeltaFields = \["chainId", "tokenIn", "tokenOut", "amountIn", "amountOut"\]' backend/src/modules/inventory/inventory.service.ts
grep -q 'inventorySkewInputFields = \["chainId", "token"\]' backend/src/modules/inventory/inventory.service.ts
grep -q 'assertOwnFields(config, inventoryServiceConfigFields, "config")' backend/src/modules/inventory/inventory.service.ts
grep -q 'assertOwnFields(input, settlementDeltaFields, "settlement delta")' backend/src/modules/inventory/inventory.service.ts
grep -q 'assertOwnFields(input, inventorySkewInputFields, "skew input")' backend/src/modules/inventory/inventory.service.ts
grep -q 'Inventory ${path}.${field} must be an own field' backend/src/modules/inventory/inventory.service.ts
grep -q 'assertPositiveBigInt(config.skewUnit, "skewUnit")' backend/src/modules/inventory/inventory.service.ts
grep -q 'assertBpsUpperBound(config.maxPositiveSkewBps, "maxPositiveSkewBps")' backend/src/modules/inventory/inventory.service.ts
grep -q 'cloneInventoryServiceConfig' backend/src/modules/inventory/inventory.service.ts
grep -q 'assertSettlementDelta(delta)' backend/src/modules/inventory/inventory.service.ts
grep -q 'assertInventorySkewInput(input)' backend/src/modules/inventory/inventory.service.ts
grep -q 'assertObject(input, "settlement delta")' backend/src/modules/inventory/inventory.service.ts
grep -q 'assertObject(input, "skew input")' backend/src/modules/inventory/inventory.service.ts
grep -Fq 'typeof value !== "string" || !/^[1-9][0-9]*$/.test(value)' backend/src/modules/inventory/inventory.service.ts
grep -q '`calculateQuoteSkewBps` output is also validated by Quote Service before Pricing Service is called' book/Volume3-RiskEngine/Chapter01-Inventory.md
grep -q 'malformed skew output is treated as `PRICING_UNAVAILABLE`' book/Volume3-RiskEngine/Chapter01-Inventory.md
grep -q '`projectSettlement` output is validated by Quote Service before Risk Service is called' book/Volume3-RiskEngine/Chapter01-Inventory.md
grep -q 'malformed projected inventory is treated as `RISK_ENGINE_UNAVAILABLE`' book/Volume3-RiskEngine/Chapter01-Inventory.md
grep -q 'InventoryService snapshots skew configuration at construction' backend/test/inventory.test.mjs
grep -q 'InventoryService rejects unsafe skew configuration at construction' backend/test/inventory-config-validation.test.mjs
grep -q 'InventoryService rejects malformed runtime payload envelopes before mutating balances' backend/test/inventory-validation.test.mjs
grep -q 'InventoryService rejects inherited runtime fields before mutating balances' backend/test/inventory-validation.test.mjs
grep -q 'Inventory config.skewUnit must be an own field' backend/test/inventory-config-validation.test.mjs
grep -q 'Inventory settlement delta.chainId must be an own field' backend/test/inventory-validation.test.mjs
grep -q 'Inventory settlement delta.amountOut must be an own field' backend/test/inventory-validation.test.mjs
grep -q 'Inventory skew input.chainId must be an own field' backend/test/inventory-validation.test.mjs
grep -q 'InventoryService rejects unsafe settlement inputs before mutating balances' backend/test/inventory-validation.test.mjs
grep -q 'InventoryService rejects unsafe projection and skew inputs' backend/test/inventory-validation.test.mjs
grep -q 'amountIn: "0100"' backend/test/inventory-validation.test.mjs
grep -q 'amountOut: "099"' backend/test/inventory-validation.test.mjs
grep -q 'amountIn: "010"' backend/test/inventory-replay-validation.test.mjs
grep -q 'rebuildFromSettlements' backend/src/modules/inventory/inventory.service.ts
grep -q 'InventoryService rebuilds inventory from settlement replay' backend/test/inventory.test.mjs
grep -q 'InventoryService rejects unsafe settlement replay before mutating balances' backend/test/inventory-replay-validation.test.mjs
grep -q 'Inventory settlement replay input must be an array' backend/src/modules/inventory/inventory.service.ts
grep -q 'Inventory replay validates the entire settlement delta batch before clearing balances' book/Volume3-RiskEngine/Chapter01-Inventory.md
grep -q 'inventory skew config fail-fast' book/Volume3-RiskEngine/Chapter01-Inventory.md
grep -q 'snapshots `InventoryServiceConfig` at construction after validation' book/Volume3-RiskEngine/Chapter01-Inventory.md
grep -q '`skewUnit` and skew bps caps must be own fields' book/Volume3-RiskEngine/Chapter01-Inventory.md
grep -q 'required settlement delta, projection and skew fields must be own fields' book/Volume3-RiskEngine/Chapter01-Inventory.md
grep -q 'canonical decimal form without leading zeros' book/Volume3-RiskEngine/Chapter01-Inventory.md
grep -q 'Malformed inventory config, settlement delta and skew root payloads are rejected before field access, balance mutation or replay clearing' book/Volume3-RiskEngine/Chapter01-Inventory.md
test -s backend/src/modules/hedge/hedge.service.ts
test -s backend/src/modules/hedge/postgres-hedge.service.ts
grep -q 'checkHealth' backend/src/modules/hedge/hedge.service.ts
test -s backend/src/modules/metrics/metrics.service.ts
grep -q 'checkHealth' backend/src/modules/metrics/metrics.service.ts
grep -q 'MetricsService sanitizes reason labels and renders core settlement metrics' backend/test/metrics.test.mjs
test -s backend/src/modules/pnl/pnl.service.ts
test -s backend/src/modules/pnl/postgres-pnl.store.ts
grep -q 'checkHealth' backend/src/modules/pnl/pnl.service.ts
test -s backend/src/modules/settlement/settlement-event.service.ts
test -s backend/src/modules/settlement/postgres-settlement-event.store.ts
test -s backend/src/db/migrations/002-settlement-canonical.sql
grep -q 'checkHealth' backend/src/modules/settlement/settlement-event.service.ts
test -s backend/src/modules/settlement/settlement-verifier.service.ts
test -s backend/src/modules/market-data/market-data.service.ts
test -s backend/src/modules/market-data/market-snapshot.repository.ts
grep -q 'interface MarketSnapshotStore' backend/src/modules/market-data/market-snapshot.repository.ts
grep -q 'class InMemoryMarketSnapshotRepository' backend/src/modules/market-data/market-snapshot.repository.ts
grep -q 'saveSnapshot(input: SaveMarketSnapshotInput)' backend/src/modules/market-data/market-snapshot.repository.ts
grep -q 'findBySnapshotId' backend/src/modules/market-data/market-snapshot.repository.ts
grep -q 'Market snapshot conflict for' backend/src/modules/market-data/market-snapshot.repository.ts
grep -q 'assertSaveMarketSnapshotInput(input)' backend/src/modules/market-data/market-snapshot.repository.ts
grep -q 'assertObject(input.request, "request")' backend/src/modules/market-data/market-snapshot.repository.ts
grep -q 'assertObject(input.snapshot, "snapshot")' backend/src/modules/market-data/market-snapshot.repository.ts
grep -q 'saveMarketSnapshotInputFields = \["request", "snapshot"\]' backend/src/modules/market-data/market-snapshot.repository.ts
grep -q 'saveMarketSnapshotOptionalFields = \["source"\]' backend/src/modules/market-data/market-snapshot.repository.ts
grep -q 'const marketSnapshotFields = \[' backend/src/modules/market-data/market-snapshot.repository.ts
grep -q '"marketSpreadBps"' backend/src/modules/market-data/market-snapshot.repository.ts
grep -q 'assertOwnFields(input, saveMarketSnapshotInputFields, "input")' backend/src/modules/market-data/market-snapshot.repository.ts
grep -q 'assertOwnOptionalFields(input, saveMarketSnapshotOptionalFields, "input")' backend/src/modules/market-data/market-snapshot.repository.ts
grep -q 'assertOwnFields(snapshot, marketSnapshotFields, "snapshot")' backend/src/modules/market-data/market-snapshot.repository.ts
grep -q 'Market snapshot ${path}.${field} must be an own field' backend/src/modules/market-data/market-snapshot.repository.ts
grep -q 'Market snapshot ${path}.${field} must be an own field when provided' backend/src/modules/market-data/market-snapshot.repository.ts
grep -q 'maxSafeIdentifierLength = 128' backend/src/modules/market-data/market-snapshot.repository.ts
grep -Fq 'safeIdentifierPattern = /^[A-Za-z0-9_:-]+$/' backend/src/modules/market-data/market-snapshot.repository.ts
grep -q 'assertMarketSnapshotIdentifier(snapshotId, "snapshotId")' backend/src/modules/market-data/market-snapshot.repository.ts
grep -q 'assertMarketSnapshotIdentifier(snapshot.snapshotId, "snapshotId")' backend/src/modules/market-data/market-snapshot.repository.ts
grep -q 'Market snapshot ${field} must be a primitive string' backend/src/modules/market-data/market-snapshot.repository.ts
grep -Fq 'typeof value === "string" && /^[1-9][0-9]*$/.test(value)' backend/src/modules/market-data/market-data.service.ts
grep -Fq 'typeof value === "string" && /^[1-9][0-9]*$/.test(value)' backend/src/modules/market-data/market-snapshot.repository.ts
grep -Fq '/^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(value)' backend/src/modules/market-data/market-data.service.ts
grep -Fq 'normalizeHumanPrice(value);' backend/src/modules/market-data/market-snapshot.repository.ts
grep -q 'parseCanonicalUtcIsoTimestamp(snapshot.observedAt)' backend/src/modules/market-data/market-data.service.ts
grep -q 'const marketSnapshotIssueFields = \[' backend/src/modules/market-data/market-data.service.ts
grep -q '"marketSpreadBps"' backend/src/modules/market-data/market-data.service.ts
grep -q 'hasOwnMarketSnapshotIssueFields(snapshot)' backend/src/modules/market-data/market-data.service.ts
grep -q 'snapshot freshness window is invalid' backend/src/modules/market-data/market-data.service.ts
grep -q 'Object.create(snapshot), "snapshot is invalid"' backend/test/market-data-validation.test.mjs
grep -q 'getMarketSnapshotIssue rejects unsafe freshness windows' backend/test/market-data-validation.test.mjs
grep -q 'getMarketSnapshotIssue()` 校验 `MarketSnapshot` 的 required own `snapshotId`' book/Volume2-MarketData-And-Pricing/Chapter01-Market-Data.md
grep -q 'isCanonicalUtcIsoTimestamp(snapshot.observedAt)' backend/src/modules/market-data/market-snapshot.repository.ts
grep -q 'Market snapshot observedAt must be a canonical UTC ISO timestamp' backend/test/market-snapshot-repository-validation.test.mjs
grep -q 'observedAt: "2026-06-29"' backend/test/market-data-validation.test.mjs
grep -q 'observedAt: "June 29, 2026"' backend/test/market-data-validation.test.mjs
grep -q 'observedAt: "2026-02-31T00:00:00.000Z"' backend/test/market-data-validation.test.mjs
grep -q 'marketSnapshotStore: MarketSnapshotStore' $quote_service_sources
grep -q 'await this.saveMarketSnapshot' $quote_service_sources
grep -q 'marketSnapshotStoreStatus' backend/src/modules/health/readiness.service.ts
grep -q 'marketSnapshotStore' backend/src/modules/metrics/metrics.service.ts
grep -q 'getMarketSnapshotIssue' backend/src/modules/market-data/market-data.service.ts
grep -q 'defaultStaticMarketDataConfig' backend/src/modules/market-data/market-data.service.ts
grep -q 'Market data pair is not configured' backend/src/modules/market-data/market-data.service.ts
grep -q 'defaultMaxSnapshotFutureSkewMs' backend/src/modules/market-data/market-data.service.ts
grep -q 'snapshot timestamp is too far in the future' backend/src/modules/market-data/market-data.service.ts
grep -q 'mid price is invalid' backend/src/modules/market-data/market-data.service.ts
grep -q 'liquidity is invalid' backend/src/modules/market-data/market-data.service.ts
grep -q 'assertStaticMarketDataConfig' backend/src/modules/market-data/market-data.service.ts
grep -q 'assertObject(config, "config")' backend/src/modules/market-data/market-data.service.ts
grep -q 'assertObject(pair, "supportedPairs entry")' backend/src/modules/market-data/market-data.service.ts
grep -q 'assertObject(request, "request")' backend/src/modules/market-data/market-data.service.ts
grep -q 'staticMarketDataConfigFields = \["supportedPairs"\]' backend/src/modules/market-data/market-data.service.ts
grep -q 'staticMarketDataPairFields = \["chainId", "tokenIn", "tokenOut"\]' backend/src/modules/market-data/market-data.service.ts
grep -q 'quoteRequestFields = \["chainId", "user", "tokenIn", "tokenOut", "amountIn", "slippageBps"\]' backend/src/modules/market-data/market-data.service.ts
grep -q 'assertOwnFields(config, staticMarketDataConfigFields, "config")' backend/src/modules/market-data/market-data.service.ts
grep -q 'assertOwnFields(pair, staticMarketDataPairFields, "supportedPairs entry")' backend/src/modules/market-data/market-data.service.ts
grep -q 'assertOwnFields(request, quoteRequestFields, "request")' backend/src/modules/market-data/market-data.service.ts
grep -q 'Static market data ${path}.${field} must be an own field' backend/src/modules/market-data/market-data.service.ts
grep -q 'cloneStaticMarketDataConfig' backend/src/modules/market-data/market-data.service.ts
grep -q 'Static market data supportedPairs must not contain duplicate pairs' backend/src/modules/market-data/market-data.service.ts
grep -q 'getMarketSnapshotIssue rejects stale or future-skewed market snapshots' backend/test/market-data-validation.test.mjs
grep -q 'StaticMarketDataService rejects unconfigured token pairs' backend/test/market-data.test.mjs
grep -q 'StaticMarketDataService returns unique pair snapshots' backend/test/market-data.test.mjs
grep -q 'StaticMarketDataService snapshots supported pairs at construction' backend/test/market-data.test.mjs
grep -q 'StaticMarketDataService rejects unsafe static market data config' backend/test/market-data-validation.test.mjs
grep -q 'StaticMarketDataService rejects unsafe snapshot requests before lookup' backend/test/market-data-validation.test.mjs
grep -q 'Static market data config must be an object' backend/test/market-data-validation.test.mjs
grep -q 'Static market data config.supportedPairs must be an own field' backend/test/market-data-validation.test.mjs
grep -q 'Static market data supportedPairs entry must be an object' backend/test/market-data-validation.test.mjs
grep -q 'Static market data supportedPairs entry.chainId must be an own field' backend/test/market-data-validation.test.mjs
grep -q 'Static market data request.chainId must be an own field' backend/test/market-data-validation.test.mjs
grep -q 'Static market data request.amountIn must be a positive uint string' backend/test/market-data-validation.test.mjs
grep -q 'Static market data request.slippageBps must be less than or equal to 10000 bps' backend/test/market-data-validation.test.mjs
grep -q 'InMemoryMarketSnapshotRepository stores idempotent market snapshots' backend/test/market-data.test.mjs
grep -q 'InMemoryMarketSnapshotRepository rejects malformed snapshot payload envelopes before storing' backend/test/market-snapshot-repository-validation.test.mjs
grep -q 'InMemoryMarketSnapshotRepository rejects inherited snapshot payload fields before storing' backend/test/market-snapshot-repository-validation.test.mjs
grep -q 'Market snapshot input.request must be an own field' backend/test/market-snapshot-repository-validation.test.mjs
grep -q 'Market snapshot snapshot.snapshotId must be an own field' backend/test/market-snapshot-repository-validation.test.mjs
grep -q 'Market snapshot input.source must be an own field when provided' backend/test/market-snapshot-repository-validation.test.mjs
grep -q 'InMemoryMarketSnapshotRepository rejects conflicts and unsafe snapshots' backend/test/market-snapshot-repository-validation.test.mjs
grep -q 'midPrice: "01.25"' backend/test/market-snapshot-repository-validation.test.mjs
grep -q 'liquidityUsd: "01000000000000"' backend/test/market-snapshot-repository-validation.test.mjs
grep -q 'InMemoryMarketSnapshotRepository returns defensive copies' backend/test/market-data.test.mjs
grep -q 'InMemoryMarketSnapshotRepository rejects unsafe snapshot lookup identifiers' backend/test/market-snapshot-repository-validation.test.mjs
grep -q 'Market snapshot snapshotId must be a primitive string' backend/test/market-snapshot-repository-validation.test.mjs
grep -q 'Market snapshot snapshotId must contain only letters, numbers, underscore, colon, or hyphen' backend/test/market-snapshot-repository-validation.test.mjs
grep -q 'Market snapshot snapshotId must be 128 characters or fewer' backend/test/market-snapshot-repository-validation.test.mjs
grep -q 'QuoteService persists market snapshots before downstream quote side effects' backend/test/quote-service-market-routing-dependencies.test.mjs
grep -q 'QuoteService blocks routing and signer when market snapshot persistence fails' backend/test/quote-service-market-routing-dependencies.test.mjs
grep -q 'QuoteService marks requested quotes as failed when routing is unavailable' backend/test/quote-service-market-routing-dependencies.test.mjs
grep -q 'QuoteService rejects malformed route plans before pricing and signing' backend/test/quote-service-market-routing-dependencies.test.mjs
grep -q 'internalVenue: "external"' backend/test/quote-service-market-routing-dependencies.test.mjs
grep -q 'assert.equal(pricingAttempts, 0)' backend/test/quote-service-market-routing-dependencies.test.mjs
grep -q 'QuoteService marks requested quotes as failed when pricing is unavailable' backend/test/quote-service-dependencies.test.mjs
grep -q 'QuoteService rejects malformed inventory and hedge pricing adjustments before pricing' backend/test/quote-service-dependencies.test.mjs
grep -q 'hedgeRiskPenaltyBps: "25"' backend/test/quote-service-dependencies.test.mjs
grep -q 'inventorySkewBps: 9_990' backend/test/quote-service-dependencies.test.mjs
grep -q 'QuoteService fails closed on malformed inventory projections before signing' backend/test/quote-service-pricing-dependencies.test.mjs
grep -q 'internalExposure: "unsafe"' backend/test/quote-service-pricing-dependencies.test.mjs
grep -q 'assert.equal(riskAttempts, 0)' backend/test/quote-service-pricing-dependencies.test.mjs
grep -q '快照 `StaticMarketDataConfig`' book/Volume2-MarketData-And-Pricing/Chapter01-Market-Data.md
grep -q 'Config 的 `supportedPairs` 必须是 own field' book/Volume2-MarketData-And-Pricing/Chapter01-Market-Data.md
grep -q '每个 supported pair 的 `chainId`、`tokenIn` 和 `tokenOut` 也必须是 own fields' book/Volume2-MarketData-And-Pricing/Chapter01-Market-Data.md
grep -q 'inherited config fields, malformed `supportedPairs` entries and inherited pair fields before reading chain/token fields' book/Volume2-MarketData-And-Pricing/Chapter01-Market-Data.md
grep -q 'Runtime `getSnapshot(request)` also requires request fields to be own fields' book/Volume2-MarketData-And-Pricing/Chapter01-Market-Data.md
grep -q 'InMemoryMarketSnapshotRepository` mirrors the PostgreSQL market_snapshots contract' book/Volume2-MarketData-And-Pricing/Chapter01-Market-Data.md
grep -q '`snapshotId` must be an own primitive-string `SafeIdentifier` with 1-128 characters' book/Volume2-MarketData-And-Pricing/Chapter01-Market-Data.md
grep -q '`source` remains a non-empty source label and must be an own field when provided' book/Volume2-MarketData-And-Pricing/Chapter01-Market-Data.md
grep -q 'canonical positive decimal string without leading zeros' book/Volume2-MarketData-And-Pricing/Chapter01-Market-Data.md
grep -q 'canonical positive uint string without leading zeros' book/Volume2-MarketData-And-Pricing/Chapter01-Market-Data.md
grep -q '`observedAt` 必须是 `Date.prototype.toISOString()` 生成的 canonical UTC ISO timestamp' book/Volume2-MarketData-And-Pricing/Chapter01-Market-Data.md
grep -q 'snapshot lookup validates `snapshotId` before reading the store' book/Volume2-MarketData-And-Pricing/Chapter01-Market-Data.md
grep -q 'Snapshot persistence rejects malformed root payloads, missing `request` / `snapshot` objects, inherited `request` / `snapshot` / `source` fields' book/Volume2-MarketData-And-Pricing/Chapter01-Market-Data.md
grep -q 'persists MarketSnapshotStore audit records before routing' book/Volume5-BackendEngineering/Chapter02-Quote-Service.md
grep -q 'Requested quote persistence happens immediately after market snapshot persistence and before routing or pricing' book/Volume5-BackendEngineering/Chapter02-Quote-Service.md
grep -q '`observedAt`，该字段必须是 `Date.prototype.toISOString()` 生成的 canonical UTC ISO timestamp' book/Volume5-BackendEngineering/Chapter02-Quote-Service.md
grep -q 'runtime `MarketSnapshotStore` 必须镜像 `market_snapshots` 表的核心契约' docs/database/er-diagram.md
test -s backend/src/modules/rate-limit/rate-limit.service.ts
test -s backend/src/shared/errors/api-error.ts
grep -q 'APIError serializes stable client responses without internal reason codes' backend/test/api-error.test.mjs
test -s backend/src/modules/routing/routing.engine.ts
grep -q 'InternalInventoryRoutingEngine creates deterministic internal inventory route plans' backend/test/routing.test.mjs
grep -q 'assertRouteInput(input)' backend/src/modules/routing/routing.engine.ts
grep -q 'assertObject(input.request, "request")' backend/src/modules/routing/routing.engine.ts
grep -q 'assertObject(input.snapshot, "snapshot")' backend/src/modules/routing/routing.engine.ts
grep -q 'routeInputFields = \["request", "snapshot"\]' backend/src/modules/routing/routing.engine.ts
grep -q 'quoteRequestFields = \["chainId", "user", "tokenIn", "tokenOut", "amountIn", "slippageBps"\]' backend/src/modules/routing/routing.engine.ts
grep -q 'routeSnapshotFields = \["snapshotId", "midPrice", "liquidityUsd", "marketSpreadBps", "volatilityBps"\]' backend/src/modules/routing/routing.engine.ts
grep -q 'assertOwnFields(input, routeInputFields, "input")' backend/src/modules/routing/routing.engine.ts
grep -q 'assertOwnFields(input.request, quoteRequestFields, "request")' backend/src/modules/routing/routing.engine.ts
grep -q 'assertOwnFields(input.snapshot, routeSnapshotFields, "snapshot")' backend/src/modules/routing/routing.engine.ts
grep -q 'Routing ${path}.${field} must be an own field' backend/src/modules/routing/routing.engine.ts
grep -q 'maxSafeIdentifierLength = 128' backend/src/modules/routing/routing.engine.ts
grep -Fq 'safeIdentifierPattern = /^[A-Za-z0-9_:-]+$/' backend/src/modules/routing/routing.engine.ts
grep -q 'assertSafeIdentifier(input.snapshot.snapshotId, "snapshot.snapshotId")' backend/src/modules/routing/routing.engine.ts
grep -q 'Routing ${field} must be a primitive string' backend/src/modules/routing/routing.engine.ts
grep -q 'Routing request token pair must contain distinct tokens' backend/src/modules/routing/routing.engine.ts
grep -Fq 'typeof value !== "string" || !/^[1-9][0-9]*$/.test(value)' backend/src/modules/routing/routing.engine.ts
grep -Fq '/^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(value)' backend/src/modules/routing/routing.engine.ts
grep -q 'InternalInventoryRoutingEngine rejects malformed route payload envelopes before planning' backend/test/routing.test.mjs
grep -q 'InternalInventoryRoutingEngine rejects inherited route input fields before planning' backend/test/routing.test.mjs
grep -q 'InternalInventoryRoutingEngine rejects unsafe route inputs before planning' backend/test/routing.test.mjs
grep -q 'Routing input.request must be an own field' backend/test/routing.test.mjs
grep -q 'Routing request.chainId must be an own field' backend/test/routing.test.mjs
grep -q 'Routing snapshot.snapshotId must be an own field' backend/test/routing.test.mjs
grep -q 'amountIn: "01000000000"' backend/test/routing.test.mjs
grep -q 'midPrice: "01.25"' backend/test/routing.test.mjs
grep -q 'liquidityUsd: "0250000000000"' backend/test/routing.test.mjs
grep -q 'Routing snapshot.snapshotId must be a primitive string' backend/test/routing.test.mjs
grep -q 'Routing snapshot.snapshotId must contain only letters, numbers, underscore, colon, or hyphen' backend/test/routing.test.mjs
grep -q 'Routing snapshot.snapshotId must be 128 characters or fewer' backend/test/routing.test.mjs
grep -q 'missing required own top-level `request` / `snapshot` fields fail before nested field access' book/Volume5-BackendEngineering/Chapter03-Pricing-Service.md
grep -q 'request and routing snapshot required fields must be own fields' book/Volume5-BackendEngineering/Chapter03-Pricing-Service.md
grep -q 'canonical positive `amountIn` without leading zeros' book/Volume5-BackendEngineering/Chapter03-Pricing-Service.md
grep -q '`snapshot.snapshotId` as a primitive-string `SafeIdentifier` with 1-128 characters' book/Volume5-BackendEngineering/Chapter03-Pricing-Service.md
test -s backend/src/shared/validation/quote-request.ts
test -s backend/src/shared/validation/submit-request.ts
test -s backend/src/shared/validation/timestamp.ts
grep -q 'validateSubmitQuoteRequest rejects unsafe submit payloads before execution' backend/test/submit-validation.test.mjs
test -s frontend/src/lib/rfq.ts
test -s frontend/src/lib/config.ts
test -s frontend/src/lib/errors.ts
test -s frontend/src/lib/integer-input.ts
test -s frontend/src/vite-env.d.ts
test -s frontend/src/app/web3.tsx
test -s frontend/src/pages/QuotePage.tsx
test -s frontend/src/components/WalletSubmitControl.tsx
test -s frontend/test/config.test.mjs
test -s frontend/test/integer-input.test.mjs
test -s frontend/test/quote-request.test.mjs
test -s frontend/test/rfq.test.mjs
test -s sdk/src/abi.ts
test -s sdk/src/client-error.ts
test -s sdk/src/client-request.ts
test -s sdk/src/client-response-validation.ts
test -s sdk/src/client-trading-responses.ts
test -s sdk/src/client-accounting-responses.ts
test -s sdk/src/eip712.ts
test -s sdk/src/index.ts
test -s sdk/src/quote-hash.ts
test -s sdk/src/settlement.ts
test -s sdk/test/sdk-client-config.test.mjs
test -s sdk/test/sdk-client-errors.test.mjs
test -s sdk/test/sdk-client-requests.test.mjs
test -s sdk/test/sdk-client-accounting-responses.test.mjs
test -s sdk/test/sdk-client-responses.test.mjs
test -s sdk/test/sdk-client-status-responses.test.mjs
test -s sdk/test/sdk-settlement.test.mjs
test -s sdk/test/sdk-settlement-validation.test.mjs
test -s sdk/test/sdk.test.mjs
test -s scripts/check-sdk-composition-consistency.mjs
test -s contracts/src/RFQSettlement.sol
test -s contracts/test/RFQSettlement.t.sol
test -s contracts/test/Deploy.t.sol
test -s examples/quote-request.json
test -s examples/submit-request.json
test -s scripts/check-examples-consistency.mjs
grep -q 'assertPositiveUint(submitRequest.quote.nonce, "submitRequest.quote.nonce")' scripts/check-examples-consistency.mjs
grep -Fq '/^[1-9][0-9]*$/.test(value)' scripts/check-examples-consistency.mjs
grep -q 'positive uint string without leading zeros' scripts/check-examples-consistency.mjs
! grep -q 'BigInt(value) > 0n' scripts/check-examples-consistency.mjs
test -s scripts/check-config-consistency.mjs
test -s scripts/check-book-template-consistency.mjs
test -s scripts/check-adr-consistency.mjs
test -s scripts/check-security-docs-consistency.mjs
test -s scripts/check-metrics-consistency.mjs
test -s scripts/check-runbook-consistency.mjs
test -s scripts/check-grafana-dashboard-consistency.mjs
test -s scripts/check-deployment-manifests-consistency.mjs
test -s scripts/check-ci-workflows-consistency.mjs
test -s scripts/check-eip712-consistency.mjs
test -s scripts/check-contract-abi-consistency.mjs
test -s scripts/check-rate-limit-consistency.mjs
test -s scripts/check-api-error-consistency.mjs
test -s scripts/check-api-schema-consistency.mjs
test -s scripts/check-api-route-consistency.mjs
test -s scripts/check-database-schema-consistency.mjs
test -s scripts/reconciliation-check.mjs
test -s scripts/verify.sh
test -s scripts/check-kms-signer-consistency.mjs
test -s scripts/smoke-api.mjs
test -s scripts/smoke-api-local.sh
test -s infra/docker/backend.Dockerfile
test -s infra/docker/frontend.Dockerfile
grep -q 'ENV HOST=0.0.0.0' infra/docker/backend.Dockerfile
grep -q 'ENV PORT=3000' infra/docker/backend.Dockerfile
grep -q 'COPY package.json pnpm-lock.yaml pnpm-workspace.yaml' infra/docker/backend.Dockerfile
grep -q 'COPY sdk/package.json sdk/package.json' infra/docker/backend.Dockerfile
grep -q 'COPY sdk/src sdk/src' infra/docker/backend.Dockerfile
grep -q '@rfq-market-maker/backend\.\.\.' infra/docker/backend.Dockerfile
grep -q -- '--frozen-lockfile' infra/docker/backend.Dockerfile
grep -q -- '--no-optional' infra/docker/backend.Dockerfile
grep -q 'HEALTHCHECK' infra/docker/backend.Dockerfile
grep -q 'http://127.0.0.1:3000/health' infra/docker/backend.Dockerfile
grep -q '^USER node$' infra/docker/backend.Dockerfile
grep -q 'FROM nginx:1.27-alpine AS runtime' infra/docker/frontend.Dockerfile
grep -q 'COPY package.json pnpm-lock.yaml pnpm-workspace.yaml' infra/docker/frontend.Dockerfile
grep -q -- '--frozen-lockfile' infra/docker/frontend.Dockerfile
grep -q 'apk add --no-cache python3 make g++' infra/docker/frontend.Dockerfile
grep -q 'ENV npm_config_nodedir=/usr/local' infra/docker/frontend.Dockerfile
grep -q 'COPY frontend/public frontend/public' infra/docker/frontend.Dockerfile
! grep -q '^ARG VITE_RFQ_' infra/docker/frontend.Dockerfile
grep -q 'COPY sdk/src sdk/src' infra/docker/frontend.Dockerfile
grep -q '@rfq-market-maker/frontend\.\.\.' infra/docker/frontend.Dockerfile
grep -q 'pnpm --filter @rfq-market-maker/frontend build' infra/docker/frontend.Dockerfile
grep -q 'HEALTHCHECK' infra/docker/frontend.Dockerfile
grep -q 'http://127.0.0.1:8080/' infra/docker/frontend.Dockerfile
grep -q '^USER nginx$' infra/docker/frontend.Dockerfile
test -s infra/docker/nginx.conf
test -s scripts/container-runtime-check.sh
test -s infra/k8s/backend-horizontal-pod-autoscaler.yaml
test -s infra/k8s/pod-disruption-budgets.yaml
test -s infra/helm/rfq-market-maker/templates/horizontal-pod-autoscaler.yaml
test -s infra/helm/rfq-market-maker/templates/pod-disruption-budgets.yaml
grep -q 'pid /tmp/nginx.pid' infra/docker/nginx.conf
grep -q 'listen 8080' infra/docker/nginx.conf
grep -q 'container-runtime-check' Makefile
grep -q 'kind: HorizontalPodAutoscaler' infra/k8s/backend-horizontal-pod-autoscaler.yaml
test "$(grep -c 'kind: PodDisruptionBudget' infra/k8s/pod-disruption-budgets.yaml)" -eq 8
test "$(grep -h -c 'topologySpreadConstraints:' infra/k8s/*-deployment.yaml | awk '{ total += $1 } END { print total }')" -eq 7
grep -q 'define "rfq-market-maker.topologySpreadConstraints"' infra/helm/rfq-market-maker/templates/_helpers.tpl
grep -q 'topology.kubernetes.io/zone' infra/helm/rfq-market-maker/values.yaml
grep -q 'backend:' docker-compose.yml
grep -q 'frontend:' docker-compose.yml
grep -q 'postgres:' docker-compose.yml
grep -q 'condition: service_healthy' docker-compose.yml
grep -q 'dockerfile: infra/docker/backend.Dockerfile' docker-compose.yml
grep -q 'dockerfile: infra/docker/frontend.Dockerfile' docker-compose.yml
test -s frontend/public/runtime-config.js
grep -q 'window.__RFQ_RUNTIME_CONFIG__' frontend/public/runtime-config.js
grep -q 'src="/runtime-config.js"' frontend/index.html
grep -q 'pg_isready -U rfq -d rfq_market_maker' docker-compose.yml
grep -q './docs/database/schema.sql:/docker-entrypoint-initdb.d/001-schema.sql:ro' docker-compose.yml
grep -q 'redis-cli' docker-compose.yml
grep -q "clickhouse-client --query 'SELECT 1'" docker-compose.yml
grep -q 'backend:3000' infra/prometheus/prometheus.yml
grep -q 'node_modules' .dockerignore
grep -q '.pnpm-store' .dockerignore
grep -q 'frontend/dist' .dockerignore
test -s infra/prometheus/prometheus.yml
test -s infra/prometheus/rules/rfq-alerts.yml
test -s infra/grafana/provisioning/datasources/prometheus.yml
test -s infra/k8s/backend-deployment.yaml
test -s infra/k8s/backend-secret.yaml
test -s infra/k8s/network-policy.yaml
test -s infra/k8s/cilium-fqdn-egress-policy.yaml
test -s infra/helm/rfq-market-maker/Chart.yaml
test -s infra/helm/rfq-market-maker/values.schema.json
test -s infra/helm/rfq-market-maker/templates/network-policy.yaml
test -s infra/helm/rfq-market-maker/templates/cilium-fqdn-egress-policy.yaml
test -s scripts/check-transport-security-consistency.mjs
test -s scripts/smoke-api.sh

grep -q 'server.post("/quote"' $gateway_sources
grep -q 'server.post("/submit"' $gateway_sources
grep -q 'server.get("/quote/:quoteId"' $gateway_sources
grep -q 'quoteService.getQuoteStatus' $gateway_sources
grep -q 'server.get("/settlements/:settlementEventId"' $gateway_sources
grep -q 'server.get("/hedges/:hedgeOrderId"' $gateway_sources
grep -q 'server.get("/pnl"' $gateway_sources
grep -q 'assertStatusIdentifier' $gateway_sources
grep -q 'function assertStatusIdentifier' $gateway_sources
grep -q '${field} must be a primitive string' $gateway_sources
grep -q 'maxStatusIdentifierLength' $gateway_sources
grep -q 'maxStatusIdentifierRouteParamLength' $gateway_sources
grep -q 'maxParamLength: maxStatusIdentifierRouteParamLength' $gateway_sources
grep -q 'statusIdentifierPattern' $gateway_sources
grep -q 'RFQ API rejects unsafe status path identifiers before store lookup' backend/test/api-status.test.mjs
grep -q 'quoteId must be 128 characters or fewer' backend/test/api-status.test.mjs
grep -q 'settlementEventId must contain only letters, numbers, underscore, colon, or hyphen' backend/test/api-status.test.mjs
grep -q 'primitive-string `SafeIdentifier` values with 1-128 characters' book/Volume5-BackendEngineering/Chapter01-API-Gateway.md
grep -q 'Status endpoints reject unsafe dynamic identifiers before store lookup' book/Volume5-BackendEngineering/Chapter01-API-Gateway.md
grep -q 'server.get("/ready"' $gateway_sources
grep -q 'readiness.status === "degraded"' $gateway_sources
grep -q 'server.get("/metrics"' $gateway_sources
grep -q 'validateQuoteRequest' $gateway_sources
grep -q 'validateSubmitQuoteRequest' $gateway_sources
grep -q 'must include field' backend/src/shared/validation/object-fields.ts
grep -q 'hasOwnProperty.call(input, field)' backend/src/shared/validation/object-fields.ts
grep -q 'positive safe integer' backend/src/shared/validation/quote-request.ts
grep -q 'positive safe integer' backend/src/shared/validation/submit-request.ts
grep -q 'isBoxedString' backend/src/shared/validation/quote-request.ts
grep -q 'isBoxedString' backend/src/shared/validation/submit-request.ts
grep -Fq 'POSITIVE_UINT_PATTERN = /^[1-9][0-9]*$/' backend/src/shared/validation/quote-request.ts
grep -Fq 'POSITIVE_UINT_PATTERN = /^[1-9][0-9]*$/' backend/src/shared/validation/submit-request.ts
grep -q 'typeof input !== "number"' backend/src/shared/validation/quote-request.ts
grep -q 'typeof input !== "string"' backend/src/shared/validation/submit-request.ts
grep -q 'rejects request JSON primitive types that would require coercion' backend/test/api-validation.test.mjs
grep -q 'RFQ API rejects missing required request fields' backend/test/api-validation.test.mjs
grep -q 'rejects non-schema JSON primitive types before coercion' backend/test/validation.test.mjs
grep -q 'validateSubmitQuoteRequest rejects non-schema JSON primitive types before coercion' backend/test/submit-schema-validation.test.mjs
grep -q 'validateQuoteRequest rejects missing required fields before field validation' backend/test/validation.test.mjs
grep -q 'validateSubmitQuoteRequest rejects missing required fields before field validation' backend/test/submit-schema-validation.test.mjs
grep -q 'Quote request must include field amountIn' backend/test/validation.test.mjs
grep -q 'Submit quote must include field nonce' backend/test/submit-schema-validation.test.mjs
grep -q 'validateQuoteRequest rejects boxed string fields before regex coercion' backend/test/validation.test.mjs
grep -q 'validateSubmitQuoteRequest rejects boxed string fields before regex coercion' backend/test/submit-schema-validation.test.mjs
grep -q 'signature must be a primitive string' backend/test/submit-schema-validation.test.mjs
grep -q '001000000000' backend/test/validation.test.mjs
grep -q '0998400000' backend/test/submit-validation.test.mjs
grep -q '不能用 `Number()` 或 `String()`' docs/api/errors.md
grep -q 'required fields、unknown fields' docs/api/errors.md
grep -q '校验 required fields、unknown fields' book/Volume5-BackendEngineering/Chapter01-API-Gateway.md
grep -q 'boxed `String` 直接调用输入' docs/api/errors.md
grep -q 'boxed `String` 字段隐式解包' book/Volume5-BackendEngineering/Chapter01-API-Gateway.md
grep -Fq '^[1-9][0-9]*$' docs/api/errors.md
grep -q 'assertExactFields' backend/src/shared/validation/quote-request.ts
grep -q 'assertExactFields' backend/src/shared/validation/submit-request.ts
grep -q 'canonicalUtcIsoTimestampPattern' backend/src/shared/validation/timestamp.ts
grep -q 'parseCanonicalUtcIsoTimestamp' backend/src/shared/validation/timestamp.ts
grep -q 'new Date(parsed).toISOString() === value' backend/src/shared/validation/timestamp.ts
grep -q 'unknown request fields' backend/test/api-validation.test.mjs
grep -q 'function assertResponseFields' backend/test/api.test.mjs
grep -Fq 'assertResponseFields(quote.body, ["quoteId", "snapshotId", "amountOut", "minAmountOut", "deadline", "nonce", "signature"])' backend/test/api.test.mjs
grep -Fq 'assertResponseFields(submit.body, ["status", "txHash", "settlementEventId", "hedgeOrderId", "pnlId"])' backend/test/api.test.mjs
grep -q 'assertResponseFields(status.body' backend/test/api.test.mjs
grep -q 'assertResponseFields(settlement.body' backend/test/api.test.mjs
grep -q 'assertResponseFields(hedge.body' backend/test/api.test.mjs
grep -Fq 'assertResponseFields(pnl.body, ["status", "totalTrades", "totals", "trades", "hedgeNet"])' backend/test/api.test.mjs
grep -q 'assertResponseFields(pnl.body.trades\[0\]' backend/test/api.test.mjs
grep -q 'successful response bodies must be closed field sets matching OpenAPI' book/Volume5-BackendEngineering/Chapter01-API-Gateway.md
grep -q 'RFQ API returns closed structured error responses' backend/test/api-validation-gateway.test.mjs
grep -q 'function assertClosedErrorResponse' backend/test/api-validation-gateway.test.mjs
grep -Fq 'assertResponseFields(response.body, ["code", "message", "traceId"])' backend/test/api-validation-gateway.test.mjs
grep -q '/closed-internal-error' backend/test/api-validation-gateway.test.mjs
grep -q 'Malformed JSON request body' backend/test/api-validation-gateway.test.mjs
grep -q 'Gateway error response bodies must be closed `ErrorResponse` field sets' book/Volume5-BackendEngineering/Chapter01-API-Gateway.md
grep -q 'Number.MAX_SAFE_INTEGER + 1' backend/test/api-validation.test.mjs
grep -q 'additionalProperties: false' docs/api/openapi.yaml
grep -q 'PositiveUIntString' docs/api/openapi.yaml
grep -Fq 'pattern: "^[1-9][0-9]*$"' docs/api/openapi.yaml
grep -q 'Canonical UTC ISO timestamp generated with Date.prototype.toISOString().' docs/api/openapi.yaml
grep -q 'maximum: 9007199254740991' docs/api/openapi.yaml
grep -q 'JavaScript safe integer maximum' scripts/check-api-schema-consistency.mjs
grep -q 'QuoteStatus", "deadline"' scripts/check-api-schema-consistency.mjs
grep -q 'HedgeIntentStatus", "chainId"' scripts/check-api-schema-consistency.mjs
grep -q 'positive safe integer minimum' scripts/check-api-schema-consistency.mjs
grep -q 'non-negative safe integer minimum' scripts/check-api-schema-consistency.mjs
grep -q 'PositiveUIntString must reject zero, negative values, and leading zeros' scripts/check-api-schema-consistency.mjs
grep -q 'SignedQuote", "nonce"' scripts/check-api-schema-consistency.mjs
grep -q 'must reject unknown fields' scripts/check-api-schema-consistency.mjs
grep -q 'backend/src/modules/health/readiness.service.ts' scripts/check-api-schema-consistency.mjs
grep -q 'readSdkClientSource' scripts/check-api-schema-consistency.mjs
grep -q 'sdk/src/client.ts' scripts/lib/read-sdk-client-source.mjs
grep -q 'SDK ReadinessComponentName must match backend readiness components' scripts/check-api-schema-consistency.mjs
grep -q 'SDK client readiness runtime components must match backend readiness components' scripts/check-api-schema-consistency.mjs
grep -q 'ReadinessResponse.components OpenAPI properties must match backend readiness components' scripts/check-api-schema-consistency.mjs
grep -q 'ReadinessResponse.components OpenAPI schema must reject unknown readiness components' scripts/check-api-schema-consistency.mjs
grep -q 'const closedOpenApiSchemas = \[' scripts/check-api-schema-consistency.mjs
grep -q '"QuoteResponse"' scripts/check-api-schema-consistency.mjs
grep -q '"SubmitQuoteResponse"' scripts/check-api-schema-consistency.mjs
grep -q '"QuoteStatus"' scripts/check-api-schema-consistency.mjs
grep -q '"HedgeIntentStatus"' scripts/check-api-schema-consistency.mjs
grep -q '"SettlementEventStatus"' scripts/check-api-schema-consistency.mjs
grep -q '"PnlTradeRecord"' scripts/check-api-schema-consistency.mjs
grep -q '"PnlSummary"' scripts/check-api-schema-consistency.mjs
grep -q 'OpenAPI schema must reject unknown fields with additionalProperties: false' scripts/check-api-schema-consistency.mjs
grep -q 'OpenAPI ReadinessComponentStatus enum must match backend' scripts/check-api-schema-consistency.mjs
grep -q 'inlineEnumMappings' scripts/check-api-schema-consistency.mjs
grep -q 'extractInterfacePropertyStringUnionValues' scripts/check-api-schema-consistency.mjs
grep -Fq '["HedgeIntentStatusResponse", "HedgeIntentStatus", "HedgeIntentStatus", "reason"]' scripts/check-api-schema-consistency.mjs
grep -Fq 'SDK ${sdkName}.${propertyName} enum must match backend ${backendName}.${propertyName}' scripts/check-api-schema-consistency.mjs
grep -Fq 'OpenAPI ${openapiName}.${propertyName} enum must match backend ${backendName}.${propertyName}' scripts/check-api-schema-consistency.mjs
grep -q 'OpenAPI HealthResponse.status enum must match SDK' scripts/check-api-schema-consistency.mjs
grep -q 'sdkRuntimeEnumMappings' scripts/check-api-schema-consistency.mjs
grep -q 'extractSdkRuntimeEnumGuardValues' scripts/check-api-schema-consistency.mjs
grep -q 'extractInterfacePropertyEnumValues' scripts/check-api-schema-consistency.mjs
grep -Fq '["HedgeIntentStatus", "reason", "assertHedgeIntentStatus"]' scripts/check-api-schema-consistency.mjs
grep -Fq 'SDK runtime ${functionName} ${sdkName}.${propertyName} enum guard must match SDK type' scripts/check-api-schema-consistency.mjs
grep -Fq 'SDK runtime ${functionName} ${sdkName}.${propertyName} enum guard must match OpenAPI' scripts/check-api-schema-consistency.mjs
grep -q 'SDK runtime isReadinessComponents component status guard must match SDK ReadinessComponentStatus' scripts/check-api-schema-consistency.mjs
grep -q 'OpenAPI ReadinessResponse.status enum must match backend' scripts/check-api-schema-consistency.mjs
grep -q 'extractConstStringArray' scripts/check-api-schema-consistency.mjs
grep -q 'extractOpenApiNestedObjectSchema' scripts/check-api-schema-consistency.mjs
grep -q 'QuoteResponse.signature must be a 65-byte canonical low-s EIP-712 signature' scripts/check-api-schema-consistency.mjs
grep -q 'SubmitQuoteResponse", "QuoteStatus", "SettlementEventStatus' scripts/check-api-schema-consistency.mjs
grep -q 'txHash must be a 32-byte transaction hash' scripts/check-api-schema-consistency.mjs
grep -q 'InMemoryRateLimiter' $gateway_sources
grep -q 'RATE_LIMITED' $gateway_sources
grep -q 'retry-after' $gateway_sources
grep -q 'signature must be 65 bytes' backend/src/shared/validation/submit-request.ts
grep -q 'SECP256K1N_HALF' backend/src/shared/validation/submit-request.ts
grep -q 'signature s value must be in the lower half order' backend/src/shared/validation/submit-request.ts
grep -q 'signature v value must be 27 or 28' backend/src/shared/validation/submit-request.ts
grep -q 'signature s value must be in the lower half order' backend/test/submit-validation.test.mjs
grep -q 'signature v value must be 27 or 28' backend/test/api-validation.test.mjs
grep -q 'canonical low-s EIP-712 signature' docs/api/openapi.yaml
grep -q 'rejects non-canonical signatures before quote lookup' book/Volume5-BackendEngineering/Chapter06-Execution-Service.md
grep -q 'readPositiveUint' backend/src/shared/validation/submit-request.ts
grep -q 'nonce: readPositiveUint(quote.nonce, "quote.nonce")' backend/src/shared/validation/submit-request.ts
grep -q 'greater than or equal to quote.minAmountOut' backend/src/shared/validation/submit-request.ts
grep -q 'QUOTE_EXPIRED' backend/src/shared/validation/submit-request.ts
grep -q 'InMemoryQuoteRepository' $gateway_sources
grep -q 'new InventoryService' $gateway_sources
grep -q 'new HedgeService' $gateway_sources
grep -q 'recordSettlement' $gateway_sources
grep -q 'pnlTradeRecordFields = \[' $gateway_sources
grep -q 'assertPnlRecordResult(pnlRecord, recordInput)' $gateway_sources
grep -q 'API PnL record grossPnlTokenOut must match snapshot valuation' $gateway_sources
grep -q 'API PnL record modelDescription must describe quote_snapshot_edge_v1' $gateway_sources
grep -q 'settlementEventResult.duplicate' $gateway_sources
grep -q 'markPostSettlementQuoteStatus' $gateway_sources
grep -q 'markSettlementRejectedQuoteFailed' $gateway_sources
grep -q 'recordInventoryPosition' $gateway_sources
grep -q 'recordInventoryPositionBestEffort(metricsService, result.inventoryPositions.tokenIn)' $gateway_sources
grep -q 'a malformed gauge sample must not change submit semantics' $gateway_sources
grep -q 'acquireSubmitReservation(submitReservationStore, metricsService, quoteId)' $gateway_sources
grep -q 'releaseSubmitReservationBestEffort(submitReservationStore, metricsService, submitReservation)' $gateway_sources
test -s backend/src/modules/execution/submit-reservation.store.ts
test -s backend/src/modules/execution/postgres-submit-reservation.store.ts
test -s backend/src/db/migrations/008-submit-reservations.sql
test -s backend/src/db/migrations/009-risk-notional-reasons.sql
test -s backend/src/db/migrations/010-risk-market-regime-reasons.sql
test -s backend/src/db/migrations/011-open-quote-exposure.sql
test -s backend/src/db/migrations/012-pricing-attribution.sql
test -s backend/src/db/migrations/013-market-spread-attribution.sql
test -s backend/src/db/migrations/014-hedge-execution-evidence.sql
test -s backend/src/db/migrations/015-hedge-fee-reconciliation.sql
test -s backend/src/db/migrations/016-treasury-liquidity-reservations.sql
test -s backend/src/db/migrations/022-portfolio-var-reservations.sql
test -s backend/src/db/migrations/023-quote-idempotency.sql
test -s backend/src/db/migrations/017-quote-principal-ownership.sql
test -s backend/src/modules/risk/treasury-liquidity.provider.ts
test -s backend/src/modules/hedge/hedge-fee-worker.ts
test -s backend/src/modules/hedge/postgres-hedge-fee.store.ts
test -s backend/test/hedge-fee-worker.test.mjs
test -s backend/test/postgres-hedge-fee-store.test.mjs
test -s backend/src/modules/risk/quote-exposure.store.ts
test -s backend/src/modules/risk/postgres-quote-exposure.store.ts
test -s backend/src/modules/risk/portfolio-var.ts
test -s backend/src/modules/risk/in-memory-portfolio-var.ts
test -s backend/src/modules/risk/postgres-portfolio-var.ts
test -s backend/test/quote-exposure-store.test.mjs
test -s backend/test/postgres-quote-exposure-store.test.mjs
test -s backend/test/portfolio-var.test.mjs
grep -q 'PORTFOLIO_VAR_LIMIT_EXCEEDED' backend/src/modules/risk/risk.engine.ts
grep -q 'quote-exposure:portfolio:' backend/src/modules/risk/postgres-quote-exposure.store.ts
grep -q 'LOCK TABLE inventory_positions IN SHARE MODE' backend/src/modules/risk/postgres-portfolio-var.ts
grep -q 'var_evaluation' docs/database/schema.sql
grep -q "('022', 'portfolio-var-reservations')" docs/database/schema.sql
grep -q "('023', 'quote-idempotency')" docs/database/schema.sql
test -s backend/src/modules/quote/quote-idempotency.store.ts
test -s backend/src/modules/quote/postgres-quote-idempotency.store.ts
test -s backend/test/quote-idempotency-store.test.mjs
test -s backend/test/postgres-quote-idempotency-store.test.mjs
test -s backend/test/api-quote-idempotency.test.mjs
grep -q 'IDEMPOTENCY_KEY_CONFLICT' backend/src/shared/errors/api-error.ts
grep -q 'Idempotency-Key' docs/api/openapi.yaml
test -s backend/test/submit-reservation-store.test.mjs
test -s backend/test/postgres-submit-reservation-store.test.mjs
test -s backend/test/api-submit-reservation.test.mjs
grep -q 'throw new APIError("QUOTE_ALREADY_USED", "Quote already used", 409)' $gateway_sources
grep -q 'reply.code(202)' $gateway_sources
grep -q '"submitted"' $gateway_sources
grep -q '"settled"' $gateway_sources
grep -q 'StaticMarketDataService' $gateway_sources
grep -q 'pricingEngine?: PricingEngine' $gateway_sources
grep -q 'quoteRepository?: QuoteRepository' $gateway_sources
grep -q 'routingEngine?: RoutingEngine' $gateway_sources
grep -q 'InternalInventoryRoutingEngine' $gateway_sources
grep -q 'TokenLimitRiskEngine' $gateway_sources
grep -q 'resolveQuoteExposureStore' $gateway_sources
grep -q 'quoteExposureStore' $gateway_sources
grep -q 'createSignerRuntime' $gateway_sources
grep -q 'ObservedSignerService' $gateway_sources
grep -q 'readSignerRuntimeConfig' $gateway_sources
grep -q 'trustedSignerAddress: signerConfig.trustedSignerAddress' $gateway_sources
grep -q 'requiresExplicitRuntimeConfig' $gateway_sources
grep -q 'nodeEnv === "development" || nodeEnv === "test"' backend/src/modules/signer/signer-runtime.ts
grep -q 'RFQ_QUOTE_TTL_SECONDS' $gateway_sources
grep -q 'readQuoteTtlSeconds' $gateway_sources
grep -q 'RFQ_BODY_LIMIT_BYTES' $gateway_sources
grep -q 'readBodyLimitBytes' $gateway_sources
grep -q 'defaultBodyLimitBytes' $gateway_sources
grep -q 'readDecimalIntegerConfig' $gateway_sources
grep -q 'must be a base-10 integer between' $gateway_sources
grep -q 'buildServerOptionFields' $gateway_sources
grep -q 'rateLimitOptionFields = \["windowMs", "maxQuoteRequests", "maxSubmitRequests", "maxStatusRequests"\]' $gateway_sources
grep -q 'assertBuildServerOptions(options)' $gateway_sources
grep -q 'assertOptionalOwnFields(options, buildServerOptionFields, "options")' $gateway_sources
grep -q 'normalizeRateLimitOption(options.rateLimit)' $gateway_sources
grep -q 'assertOptionalOwnFields(rateLimit, rateLimitOptionFields, "rateLimit")' $gateway_sources
grep -q 'assertIntegerOption(options.bodyLimitBytes, "bodyLimitBytes", 1024, 1_048_576)' $gateway_sources
grep -q 'assertIntegerOption(options.quoteTtlSeconds, "quoteTtlSeconds", 1, 3600)' $gateway_sources
grep -q 'assertBooleanOption(options.logger, "logger")' $gateway_sources
grep -q 'assertBooleanOption(options.enableHsts, "enableHsts")' $gateway_sources
grep -q 'assertBooleanOption(options.trustProxy, "trustProxy")' $gateway_sources
grep -q 'RFQ_CORS_ALLOWED_ORIGINS' $gateway_sources
grep -q 'readCorsAllowedOrigins' $gateway_sources
grep -q 'defaultCorsAllowedOrigins' $gateway_sources
grep -q 'applyCorsHeaders' $gateway_sources
grep -q 'access-control-allow-origin' $gateway_sources
grep -Fq 'server.options("/*"' $gateway_sources
grep -q 'RFQ_ENABLE_HSTS' $gateway_sources
grep -q 'readEnableHsts' $gateway_sources
grep -q 'defaultEnableHsts' $gateway_sources
grep -q 'RFQ_TRUST_PROXY' $gateway_sources
grep -q 'readTrustProxy' $gateway_sources
grep -q 'defaultTrustProxy' $gateway_sources
grep -q 'trustProxy?: boolean' $gateway_sources
grep -q 'clientIdForRateLimit(request, trustProxy, principal)' $gateway_sources
grep -q 'if (!trustProxy)' $gateway_sources
grep -q 'applySecurityHeaders' $gateway_sources
grep -q 'cache-control' $gateway_sources
grep -q 'x-content-type-options' $gateway_sources
grep -q 'strict-transport-security' $gateway_sources
grep -q 'installGracefulShutdown' $gateway_sources
grep -q 'SIGTERM' $gateway_sources
grep -q 'SIGINT' $gateway_sources
grep -q 'server.close' $gateway_sources
grep -q 'server.setNotFoundHandler' $gateway_sources
grep -q 'Route not found' $gateway_sources
grep -q 'server.setErrorHandler' $gateway_sources
grep -q 'frameworkErrorToAPIError' $gateway_sources
grep -q 'frameworkErrorField(error, "code")' $gateway_sources
grep -q 'frameworkErrorField(error, "statusCode")' $gateway_sources
grep -q 'FST_ERR_CTP_BODY_TOO_LARGE' $gateway_sources
grep -q 'RFQ API ignores inherited framework error fields' backend/test/api-validation-gateway.test.mjs
grep -q 'Object.create({ statusCode: 400, code: "FST_ERR_CTP_BODY_TOO_LARGE" })' backend/test/api-validation-gateway.test.mjs
grep -q '框架错误映射只信任 error 对象自有的 `code` 和 `statusCode` 字段' book/Volume5-BackendEngineering/Chapter01-API-Gateway.md
grep -q 'function requireConfigured' backend/src/modules/signer/signer-runtime.ts
grep -q 'function parsePrivateKey' backend/src/modules/signer/signer-runtime.ts
grep -q 'function parseAddress' backend/src/modules/signer/signer-runtime.ts
grep -q 'NODE_ENV=${nodeEnv}' $gateway_sources
grep -q 'HOST' $gateway_sources
grep -q 'x-trace-id' $gateway_sources
grep -q 'server.addHook("onRequest"' $gateway_sources
grep -q 'requestTraceId' $gateway_sources
grep -q 'safeIncomingTraceId' $gateway_sources
grep -q 'traceIdPattern' $gateway_sources
grep -q 'RFQ API propagates safe incoming trace ids and falls back for unsafe values' backend/test/api-gateway-runtime.test.mjs
grep -q 'RFQ_TRUST_PROXY=false' .env.example
grep -q 'RFQ_TRUST_PROXY: "false"' docker-compose.yml
grep -q 'RFQ_TRUST_PROXY: "false"' infra/k8s/configmap.yaml
grep -q 'RFQ_TRUST_PROXY: "false"' infra/helm/rfq-market-maker/values.yaml
grep -q 'RFQ API rejects invalid RFQ_TRUST_PROXY at startup' backend/test/api-gateway-env.test.mjs
grep -q 'does not trust x-forwarded-for for rate limit identity by default' backend/test/api-rate-limit.test.mjs
grep -q 'trusts x-forwarded-for for rate limit identity only when proxy trust is enabled' backend/test/api-rate-limit.test.mjs
grep -q 'rejects oversized trusted forwarded rate limit identity' backend/test/api-rate-limit.test.mjs
grep -q 'rejects unsafe trusted forwarded rate limit identity' backend/test/api-rate-limit.test.mjs
grep -q 'only enable it when a trusted reverse proxy or ingress strips untrusted' README.md
grep -Fq '128 character limit and `[A-Za-z0-9_.:-]` character set' README.md
grep -q 'x-forwarded-for` is ignored unless `RFQ_TRUST_PROXY=true`' docs/api/errors.md
grep -Fq 'forwarded client identities longer than 128 characters or outside `[A-Za-z0-9_.:-]` are rejected as `INVALID_REQUEST`/400' docs/api/errors.md
grep -q '默认 `RFQ_TRUST_PROXY=false`' book/Volume5-BackendEngineering/Chapter01-API-Gateway.md
grep -Fq 'trusted forwarded identity exceeding 128 characters or outside `[A-Za-z0-9_.:-]` returns `INVALID_REQUEST`/400' book/Volume5-BackendEngineering/Chapter01-API-Gateway.md
grep -q 'traceId: string' backend/src/shared/errors/api-error.ts
grep -q 'HEDGE_NOT_FOUND' backend/src/shared/errors/api-error.ts
grep -q 'HEDGE_STORE_UNAVAILABLE' backend/src/shared/errors/api-error.ts
grep -q 'SETTLEMENT_EVENT_NOT_FOUND' backend/src/shared/errors/api-error.ts
grep -q 'SETTLEMENT_EVENT_STORE_UNAVAILABLE' backend/src/shared/errors/api-error.ts
grep -q 'PNL_STORE_UNAVAILABLE' backend/src/shared/errors/api-error.ts
grep -q 'getSnapshot' $quote_service_sources
grep -q 'getUsableSnapshot' $quote_service_sources
grep -q 'validateQuoteRequest(request)' $quote_service_sources
grep -q 'marketDataFailure' $quote_service_sources
grep -q 'assertUsableSnapshot' $quote_service_sources
grep -q 'getMarketSnapshotIssue' $quote_service_sources
grep -q 'maxSnapshotAgeMs' $quote_service_sources
grep -q 'maxSnapshotFutureSkewMs' $quote_service_sources
grep -q 'assertPositiveSafeInteger(config.maxSnapshotAgeMs, "maxSnapshotAgeMs")' $quote_service_sources
grep -q 'assertPositiveSafeInteger(config.quoteTtlSeconds, "quoteTtlSeconds")' $quote_service_sources
grep -q 'assertOwnFields(config, quoteServiceConfigFields, "config")' $quote_service_sources
grep -q 'assertOwnFields(deps, quoteServiceDepsFields, "deps")' $quote_service_sources
grep -q 'assertOptionalOwnField(deps, "hedgeService", "deps")' $quote_service_sources
grep -q 'Quote service ${path}.${field} must be an own field' $quote_service_sources
grep -q 'Quote service ${path}.${field} must be an own field when provided' $quote_service_sources
grep -q 'assertQuoteServiceDeps(deps)' $quote_service_sources
grep -q 'assertDependencyMethod(deps.quoteRepository, "quoteRepository", "findSignedQuoteByChainUserNonce")' $quote_service_sources
grep -q 'normalizeQuoteServiceDeps' $quote_service_sources
grep -q 'normalizeQuoteServiceConfig' $quote_service_sources
grep -q 'MARKET_DATA_UNAVAILABLE' $quote_service_sources
grep -q 'ROUTING_UNAVAILABLE' $quote_service_sources
grep -q 'routingFailure' $quote_service_sources
grep -q 'routePlanFields = \["routeId", "venue", "tokenIn", "tokenOut", "expectedLiquidityUsd"\]' $quote_service_sources
grep -q 'inventoryProjectionFields = \["tokenIn", "tokenOut"\]' $quote_service_sources
grep -q 'assertRoutePlan(routeResult, validatedRequest)' $quote_service_sources
grep -q 'Quote service route plan token pair must match quote request token pair' $quote_service_sources
grep -q 'PRICING_UNAVAILABLE' $quote_service_sources
grep -q 'pricingFailure' $quote_service_sources
grep -q 'assertInventorySkewBps(inventorySkewResult)' $quote_service_sources
grep -q 'pairPenalties.forEach(assertHedgeRiskPenaltyBps)' $quote_service_sources
grep -Fq 'assertPricingAdjustmentBps(inventorySkewBps + hedgeCostBps)' $quote_service_sources
grep -q 'Quote service pricing adjustment bps must be a safe bps integer' $quote_service_sources
grep -q 'pricingResultFields' $quote_service_sources
grep -q 'assertPricingResult(pricingResult)' $quote_service_sources
grep -q 'Quote service pricing result.amountOut must be greater than or equal to pricing result.minAmountOut' $quote_service_sources
grep -q 'assertInventoryProjection(projectionResult, validatedRequest)' $quote_service_sources
grep -q 'Quote service inventory projection.${field} must match quote request ${field}' $quote_service_sources
grep -q 'evaluateRisk' $quote_service_sources
grep -q 'RISK_ENGINE_UNAVAILABLE' $quote_service_sources
grep -q 'riskUnavailableDecision()' $quote_service_sources
grep -q 'assertRiskDecision(riskDecision)' $quote_service_sources
grep -q 'Quote service risk decision.status must be approved or rejected' $quote_service_sources
grep -q 'Quote service risk decision.reasonCode must be a stable risk reject reason' $quote_service_sources
grep -q 'saveRejectedQuoteBestEffort' $quote_service_sources
grep -q 'selectRoute' $quote_service_sources
grep -q 'quoteRepository.saveRequested' $quote_service_sources
grep -q 'quoteRepository.saveSigned' $quote_service_sources
grep -q 'quoteRepository.markFailed' $quote_service_sources
grep -q 'markQuoteFailedBestEffort' $quote_service_sources
grep -q 'quoteStoreFailure' $quote_service_sources
grep -q 'QUOTE_STORE_UNAVAILABLE' $quote_service_sources
grep -q 'quoteFailureCode' $quote_service_sources
grep -q 'quoteTtlSeconds' $quote_service_sources
grep -q 'defaultQuoteServiceConfig' $quote_service_sources
grep -q 'validateSubmitQuoteRequest({ quote, signature }, { allowExpired: true })' $quote_service_sources
grep -q 'allowExpired' backend/src/shared/validation/submit-request.ts
grep -q 'SUBMIT_VALIDATION_OPTION_FIELDS = \["allowExpired"\]' backend/src/shared/validation/submit-request.ts
grep -q 'normalizeValidationOptions(options)' backend/src/shared/validation/submit-request.ts
grep -q 'assertOwnOptionalFields(options, SUBMIT_VALIDATION_OPTION_FIELDS, "Submit validation options")' backend/src/shared/validation/submit-request.ts
grep -q '${label}.${inherited} must be an own field when provided' backend/src/shared/validation/submit-request.ts
grep -q 'Submit validation options allowExpired must be a boolean' backend/src/shared/validation/submit-request.ts
grep -q 'QuoteService snapshots dependency object at construction' backend/test/quote-service-dependency-config.test.mjs
grep -q 'QuoteService rejects unsafe dependency configuration at construction' backend/test/quote-service-dependency-config.test.mjs
grep -q 'QuoteService rejects malformed pricing engine results before signing' backend/test/quote-service-pricing-dependencies.test.mjs
grep -q 'internalSpread: 8' backend/test/quote-service-pricing-dependencies.test.mjs
grep -q 'assert.equal(signAttempts, 0)' backend/test/quote-service-pricing-dependencies.test.mjs
grep -q 'QuoteService fails closed on malformed risk engine decisions before signing' backend/test/quote-service-risk-dependencies.test.mjs
grep -q 'TEMPORARY_RISK_REASON' backend/test/quote-service-risk-dependencies.test.mjs
grep -q 'approvedWithInheritedReason' backend/test/quote-service-risk-dependencies.test.mjs
grep -q 'assertRecord(config, "config")' $quote_service_sources
grep -q 'assertRecord(deps, "deps")' $quote_service_sources
grep -q 'assertRecord(dependency, dependencyName)' $quote_service_sources
grep -q 'Quote service config must be an object' backend/test/quote-service-config.test.mjs
grep -q 'Quote service config.maxSnapshotAgeMs must be an own field' backend/test/quote-service-config.test.mjs
grep -q 'Quote service config.quoteTtlSeconds must be an own field' backend/test/quote-service-config.test.mjs
grep -q 'Quote service marketDataService must be an object' backend/test/quote-service-dependency-config.test.mjs
grep -q 'Quote service deps.inventoryService must be an own field' backend/test/quote-service-dependency-config.test.mjs
grep -q 'Quote service deps.hedgeService must be an own field when provided' backend/test/quote-service-dependency-config.test.mjs
grep -q 'Quote service hedgeService must be an object when provided' backend/test/quote-service-dependency-config.test.mjs
grep -q 'QuoteService rejects unsafe quote requests before dependency side effects' backend/test/quote-service.test.mjs
grep -q 'QuoteService rejects unsafe submit quotes before quote lookup or signature verification' backend/test/quote-service-submit.test.mjs
grep -q 'QuoteService rejects submit signatures that differ from the stored signed quote' backend/test/quote-service-submit.test.mjs
grep -q 'validateSubmitQuoteRequest validates internal submit validation options' backend/test/submit-options-validation.test.mjs
grep -q 'Submit validation options.allowExpired must be an own field when provided' backend/test/submit-options-validation.test.mjs
grep -q 'Submit validation options allowExpired must be a boolean' backend/test/submit-options-validation.test.mjs
grep -q 'QuoteService` rejects malformed config, inherited config fields, malformed dependency map, inherited required dependency entries, inherited optional `hedgeService`, and malformed dependency entries before reading runtime fields or service methods' book/Volume5-BackendEngineering/Chapter02-Quote-Service.md
grep -q 'createQuote()` revalidates and snapshots the quote request at the service boundary' book/Volume5-BackendEngineering/Chapter02-Quote-Service.md
grep -q 'validates `RoutePlan` returned by the routing adapter before inventory skew, pricing, risk evaluation or signing' book/Volume5-BackendEngineering/Chapter02-Quote-Service.md
grep -q 'Malformed route output is treated as `ROUTING_UNAVAILABLE`' book/Volume5-BackendEngineering/Chapter02-Quote-Service.md
grep -q 'validates pricing adjustment inputs before calling Pricing Service' book/Volume5-BackendEngineering/Chapter02-Quote-Service.md
grep -q 'Malformed inventory skew, malformed hedge penalty or an overflowing combined adjustment is treated as `PRICING_UNAVAILABLE`' book/Volume5-BackendEngineering/Chapter02-Quote-Service.md
grep -q 'validates `PricingResult` returned by the pricing adapter before inventory projection, risk evaluation or signing' book/Volume5-BackendEngineering/Chapter02-Quote-Service.md
grep -q 'Malformed pricing output is treated as `PRICING_UNAVAILABLE`' book/Volume5-BackendEngineering/Chapter02-Quote-Service.md
grep -q 'validates `InventoryProjection` returned by the inventory adapter before risk evaluation or signer access' book/Volume5-BackendEngineering/Chapter02-Quote-Service.md
grep -q 'Malformed projected inventory is treated as risk unavailable' book/Volume5-BackendEngineering/Chapter02-Quote-Service.md
grep -q 'validates `RiskDecision` returned by the risk adapter before audit persistence or signer access' book/Volume5-BackendEngineering/Chapter02-Quote-Service.md
grep -q 'Malformed risk output is treated the same as risk engine dependency failure' book/Volume5-BackendEngineering/Chapter02-Quote-Service.md
grep -q 'requireSubmittableSignedQuote()` revalidates the submit quote and canonical signature' book/Volume5-BackendEngineering/Chapter02-Quote-Service.md
grep -q 'The internal `allowExpired` validation option must be an own boolean field' book/Volume5-BackendEngineering/Chapter02-Quote-Service.md
grep -q 'internal validation options also reject inherited `allowExpired` fields' book/Volume5-BackendEngineering/Chapter06-Execution-Service.md
grep -q 'QuoteService` snapshots its dependency map at construction' book/Volume5-BackendEngineering/Chapter02-Quote-Service.md
grep -q 'Required dependency entries must be own fields before method validation, and optional `hedgeService`、`quoteExposureStore`、`treasuryLiquidityProvider` must be own fields when provided' book/Volume5-BackendEngineering/Chapter02-Quote-Service.md
grep -q 'A treasury provider without a reservation store is rejected at construction' book/Volume5-BackendEngineering/Chapter02-Quote-Service.md
grep -q 'QuoteService` validates dependency methods at construction' book/Volume5-BackendEngineering/Chapter02-Quote-Service.md
grep -q 'class QuoteIdentityGenerator' backend/src/modules/quote/quote-identity.ts
grep -q 'randomUint64' backend/src/modules/quote/quote-identity.ts
grep -q 'globalThis.crypto' backend/src/modules/quote/quote-identity.ts
grep -q 'getRandomValues(values)' backend/src/modules/quote/quote-identity.ts
grep -q 'Quote identity generation requires Web Crypto getRandomValues' backend/src/modules/quote/quote-identity.ts
! grep -q 'Math.random' backend/src/modules/quote/quote-identity.ts
grep -q 'must fail fast when Web Crypto is unavailable' book/Volume5-BackendEngineering/Chapter02-Quote-Service.md
grep -q 'lastTimestampMs' backend/src/modules/quote/quote-identity.ts
grep -q 'QuoteIdentityGenerator creates monotonic unique nonces within one millisecond' backend/test/quote-identity.test.mjs
grep -q 'per-millisecond sequence wraps' backend/test/quote-identity.test.mjs
grep -q 'QuoteIdentityGenerator uses Web Crypto instead of Math.random' backend/test/quote-identity.test.mjs
grep -q 'class InMemoryQuoteRepository' backend/src/modules/quote/quote.repository.ts
grep -q 'markFailed' backend/src/modules/quote/quote.repository.ts
grep -q 'cloneQuoteRecord' backend/src/modules/quote/quote.repository.ts
grep -q 'class BasicRiskEngine' backend/src/modules/risk/risk.engine.ts
! grep -q 'AllowAllRiskEngine' backend/src/modules/risk/risk.engine.ts
! grep -q 'allow-all-skeleton-v0' backend/src/modules/risk/risk.engine.ts
grep -q 'class InMemoryRateLimiter' backend/src/modules/rate-limit/rate-limit.service.ts
grep -q 'cloneRateLimitConfig' backend/src/modules/rate-limit/rate-limit.service.ts
grep -q 'assertPositiveSafeInteger' backend/src/modules/rate-limit/rate-limit.service.ts
grep -q 'normalizeRateLimitInput(input)' backend/src/modules/rate-limit/rate-limit.service.ts
grep -q 'rateLimitConfigFields = \["windowMs", "maxQuoteRequests", "maxSubmitRequests", "maxStatusRequests"\]' backend/src/modules/rate-limit/rate-limit.service.ts
grep -q 'rateLimitInputFields = \["endpoint", "clientId"\]' backend/src/modules/rate-limit/rate-limit.service.ts
grep -q 'assertOwnFields(config, rateLimitConfigFields, "config")' backend/src/modules/rate-limit/rate-limit.service.ts
grep -q 'assertOwnFields(input, rateLimitInputFields, "input")' backend/src/modules/rate-limit/rate-limit.service.ts
grep -q 'Rate limit ${path}.${field} must be an own field' backend/src/modules/rate-limit/rate-limit.service.ts
grep -q 'assertRateLimitTimestamp(now)' backend/src/modules/rate-limit/rate-limit.service.ts
grep -q 'maxRateLimitClientIdLength' backend/src/modules/rate-limit/rate-limit.service.ts
grep -q 'rateLimitClientIdPattern' backend/src/modules/rate-limit/rate-limit.service.ts
grep -q 'sweepExpiredBuckets(now)' backend/src/modules/rate-limit/rate-limit.service.ts
grep -q 'Rate limit input must be an object' backend/src/modules/rate-limit/rate-limit.service.ts
grep -q 'Rate limit clientId must be a primitive string' backend/src/modules/rate-limit/rate-limit.service.ts
grep -q 'Rate limit clientId must be a non-empty string' backend/src/modules/rate-limit/rate-limit.service.ts
grep -q 'Rate limit clientId must be 128 characters or fewer' backend/src/modules/rate-limit/rate-limit.service.ts
grep -q 'Rate limit clientId must contain only letters, numbers, dot, underscore, colon, or hyphen' backend/src/modules/rate-limit/rate-limit.service.ts
grep -q 'InMemoryRateLimiter normalizes client identities before bucketing' backend/test/rate-limit.test.mjs
grep -q 'new String("client-a")' backend/test/rate-limit.test.mjs
grep -q 'Rate limit config.windowMs must be an own field' backend/test/rate-limit.test.mjs
grep -q 'Rate limit input.endpoint must be an own field' backend/test/rate-limit.test.mjs
test -s backend/src/modules/rate-limit/redis-rate-limit.service.ts
test -s backend/test/redis-rate-limit.test.mjs
test -s backend/test/api-redis-rate-limit.test.mjs
grep -q 'class RedisRateLimiter' backend/src/modules/rate-limit/redis-rate-limit.service.ts
grep -q 'redis.call("SET", KEYS\[1\], 1, "PX", ARGV\[1\])' backend/src/modules/rate-limit/redis-rate-limit.service.ts
grep -q 'if current >= tonumber(ARGV\[2\])' backend/src/modules/rate-limit/redis-rate-limit.service.ts
grep -q 'RFQ_RATE_LIMIT_BACKEND must be redis when NODE_ENV=' $gateway_sources
grep -q 'RATE_LIMIT_UNAVAILABLE' $gateway_sources
grep -q '任何非本地 `NODE_ENV` 都强制 `RFQ_RATE_LIMIT_BACKEND=redis`' book/Volume5-BackendEngineering/Chapter01-API-Gateway.md
grep -q '超限后不继续递增计数' book/Volume5-BackendEngineering/Chapter01-API-Gateway.md
grep -q '`rateLimitStore` readiness' book/Volume5-BackendEngineering/Chapter01-API-Gateway.md
grep -q 'maxQuoteRequests' backend/src/modules/rate-limit/rate-limit.service.ts
grep -q 'maxSubmitRequests' backend/src/modules/rate-limit/rate-limit.service.ts
grep -q 'maxStatusRequests' backend/src/modules/rate-limit/rate-limit.service.ts
grep -q 'CHAIN_NOT_ENABLED' backend/src/modules/risk/risk.engine.ts
grep -q 'TOKEN_NOT_ALLOWED' backend/src/modules/risk/risk.engine.ts
grep -q 'AMOUNT_IN_LIMIT_EXCEEDED' backend/src/modules/risk/risk.engine.ts
grep -q 'SLIPPAGE_TOO_WIDE' backend/src/modules/risk/risk.engine.ts
grep -q 'QUOTED_SPREAD_TOO_WIDE' backend/src/modules/risk/risk.engine.ts
grep -q 'maxQuotedSpreadBps' backend/src/modules/risk/risk.engine.ts
grep -q 'assertRiskInput(input)' backend/src/modules/risk/risk.engine.ts
grep -q 'must match request ${field}' backend/src/modules/risk/risk.engine.ts
grep -q 'assertChainIds(policy.enabledChainIds)' backend/src/modules/risk/risk.engine.ts
grep -q 'assertAddressList(policy.tokenAllowlist, "tokenAllowlist", true)' backend/src/modules/risk/risk.engine.ts
grep -q 'assertBpsUpperBound(policy.maxQuotedSpreadBps, "maxQuotedSpreadBps")' backend/src/modules/risk/risk.engine.ts
grep -Fq 'typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)' backend/src/modules/risk/risk.engine.ts
grep -Fq 'typeof value !== "string" || !/^[1-9][0-9]*$/.test(value)' backend/src/modules/risk/risk.engine.ts
grep -q 'cloneBasicRiskPolicy' backend/src/modules/risk/risk.engine.ts
grep -q 'TOXIC_FLOW_RESTRICTED_USER' backend/src/modules/risk/risk.engine.ts
grep -q 'TOXIC_FLOW_SCORE_EXCEEDED' backend/src/modules/risk/risk.engine.ts
grep -q 'toxicFlowScores' backend/src/modules/risk/risk.engine.ts
grep -q 'restrictedUsers' backend/src/modules/risk/risk.engine.ts
grep -q 'Basic risk enabledChainIds must not contain duplicate chain ids' backend/src/modules/risk/risk.engine.ts
grep -q 'Basic risk ${field} must not contain duplicate addresses' backend/src/modules/risk/risk.engine.ts
grep -q 'Basic risk toxicFlowScores must not contain duplicate users' backend/src/modules/risk/risk.engine.ts
grep -q 'BasicRiskEngine snapshots policy configuration at construction' backend/test/risk.test.mjs
grep -q 'BasicRiskEngine rejects unsafe policy configuration at construction' backend/test/risk-validation.test.mjs
grep -q 'new String(baseRequest.tokenIn)' backend/test/risk-validation.test.mjs
grep -q 'amountIn: "01000000000"' backend/test/risk-runtime-validation.test.mjs
grep -q 'amountOut: "0998400000"' backend/test/risk-runtime-validation.test.mjs
grep -q 'Basic risk tokenAllowlist must not contain duplicate addresses' backend/test/risk-validation.test.mjs
grep -q 'Basic risk restrictedUsers must not contain duplicate addresses' backend/test/risk-validation.test.mjs
grep -q 'Basic risk toxicFlowScores must not contain duplicate users' backend/test/risk-validation.test.mjs
test -s backend/src/modules/risk/token-limit-risk.engine.ts
test -s backend/test/token-limit-risk.test.mjs
test -s backend/test/api-risk-policy-runtime.test.mjs
test -s scripts/check-risk-policy-consistency.mjs
grep -q 'TokenLimitRiskPolicy` 使用 exact-field parser' book/Volume5-BackendEngineering/Chapter04-Risk-Service.md
grep -q 'cross-chain address isolation' book/Volume5-BackendEngineering/Chapter04-Risk-Service.md
grep -q 'RFQ_RISK_POLICY_JSON' $gateway_sources
grep -q 'tokenLimitKey(input.request.chainId, input.request.tokenIn)' backend/src/modules/risk/token-limit-risk.engine.ts
grep -q 'tokenLimitKey(input.request.chainId, input.request.tokenOut)' backend/src/modules/risk/token-limit-risk.engine.ts
grep -q 'TokenLimitRiskEngine scopes token authorization by chain and address' backend/test/token-limit-risk.test.mjs
grep -q 'configured chain/token limits to a cross-decimals quote' backend/test/api-risk-policy-runtime.test.mjs
grep -q '覆盖 toxic-flow score' book/Volume5-BackendEngineering/Chapter04-Risk-Service.md
grep -q 'malformed `projectSettlement` output cannot be ignored by a custom risk engine' book/Volume5-BackendEngineering/Chapter04-Risk-Service.md
grep -q 'class LocalEIP712SignerService' backend/src/modules/signer/signer.service.ts
grep -q 'class ObservedSignerService' backend/src/modules/signer/signer.service.ts
grep -q 'SIGNER_UNAVAILABLE' backend/src/modules/signer/signer.service.ts
grep -q 'privateKeyToAccount' backend/src/modules/signer/signer.service.ts
grep -q 'assertObservedSignerDeps(inner, metricsService)' backend/src/modules/signer/signer.service.ts
grep -q 'assertDependencyObject(dependency, dependencyName)' backend/src/modules/signer/signer.service.ts
grep -q 'assertDependencyMethod(metricsService, "metricsService", "recordSignerLatency")' backend/src/modules/signer/signer.service.ts
grep -q 'const signature = await this.inner.signQuote(input)' backend/src/modules/signer/signer.service.ts
grep -q 'assertSignature(signature)' backend/src/modules/signer/signer.service.ts
grep -q 'Signer verifyQuoteSignature result must be a boolean' backend/src/modules/signer/signer.service.ts
! grep -q 'class PlaceholderSignerService' backend/src/modules/signer/signer.service.ts
! grep -q 'toFixedHex(seed' backend/src/modules/signer/signer.service.ts
grep -q 'assertObject(config, "config")' backend/src/modules/signer/signer.service.ts
grep -q 'assertObject(input, "input")' backend/src/modules/signer/signer.service.ts
grep -q 'assertObject(quote, "quote")' backend/src/modules/signer/signer.service.ts
grep -q 'localEIP712SignerConfigFields = \["privateKey", "settlementAddress"\]' backend/src/modules/signer/signer.service.ts
grep -q 'signQuoteInputFields = \["quote", "quoteId", "snapshotId"\]' backend/src/modules/signer/signer.service.ts
grep -q 'signedQuoteFields = \[' backend/src/modules/signer/signer.service.ts
grep -q 'assertOwnFields(config, localEIP712SignerConfigFields, "config")' backend/src/modules/signer/signer.service.ts
grep -q 'assertOwnFields(input, signQuoteInputFields, "input")' backend/src/modules/signer/signer.service.ts
grep -q 'assertOwnFields(quote, signedQuoteFields, "quote")' backend/src/modules/signer/signer.service.ts
grep -q 'Signer ${path}.${field} must be an own field' backend/src/modules/signer/signer.service.ts
grep -q 'assertPrivateKey(config.privateKey)' backend/src/modules/signer/signer.service.ts
grep -q 'cloneLocalEIP712SignerConfig' backend/src/modules/signer/signer.service.ts
grep -q 'assertSignQuoteInput(input)' backend/src/modules/signer/signer.service.ts
grep -q 'maxSafeIdentifierLength = 128' backend/src/modules/signer/signer.service.ts
grep -Fq 'safeIdentifierPattern = /^[A-Za-z0-9_:-]+$/' backend/src/modules/signer/signer.service.ts
grep -q 'assertSafeIdentifier(input.quoteId, "quoteId")' backend/src/modules/signer/signer.service.ts
grep -q 'assertSafeIdentifier(input.snapshotId, "snapshotId")' backend/src/modules/signer/signer.service.ts
grep -q 'Signer ${field} must be a primitive string' backend/src/modules/signer/signer.service.ts
grep -q 'SECP256K1N_HALF' backend/src/modules/signer/signer.service.ts
grep -q 'Signer signature s value must be in the lower half order' backend/src/modules/signer/signer.service.ts
grep -q 'ProductionGradeRFQ' backend/src/modules/signer/signer.service.ts
grep -Fq 'typeof value !== "string" || !/^[1-9][0-9]*$/.test(value)' backend/src/modules/signer/signer.service.ts
grep -q 'LocalEIP712SignerService binds signatures to the settlement contract address' backend/test/signer.test.mjs
grep -q 'LocalEIP712SignerService snapshots signer configuration at construction' backend/test/signer.test.mjs
grep -q 'LocalEIP712SignerService rejects high-s malleated quote signatures' backend/test/signer.test.mjs
grep -q 'LocalEIP712SignerService rejects unsafe signer configuration at construction' backend/test/signer-validation.test.mjs
grep -q 'LocalEIP712SignerService rejects malformed signer payload envelopes before signing' backend/test/signer-validation.test.mjs
grep -q 'LocalEIP712SignerService rejects inherited signer payload fields before signing' backend/test/signer-validation.test.mjs
grep -q 'Signer config.privateKey must be an own field' backend/test/signer-validation.test.mjs
grep -q 'Signer input.quote must be an own field' backend/test/signer-validation.test.mjs
grep -q 'Signer quote.user must be an own field' backend/test/signer-validation.test.mjs
grep -q 'verifyQuoteSignature(Object.create(quote), fixedSignature())' backend/test/signer-validation.test.mjs
grep -q 'LocalEIP712SignerService rejects unsafe quote inputs before signing' backend/test/signer-validation.test.mjs
grep -q 'amountIn: "01000000000"' backend/test/signer-validation.test.mjs
grep -q 'amountOut: "0998400000"' backend/test/signer-validation.test.mjs
grep -q 'minAmountOut: "0993408000"' backend/test/signer-validation.test.mjs
grep -q 'nonce: "042"' backend/test/signer-validation.test.mjs
grep -q 'Signer quoteId must be a primitive string' backend/test/signer-validation.test.mjs
grep -q 'Signer quoteId must contain only letters, numbers, underscore, colon, or hyphen' backend/test/signer-validation.test.mjs
grep -q 'Signer snapshotId must be a primitive string' backend/test/signer-validation.test.mjs
grep -q 'Signer snapshotId must be 128 characters or fewer' backend/test/signer-validation.test.mjs
grep -q 'ObservedSignerService rejects unsafe wrapper dependencies at construction' backend/test/signer.test.mjs
grep -q 'ObservedSignerService rejects malformed inner signer results' backend/test/signer.test.mjs
grep -q 'non_boolean_verify' backend/test/signer.test.mjs
grep -q 'SIGNER_UNAVAILABLE' backend/test/signer.test.mjs
grep -q 'Signer inner must be an object' backend/test/signer.test.mjs
grep -q 'Signer metricsService must be an object' backend/test/signer.test.mjs
grep -q 'snapshots `LocalEIP712SignerConfig` at construction after validation' book/Volume5-BackendEngineering/Chapter05-Signer-Service.md
grep -q 'ObservedSignerService` validates inner signer and metrics dependency methods at construction' book/Volume5-BackendEngineering/Chapter05-Signer-Service.md
grep -q 'ObservedSignerService` rejects malformed dependency envelopes as non-array objects before reading signer or metrics methods' book/Volume5-BackendEngineering/Chapter05-Signer-Service.md
grep -q 'validates inner signer results before returning them to Quote Service' book/Volume5-BackendEngineering/Chapter05-Signer-Service.md
grep -q 'verifyQuoteSignature()` must return a runtime boolean' book/Volume5-BackendEngineering/Chapter05-Signer-Service.md
grep -q 'validates malformed config, signing request and quote objects before field access' book/Volume5-BackendEngineering/Chapter05-Signer-Service.md
grep -q 'requires local signer config fields, signing request fields and signed quote fields to be own fields' book/Volume5-BackendEngineering/Chapter05-Signer-Service.md
grep -q 'Direct signer callers cannot pass inherited object properties' book/Volume5-BackendEngineering/Chapter05-Signer-Service.md
grep -q 'Malformed verification inputs, including inherited quote fields, return `false`' book/Volume5-BackendEngineering/Chapter05-Signer-Service.md
grep -q '`quoteId` and `snapshotId` as primitive-string `SafeIdentifier` values with 1-128 characters' book/Volume5-BackendEngineering/Chapter05-Signer-Service.md
grep -q 'canonical decimal form without leading zeros' book/Volume5-BackendEngineering/Chapter05-Signer-Service.md
grep -q '代码库不保留 placeholder signer' book/Volume5-BackendEngineering/Chapter05-Signer-Service.md
grep -q 'RFQ API rejects issued quotes with high-s malleated signatures' backend/test/api-submit.test.mjs
grep -q 'canonical low-s ECDSA' docs/api/errors.md
grep -Fq -- '- [x] Signer verification rejects non-canonical high-s ECDSA signatures before submit settlement.' docs/security/audit-checklist.md
grep -q 'Local signer verification rejects high-s ECDSA signatures' book/Volume5-BackendEngineering/Chapter05-Signer-Service.md
grep -q 'RISK_REJECTED' $quote_service_sources
grep -q 'requireSubmittableSignedQuote' $quote_service_sources
grep -q 'QUOTE_FAILED' $quote_service_sources
grep -q 'markQuoteExpiredBestEffort' $quote_service_sources
grep -q 'QUOTE_EXPIRED' $quote_service_sources
grep -q 'findSignedQuoteByChainUserNonce' backend/src/modules/quote/quote.repository.ts
grep -q 'findSignedQuoteByQuoteId' backend/src/modules/quote/quote.repository.ts
grep -q 'chainUserNonceKey' backend/src/modules/quote/quote.repository.ts
grep -q 'assertRequestedQuoteInput(input)' backend/src/modules/quote/quote.repository.ts
grep -q 'assertRejectedQuoteInput(input)' backend/src/modules/quote/quote.repository.ts
grep -q 'assertObject(input, "input", "Requested quote")' backend/src/modules/quote/quote.repository.ts
grep -q 'assertObject(request, "request", subject)' backend/src/modules/quote/quote.repository.ts
grep -q 'assertObject(input.quote, "quote", "Signed quote")' backend/src/modules/quote/quote.repository.ts
grep -q 'requestedQuoteInputFields = \["quoteId", "principalId", "request", "snapshotId"\]' backend/src/modules/quote/quote.repository.ts
grep -q 'rejectedQuoteInputFields = \["quoteId", "principalId", "request", "snapshotId", "rejectCode"\]' backend/src/modules/quote/quote.repository.ts
grep -q 'assertPrincipalId(input.principalId, "Requested quote principalId")' backend/src/modules/quote/quote.repository.ts
grep -q 'rejectedQuoteOptionalFields = \["riskPolicyVersion"\]' backend/src/modules/quote/quote.repository.ts
grep -q 'quoteRequestFields = \["chainId", "user", "tokenIn", "tokenOut", "amountIn", "slippageBps"\]' backend/src/modules/quote/quote.repository.ts
grep -q 'assertOwnFields(input, requestedQuoteInputFields, "input", "Requested quote")' backend/src/modules/quote/quote.repository.ts
grep -q 'assertOwnFields(input, rejectedQuoteInputFields, "input", "Rejected quote")' backend/src/modules/quote/quote.repository.ts
grep -q 'assertOwnOptionalFields(input, rejectedQuoteOptionalFields, "input", "Rejected quote")' backend/src/modules/quote/quote.repository.ts
grep -q 'assertOwnFields(request, quoteRequestFields, "request", subject)' backend/src/modules/quote/quote.repository.ts
grep -q 'assertOwnFields(input, signedQuoteInputFields, "input", "Signed quote")' backend/src/modules/quote/quote.repository.ts
grep -q 'assertOwnFields(input.quote, signedQuoteFields, "quote", "Signed quote")' backend/src/modules/quote/quote.repository.ts
grep -q '${subject} ${path}.${field} must be an own field' backend/src/modules/quote/quote.repository.ts
grep -q '${subject} ${path}.${field} must be an own field when provided' backend/src/modules/quote/quote.repository.ts
grep -q 'assertCanSaveRequestedQuote(current, input)' backend/src/modules/quote/quote.repository.ts
grep -q 'assertCanSaveRejectedQuote(current, input)' backend/src/modules/quote/quote.repository.ts
grep -q 'isSameRequestedQuotePayload' backend/src/modules/quote/quote.repository.ts
grep -q 'isSameRequestedQuotePayloadAsSigned' backend/src/modules/quote/quote.repository.ts
grep -q 'Requested quote payload cannot be changed' backend/src/modules/quote/quote.repository.ts
grep -q 'cannot save rejected quote without requested state' backend/src/modules/quote/quote.repository.ts
grep -q 'Signed quote request cannot differ from requested quote' backend/src/modules/quote/quote.repository.ts
grep -q 'Signed quote nonce key already exists' backend/src/modules/quote/quote.repository.ts
grep -q 'assertSignedQuoteInput(input)' backend/src/modules/quote/quote.repository.ts
grep -q 'Signed quote signature must be a 65-byte hex string' backend/src/modules/quote/quote.repository.ts
grep -Fq 'typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)' backend/src/modules/quote/quote.repository.ts
grep -Fq 'typeof value !== "string" || !/^[1-9][0-9]*$/.test(value)' backend/src/modules/quote/quote.repository.ts
grep -Fq 'typeof value !== "string" || !/^0x[0-9a-fA-F]{130}$/.test(value)' backend/src/modules/quote/quote.repository.ts
grep -Fq 'typeof metadata.txHash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(metadata.txHash)' backend/src/modules/quote/quote.repository.ts
grep -q 'SECP256K1N_HALF' backend/src/modules/quote/quote.repository.ts
grep -q 'Signed quote signature s value must be in the lower half order' backend/src/modules/quote/quote.repository.ts
grep -q 'Signed quote signature v value must be 27 or 28' backend/src/modules/quote/quote.repository.ts
grep -q 'Signed quote signature s value must be in the lower half order' backend/test/quote-repository-signed-validation.test.mjs
grep -q 'new String(fixedSignature())' backend/test/quote-repository-signed-validation.test.mjs
grep -q 'q_bad_amount_leading_zero' backend/test/quote-repository-lifecycle.test.mjs
grep -q 'new String(`0x${"aa".repeat(32)}`)' backend/test/quote-status-metadata-validation.test.mjs
grep -q 'InMemoryQuoteRepository rejects malformed quote persistence envelopes before storing' backend/test/quote-repository-validation.test.mjs
grep -q 'Requested quote input.request must be an own field' backend/test/quote-repository-validation.test.mjs
grep -q 'InMemoryQuoteRepository rejects inherited quote persistence fields before storing' backend/test/quote-repository-validation.test.mjs
grep -q 'Requested quote input.quoteId must be an own field' backend/test/quote-repository-validation.test.mjs
grep -q 'Requested quote request.chainId must be an own field' backend/test/quote-repository-validation.test.mjs
grep -q 'Rejected quote input.riskPolicyVersion must be an own field when provided' backend/test/quote-repository-validation.test.mjs
grep -q 'Signed quote quote.user must be an own field' backend/test/quote-repository-validation.test.mjs
grep -q 'Signed quote input.quoteId must be an own field' backend/test/quote-repository-validation.test.mjs
grep -q 'maxSafeIdentifierLength = 128' backend/src/modules/quote/quote.repository.ts
grep -Fq 'safeIdentifierPattern = /^[A-Za-z0-9_:-]+$/' backend/src/modules/quote/quote.repository.ts
grep -q 'assertSafeIdentifier(input.quoteId, "quoteId", "Requested quote")' backend/src/modules/quote/quote.repository.ts
grep -q 'assertSafeIdentifier(input.snapshotId, "snapshotId", "Rejected quote")' backend/src/modules/quote/quote.repository.ts
grep -q 'assertSafeIdentifier(input.quoteId, "quoteId")' backend/src/modules/quote/quote.repository.ts
grep -q 'assertSafeMetadataIdentifier(metadata.settlementEventId, "settlementEventId")' backend/src/modules/quote/quote.repository.ts
grep -q 'assertSafeMetadataIdentifier(metadata.hedgeOrderId, "hedgeOrderId")' backend/src/modules/quote/quote.repository.ts
grep -q 'assertSafeMetadataIdentifier(metadata.pnlId, "pnlId")' backend/src/modules/quote/quote.repository.ts
grep -q '${subject} ${field} must be a primitive string' backend/src/modules/quote/quote.repository.ts
grep -q 'Quote status ${field} must be a primitive string' backend/src/modules/quote/quote.repository.ts
grep -q 'Requested quote quoteId must be a primitive string' backend/test/quote-repository-lifecycle.test.mjs
grep -q 'Requested quote quoteId must contain only letters, numbers, underscore, colon, or hyphen' backend/test/quote-repository-lifecycle.test.mjs
grep -q 'Signed quote snapshotId must be a primitive string' backend/test/quote-repository-signed-validation.test.mjs
grep -q 'Signed quote snapshotId must be 128 characters or fewer' backend/test/quote-repository-signed-validation.test.mjs
grep -q 'Quote status hedgeOrderId must be a primitive string' backend/test/quote-status-metadata-validation.test.mjs
grep -q 'Quote status hedgeOrderId must be 128 characters or fewer' backend/test/quote-status-metadata-validation.test.mjs
grep -q 'Requested and rejected quote persistence rejects malformed root payloads and missing `request` objects before field access' book/Volume5-BackendEngineering/Chapter02-Quote-Service.md
grep -q 'Requested and rejected persistence require own top-level fields and own request fields before writing quote state' book/Volume5-BackendEngineering/Chapter02-Quote-Service.md
grep -q 'inherited optional `riskPolicyVersion` is rejected before it can affect the stored audit payload' book/Volume5-BackendEngineering/Chapter02-Quote-Service.md
grep -q 'Signed quote persistence rejects malformed root payloads, missing `quote` objects, inherited top-level fields and inherited signed quote fields before field access' book/Volume5-BackendEngineering/Chapter02-Quote-Service.md
grep -q 'quoteId` and `snapshotId` as primitive-string `SafeIdentifier` values with 1-128 characters' book/Volume5-BackendEngineering/Chapter02-Quote-Service.md
grep -q 'settlementEventId`、`hedgeOrderId`、`pnlId` must be primitive-string `SafeIdentifier` values' book/Volume5-BackendEngineering/Chapter02-Quote-Service.md
grep -q '65-byte canonical low-s EIP-712 signature before writing the `chainId:user:nonce` index' book/Volume5-BackendEngineering/Chapter02-Quote-Service.md
grep -q 'rejects non-string address, signature, `txHash` and uint-like values' book/Volume5-BackendEngineering/Chapter02-Quote-Service.md
grep -q 'assertCanSaveSignedQuote(current, input)' backend/src/modules/quote/quote.repository.ts
grep -q 'isSameSignedQuotePayload' backend/src/modules/quote/quote.repository.ts
grep -q 'Signed quote payload cannot be changed' backend/src/modules/quote/quote.repository.ts
grep -q 'cannot save signed quote from' backend/src/modules/quote/quote.repository.ts
grep -q 'assertStatusTransition(current, status)' backend/src/modules/quote/quote.repository.ts
grep -q 'assertCanMarkFailed(current, errorCode)' backend/src/modules/quote/quote.repository.ts
grep -q 'Failed quote errorCode cannot be changed' backend/src/modules/quote/quote.repository.ts
grep -q 'cannot transition from terminal status ${record.status} to failed' backend/src/modules/quote/quote.repository.ts
grep -q 'cannot transition from requested to ${nextStatus} through markStatus' backend/src/modules/quote/quote.repository.ts
grep -q 'cannot transition from signed to ${nextStatus} through markStatus' backend/src/modules/quote/quote.repository.ts
grep -q 'cannot transition from submitted to ${nextStatus}' backend/src/modules/quote/quote.repository.ts
grep -q 'terminal status expired' backend/src/modules/quote/quote.repository.ts
grep -q 'assertNonEmptyString(errorCode, "errorCode", "Failed quote")' backend/src/modules/quote/quote.repository.ts
grep -q 'assertQuoteStatusMetadata(metadata)' backend/src/modules/quote/quote.repository.ts
grep -q 'normalizeQuoteStatusMetadata(metadata)' backend/src/modules/quote/quote.repository.ts
grep -q 'metadata.txHash?.toLowerCase()' backend/src/modules/quote/quote.repository.ts
grep -q 'assertQuoteStatusMetadataDoesNotConflict(current, normalizedMetadata)' backend/src/modules/quote/quote.repository.ts
grep -q 'mergeQuoteStatusMetadata(current, normalizedMetadata)' backend/src/modules/quote/quote.repository.ts
grep -q 'assertMetadataFieldDoesNotConflict' backend/src/modules/quote/quote.repository.ts
grep -q 'assertNonSettlementStatusMetadata(current, status, normalizedMetadata)' backend/src/modules/quote/quote.repository.ts
grep -q 'assertNonSettlementMetadataField' backend/src/modules/quote/quote.repository.ts
grep -q 'assertSettlementStatusMetadata(current, status, normalizedMetadata)' backend/src/modules/quote/quote.repository.ts
grep -q 'Quote status txHash must be a 32-byte hex string' backend/src/modules/quote/quote.repository.ts
grep -q 'status must not include' backend/src/modules/quote/quote.repository.ts
grep -q 'status cannot retain' backend/src/modules/quote/quote.repository.ts
grep -q 'cannot be changed once set' backend/src/modules/quote/quote.repository.ts
grep -q 'status requires txHash' backend/src/modules/quote/quote.repository.ts
grep -q 'status requires settlementEventId' backend/src/modules/quote/quote.repository.ts
grep -q 'rejects signed quote nonce key conflicts' backend/test/quote-repository.test.mjs
grep -q 'findSignedQuoteByQuoteId' backend/test/quote-repository.test.mjs
grep -q 'returns defensive copies of signed quote records' backend/test/quote-repository.test.mjs
grep -q 'rejects signed quote identity rewrites' backend/test/quote-repository.test.mjs
grep -q 'rejects signed quote payload rewrites' backend/test/quote-repository.test.mjs
grep -q 'rejects saveSigned lifecycle regressions' backend/test/quote-status-repository.test.mjs
grep -q 'rejects unsafe signed quote persistence inputs' backend/test/quote-repository-signed-validation.test.mjs
grep -q 'persists expired status when signed quote status is read after deadline' backend/test/quote-service.test.mjs
grep -q 'rejects expired signed quotes before signature verification' backend/test/quote-service-submit.test.mjs
grep -q 'rejects unsafe requested and rejected quote persistence inputs' backend/test/quote-repository-lifecycle.test.mjs
grep -q 'rejects requested quote payload rewrites' backend/test/quote-repository-lifecycle.test.mjs
grep -q 'rejects rejected quote payload rewrites' backend/test/quote-repository-lifecycle.test.mjs
grep -q 'rejects terminal quote status regressions' backend/test/quote-status-repository.test.mjs
grep -q 'Failed quote errorCode cannot be changed' backend/test/quote-status-repository.test.mjs
grep -q 'cannot transition from terminal status rejected to failed' backend/test/quote-status-repository.test.mjs
grep -q 'cannot transition from requested to settled through markStatus' backend/test/quote-status-repository.test.mjs
grep -q 'cannot transition from submitted to expired' backend/test/quote-status-repository.test.mjs
grep -q 'rejects malformed quote status metadata' backend/test/quote-status-metadata-validation.test.mjs
grep -q 'rejects conflicting quote status metadata rewrites' backend/test/quote-status-metadata-validation.test.mjs
grep -q 'Quote status hedgeOrderId cannot be changed once set' backend/test/quote-status-metadata-validation.test.mjs
grep -Fq 'txHash: `0x${"AA".repeat(32)}`' backend/test/quote-status-metadata-validation.test.mjs
grep -q 'rejects settlement statuses without chain pointers' backend/test/quote-status-repository-validation.test.mjs
grep -q 'rejects non-settlement statuses with settlement pointers' backend/test/quote-status-repository-validation.test.mjs
grep -q 'expired status must not include txHash' backend/test/quote-status-repository-validation.test.mjs
grep -q 'rejects malformed failed quote metadata' backend/test/quote-status-repository-validation.test.mjs
grep -q 'preserves settlement metadata across status updates' backend/test/quote-status-repository.test.mjs
grep -q 'chainId:user:nonce' book/Volume5-BackendEngineering/Chapter02-Quote-Service.md
grep -q 'Requested quote storage is write-once by `quoteId`' book/Volume5-BackendEngineering/Chapter02-Quote-Service.md
grep -q 'including a different `slippageBps`' book/Volume5-BackendEngineering/Chapter02-Quote-Service.md
grep -q 'must start from the matching requested quote' book/Volume5-BackendEngineering/Chapter02-Quote-Service.md
grep -q 'bind to the same requested `quoteId`, `snapshotId`, chain, user, token pair, `amountIn` and `slippageBps`' book/Volume5-BackendEngineering/Chapter02-Quote-Service.md
grep -q 'exact same signed payload' book/Volume5-BackendEngineering/Chapter02-Quote-Service.md
grep -q 'pricing bps components, pricing/risk versions and signature' book/Volume5-BackendEngineering/Chapter02-Quote-Service.md
grep -q 'must not move submitted, settled, failed, rejected or expired quotes back to `signed`' book/Volume5-BackendEngineering/Chapter02-Quote-Service.md
grep -q 'requested/rejected quote persistence validation' book/Volume5-BackendEngineering/Chapter02-Quote-Service.md
grep -q 'signed quote persistence validation' book/Volume5-BackendEngineering/Chapter02-Quote-Service.md
grep -q 'bounded request `slippageBps`' book/Volume5-BackendEngineering/Chapter02-Quote-Service.md
grep -q 'bounded pricing bps components' book/Volume5-BackendEngineering/Chapter02-Quote-Service.md
grep -q 'terminal quote status invariants' book/Volume5-BackendEngineering/Chapter02-Quote-Service.md
grep -q 'requested quotes cannot be marked submitted, settled or expired through the status updater' book/Volume5-BackendEngineering/Chapter02-Quote-Service.md
grep -q 'already failed quote may replay the same `errorCode`' book/Volume5-BackendEngineering/Chapter02-Quote-Service.md
grep -q 'different failure reason is rejected' book/Volume5-BackendEngineering/Chapter02-Quote-Service.md
grep -q 'quote status metadata validation' book/Volume5-BackendEngineering/Chapter02-Quote-Service.md
grep -q 'Quote status `txHash` is normalized to lowercase before persistence' book/Volume5-BackendEngineering/Chapter02-Quote-Service.md
grep -q 'canonical transaction hash shape' book/Volume5-BackendEngineering/Chapter02-Quote-Service.md
grep -q 'Quote status pointers are immutable once set' book/Volume5-BackendEngineering/Chapter02-Quote-Service.md
grep -q 'a different value is rejected' book/Volume5-BackendEngineering/Chapter02-Quote-Service.md
grep -q 'Non-settlement status updates such as `expired` must not include or retain' book/Volume5-BackendEngineering/Chapter02-Quote-Service.md
grep -q 'post-trade pointers on unfilled quotes' book/Volume5-BackendEngineering/Chapter02-Quote-Service.md
grep -q 'requires `txHash` and `settlementEventId` before a quote can become `submitted` or `settled`' book/Volume5-BackendEngineering/Chapter02-Quote-Service.md
grep -q 'returns defensive copies from signed quote lookup operations' book/Volume5-BackendEngineering/Chapter02-Quote-Service.md
grep -q 'indexes signed quotes by chain, user, and nonce' backend/test/quote-repository.test.mjs
grep -q 'uq_quotes_chain_user_nonce' docs/database/schema.sql
grep -q 'quotes must keep the chain_id, user_address, nonce signed-quote lookup key' scripts/check-database-schema-consistency.mjs
grep -q 'partial unique index `(chain_id, user_address, nonce) WHERE nonce IS NOT NULL`' docs/database/er-diagram.md
grep -q 'chk_quotes_id_safe' docs/database/schema.sql
grep -q 'chk_market_snapshots_id_safe' docs/database/schema.sql
grep -q 'chk_risk_decisions_id_safe' docs/database/schema.sql
grep -q 'chk_settlement_events_id_safe' docs/database/schema.sql
grep -q 'chk_inventory_positions_id_safe' docs/database/schema.sql
grep -q 'chk_hedge_orders_id_safe' docs/database/schema.sql
grep -q 'chk_pnl_records_id_safe' docs/database/schema.sql
grep -Fq "id ~ '^[A-Za-z0-9_:-]+$'" docs/database/schema.sql
grep -q 'char_length(id) <= 128' docs/database/schema.sql
grep -q 'chk_quotes_status' docs/database/schema.sql
grep -q 'chk_quotes_chain_id_safe' docs/database/schema.sql
grep -q 'chk_market_snapshots_source_non_empty' docs/database/schema.sql
grep -q 'chk_market_snapshots_chain_id_safe' docs/database/schema.sql
grep -q 'chk_settlement_events_chain_id_safe' docs/database/schema.sql
grep -q 'chk_inventory_positions_chain_id_safe' docs/database/schema.sql
grep -q 'chk_hedge_orders_chain_id_safe' docs/database/schema.sql
grep -q 'chk_pnl_records_chain_id_safe' docs/database/schema.sql
grep -q 'chk_quotes_distinct_tokens' docs/database/schema.sql
grep -q 'chk_market_snapshots_distinct_tokens' docs/database/schema.sql
grep -q 'chk_settlement_events_distinct_tokens' docs/database/schema.sql
grep -q 'chk_pnl_records_distinct_tokens' docs/database/schema.sql
grep -q 'chk_quotes_metadata_non_empty' docs/database/schema.sql
grep -q 'chk_quotes_signature_and_tx_hash_hex' docs/database/schema.sql
grep -q 'substring(signature from 67 for 64)' docs/database/schema.sql
grep -q "substring(signature from 131 for 2)) IN ('1b', '1c')" docs/database/schema.sql
grep -q 'chk_quotes_status_payload_consistency' docs/database/schema.sql
grep -q 'chk_quotes_signed_payload_atomic' docs/database/schema.sql
grep -q 'chk_quotes_unfilled_payload_consistency' docs/database/schema.sql
grep -q 'chk_quotes_signed_payload_consistency' docs/database/schema.sql
grep -q 'chk_quotes_rejection_payload_consistency' docs/database/schema.sql
grep -q 'nonce IS NULL OR nonce > 0' docs/database/schema.sql
grep -q 'amount_out >= min_amount_out' docs/database/schema.sql
grep -q 'slippage_bps INTEGER NOT NULL' docs/database/schema.sql
grep -q 'chk_quotes_slippage_bps' docs/database/schema.sql
grep -q 'slippage_bps BETWEEN 0 AND 10000' docs/database/schema.sql
grep -q 'spread_bps INTEGER' docs/database/schema.sql
grep -q 'size_impact_bps INTEGER' docs/database/schema.sql
grep -q 'market_spread_bps INTEGER' docs/database/schema.sql
grep -q 'inventory_skew_bps INTEGER' docs/database/schema.sql
grep -q 'volatility_premium_bps INTEGER' docs/database/schema.sql
grep -q 'hedge_cost_bps INTEGER' docs/database/schema.sql
grep -q 'chk_quotes_pricing_bps' docs/database/schema.sql
grep -q 'spread_bps BETWEEN 0 AND 10000' docs/database/schema.sql
grep -q 'size_impact_bps BETWEEN 0 AND 10000' docs/database/schema.sql
grep -q 'market_spread_bps BETWEEN 0 AND 10000' docs/database/schema.sql
grep -q 'inventory_skew_bps BETWEEN -10000 AND 10000' docs/database/schema.sql
grep -q 'volatility_premium_bps BETWEEN 0 AND 10000' docs/database/schema.sql
grep -q 'hedge_cost_bps BETWEEN 0 AND 10000' docs/database/schema.sql
grep -q 'chk_settlement_events_hashes' docs/database/schema.sql
grep -q 'AND nonce > 0' docs/database/schema.sql
grep -q 'bid_price <= mid_price' docs/database/schema.sql
grep -q 'mid_price <= ask_price' docs/database/schema.sql
grep -q 'market_spread_bps INTEGER NOT NULL' docs/database/schema.sql
grep -q 'volatility_bps INTEGER NOT NULL' docs/database/schema.sql
grep -q 'AND volatility_bps BETWEEN 0 AND 10000' docs/database/schema.sql
grep -q 'chk_hedge_orders_side' docs/database/schema.sql
grep -q 'chk_hedge_orders_reason' docs/database/schema.sql
grep -q 'chk_hedge_orders_venue_non_empty' docs/database/schema.sql
grep -q 'chk_hedge_orders_external_order_id_non_empty' docs/database/schema.sql
grep -q 'chk_pnl_records_model' docs/database/schema.sql
grep -q 'chk_pnl_records_model_description' docs/database/schema.sql
grep -q 'user_address TEXT NOT NULL' docs/database/schema.sql
grep -q 'liquidity_usd NUMERIC(78, 0) NOT NULL' docs/database/schema.sql
grep -q 'AND liquidity_usd > 0' docs/database/schema.sql
grep -q 'deadline BIGINT,' docs/database/schema.sql
grep -q 'deadline IS NULL OR deadline BETWEEN 1 AND 9007199254740991' docs/database/schema.sql
grep -q 'min_amount_out NUMERIC(78, 0) NOT NULL' docs/database/schema.sql
grep -q 'deadline BIGINT NOT NULL' docs/database/schema.sql
grep -q 'deadline BETWEEN 1 AND 9007199254740991' docs/database/schema.sql
grep -q 'gross_pnl_bps BIGINT NOT NULL' docs/database/schema.sql
grep -q 'gross_pnl_bps BETWEEN -9007199254740991 AND 9007199254740991' docs/database/schema.sql
grep -q 'log_index BIGINT NOT NULL' docs/database/schema.sql
grep -q 'log_index BETWEEN 0 AND 9007199254740991' docs/database/schema.sql
grep -q 'block_number BETWEEN 0 AND 9007199254740991' docs/database/schema.sql
grep -q 'user: "user_address"' scripts/check-database-schema-consistency.mjs
grep -q 'minAmountOut: "min_amount_out"' scripts/check-database-schema-consistency.mjs
grep -q 'deadline: "deadline"' scripts/check-database-schema-consistency.mjs
grep -q 'slippageBps: "slippage_bps"' scripts/check-database-schema-consistency.mjs
grep -q 'quotes.slippage_bps must persist QuoteRequest.slippageBps for quote replay' scripts/check-database-schema-consistency.mjs
grep -q 'SaveSignedQuoteInput must carry slippageBps so signed quote persistence can populate quotes.slippage_bps' scripts/check-database-schema-consistency.mjs
grep -q 'signed quote persistence must validate slippageBps before writing quote state' scripts/check-database-schema-consistency.mjs
grep -q 'SaveSignedQuoteInput must carry pricing bps components for quote replay' scripts/check-database-schema-consistency.mjs
grep -q 'signed quote persistence must reject pricing bps rewrites' scripts/check-database-schema-consistency.mjs
grep -q 'quotes signed payload constraints must require ${columnName} to be atomic with signed quote state' scripts/check-database-schema-consistency.mjs
grep -q 'quote_snapshot_edge_v1' docs/database/er-diagram.md
grep -q 'id must reject empty primary key values' scripts/check-database-schema-consistency.mjs
grep -q 'quotes must constrain lifecycle status values' scripts/check-database-schema-consistency.mjs
grep -q 'chain_id must be constrained to the JavaScript safe integer range' scripts/check-database-schema-consistency.mjs
grep -q 'must require distinct token_in and token_out addresses' scripts/check-database-schema-consistency.mjs
grep -q 'canonical low-s EIP-712 signatures' scripts/check-database-schema-consistency.mjs
grep -q 'recovery id 27 or 28' scripts/check-database-schema-consistency.mjs
grep -q 'submitted and settled quotes must keep tx_hash and settlement_event_id pointers' scripts/check-database-schema-consistency.mjs
grep -q 'quotes.deadline must be stored as signed quote Unix seconds' scripts/check-database-schema-consistency.mjs
grep -q 'quotes must require positive signed amount and nonce fields plus safe-integer deadlines when present' scripts/check-database-schema-consistency.mjs
grep -q 'quotes must require amount_out to satisfy min_amount_out when both are present' scripts/check-database-schema-consistency.mjs
grep -q 'pnl_records must require safe-integer signed attribution deadlines' scripts/check-database-schema-consistency.mjs
grep -q 'pnl_records.gross_pnl_bps must be stored as a JavaScript safe-integer sized signed bps value' scripts/check-database-schema-consistency.mjs
grep -q 'pnl_records must constrain gross PnL bps to JavaScript safe integer range' scripts/check-database-schema-consistency.mjs
grep -q 'settlement_events.log_index must be stored as a JavaScript safe-integer sized ordinal' scripts/check-database-schema-consistency.mjs
grep -q 'settlement_events must require positive settled amount and nonce fields plus safe-integer event ordinals' scripts/check-database-schema-consistency.mjs
grep -q 'market_snapshots must keep bid_price <= mid_price <= ask_price when bid or ask are present' scripts/check-database-schema-consistency.mjs
grep -q 'market_snapshots.liquidity_usd must be stored as a required positive uint-sized value' scripts/check-database-schema-consistency.mjs
grep -q 'market_snapshots must require positive liquidity_usd' scripts/check-database-schema-consistency.mjs
grep -q 'market_snapshots.market_spread_bps must be required because MarketSnapshot.marketSpreadBps is required' scripts/check-database-schema-consistency.mjs
grep -q 'market_snapshots.volatility_bps must be required because MarketSnapshot.volatilityBps is required' scripts/check-database-schema-consistency.mjs
grep -q 'market_snapshots must constrain volatility_bps to the 0..10000 bps range' scripts/check-database-schema-consistency.mjs
grep -q 'market_snapshots must reject empty source values' scripts/check-database-schema-consistency.mjs
grep -q 'non-settlement quote statuses must not expose settlement, hedge, or PnL pointers' scripts/check-database-schema-consistency.mjs
grep -q 'quote signed payload fields must be all present or all absent' scripts/check-database-schema-consistency.mjs
grep -q 'requested and rejected quotes must not carry signed payload fields' scripts/check-database-schema-consistency.mjs
grep -q 'signed lifecycle statuses must keep complete signed quote payload metadata' scripts/check-database-schema-consistency.mjs
grep -q 'only rejected and failed quote statuses may keep reject_code' scripts/check-database-schema-consistency.mjs
grep -Fq 'for (const field of ["pricing_version", "risk_policy_version", "reject_code"])' scripts/check-database-schema-consistency.mjs
grep -q 'must reject empty values when present' scripts/check-database-schema-consistency.mjs
grep -q 'risk decision policy_version must be non-empty' scripts/check-database-schema-consistency.mjs
grep -q 'risk decision reason_code must be present only for rejected decisions' scripts/check-database-schema-consistency.mjs
grep -q 'risk_decisions.reason_code constraint must match backend RiskRejectReasonCode values' scripts/check-database-schema-consistency.mjs
grep -q 'export type RiskRejectReasonCode' backend/src/modules/risk/risk.engine.ts
grep -q 'RISK_ENGINE_UNAVAILABLE' docs/database/schema.sql
grep -q 'settlement_events must constrain hash-shaped fields' scripts/check-database-schema-consistency.mjs
grep -q 'hedge_orders must constrain side enum values' scripts/check-database-schema-consistency.mjs
grep -q 'hedge reason constraint must match backend HedgeIntent reason values' scripts/check-database-schema-consistency.mjs
grep -q 'hedge_orders must persist HedgeIntentStatusResponse' scripts/check-database-schema-consistency.mjs
grep -q 'hedge_orders must reject empty or oversized venue values' scripts/check-database-schema-consistency.mjs
grep -q 'hedge_orders must reject empty external_order_id values when present' scripts/check-database-schema-consistency.mjs
grep -q 'pnl_records must constrain supported attribution models' scripts/check-database-schema-consistency.mjs
grep -q 'pnl_records must constrain supported attribution model descriptions' scripts/check-database-schema-consistency.mjs
grep -q '操作表 primary id 使用 SafeIdentifier 约束' docs/database/er-diagram.md
grep -q 'primary id 都必须符合 SafeIdentifier' docs/database/er-diagram.md
grep -q 'distinct token pair' docs/database/er-diagram.md
grep -q 'bid_price <= mid_price <= ask_price' docs/database/er-diagram.md
grep -q 'market snapshot `volatility_bps` 在 0..10000 bps' docs/database/er-diagram.md
grep -q 'canonical low-s EIP-712 signature' docs/database/er-diagram.md
grep -q 'market_snapshots.source` 必须是非空字符串' docs/database/er-diagram.md
grep -q 'market_snapshots.liquidity_usd` 必须是非空正整数数值' docs/database/er-diagram.md
grep -q 'market_snapshots.volatility_bps` 必须是 `0..10000` bps 内的整数' docs/database/er-diagram.md
grep -q 'hedge `venue` 非空' docs/database/er-diagram.md
grep -q '`quote_id` 是 `quotes.id` 的非空外键' docs/database/er-diagram.md
grep -q 'external_order_id` 可以在内部 queued intent 阶段为 NULL' docs/database/er-diagram.md
grep -q '只有 rejected/failed 状态可以携带非空 `reject_code`' docs/database/er-diagram.md
grep -q 'quotes.pricing_version`、`quotes.risk_policy_version` 和 `quotes.reject_code`' docs/database/er-diagram.md
grep -q 'quotes.deadline` 使用 BIGINT 保存 EIP-712 signed quote 的 Unix seconds' docs/database/er-diagram.md
grep -q 'quotes.slippage_bps` 保存原始 `QuoteRequest.slippageBps`' docs/database/er-diagram.md
grep -q 'quotes.volatility_premium_bps` 和 `quotes.hedge_cost_bps`' docs/database/er-diagram.md
grep -q '外键绑定实际 settlement event 与原始 market snapshot' docs/database/er-diagram.md
grep -q 'model_description' docs/database/er-diagram.md
grep -q 'safe-integer signed `gross_pnl_bps`' docs/database/er-diagram.md
grep -q 'settlement_events.log_index` 和 `settlement_events.block_number` 使用 BIGINT 保存链上 event ordinal' docs/database/er-diagram.md
grep -q 'reason_code` 只允许出现在 rejected decision 上' docs/database/er-diagram.md
grep -q 'RiskRejectReasonCode` 稳定枚举' docs/database/er-diagram.md
grep -q 'signed payload 字段全有或全无' docs/database/er-diagram.md
grep -q '正数 signed amount/nonce' docs/database/er-diagram.md
grep -q 'amount_out >= min_amount_out' docs/database/er-diagram.md
grep -q 'status payload consistency' docs/database/er-diagram.md
grep -q 'JavaScript safe integer range `1..9007199254740991`' docs/database/er-diagram.md
grep -q 'PostgreSQL schema mirrors these invariants with quote status payload consistency checks' book/Volume5-BackendEngineering/Chapter02-Quote-Service.md
grep -q '`pricing_version` / `risk_policy_version` / `reject_code` must be non-empty whenever present' book/Volume5-BackendEngineering/Chapter02-Quote-Service.md
grep -q 'PostgreSQL stores `quotes.deadline` as BIGINT Unix seconds in the JavaScript safe integer range' book/Volume5-BackendEngineering/Chapter02-Quote-Service.md
grep -q 'PostgreSQL stores `quotes.slippage_bps` as the original `QuoteRequest.slippageBps`' book/Volume5-BackendEngineering/Chapter02-Quote-Service.md
grep -q 'quotes.volatility_premium_bps` and `quotes.hedge_cost_bps`' book/Volume5-BackendEngineering/Chapter02-Quote-Service.md
grep -q 'signed payload fields and pricing bps components must be all present or all absent' book/Volume5-BackendEngineering/Chapter02-Quote-Service.md
grep -q 'PostgreSQL requires `quotes.snapshot_id` for every persisted quote' book/Volume5-BackendEngineering/Chapter02-Quote-Service.md
grep -q 'snapshot_id TEXT NOT NULL' docs/database/schema.sql
grep -q 'fk_quotes_snapshot_id' docs/database/schema.sql
grep -q 'fk_quotes_settlement_event_id' docs/database/schema.sql
grep -q 'fk_quotes_hedge_order_id' docs/database/schema.sql
grep -q 'fk_quotes_pnl_id' docs/database/schema.sql
grep -q 'quotes.snapshot_id must reference market_snapshots(id)' scripts/check-database-schema-consistency.mjs
grep -q 'quotes.snapshot_id must be required for quote replay' scripts/check-database-schema-consistency.mjs
grep -q 'quotes.settlement_event_id must reference settlement_events(id)' scripts/check-database-schema-consistency.mjs
grep -q 'quotes.hedge_order_id must reference hedge_orders(id)' scripts/check-database-schema-consistency.mjs
grep -q 'quotes.pnl_id must reference pnl_records(id)' scripts/check-database-schema-consistency.mjs
grep -q '状态指针不能悬空' docs/database/er-diagram.md
grep -q 'quotes.snapshot_id` 是指向 `market_snapshots.id` 的必填 foreign key' docs/database/er-diagram.md
grep -q 'idx_market_snapshots_pair_observed_at' docs/database/schema.sql
grep -q 'idx_quotes_snapshot_id' docs/database/schema.sql
grep -q 'idx_quotes_settlement_event_id' docs/database/schema.sql
grep -q 'idx_quotes_hedge_order_id' docs/database/schema.sql
grep -q 'idx_quotes_pnl_id' docs/database/schema.sql
grep -q 'market_snapshots must support latest snapshot lookup by chain and token pair' scripts/check-database-schema-consistency.mjs
grep -q 'must use a partial index for non-null status pointer joins' scripts/check-database-schema-consistency.mjs
grep -q 'nullable status pointers 使用 partial indexes' docs/database/er-diagram.md
grep -q '(chain_id, token_in, token_out, observed_at DESC)' book/Volume2-MarketData-And-Pricing/Chapter01-Market-Data.md
grep -q 'CREATE OR REPLACE FUNCTION set_updated_at' docs/database/schema.sql
grep -q 'trg_quotes_set_updated_at' docs/database/schema.sql
grep -q 'trg_inventory_positions_set_updated_at' docs/database/schema.sql
grep -q 'trg_hedge_orders_set_updated_at' docs/database/schema.sql
grep -q 'must refresh updated_at through a BEFORE UPDATE trigger' scripts/check-database-schema-consistency.mjs
grep -q '共享 `set_updated_at()` trigger' docs/database/er-diagram.md
grep -q 'quote_hash TEXT NOT NULL' docs/database/schema.sql
grep -q 'nonce NUMERIC(78, 0) NOT NULL' docs/database/schema.sql
grep -q 'quote_hash' docs/database/er-diagram.md
grep -q 'quoteHash: "quote_hash"' scripts/check-database-schema-consistency.mjs
grep -q 'nonce: "nonce"' scripts/check-database-schema-consistency.mjs
grep -q 'settlement_events must persist SettlementEventStatusResponse' scripts/check-database-schema-consistency.mjs
grep -q 'uq_hedge_orders_settlement_event' docs/database/schema.sql
grep -q 'settlement_event_id TEXT NOT NULL REFERENCES settlement_events(id)' docs/database/schema.sql
grep -q 'quote_id TEXT NOT NULL REFERENCES quotes(id)' docs/database/schema.sql
grep -q 'hedge_orders.settlement_event_id must be a required settlement_events(id) foreign key' scripts/check-database-schema-consistency.mjs
grep -q 'hedge_orders.quote_id must be a required quotes(id) foreign key' scripts/check-database-schema-consistency.mjs
grep -q 'hedge_orders must keep one hedge intent per settlement event' scripts/check-database-schema-consistency.mjs
grep -q 'unique index `(settlement_event_id)`' docs/database/er-diagram.md
grep -q 'quote_id TEXT NOT NULL REFERENCES quotes(id)' docs/database/schema.sql
grep -q 'settlement_events.quote_id must be a required quotes(id) foreign key' scripts/check-database-schema-consistency.mjs
grep -q 'settlement_events.quote_id' docs/database/er-diagram.md
grep -q 'uq_settlement_events_canonical_quote_id' docs/database/schema.sql
grep -q 'settlement_events must keep one canonical settlement event per quote' scripts/check-database-schema-consistency.mjs
grep -q 'slippageBps: input.request.slippageBps' backend/src/modules/quote/quote.repository.ts
grep -q 'slippageBps: input.slippageBps' backend/src/modules/quote/quote.repository.ts
grep -q 'spreadBps: input.spreadBps' backend/src/modules/quote/quote.repository.ts
grep -q 'sizeImpactBps: input.sizeImpactBps' backend/src/modules/quote/quote.repository.ts
grep -q 'inventorySkewBps: input.inventorySkewBps' backend/src/modules/quote/quote.repository.ts
grep -q 'volatilityPremiumBps: input.volatilityPremiumBps' backend/src/modules/quote/quote.repository.ts
grep -q 'hedgeCostBps: input.hedgeCostBps' backend/src/modules/quote/quote.repository.ts
grep -q 'spreadBps: pricing.spreadBps' $quote_service_sources
grep -q 'sizeImpactBps: pricing.sizeImpactBps' $quote_service_sources
grep -q 'inventorySkewBps: pricing.inventorySkewBps' $quote_service_sources
grep -q 'volatilityPremiumBps: pricing.volatilityPremiumBps' $quote_service_sources
grep -q 'hedgeCostBps: pricing.hedgeCostBps' $quote_service_sources
grep -q 'record.slippageBps === input.request.slippageBps' backend/src/modules/quote/quote.repository.ts
grep -q 'record.slippageBps === input.slippageBps' backend/src/modules/quote/quote.repository.ts
grep -q 'record.spreadBps === input.spreadBps' backend/src/modules/quote/quote.repository.ts
grep -q 'record.sizeImpactBps === input.sizeImpactBps' backend/src/modules/quote/quote.repository.ts
grep -q 'record.inventorySkewBps === input.inventorySkewBps' backend/src/modules/quote/quote.repository.ts
grep -q 'record.volatilityPremiumBps === input.volatilityPremiumBps' backend/src/modules/quote/quote.repository.ts
grep -q 'record.hedgeCostBps === input.hedgeCostBps' backend/src/modules/quote/quote.repository.ts
grep -q 'slippageBps: request.slippageBps + 1' backend/test/quote-repository-lifecycle.test.mjs
grep -q 'Signed quote slippageBps must be less than or equal to 10000 bps' backend/test/quote-repository-signed-validation.test.mjs
grep -q 'Signed quote spreadBps must be less than or equal to 10000 bps' backend/test/quote-repository-signed-validation.test.mjs
grep -q 'Signed quote inventorySkewBps magnitude must be less than or equal to 10000 bps' backend/test/quote-repository-signed-validation.test.mjs
grep -q 'slippageBps: 50' scripts/reconciliation-check.mjs
grep -q 'spreadBps: 8' scripts/reconciliation-check.mjs
grep -q 'partial unique index `(quote_id) WHERE canonical = TRUE`' docs/database/er-diagram.md
grep -q 'applySettlement' backend/src/modules/execution/execution.service.ts
grep -q 'applySettlementEvent' backend/src/modules/execution/execution.service.ts
grep -q 'settlementVerifier.verify' backend/src/modules/execution/execution.service.ts
grep -q 'SETTLEMENT_UNAVAILABLE' backend/src/modules/execution/execution.service.ts
grep -q 'SettlementEventStore' backend/src/modules/execution/execution.service.ts
grep -q 'settlementEventStoreFailure' backend/src/modules/execution/execution.service.ts
grep -q 'assertExecutionServiceDeps(deps)' backend/src/modules/execution/execution.service.ts
grep -q 'assertRecord(deps, "deps")' backend/src/modules/execution/execution.service.ts
grep -q 'assertOwnFields(deps, executionServiceDepsFields, "deps")' backend/src/modules/execution/execution.service.ts
grep -q 'Execution service ${path}.${field} must be an own field' backend/src/modules/execution/execution.service.ts
grep -q 'assertRecord(dependency, dependencyName)' backend/src/modules/execution/execution.service.ts
grep -q 'assertDependencyMethod(deps.settlementVerifier, "settlementVerifier", "verify")' backend/src/modules/execution/execution.service.ts
grep -q 'settlementVerificationResultFields = \["status", "verifierVersion", "amountOut"\]' backend/src/modules/execution/execution.service.ts
grep -q 'assertSettlementVerificationResult(settlementVerification, request.quote.amountOut)' backend/src/modules/execution/execution.service.ts
grep -q 'Execution service settlement verification amountOut must match quote amountOut' backend/src/modules/execution/execution.service.ts
grep -q 'settlementEventResultFields = \["event", "duplicate"\]' backend/src/modules/execution/execution.service.ts
grep -q 'assertApplySettlementEventResult(settlementEventResult, input)' backend/src/modules/execution/execution.service.ts
grep -q 'Execution service settlement event quoteHash must match submitted quote' backend/src/modules/execution/execution.service.ts
grep -q 'hedgeResultFields = \["status", "hedgeOrderId", "record"\]' backend/src/modules/execution/execution.service.ts
grep -q 'assertHedgeResult(hedgeResult, intent)' backend/src/modules/execution/execution.service.ts
grep -q 'Execution service hedge result.record amount must match hedge intent' backend/src/modules/execution/execution.service.ts
grep -q 'inventoryPositionFields = \["chainId", "token", "balance"\]' backend/src/modules/execution/execution.service.ts
grep -q 'readInventoryPositions(validatedRequest)' backend/src/modules/execution/execution.service.ts
grep -q 'Execution service inventory position.${field}.balance must be a bigint' backend/src/modules/execution/execution.service.ts
grep -q 'cloneExecutionServiceDeps' backend/src/modules/execution/execution.service.ts
grep -q 'keccak256(toBytes(payload))' backend/src/modules/execution/execution.service.ts
grep -q 'maxSafeIdentifierLength = 128' backend/src/modules/execution/execution.service.ts
grep -Fq 'safeIdentifierPattern = /^[A-Za-z0-9_:-]+$/' backend/src/modules/execution/execution.service.ts
grep -q 'buildSyntheticTxHash returns deterministic keccak256 bytes32 hashes' backend/test/execution.test.mjs
grep -q 'buildSyntheticTxHash rejects malformed submit payloads before hashing' backend/test/execution-validation.test.mjs
grep -q 'SkeletonExecutionService suppresses duplicate settlement side effects' backend/test/execution.test.mjs
grep -q 'SkeletonExecutionService snapshots dependency object at construction' backend/test/execution.test.mjs
grep -q 'SkeletonExecutionService rejects malformed settlement verifier results before side effects' backend/test/execution-settlement-results.test.mjs
grep -q 'internalRoute: "bypass"' backend/test/execution-settlement-results.test.mjs
grep -q 'SkeletonExecutionService rejects malformed settlement event results before follow-up side effects' backend/test/execution-settlement-results.test.mjs
grep -q 'internalState: "unsafe"' backend/test/execution-settlement-results.test.mjs
grep -q 'assert.equal(inventoryReads, 0)' backend/test/execution-settlement-results.test.mjs
grep -q 'SkeletonExecutionService treats malformed hedge results as post-settlement hedge failures' backend/test/execution.test.mjs
grep -q 'assert.equal(result.response.hedgeOrderId, undefined)' backend/test/execution.test.mjs
grep -q 'assert.equal(hedgeFailures, 1)' backend/test/execution.test.mjs
grep -q 'SkeletonExecutionService treats malformed inventory position reads as metric-only unavailable' backend/test/execution.test.mjs
grep -q 'assert.equal(result.inventoryPositions, undefined)' backend/test/execution.test.mjs
grep -q 'SETTLEMENT_UNAVAILABLE' backend/test/execution-settlement-results.test.mjs
grep -q 'SkeletonExecutionService rejects unsafe dependency configuration at construction' backend/test/execution-validation.test.mjs
grep -q 'Execution service deps.hedgeService must be an own field' backend/test/execution-validation.test.mjs
grep -q 'Execution service hedgeService must be an object' backend/test/execution-validation.test.mjs
grep -q 'Execution service settlementVerifier must be an object' backend/test/execution-validation.test.mjs
grep -q 'validateSubmitQuoteRequest(request)' backend/src/modules/execution/execution.service.ts
grep -q 'Execution context quoteId must be an own field' backend/src/modules/execution/execution.service.ts
grep -q 'Execution context quoteId must be a primitive string' backend/src/modules/execution/execution.service.ts
grep -q 'Execution context quoteId must be a non-empty string' backend/src/modules/execution/execution.service.ts
grep -q 'Execution context quoteId must be an own field' backend/test/execution-validation.test.mjs
grep -q 'Execution context quoteId must be a primitive string' backend/test/execution-validation.test.mjs
grep -q 'Execution context quoteId must contain only letters, numbers, underscore, colon, or hyphen' backend/test/execution-validation.test.mjs
grep -q 'Execution context quoteId must be 128 characters or fewer' backend/test/execution-validation.test.mjs
grep -q 'SkeletonExecutionService rejects unsafe execution inputs before settlement side effects' backend/test/execution-validation.test.mjs
grep -q 'rejects malformed execution context envelopes plus execution `quoteId` values that are not own primitive-string 1-128 character `SafeIdentifier` values' book/Volume5-BackendEngineering/Chapter06-Execution-Service.md
grep -q 'validates the `ApplySettlementEventResult` returned by the settlement event store' book/Volume5-BackendEngineering/Chapter06-Execution-Service.md
grep -q 'Malformed or mismatched event-store output returns `SETTLEMENT_EVENT_STORE_UNAVAILABLE`' book/Volume5-BackendEngineering/Chapter06-Execution-Service.md
grep -q 'validates the `HedgeResult` returned by the hedge adapter before exposing `hedgeOrderId`' book/Volume5-BackendEngineering/Chapter06-Execution-Service.md
grep -q 'Malformed or mismatched hedge output is treated as `HEDGE_INTENT_FAILED`' book/Volume5-BackendEngineering/Chapter06-Execution-Service.md
grep -q 'class SettlementEventService' backend/src/modules/settlement/settlement-event.service.ts
grep -q 'interface SettlementEventStore' backend/src/modules/settlement/settlement-event.service.ts
grep -q 'getSettlementEvent' backend/src/modules/settlement/settlement-event.service.ts
grep -q 'listSettlementEvents' backend/src/modules/settlement/settlement-event.service.ts
grep -q 'removeSettlementEvent' backend/src/modules/settlement/settlement-event.service.ts
grep -q 'rebuildFromSettlements' backend/src/modules/settlement/settlement-event.service.ts
grep -q 'assertSettlementEventServiceDeps(inventoryService)' backend/src/modules/settlement/settlement-event.service.ts
grep -q 'assertDependencyMethod(inventoryService, "inventoryService", "rebuildFromSettlements")' backend/src/modules/settlement/settlement-event.service.ts
grep -q 'assertRecord(inventoryService, "inventoryService")' backend/src/modules/settlement/settlement-event.service.ts
grep -q 'assertRecord(input, "input")' backend/src/modules/settlement/settlement-event.service.ts
grep -q 'assertRecord(input, "reorg input")' backend/src/modules/settlement/settlement-event.service.ts
grep -q 'assertRecord(quote, "quote")' backend/src/modules/settlement/settlement-event.service.ts
grep -q 'assertOwnFields(input, settlementEventInputFields, "input")' backend/src/modules/settlement/settlement-event.service.ts
grep -q 'assertOwnFields(input, removeSettlementEventInputFields, "reorg input")' backend/src/modules/settlement/settlement-event.service.ts
grep -q 'assertOwnOptionalFields(input, settlementEventOrdinalFields, "input")' backend/src/modules/settlement/settlement-event.service.ts
grep -q 'assertOwnOptionalFields(input, settlementEventOrdinalFields, "reorg input")' backend/src/modules/settlement/settlement-event.service.ts
grep -q 'assertOwnFields(quote, settlementQuoteFields, "quote")' backend/src/modules/settlement/settlement-event.service.ts
grep -q 'Settlement event ${path}.${field} must be an own field' backend/src/modules/settlement/settlement-event.service.ts
grep -q 'Settlement event ${path}.${field} must be an own field when provided' backend/src/modules/settlement/settlement-event.service.ts
grep -q 'eventIdsByQuoteId' backend/src/modules/settlement/settlement-event.service.ts
grep -q 'txHash.slice(2)}_${logIndex}' backend/src/modules/settlement/settlement-event.service.ts
grep -q 'eventKey' backend/src/modules/settlement/settlement-event.service.ts
grep -q 'settlementEventsMatch' backend/src/modules/settlement/settlement-event.service.ts
grep -q 'left.nonce === right.nonce' backend/src/modules/settlement/settlement-event.service.ts
grep -q 'nonce: input.quote.nonce' backend/src/modules/settlement/settlement-event.service.ts
grep -q 'cloneSettlementEvent' backend/src/modules/settlement/settlement-event.service.ts
grep -q 'maxSafeIdentifierLength = 128' backend/src/modules/settlement/settlement-event.service.ts
grep -Fq 'safeIdentifierPattern = /^[A-Za-z0-9_:-]+$/' backend/src/modules/settlement/settlement-event.service.ts
grep -q 'buildSettlementEventId(input.quote.chainId, txHash, logIndex)' backend/src/modules/settlement/settlement-event.service.ts
grep -q 'assertSafeIdentifier(settlementEventId, "settlementEventId")' backend/src/modules/settlement/settlement-event.service.ts
grep -q 'assertSettlementEventInput' backend/src/modules/settlement/settlement-event.service.ts
grep -q 'assertSafeIdentifier(input.quoteId, "quoteId")' backend/src/modules/settlement/settlement-event.service.ts
grep -q 'Settlement event ${field} must be a primitive string' backend/src/modules/settlement/settlement-event.service.ts
grep -q 'Settlement event quote.amountOut must be greater than or equal to quote.minAmountOut' backend/src/modules/settlement/settlement-event.service.ts
grep -Fq '!/^[1-9][0-9]*$/.test(value)' backend/src/modules/settlement/settlement-event.service.ts
grep -Fq 'typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value)' backend/src/modules/settlement/settlement-event.service.ts
grep -q 'assert.equal(first.event.nonce, quote.nonce)' backend/test/settlement-event.test.mjs
grep -q 'keeps distinct events with the same tx hash prefix' backend/test/settlement-event.test.mjs
grep -q 'rejects conflicting events for an already settled quote' backend/test/settlement-event-validation.test.mjs
grep -q 'lists settlement events in chain order' backend/test/settlement-event.test.mjs
grep -q 'returns defensive copies of settlement events' backend/test/settlement-event.test.mjs
grep -q 'rejects unsafe settlement event lookup identifiers' backend/test/settlement-event-lookup-validation.test.mjs
grep -q 'Settlement event settlementEventId must be a primitive string' backend/test/settlement-event-lookup-validation.test.mjs
grep -q 'Settlement event quoteId must be a primitive string' backend/test/settlement-event-validation.test.mjs
grep -q 'Settlement event settlementEventId must contain only letters, numbers, underscore, colon, or hyphen' backend/test/settlement-event-lookup-validation.test.mjs
grep -q 'SettlementEventService rejects unsafe inventory dependency at construction' backend/test/settlement-event-lookup-validation.test.mjs
grep -q 'SettlementEventService rejects malformed event payload envelopes before side effects' backend/test/settlement-event-validation.test.mjs
grep -q 'Object.create({' backend/test/settlement-event-validation.test.mjs
grep -q 'Settlement event input.quoteId must be an own field' backend/test/settlement-event-validation.test.mjs
grep -q 'Settlement event quote.user must be an own field' backend/test/settlement-event-validation.test.mjs
grep -q 'Settlement event input.logIndex must be an own field when provided' backend/test/settlement-event-validation.test.mjs
grep -q 'Settlement event reorg input.txHash must be an own field' backend/test/settlement-event-validation.test.mjs
grep -q 'new String(`0x${"55".repeat(32)}`)' backend/test/settlement-event-validation.test.mjs
grep -q 'amountIn: "01000"' backend/test/settlement-event-validation.test.mjs
grep -q 'amountOut: "0990"' backend/test/settlement-event-validation.test.mjs
grep -q 'minAmountOut: "0980"' backend/test/settlement-event-validation.test.mjs
grep -q 'nonce: "01"' backend/test/settlement-event-validation.test.mjs
grep -q 'returns defensive copies from apply, remove, get and list operations' book/Volume5-BackendEngineering/Chapter06-Execution-Service.md
grep -q 'canonical positive uint strings without leading zeros' book/Volume5-BackendEngineering/Chapter06-Execution-Service.md
grep -q 'SettlementEventService` validates inventory dependency methods at construction' book/Volume5-BackendEngineering/Chapter06-Execution-Service.md
grep -q 'Malformed settlement event dependency, apply input, reorg input and quote envelopes are rejected as non-array objects before field access' book/Volume5-BackendEngineering/Chapter06-Execution-Service.md
grep -q '`txHash` as a runtime string and a 32-byte hex string' book/Volume5-BackendEngineering/Chapter06-Execution-Service.md
grep -q 'Settlement event ingestion validates `quoteId` as an own primitive-string `SafeIdentifier`' book/Volume5-BackendEngineering/Chapter06-Execution-Service.md
grep -q 'rejects inherited optional `blockNumber` / `logIndex`' book/Volume5-BackendEngineering/Chapter06-Execution-Service.md
grep -q 'Settlement status lookups also validate `settlementEventId` before reading either store implementation' book/Volume5-BackendEngineering/Chapter06-Execution-Service.md
grep -q 'persists the signed `nonce` alongside `quoteHash`' book/Volume5-BackendEngineering/Chapter06-Execution-Service.md
grep -q 'quoteHash` and `nonce` emitted by `RFQSettlement.QuoteSettled`' book/Volume5-BackendEngineering/Chapter06-Execution-Service.md
grep -q 'removes reorged events and rebuilds inventory from canonical events' backend/test/settlement-event-reorg.test.mjs
grep -q 'treats duplicate reorg removals as idempotent' backend/test/settlement-event-reorg.test.mjs
grep -q 'rejects conflicting reorg removals before mutating state' backend/test/settlement-event-reorg.test.mjs
grep -q 'rejects conflicting payloads for an existing chain event key' backend/test/settlement-event-validation.test.mjs
grep -q 'SettlementEventService rejects unsafe settlement quote inputs before side effects' backend/test/settlement-event-validation.test.mjs
grep -q 'hashSettlementQuote rejects malformed quote fields before ABI encoding' backend/test/settlement-event-lookup-validation.test.mjs
grep -q 'class ReconciliationService' backend/src/modules/reconciliation/reconciliation.service.ts
grep -q 'assertReconciliationServiceDeps(deps)' backend/src/modules/reconciliation/reconciliation.service.ts
grep -q 'assertRecord(deps, "deps")' backend/src/modules/reconciliation/reconciliation.service.ts
grep -q 'assertOwnFields(deps, reconciliationServiceDepsFields, "deps")' backend/src/modules/reconciliation/reconciliation.service.ts
grep -q 'assertOptionalOwnField(deps, "pnlService", "deps")' backend/src/modules/reconciliation/reconciliation.service.ts
grep -q 'assertOptionalOwnField(deps, "hedgeService", "deps")' backend/src/modules/reconciliation/reconciliation.service.ts
grep -q 'ReconciliationService ${path}.${field} must be an own field' backend/src/modules/reconciliation/reconciliation.service.ts
grep -q 'ReconciliationService ${path}.${field} must be an own field when provided' backend/src/modules/reconciliation/reconciliation.service.ts
grep -q 'assertRecord(dependency, dependencyName)' backend/src/modules/reconciliation/reconciliation.service.ts
grep -q 'assertDependencyMethod(deps.quoteRepository, "quoteRepository", "findSignedQuoteByQuoteId")' backend/src/modules/reconciliation/reconciliation.service.ts
grep -q 'assertDependencyMethod(deps.quoteRepository, "quoteRepository", "clearSettlementStatus")' backend/src/modules/reconciliation/reconciliation.service.ts
grep -q 'assertDependencyMethod(deps.settlementEventService, "settlementEventService", "getSettlementEventsByQuoteHash")' backend/src/modules/reconciliation/reconciliation.service.ts
grep -q 'cloneReconciliationServiceDeps' backend/src/modules/reconciliation/reconciliation.service.ts
grep -q 'reconcileSettlementToQuote' backend/src/modules/reconciliation/reconciliation.service.ts
grep -q 'reconcileRemovedSettlementToQuote' backend/src/modules/reconciliation/reconciliation.service.ts
grep -q 'reconcileSettlementToHedge' backend/src/modules/reconciliation/reconciliation.service.ts
grep -q 'reconcileRemovedSettlementToHedge' backend/src/modules/reconciliation/reconciliation.service.ts
grep -q 'reconcileSettlementToPnl' backend/src/modules/reconciliation/reconciliation.service.ts
grep -q 'reconcileRemovedSettlementToPnl' backend/src/modules/reconciliation/reconciliation.service.ts
grep -q 'normalizeSettlementReconciliationFilter' backend/src/modules/reconciliation/reconciliation.service.ts
grep -q 'hedgePlanInputFromSettlementEvent' backend/src/modules/reconciliation/reconciliation.service.ts
grep -q 'this.hedgePlanner.plan' backend/src/modules/reconciliation/reconciliation.service.ts
grep -q 'createHedgeIntent(hedgeIntent)' backend/src/modules/reconciliation/reconciliation.service.ts
grep -q 'QUOTE_NOT_FOUND' backend/src/modules/reconciliation/reconciliation.service.ts
grep -q 'SIGNED_QUOTE_NOT_FOUND' backend/src/modules/reconciliation/reconciliation.service.ts
grep -q 'clearSettlementStatus' backend/src/modules/quote/quote.repository.ts
grep -q 'settlement status removal conflict' backend/src/modules/quote/quote.repository.ts
grep -q 'removeHedgeIntentBySettlementEvent' backend/src/modules/hedge/hedge.service.ts
grep -q 'removePnlRecord' backend/src/modules/pnl/pnl.service.ts
grep -q 'repairs quote status from settlement events' backend/test/reconciliation.test.mjs
grep -q 'repairs quote status after a removed settlement event' backend/test/reconciliation-reorg.test.mjs
grep -q 'removes hedge and PnL records after a removed settlement event' backend/test/reconciliation-reorg.test.mjs
grep -q 'skips removed events when quote points at a replacement settlement' backend/test/reconciliation-reorg.test.mjs
grep -q 'scopes repairs by chain-scoped settlement quote hash' backend/test/reconciliation.test.mjs
grep -q 'rejects unsafe settlement quote hash filters before scanning' backend/test/reconciliation.test.mjs
grep -q 'reports terminal quote conflicts without stopping later events' backend/test/reconciliation.test.mjs
grep -q 'reports settlement events whose quotes are missing' backend/test/reconciliation.test.mjs
grep -q 'ReconciliationService snapshots dependency object at construction' backend/test/reconciliation-config.test.mjs
grep -q 'ReconciliationService rejects unsafe dependency configuration at construction' backend/test/reconciliation-config.test.mjs
grep -q 'ReconciliationService deps.quoteRepository must be an own field' backend/test/reconciliation-config.test.mjs
grep -q 'ReconciliationService deps.pnlService must be an own field when provided' backend/test/reconciliation-config.test.mjs
grep -q 'ReconciliationService deps.hedgeService must be an own field when provided' backend/test/reconciliation-config.test.mjs
grep -q 'ReconciliationService settlementEventService must be an object' backend/test/reconciliation-config.test.mjs
grep -q 'ReconciliationService pnlService must be an object when provided' backend/test/reconciliation-config.test.mjs
grep -q 'repairs hedge intents from settlement events' backend/test/reconciliation-hedge.test.mjs
grep -q 'reports hedge intent conflicts without stopping later events' backend/test/reconciliation-hedge.test.mjs
grep -q 'requires hedge service for settlement-to-hedge repair' backend/test/reconciliation-hedge.test.mjs
grep -q 'repairs PnL records from settlement events and signed quotes' backend/test/reconciliation-pnl.test.mjs
grep -q 'reports PnL reconciliation events whose signed quote is missing' backend/test/reconciliation-pnl.test.mjs
grep -q 'reports PnL conflicts without stopping later events' backend/test/reconciliation-pnl.test.mjs
grep -q 'requires PnL service for settlement-to-PnL repair' backend/test/reconciliation-pnl.test.mjs
grep -q 'clears matching settlement status after reorg removal' backend/test/quote-status-repository-clear.test.mjs
grep -q 'expires settlement status when removed quote is past deadline' backend/test/quote-status-repository-clear.test.mjs
grep -q 'rejects unsafe settlement status clearing' backend/test/quote-status-repository-clear.test.mjs
grep -q 'removes hedge intents by settlement event after reorgs' backend/test/hedge.test.mjs
grep -q 'removes PnL records by quote and model after reorgs' backend/test/pnl.test.mjs
grep -q 'class LocalSettlementVerifier' backend/src/modules/settlement/settlement-verifier.service.ts
grep -q 'recoverTypedDataAddress' backend/src/modules/settlement/settlement-verifier.service.ts
grep -q 'buildQuoteTypedData(quote, this.policy.settlementAddress)' backend/src/modules/settlement/settlement-verifier.service.ts
grep -q 'trustedSignerAddress' backend/src/modules/settlement/settlement-verifier.service.ts
grep -q 'Settlement signature is not from the trusted signer' backend/src/modules/settlement/settlement-verifier.service.ts
grep -q 'SECP256K1N_HALF' backend/src/modules/settlement/settlement-verifier.service.ts
grep -q 'Settlement signature s value must be in the lower half order' backend/src/modules/settlement/settlement-verifier.service.ts
grep -q 'Settlement signature v value must be 27 or 28' backend/src/modules/settlement/settlement-verifier.service.ts
grep -q 'TOKEN_NOT_WHITELISTED' backend/src/modules/settlement/settlement-verifier.service.ts
grep -q 'SETTLEMENT_REVERTED' backend/src/modules/settlement/settlement-verifier.service.ts
grep -q 'assertSettlementQuoteShape(quote)' backend/src/modules/settlement/settlement-verifier.service.ts
grep -q 'Settlement quote deadline is invalid' backend/src/modules/settlement/settlement-verifier.service.ts
grep -Fq 'typeof signature !== "string" || !/^0x[0-9a-fA-F]{130}$/.test(signature)' backend/src/modules/settlement/settlement-verifier.service.ts
grep -Fq 'typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)' backend/src/modules/settlement/settlement-verifier.service.ts
grep -Fq 'typeof value !== "string" || !/^[1-9][0-9]*$/.test(value)' backend/src/modules/settlement/settlement-verifier.service.ts
grep -q 'assertObject(policy, "policy")' backend/src/modules/settlement/settlement-verifier.service.ts
grep -q '"settlementAddress"' backend/src/modules/settlement/settlement-verifier.service.ts
grep -q '"trustedSignerAddress"' backend/src/modules/settlement/settlement-verifier.service.ts
grep -q 'settlementVerificationInputFields = \["quoteId", "request"\]' backend/src/modules/settlement/settlement-verifier.service.ts
grep -q 'assertOwnFields(policy, localSettlementVerifierPolicyFields, "policy")' backend/src/modules/settlement/settlement-verifier.service.ts
grep -q 'assertOwnFields(input, settlementVerificationInputFields, "input")' backend/src/modules/settlement/settlement-verifier.service.ts
grep -q 'assertArray(chainIds, "enabledChainIds")' backend/src/modules/settlement/settlement-verifier.service.ts
grep -q 'assertVerificationInput(input)' backend/src/modules/settlement/settlement-verifier.service.ts
grep -q 'verificationRequestFields = \["quote", "signature"\]' backend/src/modules/settlement/settlement-verifier.service.ts
grep -q 'assertOwnFields(input.request, verificationRequestFields, "request")' backend/src/modules/settlement/settlement-verifier.service.ts
grep -q 'assertOwnFields(quote, settlementQuoteFields, "request.quote")' backend/src/modules/settlement/settlement-verifier.service.ts
grep -q 'Local settlement verifier ${path}.${field} must be an own field' backend/src/modules/settlement/settlement-verifier.service.ts
grep -q 'maxSafeIdentifierLength = 128' backend/src/modules/settlement/settlement-verifier.service.ts
grep -Fq 'safeIdentifierPattern = /^[A-Za-z0-9_:-]+$/' backend/src/modules/settlement/settlement-verifier.service.ts
grep -q 'assertSafeIdentifier(input.quoteId, "quoteId")' backend/src/modules/settlement/settlement-verifier.service.ts
grep -q 'Local settlement verifier ${field} must be a primitive string' backend/src/modules/settlement/settlement-verifier.service.ts
grep -q 'assertObject(input.request, "request")' backend/src/modules/settlement/settlement-verifier.service.ts
grep -q 'assertObject(input.request.quote, "request.quote")' backend/src/modules/settlement/settlement-verifier.service.ts
grep -q 'assertChainIds(policy.enabledChainIds)' backend/src/modules/settlement/settlement-verifier.service.ts
grep -q 'assertTokenWhitelist(policy.tokenWhitelist)' backend/src/modules/settlement/settlement-verifier.service.ts
grep -q 'assertAddress(policy.settlementAddress, "settlementAddress")' backend/src/modules/settlement/settlement-verifier.service.ts
grep -q 'assertTrustedSignerAddresses(' backend/src/modules/settlement/settlement-verifier.service.ts
grep -q 'cloneLocalSettlementVerifierPolicy' backend/src/modules/settlement/settlement-verifier.service.ts
grep -q 'Local settlement verifier enabledChainIds must not contain duplicate chain ids' backend/src/modules/settlement/settlement-verifier.service.ts
grep -q 'Local settlement verifier tokenWhitelist must not contain duplicate addresses' backend/src/modules/settlement/settlement-verifier.service.ts
grep -q 'EIP-712 trusted signer recovery' book/Volume5-BackendEngineering/Chapter06-Execution-Service.md
grep -q 'enabledChainIds` 和 `tokenWhitelist` 必须非空且不能包含重复项' book/Volume5-BackendEngineering/Chapter06-Execution-Service.md
grep -q '`settlementAddress` 和 `trustedSignerAddress` 必须是真实字符串且是 20-byte hex address' book/Volume5-BackendEngineering/Chapter06-Execution-Service.md
grep -q 'recovers the EIP-712 signer against the configured `settlementAddress`' book/Volume5-BackendEngineering/Chapter06-Execution-Service.md
grep -q 'malformed policy object, inherited policy fields and policy array fields must be rejected before field access' book/Volume5-BackendEngineering/Chapter06-Execution-Service.md
grep -q 'missing or inherited root `quoteId` / `request` fields' book/Volume5-BackendEngineering/Chapter06-Execution-Service.md
grep -q 'Local settlement verifier policy.verifierVersion must be an own field' backend/test/settlement-verifier-policy-validation.test.mjs
grep -q 'Local settlement verifier policy.tokenWhitelist must be an own field' backend/test/settlement-verifier-policy-validation.test.mjs
grep -q 'Local settlement verifier input.quoteId must be an own field' backend/test/settlement-verifier-validation.test.mjs
grep -q 'Local settlement verifier input.request must be an own field' backend/test/settlement-verifier-validation.test.mjs
grep -q 'inherited `request` / `request.quote` required fields' book/Volume5-BackendEngineering/Chapter06-Execution-Service.md
grep -q 'without leading zeros' book/Volume5-BackendEngineering/Chapter06-Execution-Service.md
grep -q 'JavaScript regex coercion' book/Volume5-BackendEngineering/Chapter06-Execution-Service.md
grep -q '`buildSyntheticTxHash()` also reuses submit request and execution context validation before hashing' book/Volume5-BackendEngineering/Chapter06-Execution-Service.md
grep -q 'snapshots `LocalSettlementVerifierPolicy` at construction after validation' book/Volume5-BackendEngineering/Chapter06-Execution-Service.md
grep -q 'SkeletonExecutionService` snapshots its dependency map at construction' book/Volume5-BackendEngineering/Chapter06-Execution-Service.md
grep -q 'Required dependency entries must be own fields before method validation' book/Volume5-BackendEngineering/Chapter06-Execution-Service.md
grep -q 'validates dependency methods at construction' book/Volume5-BackendEngineering/Chapter06-Execution-Service.md
grep -q 'SkeletonExecutionService` rejects malformed dependency envelopes and inherited dependency entries before reading required dependency methods' book/Volume5-BackendEngineering/Chapter06-Execution-Service.md
grep -q 'validates the `SettlementVerificationResult` returned by the verifier dependency before settlement event writes' book/Volume5-BackendEngineering/Chapter06-Execution-Service.md
grep -q 'malformed or mismatched verifier output returns `SETTLEMENT_UNAVAILABLE` before inventory, hedge, PnL or quote-status side effects' book/Volume5-BackendEngineering/Chapter06-Execution-Service.md
grep -q 'ReconciliationService` snapshots its dependency map at construction' book/Volume5-BackendEngineering/Chapter06-Execution-Service.md
grep -q 'optional `pnlService` / `hedgeService` entries must be own fields when provided' book/Volume5-BackendEngineering/Chapter06-Execution-Service.md
grep -q 'ReconciliationService` validates dependency methods at construction' book/Volume5-BackendEngineering/Chapter06-Execution-Service.md
grep -q 'ReconciliationService` rejects malformed dependency envelopes, inherited required dependency entries and inherited optional recovery dependencies before reading required or optional recovery methods' book/Volume5-BackendEngineering/Chapter06-Execution-Service.md
grep -q 'reports PnL attribution conflicts per settlement event' book/Volume5-BackendEngineering/Chapter06-Execution-Service.md
grep -q 'validates existing hedge intents against settlement events' book/Volume5-BackendEngineering/Chapter06-Execution-Service.md
grep -q 'createHedgeIntent' backend/src/modules/execution/execution.service.ts
grep -q 'recordHedgeFailure' backend/src/modules/execution/execution.service.ts
grep -q 'hedgeOrderId: hedgeResult?.hedgeOrderId' backend/src/modules/execution/execution.service.ts
grep -q 'getHedgeIntent' backend/src/modules/hedge/hedge.service.ts
grep -q 'getHedgeIntentBySettlementEvent' backend/src/modules/hedge/hedge.service.ts
grep -q 'settlementEventId: intent.settlementEventId' backend/src/modules/hedge/hedge.service.ts
grep -q 'hedgeOrderIdsBySettlementEvent' backend/src/modules/hedge/hedge.service.ts
grep -q 'cloneHedgeIntentStatus' backend/src/modules/hedge/hedge.service.ts
grep -q 'cloneHedgeServiceConfig' backend/src/modules/hedge/hedge.service.ts
grep -q 'matchesHedgeIntent' backend/src/modules/hedge/hedge.service.ts
grep -q 'Hedge intent conflict' backend/src/modules/hedge/hedge.service.ts
grep -q 'returns the existing hedge intent for settlement retries' backend/test/hedge.test.mjs
grep -q 'rejects conflicting retry payloads for the same settlement event' backend/test/hedge.test.mjs
grep -q 'returns defensive copies of hedge intent status records' backend/test/hedge.test.mjs
grep -q 'Hedge idempotency requires repeated `settlementEventId` input to match the stored hedge intent payload' book/Volume5-BackendEngineering/Chapter07-Hedge-Service.md
grep -q 'Persistent hedge rows store the required `quoteId` and `reason`' book/Volume5-BackendEngineering/Chapter07-Hedge-Service.md
grep -q 'returns defensive copies from create and status lookup operations' book/Volume5-BackendEngineering/Chapter07-Hedge-Service.md
grep -q 'non-null external order reference must be non-empty' book/Volume5-BackendEngineering/Chapter07-Hedge-Service.md
grep -q 'getHedgeIntentBySettlementEvent' backend/test/hedge.test.mjs
grep -q 'settlementEventId: submitResponse.settlementEventId' sdk/test/sdk.test.mjs
grep -q 'hedge settlement event id' scripts/smoke-api.mjs
grep -q 'quoteRiskPenaltyBps' backend/src/modules/hedge/hedge.service.ts
grep -q 'failurePenaltyBps' backend/src/modules/hedge/hedge.service.ts
grep -q 'assertObject(config, "config")' backend/src/modules/hedge/hedge.service.ts
grep -q 'hedgeServiceConfigFields = \["failurePenaltyBps", "maxFailurePenaltyBps"\]' backend/src/modules/hedge/hedge.service.ts
grep -q 'hedgeIntentFields = \["settlementEventId", "quoteId", "chainId", "token", "side", "amount", "reason"\]' backend/src/modules/hedge/hedge.service.ts
grep -q 'hedgeRiskInputFields = \["chainId", "token"\]' backend/src/modules/hedge/hedge.service.ts
grep -q 'assertOwnFields(config, hedgeServiceConfigFields, "config")' backend/src/modules/hedge/hedge.service.ts
grep -q 'assertOwnFields(intent, hedgeIntentFields, "intent")' backend/src/modules/hedge/hedge.service.ts
grep -q 'assertOwnFields(input, hedgeRiskInputFields, "risk input")' backend/src/modules/hedge/hedge.service.ts
grep -q 'Hedge ${path}.${field} must be an own field' backend/src/modules/hedge/hedge.service.ts
grep -q 'assertPositiveBps(config.failurePenaltyBps, "failurePenaltyBps")' backend/src/modules/hedge/hedge.service.ts
grep -q 'assertHedgeIntent(intent)' backend/src/modules/hedge/hedge.service.ts
grep -q 'assertHedgeRiskInput(input)' backend/src/modules/hedge/hedge.service.ts
grep -q 'maxSafeIdentifierLength = 128' backend/src/modules/hedge/hedge.service.ts
grep -Fq 'safeIdentifierPattern = /^[A-Za-z0-9_:-]+$/' backend/src/modules/hedge/hedge.service.ts
grep -q 'assertSafeIdentifier(hedgeOrderId, "hedgeOrderId")' backend/src/modules/hedge/hedge.service.ts
grep -q 'assertSafeIdentifier(settlementEventId, "settlementEventId")' backend/src/modules/hedge/hedge.service.ts
grep -q 'assertSafeIdentifier(intent.settlementEventId, "settlementEventId")' backend/src/modules/hedge/hedge.service.ts
grep -q 'assertSafeIdentifier(intent.quoteId, "quoteId")' backend/src/modules/hedge/hedge.service.ts
grep -q 'Hedge ${field} must be a primitive string' backend/src/modules/hedge/hedge.service.ts
grep -q 'assertObject(intent, "intent")' backend/src/modules/hedge/hedge.service.ts
grep -q 'assertObject(input, "risk input")' backend/src/modules/hedge/hedge.service.ts
grep -Fq 'typeof input.token !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(input.token)' backend/src/modules/hedge/hedge.service.ts
grep -Fq '!/^[1-9][0-9]*$/.test(value)' backend/src/modules/hedge/hedge.service.ts
grep -q 'failurePenaltyBps must be less than or equal to maxFailurePenaltyBps' backend/src/modules/hedge/hedge.service.ts
grep -q 'HedgeService rejects unsafe failure penalty configuration at construction' backend/test/hedge-config-validation.test.mjs
grep -q 'HedgeService snapshots failure penalty configuration at construction' backend/test/hedge.test.mjs
grep -q 'HedgeService rejects malformed intent and risk payload envelopes before state writes' backend/test/hedge-input-shape-validation.test.mjs
grep -q 'HedgeService rejects inherited intent and risk fields before state writes' backend/test/hedge-input-shape-validation.test.mjs
grep -q 'Hedge config.failurePenaltyBps must be an own field' backend/test/hedge-config-validation.test.mjs
grep -q 'Hedge intent.settlementEventId must be an own field' backend/test/hedge-input-shape-validation.test.mjs
grep -q 'Hedge intent.amount must be an own field' backend/test/hedge-input-shape-validation.test.mjs
grep -q 'Hedge risk input.chainId must be an own field' backend/test/hedge-input-shape-validation.test.mjs
grep -q 'HedgeService rejects unsafe intent inputs before writing hedge state' backend/test/hedge-validation.test.mjs
grep -q 'amount: "0100"' backend/test/hedge-validation.test.mjs
grep -q 'token: new String(intent.token)' backend/test/hedge-validation.test.mjs
grep -q 'Hedge settlementEventId must be a primitive string' backend/test/hedge-validation.test.mjs
grep -q 'Hedge settlementEventId must contain only letters, numbers, underscore, colon, or hyphen' backend/test/hedge-validation.test.mjs
grep -q 'Hedge quoteId must be a primitive string' backend/test/hedge-validation.test.mjs
grep -q 'Hedge quoteId must be 128 characters or fewer' backend/test/hedge-validation.test.mjs
grep -q 'HedgeService rejects unsafe hedge status lookup identifiers' backend/test/hedge-validation.test.mjs
grep -q 'Hedge hedgeOrderId must be a primitive string' backend/test/hedge-validation.test.mjs
grep -q 'Hedge hedgeOrderId must contain only letters, numbers, underscore, colon, or hyphen' backend/test/hedge-validation.test.mjs
grep -q 'HedgeService rejects unsafe risk feedback inputs before recording pressure' backend/test/hedge-validation.test.mjs
grep -q 'failure penalty config fail-fast' book/Volume5-BackendEngineering/Chapter07-Hedge-Service.md
grep -q 'snapshots `HedgeServiceConfig` at construction after validation' book/Volume5-BackendEngineering/Chapter07-Hedge-Service.md
grep -q 'required config, intent and risk fields must be own fields' book/Volume5-BackendEngineering/Chapter07-Hedge-Service.md
grep -q 'settlementEventId` and `quoteId` must be own primitive-string `SafeIdentifier` values with 1-128 characters' book/Volume5-BackendEngineering/Chapter07-Hedge-Service.md
grep -q '`token` must be an own runtime string and a 20-byte address' book/Volume5-BackendEngineering/Chapter07-Hedge-Service.md
grep -q 'canonical positive uint string without leading zeros' book/Volume5-BackendEngineering/Chapter07-Hedge-Service.md
grep -q 'inherited object properties' book/Volume5-BackendEngineering/Chapter07-Hedge-Service.md
grep -q 'Hedge status lookups validate `hedgeOrderId` and `settlementEventId` as primitive-string `SafeIdentifier` values' book/Volume5-BackendEngineering/Chapter07-Hedge-Service.md
grep -q 'Malformed hedge config, intent and risk feedback root payloads are rejected before field access or state mutation' book/Volume5-BackendEngineering/Chapter07-Hedge-Service.md
grep -q 'hedgeRiskPenaltyResult' $quote_service_sources
grep -q 'interface PnlStore' backend/src/modules/pnl/pnl.service.ts
grep -q 'class PnlService' backend/src/modules/pnl/pnl.service.ts
grep -q 'recordSettlement' backend/src/modules/pnl/pnl.service.ts
grep -q 'quote_snapshot_edge_v1' backend/src/modules/pnl/pnl.service.ts
grep -q 'quoteSnapshotPnlModelDescription' backend/src/modules/pnl/pnl.service.ts
grep -q 'pnlIdsByQuoteModel' backend/src/modules/pnl/pnl.service.ts
grep -q 'assertPnlInput(input)' backend/src/modules/pnl/pnl.service.ts
grep -q 'pnlInputFields = \["quoteId", "settlementEventId", "snapshotId", "realizedAt", "quote"\]' backend/src/modules/pnl/pnl.service.ts
grep -q 'assertOwnFields(input, pnlInputFields, "input")' backend/src/modules/pnl/pnl.service.ts
grep -q 'assertOwnFields(input.quote, signedQuoteFields, "quote")' backend/src/modules/pnl/pnl.service.ts
grep -q 'Pnl ${path}.${field} must be an own field' backend/src/modules/pnl/pnl.service.ts
grep -q 'maxSafeIdentifierLength = 128' backend/src/modules/pnl/pnl.service.ts
grep -Fq 'safeIdentifierPattern = /^[A-Za-z0-9_:-]+$/' backend/src/modules/pnl/pnl.service.ts
grep -q 'buildPnlId(input.quoteId)' backend/src/modules/pnl/pnl.service.ts
grep -q 'assertSafeIdentifier(input.quoteId, "quoteId")' backend/src/modules/pnl/pnl.service.ts
grep -q 'assertSafeIdentifier(pnlId, "pnlId")' backend/src/modules/pnl/pnl.service.ts
grep -q 'Pnl ${field} must be a primitive string' backend/src/modules/pnl/pnl.service.ts
grep -q 'Pnl input must be an object' backend/src/modules/pnl/pnl.service.ts
grep -q 'Pnl quote must be an object' backend/src/modules/pnl/pnl.service.ts
grep -Fq 'typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)' backend/src/modules/pnl/pnl.service.ts
grep -Fq 'typeof value !== "string" || !/^[1-9][0-9]*$/.test(value)' backend/src/modules/pnl/pnl.service.ts
grep -q 'matchesPnlInput' backend/src/modules/pnl/pnl.service.ts
grep -q 'PnL record conflict' backend/src/modules/pnl/pnl.service.ts
grep -q 'user: input.quote.user' backend/src/modules/pnl/pnl.service.ts
grep -q 'minAmountOut: input.quote.minAmountOut' backend/src/modules/pnl/pnl.service.ts
grep -q 'nonce: input.quote.nonce' backend/src/modules/pnl/pnl.service.ts
grep -q 'deadline: input.quote.deadline' backend/src/modules/pnl/pnl.service.ts
grep -q 'amountOut must be greater than or equal to quote.minAmountOut' backend/src/modules/pnl/pnl.service.ts
grep -q 'clonePnlTradeRecord' backend/src/modules/pnl/pnl.service.ts
grep -q 'returns the existing attribution record for quote retries' backend/test/pnl.test.mjs
grep -q 'returns defensive copies of PnL trade records' backend/test/pnl.test.mjs
grep -q 'rejects conflicting retry payloads for the same quote and model' backend/test/pnl.test.mjs
grep -q 'rejects signed quote metadata conflicts for the same quote and model' backend/test/pnl.test.mjs
grep -q 'rejects unsafe gross PnL bps before storing attribution' backend/test/pnl-validation.test.mjs
grep -q 'PnlService rejects malformed attribution payload envelopes' backend/test/pnl-validation.test.mjs
grep -q 'PnlService rejects inherited attribution fields' backend/test/pnl-validation.test.mjs
grep -q 'PnlService rejects unsafe attribution identifiers, timestamps, and quote values' backend/test/pnl-validation.test.mjs
grep -q 'Pnl input.quoteId must be an own field' backend/test/pnl-validation.test.mjs
grep -q 'Pnl quote.user must be an own field' backend/test/pnl-validation.test.mjs
grep -q 'quoteId must contain only letters' backend/test/pnl-validation.test.mjs
grep -q 'q_nonce_leading_zero' backend/test/pnl-validation.test.mjs
grep -q 'stored signed attribution payload' book/Volume5-BackendEngineering/Chapter06-Execution-Service.md
grep -q 'PnlService` returns defensive copies from `recordSettlement()` and `summary()`' book/Volume5-BackendEngineering/Chapter06-Execution-Service.md
grep -q 'validates the `PnlTradeRecord` returned by `PnlStore.recordSettlement()` before exposing `pnlId`' book/Volume5-BackendEngineering/Chapter06-Execution-Service.md
grep -q 'malformed or mismatched PnL store output is treated as `PNL_RECORD_FAILED`' book/Volume5-BackendEngineering/Chapter06-Execution-Service.md
grep -q 'Post-settlement inventory position reads are a metrics boundary' book/Volume5-BackendEngineering/Chapter06-Execution-Service.md
grep -q 'Malformed or unavailable position reads leave the settlement accepted' book/Volume5-BackendEngineering/Chapter06-Execution-Service.md
grep -q 'acquires a quote-scoped reservation before `/submit` enters settlement verification' book/Volume5-BackendEngineering/Chapter06-Execution-Service.md
grep -q '`RFQSettlement` nonce consumption remains the authoritative replay protection' book/Volume5-BackendEngineering/Chapter06-Execution-Service.md
grep -q 'rejects malformed root payloads, missing `quote` objects, and inherited root or signed quote required fields before field access' book/Volume5-BackendEngineering/Chapter06-Execution-Service.md
grep -q '`quoteId`、`settlementEventId`、`snapshotId` and the derived `pnlId` as `SafeIdentifier`' book/Volume5-BackendEngineering/Chapter06-Execution-Service.md
grep -q '`QuoteSnapshotPnlValuationProvider` loads the immutable persisted snapshot' book/Volume5-BackendEngineering/Chapter06-Execution-Service.md
grep -q '`fairAmountOut - amountOut` in tokenOut base units' book/Volume5-BackendEngineering/Chapter06-Execution-Service.md
grep -q 'Gross totals group by `(chainId, tokenOut)`' book/Volume5-BackendEngineering/Chapter06-Execution-Service.md
grep -q 'completed net totals group by `(chainId, valuationToken, valuationAsset)`' book/Volume5-BackendEngineering/Chapter06-Execution-Service.md
grep -q 'minAmountOut' docs/api/openapi.yaml
grep -q 'PnlTradeRecord", "minAmountOut"' scripts/check-api-schema-consistency.mjs
grep -q 'PnlTradeRecord", "deadline"' scripts/check-api-schema-consistency.mjs
grep -q 'PnlTradeRecord.grossPnlBps must document the JavaScript safe integer minimum' scripts/check-api-schema-consistency.mjs
grep -q 'payload.user' $sdk_client_sources
grep -q 'payload.minAmountOut' $sdk_client_sources
grep -q 'malformed nonce' sdk/test/sdk-client-responses.test.mjs
grep -q 'rfq_quote_errors_total' backend/src/modules/metrics/metrics.service.ts
grep -q 'rfq_quote_latency_seconds' backend/src/modules/metrics/metrics.service.ts
grep -q 'rfq_quote_rejections_total' backend/src/modules/metrics/metrics.service.ts
grep -q 'rfq_submit_latency_seconds' backend/src/modules/metrics/metrics.service.ts
grep -q 'rfq_rate_limited_total' backend/src/modules/metrics/metrics.service.ts
grep -q 'recordRateLimited' $gateway_sources
grep -q 'rfq_signer_requests_total' backend/src/modules/metrics/metrics.service.ts
grep -q 'rfq_signer_errors_total' backend/src/modules/metrics/metrics.service.ts
grep -q 'rfq_signer_latency_seconds' backend/src/modules/metrics/metrics.service.ts
grep -q 'rfq_readiness_status' backend/src/modules/metrics/metrics.service.ts
grep -q 'rfq_dependency_status' backend/src/modules/metrics/metrics.service.ts
grep -q '"routing"' backend/src/modules/metrics/metrics.service.ts
grep -q 'readonly ReadinessComponentName\[\]' backend/src/modules/metrics/metrics.service.ts
grep -q 'assertRateLimitedEndpoint(endpoint)' backend/src/modules/metrics/metrics.service.ts
grep -q 'assertSignerMetricOperation(operation)' backend/src/modules/metrics/metrics.service.ts
grep -q 'assertReadinessMetricInput(readiness)' backend/src/modules/metrics/metrics.service.ts
grep -q 'readinessMetricInputFields = \["status", "components"\]' backend/src/modules/metrics/metrics.service.ts
grep -q 'inventoryMetricPositionFields = \["chainId", "token", "balance"\]' backend/src/modules/metrics/metrics.service.ts
grep -q 'pnlTradeMetricRecordFields = \[' backend/src/modules/metrics/metrics.service.ts
grep -q 'assertOwnFields(readiness, readinessMetricInputFields, "readiness")' backend/src/modules/metrics/metrics.service.ts
grep -q 'assertOwnFields(readiness.components, readinessDependencyComponents, "readiness components")' backend/src/modules/metrics/metrics.service.ts
grep -q 'assertOwnFields(position, inventoryMetricPositionFields, "inventory position")' backend/src/modules/metrics/metrics.service.ts
grep -q 'assertOwnFields(record, pnlTradeMetricRecordFields, "PnL trade record")' backend/src/modules/metrics/metrics.service.ts
grep -q 'Metrics ${path}.${field} must be an own field' backend/src/modules/metrics/metrics.service.ts
grep -q 'assertMetricLabelValue(value)' backend/src/modules/metrics/metrics.service.ts
grep -q 'assertFiniteHistogramObservation(value)' backend/src/modules/metrics/metrics.service.ts
grep -q 'MetricsService rejects unsupported fixed-label inputs before mutating state' backend/test/metrics-validation.test.mjs
grep -q 'MetricsService rejects non-string dynamic label values before mutating state' backend/test/metrics-validation.test.mjs
grep -q 'MetricsService rejects non-finite histogram observations before mutating state' backend/test/metrics-validation.test.mjs
grep -q 'maxSafeIdentifierLength = 128' backend/src/modules/metrics/metrics.service.ts
grep -Fq 'safeIdentifierPattern = /^[A-Za-z0-9_:-]+$/' backend/src/modules/metrics/metrics.service.ts
grep -q 'assertSafeIdentifier(record.pnlId, "PnL trade pnlId")' backend/src/modules/metrics/metrics.service.ts
grep -q 'assertSafeIdentifier(record.quoteId, "PnL trade quoteId")' backend/src/modules/metrics/metrics.service.ts
grep -q 'Metrics ${field} must be a primitive string' backend/src/modules/metrics/metrics.service.ts
grep -Fq 'typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)' backend/src/modules/metrics/metrics.service.ts
grep -Fq 'typeof value !== "string" || !/^[1-9][0-9]*$/.test(value)' backend/src/modules/metrics/metrics.service.ts
grep -Fq 'typeof value !== "string" || !/^(0|-?[1-9][0-9]*)$/.test(value)' backend/src/modules/metrics/metrics.service.ts
grep -q 'isCanonicalUtcIsoTimestamp(record.realizedAt)' backend/src/modules/metrics/metrics.service.ts
grep -q 'Metrics PnL trade pnlId must be a primitive string' backend/test/metrics-inventory-pnl-validation.test.mjs
grep -q 'Metrics PnL trade record.pnlId must be an own field' backend/test/metrics-inventory-pnl-validation.test.mjs
grep -q 'Metrics PnL trade pnlId must contain only letters, numbers, underscore, colon, or hyphen' backend/test/metrics-inventory-pnl-validation.test.mjs
grep -q 'Metrics PnL trade quoteId must be a primitive string' backend/test/metrics-inventory-pnl-validation.test.mjs
grep -q 'Metrics PnL trade quoteId must be 128 characters or fewer' backend/test/metrics-inventory-pnl-validation.test.mjs
grep -q 'token: new String(token)' backend/test/metrics-inventory-pnl-validation.test.mjs
grep -q 'Metrics inventory position.chainId must be an own field' backend/test/metrics-inventory-pnl-validation.test.mjs
grep -q 'Metrics readiness.status must be an own field' backend/test/metrics-validation.test.mjs
grep -q 'Metrics readiness components.marketData must be an own field' backend/test/metrics-validation.test.mjs
grep -q 'Metrics readiness components.signer must be an own field' backend/test/metrics-validation.test.mjs
grep -q 'user: new String(pnlTradeRecord.user)' backend/test/metrics-inventory-pnl-validation.test.mjs
grep -q 'tokenIn: new String(pnlTradeRecord.tokenIn)' backend/test/metrics-inventory-pnl-validation.test.mjs
grep -q 'grossPnlTokenOut: new String("1600000")' backend/test/metrics-inventory-pnl-validation.test.mjs
grep -q 'grossPnlTokenOut: "01600000"' backend/test/metrics-inventory-pnl-validation.test.mjs
grep -q 'grossPnlTokenOut: "-0"' backend/test/metrics-inventory-pnl-validation.test.mjs
grep -q 'amountIn: "0100000000"' backend/test/metrics-inventory-pnl-validation.test.mjs
grep -q 'nonce: "01"' backend/test/metrics-inventory-pnl-validation.test.mjs
grep -q 'realizedAt: "2026-06-29"' backend/test/metrics-inventory-pnl-validation.test.mjs
grep -q 'realizedAt: "June 29, 2026"' backend/test/metrics-inventory-pnl-validation.test.mjs
grep -q 'realizedAt: "2026-02-31T00:00:00.000Z"' backend/test/metrics-inventory-pnl-validation.test.mjs
grep -q 'Metrics PnL trade realizedAt must be a canonical UTC ISO timestamp' backend/test/metrics-inventory-pnl-validation.test.mjs
grep -q 'validates fixed-label inputs before mutation' book/Volume5-BackendEngineering/Chapter08-Metrics-Service.md
grep -q 'validates dynamic label values before mutation' book/Volume5-BackendEngineering/Chapter08-Metrics-Service.md
grep -q 'Histogram observations must be finite numbers before mutation' book/Volume5-BackendEngineering/Chapter08-Metrics-Service.md
grep -q 'realizedAt` must be a canonical UTC ISO timestamp generated with `Date.prototype.toISOString()`' book/Volume5-BackendEngineering/Chapter08-Metrics-Service.md
grep -q '`String` wrapper objects cannot rely on JavaScript `RegExp.test()` coercion' book/Volume5-BackendEngineering/Chapter08-Metrics-Service.md
grep -q 'canonical integer strings without leading zeros or negative zero' book/Volume5-BackendEngineering/Chapter08-Metrics-Service.md
grep -q 'recordReadiness' $gateway_sources
grep -q 'rfq_readiness_status' book/Volume5-BackendEngineering/Chapter08-Metrics-Service.md
grep -q 'rfq_dependency_status' book/Volume5-BackendEngineering/Chapter08-Metrics-Service.md
grep -q 'rfq_rate_limited_total' book/Volume5-BackendEngineering/Chapter08-Metrics-Service.md
grep -q 'marketData、marketSnapshotStore、routing、pricing' book/Volume5-BackendEngineering/Chapter08-Metrics-Service.md
grep -q 'quoteControl、riskDecisionStore、rateLimitStore、inventory' book/Volume5-BackendEngineering/Chapter08-Metrics-Service.md
grep -q 'rfq_readiness_status' book/Volume7-ProductionDeployment/Chapter03-Monitoring.md
grep -q 'rfq_dependency_status' book/Volume7-ProductionDeployment/Chapter03-Monitoring.md
grep -q 'rfq_rate_limited_total' book/Volume7-ProductionDeployment/Chapter03-Monitoring.md
grep -q 'marketData|marketSnapshotStore|routing|pricing' book/Volume7-ProductionDeployment/Chapter03-Monitoring.md
grep -q 'quoteControl|riskDecisionStore|rateLimitStore|inventory' book/Volume7-ProductionDeployment/Chapter03-Monitoring.md
grep -q 'rfq_rate_limited_total' infra/grafana/provisioning/dashboards/rfq-overview.json
grep -q 'RFQReadinessDegraded' infra/prometheus/rules/rfq-alerts.yml
grep -q 'rfq_readiness_status{status="degraded"} == 1' infra/prometheus/rules/rfq-alerts.yml
grep -q 'RFQDependencyComponentDegraded' infra/prometheus/rules/rfq-alerts.yml
grep -q 'rfq_dependency_status' book/Volume7-ProductionDeployment/Chapter05-Runbook.md
grep -q 'RFQQuoteErrorsSpike' infra/prometheus/rules/rfq-alerts.yml
grep -q 'rfq_quote_errors_total' book/Volume7-ProductionDeployment/Chapter05-Runbook.md
grep -q 'RFQSubmitErrorsSpike' infra/prometheus/rules/rfq-alerts.yml
grep -q 'rfq_submit_errors_total' book/Volume7-ProductionDeployment/Chapter05-Runbook.md
grep -q 'RFQSubmitLatencyP95High' infra/prometheus/rules/rfq-alerts.yml
grep -q 'rfq_submit_latency_seconds' book/Volume7-ProductionDeployment/Chapter05-Runbook.md
grep -q 'RFQRateLimitSpike' infra/prometheus/rules/rfq-alerts.yml
grep -q 'rfq_rate_limited_total' book/Volume7-ProductionDeployment/Chapter05-Runbook.md
grep -q 'recordQuoteLatency' $gateway_sources
grep -q 'recordQuoteRejection' $gateway_sources
grep -q 'recordSubmitLatency' $gateway_sources
grep -q 'quoteService.markQuoteFailed' $gateway_sources
grep -q 'SETTLEMENT_REVERTED' $gateway_sources
grep -q 'rfq_settlements_total' backend/src/modules/metrics/metrics.service.ts
grep -q 'rfq_settlements_total' book/Volume5-BackendEngineering/Chapter08-Metrics-Service.md
grep -q 'rfq_settlements_total' book/Volume7-ProductionDeployment/Chapter03-Monitoring.md
grep -q 'rfq_hedge_intents_total' backend/src/modules/metrics/metrics.service.ts
grep -q 'rfq_hedge_intents_total' book/Volume5-BackendEngineering/Chapter08-Metrics-Service.md
grep -q 'rfq_hedge_intents_total' book/Volume7-ProductionDeployment/Chapter03-Monitoring.md
grep -q 'rfq_hedge_intent_errors_total' backend/src/modules/metrics/metrics.service.ts
grep -q 'rfq_hedge_intent_errors_total' book/Volume5-BackendEngineering/Chapter08-Metrics-Service.md
grep -q 'rfq_hedge_intent_errors_total' book/Volume7-ProductionDeployment/Chapter03-Monitoring.md
grep -q 'recordHedgeIntentError' $gateway_sources
grep -q 'rfq_hedge_lag_seconds' backend/src/modules/metrics/metrics.service.ts
grep -q 'recordHedgeLag' $gateway_sources
grep -q 'rfq_hedge_lag_seconds' book/Volume5-BackendEngineering/Chapter08-Metrics-Service.md
grep -q 'rfq_hedge_lag_seconds' book/Volume7-ProductionDeployment/Chapter03-Monitoring.md
grep -q 'RFQInventoryExposureHigh' infra/prometheus/rules/rfq-alerts.yml
grep -q 'rfq_inventory_balance' book/Volume7-ProductionDeployment/Chapter05-Runbook.md
grep -q 'rfq_quote_status_update_errors_total' backend/src/modules/metrics/metrics.service.ts
grep -q 'recordQuoteStatusUpdateError' $gateway_sources
grep -q 'rfq_inventory_balance' backend/src/modules/metrics/metrics.service.ts
grep -q 'rfq_inventory_balance' book/Volume5-BackendEngineering/Chapter08-Metrics-Service.md
grep -q 'rfq_inventory_balance' book/Volume7-ProductionDeployment/Chapter03-Monitoring.md
grep -q 'rfq_pnl_trades_total' backend/src/modules/metrics/metrics.service.ts
grep -q 'rfq_pnl_record_errors_total' backend/src/modules/metrics/metrics.service.ts
grep -q 'recordPnlRecordError' $gateway_sources
grep -q 'rfq_realized_pnl_token_out' backend/src/modules/metrics/metrics.service.ts
grep -q 'assertInventoryMetricPosition(position)' backend/src/modules/metrics/metrics.service.ts
grep -q 'assertPnlTradeMetricRecord(record)' backend/src/modules/metrics/metrics.service.ts
grep -q 'cloneInventoryMetricPosition' backend/src/modules/metrics/metrics.service.ts
grep -q 'MetricsService validates inventory and PnL metric inputs before mutating state' backend/test/metrics-inventory-pnl-validation.test.mjs
grep -q 'MetricsService snapshots inventory positions before storing gauges' backend/test/metrics.test.mjs
grep -q 'readiness metrics must provide own `status` / `components` fields plus the exact supported component set as own fields' book/Volume5-BackendEngineering/Chapter08-Metrics-Service.md
grep -q 'Inventory position fields and PnL trade record fields must be own fields' book/Volume5-BackendEngineering/Chapter08-Metrics-Service.md
grep -q 'inherited object properties or `String` wrapper objects cannot rely on JavaScript `RegExp.test()` coercion' book/Volume5-BackendEngineering/Chapter08-Metrics-Service.md
grep -q 'records `rfq_inventory_balance` best-effort after settlement acceptance' book/Volume5-BackendEngineering/Chapter08-Metrics-Service.md
grep -q 'malformed, inherited or mismatched inventory position samples cannot convert an already-applied settlement into a submit error' book/Volume5-BackendEngineering/Chapter08-Metrics-Service.md
grep -q 'PnL trade `pnlId` and `quoteId` must be primitive-string `SafeIdentifier` values with 1-128 characters' book/Volume5-BackendEngineering/Chapter08-Metrics-Service.md
grep -q 'amount fields and nonce must be canonical positive uint strings without leading zeros' book/Volume5-BackendEngineering/Chapter08-Metrics-Service.md
! grep -q 'rfq_settlement_event_lag_seconds' book/Volume7-ProductionDeployment/Chapter03-Monitoring.md
! grep -q 'rfq_inventory_exposure_usd' book/Volume5-BackendEngineering/Chapter08-Metrics-Service.md
! grep -q 'rfq_inventory_exposure_usd' book/Volume7-ProductionDeployment/Chapter03-Monitoring.md
grep -q 'rfqClient.quote' frontend/src/pages/QuotePage.tsx
grep -q 'rfqClient.submit' frontend/src/pages/QuotePage.tsx
grep -q 'client.getQuote' frontend/src/lib/quote-lifecycle.ts
grep -q 'RFQClientError' frontend/src/lib/errors.ts
grep -q 'traceId' frontend/src/lib/errors.ts
grep -q 'retryAfterSeconds' frontend/src/lib/errors.ts
grep -q 'toUIError' frontend/src/pages/QuotePage.tsx
test -s frontend/test/quote-page.test.mjs
test -s frontend/test/quote-status-panel.test.mjs
test -s frontend/test/wallet-submit-control.test.mjs
test -s frontend/test/component-render.test.mjs
test -s frontend/test/quote-lifecycle.test.mjs
test -s frontend/src/hooks/useQuoteLifecyclePolling.ts
test -s frontend/src/lib/quote-lifecycle.ts
grep -q 'QuoteForm component invokes controlled field changes and submit handlers' frontend/test/component-render.test.mjs
grep -q 'QuoteStatusPanel component renders post-trade state and wires actions' frontend/test/component-render.test.mjs
grep -q 'QuotePage component renders the initial trading workspace' frontend/test/component-render.test.mjs
grep -q 'renderToStaticMarkup' frontend/test/component-render.test.mjs
grep -q 'quotedRequest' frontend/src/pages/QuotePage.tsx
grep -q 'setQuotedRequest(safeRequest)' frontend/src/pages/QuotePage.tsx
grep -q 'buildQuoteFromResponse(quotedRequest, quote)' frontend/src/pages/QuotePage.tsx
grep -q 'clearQuoteSession' frontend/src/pages/QuotePage.tsx
grep -q 'quoteSessionVersion.current += 1' frontend/src/pages/QuotePage.tsx
grep -q 'if (quoteSessionVersion.current !== quoteSession) return' frontend/src/pages/QuotePage.tsx
grep -q 'const \[nowSeconds, setNowSeconds\] = useState' frontend/src/pages/QuotePage.tsx
grep -q 'window.setInterval' frontend/src/pages/QuotePage.tsx
grep -q 'window.clearInterval(timer)' frontend/src/pages/QuotePage.tsx
grep -q 'const expiresInSeconds = quote ? Math.max(0, quote.deadline - nowSeconds) : undefined' frontend/src/pages/QuotePage.tsx
grep -q 'expiresInSeconds > 0' frontend/src/pages/QuotePage.tsx
grep -q 'expiresInSeconds={expiresInSeconds}' frontend/src/pages/QuotePage.tsx
grep -q 'expiresInSeconds?: number' frontend/src/components/QuoteStatusPanel.tsx
grep -q '<dt>Expires In</dt>' frontend/src/components/QuoteStatusPanel.tsx
grep -q 'Quote expired; request a new quote' frontend/src/pages/QuotePage.tsx
grep -q 'Quote expired; request a new quote' frontend/src/components/WalletSubmitControl.tsx
grep -q 'onChange={handleRequestChange}' frontend/src/pages/QuotePage.tsx
grep -q 'QuotePage binds signed quotes to the quoted request snapshot' frontend/test/quote-page.test.mjs
grep -q 'QuotePage clears quote session when request changes' frontend/test/quote-page.test.mjs
grep -q 'QuotePage ignores stale quote responses after request edits' frontend/test/quote-page.test.mjs
grep -q 'QuotePage drives submit eligibility from a ticking TTL clock' frontend/test/quote-page.test.mjs
grep -q 'QuotePage rejects expired API submit attempts inside the handler' frontend/test/quote-page.test.mjs
grep -q 'QuotePage isolates submit, refresh, wallet, and polling updates by quote session' frontend/test/quote-page.test.mjs
grep -q 'QuotePage starts lifecycle tracking after API acceptance or wallet broadcast' frontend/test/quote-page.test.mjs
grep -q 'QuoteStatusPanel renders the quote TTL countdown field' frontend/test/quote-status-panel.test.mjs
grep -q 'WalletSubmitControl enables onchain submit only for matching wallet state' frontend/test/wallet-submit-control.test.mjs
grep -q 'WalletSubmitControl disables onchain submit for mismatch and pending states' frontend/test/wallet-submit-control.test.mjs
grep -q 'WalletSubmitControl reports expired, preparation, and write errors' frontend/test/wallet-submit-control.test.mjs
grep -q 'setWagmiMock' frontend/test/wallet-submit-control.test.mjs
grep -q 'writeContractAsync' frontend/test/wallet-submit-control.test.mjs
grep -q 'Quote UI binds every `QuoteResponse` to the validated request snapshot' book/Volume6-Frontend-And-SDK/Chapter02-Quote-UI.md
grep -q 'in-flight quote responses are ignored when their session version is no longer current' book/Volume6-Frontend-And-SDK/Chapter02-Quote-UI.md
grep -q 'TTL countdown is driven by a one-second UI clock while a quote is active' book/Volume6-Frontend-And-SDK/Chapter02-Quote-UI.md
grep -q 'API submit is fail-closed inside the `submitQuote()` handler' book/Volume6-Frontend-And-SDK/Chapter02-Quote-UI.md
grep -q '组件层测试实际执行 `QuotePage`、`QuoteForm`、`QuoteStatusPanel` 和 `WalletSubmitControl` 的 React render path' book/Volume6-Frontend-And-SDK/Chapter02-Quote-UI.md
grep -q 'setQuoteStatus(lifecycle.quoteStatus)' frontend/src/pages/QuotePage.tsx
grep -q 'client.getSettlement' frontend/src/lib/quote-lifecycle.ts
grep -q 'client.getHedge' frontend/src/lib/quote-lifecycle.ts
grep -q 'client.pnl' frontend/src/lib/quote-lifecycle.ts
grep -q 'validateQuoteFormRequest(request)' frontend/src/pages/QuotePage.tsx
grep -q 'tokenIn and tokenOut must be different' frontend/src/lib/quote-request.ts
grep -q 'amountIn must be a positive uint string' frontend/src/lib/quote-request.ts
grep -q 'quoteFormRequestFields = \["chainId", "user", "tokenIn", "tokenOut", "amountIn", "slippageBps"\]' frontend/src/lib/quote-request.ts
grep -q 'assertExactFields(request, quoteFormRequestFields, "quote form request")' frontend/src/lib/quote-request.ts
grep -Fq '${label}.${field} must be an own field' frontend/src/lib/quote-request.ts
grep -Fq 'positiveUintPattern = /^[1-9][0-9]*$/' frontend/src/lib/quote-request.ts
grep -Fq 'typeof value !== "string" || !addressPattern.test(value)' frontend/src/lib/quote-request.ts
grep -Fq 'typeof value !== "string" || !positiveUintPattern.test(value)' frontend/src/lib/quote-request.ts
grep -q 'validateQuoteFormRequest rejects unsafe request object shapes' frontend/test/quote-request.test.mjs
grep -Fq 'quote form request\.chainId must be an own field' frontend/test/quote-request.test.mjs
grep -q 'quote form request must not include unknown field routeHint' frontend/test/quote-request.test.mjs
grep -q 'validateQuoteFormRequest rejects boxed string address fields' frontend/test/quote-request.test.mjs
grep -q 'validateQuoteFormRequest rejects boxed string amountIn' frontend/test/quote-request.test.mjs
grep -q 'requires closed own quote form request fields' book/Volume6-Frontend-And-SDK/Chapter02-Quote-UI.md
grep -q 'boxed `String` objects or other non-primitive values fail before regex validation' book/Volume6-Frontend-And-SDK/Chapter02-Quote-UI.md
grep -q 'loadQuoteLifecycle(rfqClient, quote.quoteId, response)' frontend/src/pages/QuotePage.tsx
grep -q 'loadQuoteLifecycle(rfqClient, quote.quoteId, submitResult)' frontend/src/pages/QuotePage.tsx
grep -q 'useQuoteLifecyclePolling' frontend/src/pages/QuotePage.tsx
grep -q 'pollQuoteLifecycle' frontend/src/hooks/useQuoteLifecyclePolling.ts
grep -q 'Promise.allSettled' frontend/src/lib/quote-lifecycle.ts
grep -q 'nextQuoteLifecyclePollDelayMs' frontend/src/lib/quote-lifecycle.ts
grep -q 'controller.abort()' frontend/src/hooks/useQuoteLifecyclePolling.ts
grep -q 'loadQuoteLifecycle preserves successful surfaces when one projection is unavailable' frontend/test/quote-lifecycle.test.mjs
grep -q 'pollQuoteLifecycle retries transient failures and stops at a terminal snapshot' frontend/test/quote-lifecycle.test.mjs
grep -q 'pollQuoteLifecycle stops without another request when the quote session aborts' frontend/test/quote-lifecycle.test.mjs
grep -q 'parseIntegerInput' frontend/src/components/QuoteForm.tsx
grep -q '../lib/integer-input' frontend/src/components/QuoteForm.tsx
grep -Fq 'typeof value !== "string" || !integerInputPattern.test(value)' frontend/src/lib/integer-input.ts
grep -q 'parseIntegerInput rejects boxed strings before regex coercion' frontend/test/integer-input.test.mjs
grep -q 'boxed `String` objects and out-of-range values do not poison request state' book/Volume6-Frontend-And-SDK/Chapter02-Quote-UI.md
grep -q 'Number.MAX_SAFE_INTEGER' frontend/src/components/QuoteForm.tsx
grep -q 'quoteStatus.settlementEventId' frontend/src/lib/quote-lifecycle.ts
grep -q 'quoteStatus.hedgeOrderId' frontend/src/lib/quote-lifecycle.ts
grep -q 'quoteStatus.pnlId' frontend/src/lib/quote-lifecycle.ts
grep -q 'rfqApiBaseUrl' frontend/src/pages/QuotePage.tsx
grep -q 'lazy(() => import("../components/WalletSubmitControl"))' frontend/src/pages/QuotePage.tsx
grep -q 'manualChunks' frontend/vite.config.ts
grep -q 'chunkSizeWarningLimit' frontend/vite.config.ts
grep -q 'INVALID_ANNOTATION' frontend/vite.config.ts
grep -q 'node_modules/ox' frontend/vite.config.ts
grep -q 'wallet-rainbowkit' frontend/vite.config.ts
grep -q 'wallet-viem' frontend/vite.config.ts
grep -q 'Enable Wallet' frontend/src/pages/QuotePage.tsx
grep -q 'onchainAction' frontend/src/pages/QuotePage.tsx
grep -q 'ConnectButton' frontend/src/components/WalletSubmitControl.tsx
grep -q 'useWriteContract' frontend/src/components/WalletSubmitControl.tsx
grep -q 'useReadContract' frontend/src/components/WalletSubmitControl.tsx
grep -q 'buildErc20AllowanceReadRequest' frontend/src/components/WalletSubmitControl.tsx
grep -q 'buildErc20ApprovalWriteRequest' frontend/src/components/WalletSubmitControl.tsx
grep -q 'waitForSuccessfulApproval' frontend/src/components/WalletSubmitControl.tsx
grep -q 'buildSubmitQuoteWriteRequest' frontend/src/components/WalletSubmitControl.tsx
grep -q 'writeContractAsync' frontend/src/components/WalletSubmitControl.tsx
grep -q 'walletMatchesQuote' frontend/src/components/WalletSubmitControl.tsx
grep -q 'prepareWalletSubmit' frontend/src/lib/wallet-submit.ts
grep -q 'walletMatchesQuote(signedQuote: Quote | undefined, wallet: WalletState)' frontend/src/lib/wallet-submit.ts
grep -q 'Signed quote must provide closed own wallet submit fields' frontend/src/lib/wallet-submit.ts
grep -q 'Quote response must provide closed own wallet submit fields' frontend/src/lib/wallet-submit.ts
grep -q 'Connected wallet must match quote user' frontend/src/lib/wallet-submit.ts
grep -q 'Connected wallet network must match quote chainId' frontend/src/lib/wallet-submit.ts
grep -q 'Object.create(signedQuote)' frontend/test/wallet-submit.test.mjs
grep -q 'Object.create(quoteResponse)' frontend/test/wallet-submit.test.mjs
grep -q 'prepareWalletSubmit()` rejects inherited or unknown signed quote fields and inherited quote response signature fields' book/Volume6-Frontend-And-SDK/Chapter03-Submit-Flow.md
grep -q 'wallet submit click handler also repeats the active quote TTL guard' book/Volume6-Frontend-And-SDK/Chapter03-Submit-Flow.md
grep -q 'quoteResponseFields = \["quoteId", "snapshotId", "amountOut", "minAmountOut", "deadline", "nonce", "signature"\]' frontend/src/lib/rfq.ts
grep -q 'assertExactFields(request, quoteRequestFields, "quote request")' frontend/src/lib/rfq.ts
grep -q 'assertExactFields(response, quoteResponseFields, "quote response")' frontend/src/lib/rfq.ts
grep -Fq '${label}.${field} must be an own field' frontend/src/lib/rfq.ts
grep -q 'buildQuoteFromResponse rejects unsafe request and response envelopes' frontend/test/rfq.test.mjs
grep -Fq 'quote response\.quoteId must be an own field' frontend/test/rfq.test.mjs
grep -q 'quote response must not include unknown field routeHint' frontend/test/rfq.test.mjs
grep -q 'buildQuoteFromResponse()` builds the wallet submission quote only from closed own request and quote response fields' book/Volume6-Frontend-And-SDK/Chapter02-Quote-UI.md
grep -q 'VITE_RFQ_API_BASE_URL' frontend/src/lib/config.ts
grep -q 'VITE_RFQ_SETTLEMENT_ADDRESS' frontend/src/lib/config.ts
grep -q 'VITE_WALLETCONNECT_PROJECT_ID' frontend/src/lib/config.ts
grep -q 'buildFrontendConfig' frontend/src/lib/config.ts
grep -q 'readOptionalConfigString' frontend/src/lib/config.ts
grep -q 'readOwnOptionalConfigString' frontend/src/lib/config.ts
grep -Fq 'frontend config env.${name} must be an own field when provided' frontend/src/lib/config.ts
grep -q 'must be a primitive string' frontend/src/lib/config.ts
grep -q 'normalizeAddress' frontend/src/lib/config.ts
grep -q 'VITE_RFQ_API_BASE_URL must be an absolute http(s) URL' frontend/src/lib/config.ts
grep -q 'VITE_RFQ_API_BASE_URL must not include credentials' frontend/src/lib/config.ts
grep -q 'VITE_RFQ_API_BASE_URL host must not contain wildcards' frontend/src/lib/config.ts
grep -q 'VITE_RFQ_API_BASE_URL must not include query strings or fragments' frontend/src/lib/config.ts
grep -q 'VITE_RFQ_SETTLEMENT_ADDRESS must be a 20-byte hex address' frontend/src/lib/config.ts
grep -q 'normalizeWalletConnectProjectId' frontend/src/lib/config.ts
grep -q 'VITE_WALLETCONNECT_PROJECT_ID must be 128 characters or fewer' frontend/src/lib/config.ts
grep -q 'VITE_WALLETCONNECT_PROJECT_ID must contain only letters, numbers, underscore, or hyphen' frontend/src/lib/config.ts
grep -q 'frontend config builder reads only supported own env fields' frontend/test/config.test.mjs
grep -q 'frontend config builder rejects malformed or inherited env fields' frontend/test/config.test.mjs
grep -Fq 'frontend config env\.VITE_RFQ_API_BASE_URL must be an own field when provided' frontend/test/config.test.mjs
grep -q 'frontend config normalizers reject boxed strings before trim coercion' frontend/test/config.test.mjs
grep -q 'frontend config normalizers reject non-string explicit values' frontend/test/config.test.mjs
grep -q 'RFQ 配置键必须是 own optional fields' book/Volume6-Frontend-And-SDK/Chapter01-Frontend-Architecture.md
grep -q 'WagmiProvider' frontend/src/app/web3.tsx
grep -q 'RainbowKitProvider' frontend/src/app/web3.tsx
grep -q 'QueryClientProvider' frontend/src/app/web3.tsx
grep -q 'Web3Provider' frontend/src/components/WalletSubmitControl.tsx
grep -q 'nextFrontendTraceId' frontend/src/lib/rfq.ts
grep -q 'tr_web_' frontend/src/lib/rfq.ts
grep -q 'traceId: nextFrontendTraceId' frontend/src/lib/rfq.ts
grep -Fq 'sends a dynamic `tr_web_*` `x-trace-id` through the SDK' README.md
grep -Fq '每个浏览器 API 请求都会发送一个符合 gateway 规则的 `tr_web_*` `x-trace-id`' book/Volume6-Frontend-And-SDK/Chapter01-Frontend-Architecture.md
grep -q 'Hedge Status' frontend/src/components/QuoteStatusPanel.tsx
grep -q 'Hedge External Order' frontend/src/components/QuoteStatusPanel.tsx
grep -q 'hedgeStatus?.externalOrderId' frontend/src/components/QuoteStatusPanel.tsx
grep -q 'Hedge Updated' frontend/src/components/QuoteStatusPanel.tsx
grep -q 'hedgeStatus?.updatedAt' frontend/src/components/QuoteStatusPanel.tsx
grep -q 'Settlement Status' frontend/src/components/QuoteStatusPanel.tsx
grep -q 'Gross PnL (tokenOut)' frontend/src/components/QuoteStatusPanel.tsx
grep -q 'quoteStatus?.settlementEventId' frontend/src/components/QuoteStatusPanel.tsx
grep -q 'quoteStatus?.hedgeOrderId' frontend/src/components/QuoteStatusPanel.tsx
grep -q 'quoteStatus?.pnlId' frontend/src/components/QuoteStatusPanel.tsx
grep -q 'Submit Onchain' frontend/src/components/WalletSubmitControl.tsx
grep -q 'Contract Call' frontend/src/components/QuoteStatusPanel.tsx
grep -q 'role="alert"' frontend/src/components/QuoteStatusPanel.tsx
grep -q 'Retry After' frontend/src/components/QuoteStatusPanel.tsx
grep -q '{error.retryAfterSeconds}s' frontend/src/components/QuoteStatusPanel.tsx
grep -q 'error-box' frontend/src/app/styles.css
grep -q 'export { RFQClient' sdk/src/index.ts
grep -q 'rfqSettlementAbi' sdk/src/index.ts
grep -q 'erc20Abi' sdk/src/index.ts
grep -q 'treasuryAbi' sdk/src/index.ts
grep -q 'buildSubmitQuoteArgs' sdk/src/index.ts
grep -q 'buildSubmitQuoteWriteRequest' sdk/src/index.ts
grep -q 'buildErc20AllowanceReadRequest' sdk/src/index.ts
grep -q 'buildErc20ApprovalWriteRequest' sdk/src/index.ts
grep -q 'hashSettlementQuote' sdk/src/index.ts
grep -q 'buildTreasuryTransferArgs' sdk/src/index.ts
grep -q 'hashSettlementQuote' sdk/src/quote-hash.ts
grep -q 'toSettlementQuote' sdk/src/quote-hash.ts
grep -q 'const settlementQuoteFields' sdk/src/settlement.ts
grep -q 'submitQuoteWriteRequestFields = \["settlementAddress", "quote", "signature"\]' sdk/src/settlement.ts
grep -q 'treasuryTransferFields = \["token", "to", "amount"\]' sdk/src/settlement.ts
grep -q 'assertExactFields(quote, settlementQuoteFields, "quote")' sdk/src/settlement.ts
grep -q 'assertExactFields(input, submitQuoteWriteRequestFields, "submit quote write request input")' sdk/src/settlement.ts
grep -q 'assertExactFields(input, treasuryTransferFields, "treasury transfer input")' sdk/src/settlement.ts
grep -Fq '${label}.${field} must be an own field' sdk/src/settlement.ts
grep -q 'parseAddress' sdk/src/settlement.ts
grep -q 'parseSignature' sdk/src/settlement.ts
grep -q 'SECP256K1N_HALF' sdk/src/settlement.ts
grep -q 's value must be in the lower half order' sdk/src/settlement.ts
grep -q 'parsePositiveUInt' sdk/src/settlement.ts
grep -Fq 'typeof value !== "string" || !/^0x[a-fA-F0-9]{40}$/.test(value)' sdk/src/settlement.ts
grep -Fq 'typeof value !== "string" || !/^0x[a-fA-F0-9]{130}$/.test(value)' sdk/src/settlement.ts
grep -Fq 'typeof value !== "string" || !/^[0-9]+$/.test(value)' sdk/src/settlement.ts
grep -q 'nonce: parsePositiveUInt(quote.nonce, "quote.nonce")' sdk/src/settlement.ts
grep -q 'treasury transfer input must be an object' sdk/test/sdk-settlement-validation.test.mjs
grep -q 'quote must be an object' sdk/test/sdk-settlement-validation.test.mjs
grep -Fq 'quote\.user must be an own field' sdk/test/sdk-settlement-validation.test.mjs
grep -q 'quote must not include unknown field routeHint' sdk/test/sdk-settlement-validation.test.mjs
grep -Fq 'submit quote write request input\.settlementAddress must be an own field' sdk/test/sdk-settlement-validation.test.mjs
grep -Fq 'treasury transfer input\.token must be an own field' sdk/test/sdk-settlement-validation.test.mjs
grep -q 'treasury transfer input must not include unknown field memo' sdk/test/sdk-settlement-validation.test.mjs
grep -Fq 'quote\.nonce must be a positive uint string' sdk/test/sdk-settlement-validation.test.mjs
grep -q 'new String(signature)' sdk/test/sdk-settlement-validation.test.mjs
grep -q 'amountIn: 1000000000' sdk/test/sdk-settlement-validation.test.mjs
grep -q 'Settlement helpers reject high-s signatures before contract calls' sdk/test/sdk-settlement-validation.test.mjs
grep -q 'buildSubmitQuoteArgs()` rejects non-canonical high-s ECDSA signatures' book/Volume6-Frontend-And-SDK/Chapter04-SDK.md
grep -q 'quote.amountOut must be greater than or equal to quote.minAmountOut' sdk/src/settlement.ts
grep -q 'buildQuoteTypedData' sdk/src/eip712.ts
grep -q 'assertQuoteShape' sdk/src/eip712.ts
grep -q 'toSettlementQuote(quote)' sdk/src/eip712.ts
grep -Fq 'typeof value !== "string" || !/^0x[a-fA-F0-9]{40}$/.test(value)' sdk/src/eip712.ts
grep -q 'ProductionGradeRFQ' sdk/src/eip712.ts
grep -q 'RFQClientError' sdk/test/sdk-client-responses.test.mjs
grep -q 'buildQuoteTypedData' sdk/test/sdk-settlement.test.mjs
grep -q 'buildQuoteTypedData rejects invalid EIP-712 domain and quote fields' sdk/test/sdk-settlement-validation.test.mjs
grep -q 'buildSubmitQuoteArgs' sdk/test/sdk-settlement.test.mjs
grep -q 'hashSettlementQuote matches RFQSettlement.hashQuote struct hashing' sdk/test/sdk-settlement.test.mjs
grep -q 'Settlement helpers reject invalid uint inputs before contract calls' sdk/test/sdk-settlement-validation.test.mjs
grep -q 'buildTreasuryTransferArgs' sdk/test/sdk-settlement.test.mjs
grep -q 'write request input, treasury transfer input and quote payloads must provide closed required own fields' book/Volume6-Frontend-And-SDK/Chapter04-SDK.md
grep -q 'inherited-field and unknown-field quote / write-request / treasury-transfer inputs' book/Volume6-Frontend-And-SDK/Chapter04-SDK.md
grep -q 'RFQSettlement ABI exposes treasury custody controls' sdk/test/sdk-settlement.test.mjs
grep -q 'emergencyWithdraw' sdk/src/abi.ts
grep -q 'hashQuote' sdk/src/abi.ts
grep -q 'rfqSettlementAbi' sdk/test/sdk-settlement.test.mjs
grep -q 'recoverTypedDataAddress' sdk/test/sdk-settlement.test.mjs
grep -q 'verifyTypedData' sdk/test/sdk-settlement.test.mjs
grep -q 'submitQuote' sdk/src/abi.ts
grep -q 'setTreasury' sdk/src/abi.ts
grep -q 'TreasuryUpdated' sdk/src/abi.ts
grep -q 'setTokenWhitelist' sdk/src/abi.ts
grep -q 'grantRole' sdk/src/abi.ts
grep -q 'RoleGranted' sdk/src/abi.ts
grep -q 'RFQSettlement ABI exposes role-based admin controls' sdk/test/sdk-settlement.test.mjs
grep -q 'async submit' $sdk_client_sources
grep -q 'assertQuoteRequest(request)' $sdk_client_sources
grep -q 'quoteRequestFields' $sdk_client_sources
grep -q 'submitRequestFields' $sdk_client_sources
grep -q 'submitRequestOptionalFields = \["txHash"\]' $sdk_client_sources
grep -q 'assertSubmitQuoteRequest(request)' $sdk_client_sources
grep -q 'assertExactFields(request, submitRequestFields, "RFQ submit request", submitRequestOptionalFields)' $sdk_client_sources
grep -q 'hasOwnProperty.call(payload, field)' $sdk_client_sources
grep -q 'buildSubmitQuoteArgs(request.quote, request.signature)' $sdk_client_sources
grep -q 'async getQuote' $sdk_client_sources
grep -q 'async getSettlement' $sdk_client_sources
grep -q 'async getHedge' $sdk_client_sources
grep -q 'async pnl' $sdk_client_sources
grep -q 'async health' $sdk_client_sources
grep -q 'async ready' $sdk_client_sources
grep -q 'assertNonEmptyIdentifier' $sdk_client_sources
grep -Fq 'function assertNonEmptyIdentifier(value: unknown' $sdk_client_sources
grep -q 'must be a primitive string' $sdk_client_sources
grep -q 'maxStatusIdentifierLength' $sdk_client_sources
grep -q 'statusIdentifierPattern' $sdk_client_sources
grep -q 'function isSafeIdentifier' $sdk_client_sources
grep -q 'statusIdentifierPattern.test(value)' $sdk_client_sources
grep -q 'RFQ quote response returned malformed quoteId' sdk/test/sdk-client-responses.test.mjs
grep -q 'RFQ submit response returned malformed pnlId' sdk/test/sdk-client-responses.test.mjs
grep -q 'RFQ PnL summary response trade returned malformed quoteId' sdk/test/sdk-client-accounting-responses.test.mjs
grep -q 'RFQClient rejects unsafe dynamic status identifiers before fetch' sdk/test/sdk-client-requests.test.mjs
grep -q 'RFQ submit request must not include unknown field relayer' sdk/test/sdk-client-requests.test.mjs
grep -q 'RFQ submit request missing required field signature' sdk/test/sdk-client-requests.test.mjs
grep -q 'RFQ quote request missing required field chainId' sdk/test/sdk-client-requests.test.mjs
grep -q 'RFQ submit request missing required field quote' sdk/test/sdk-client-requests.test.mjs
grep -q 'new String("q_test")' sdk/test/sdk-client-requests.test.mjs
grep -q 'new String("h_test")' sdk/test/sdk-client-requests.test.mjs
grep -q 'new String("se_test")' sdk/test/sdk-client-requests.test.mjs
grep -q 'identifiers must be non-empty, 128 characters or fewer' book/Volume6-Frontend-And-SDK/Chapter04-SDK.md
grep -q 'boxed `String` identifiers fail before `encodeURIComponent()` or fetch' book/Volume6-Frontend-And-SDK/Chapter04-SDK.md
grep -q 'export interface RFQClientOptions' $sdk_client_sources
grep -q 'clientOptionFields = \["fetch", "traceId", "apiKey"\]' $sdk_client_sources
grep -Fq 'assertClientOptions(options)' $sdk_client_sources
grep -Fq 'RFQClient options.${field} must be an own field when provided' $sdk_client_sources
grep -q 'RFQClient options must not include unknown field' $sdk_client_sources
grep -q 'private readonly fetchImpl' $sdk_client_sources
grep -Fq 'resolveFetch(clientOptions)' $sdk_client_sources
grep -q 'RFQClient rejects unsafe fetch dependencies at construction' sdk/test/sdk-client-config.test.mjs
grep -q 'RFQClient options.fetch must be an own field when provided' sdk/test/sdk-client-config.test.mjs
grep -q 'RFQClient options.traceId must be an own field when provided' sdk/test/sdk-client-config.test.mjs
grep -q 'RFQClient options must not include unknown field retry' sdk/test/sdk-client-config.test.mjs
grep -q 'RFQClient accepts injected fetch implementations' sdk/test/sdk-client-config.test.mjs
grep -q 'can receive an injected `fetch` implementation' book/Volume6-Frontend-And-SDK/Chapter04-SDK.md
grep -q 'Client options are closed to own optional `fetch` / `traceId` / `apiKey` fields' book/Volume6-Frontend-And-SDK/Chapter04-SDK.md
grep -q 'Inherited `traceId` options' book/Volume6-Frontend-And-SDK/Chapter04-SDK.md
grep -q 'new RFQClient("http://localhost:3000", { fetch: customFetch })' README.md
grep -q 'errorResponseFields = \["code", "message", "traceId"\]' $sdk_client_sources
grep -Fq 'hasExactOwnFields(value, errorResponseFields)' $sdk_client_sources
grep -q 'RFQClient ignores non-closed API error bodies' sdk/test/sdk-client-errors.test.mjs
grep -q 'reasonCode: "TOXIC_FLOW_SCORE"' sdk/test/sdk-client-errors.test.mjs
grep -q 'structured RFQ errors must be closed own-field `ErrorResponse` objects' book/Volume6-Frontend-And-SDK/Chapter04-SDK.md
grep -q 'ErrorResponse` 是闭合 schema' docs/api/errors.md
grep -q 'additionalProperties: false' docs/api/openapi.yaml
grep -q 'assertQuoteStatus' $sdk_client_sources
grep -q 'assertQuoteStatusPayloadConsistency' $sdk_client_sources
grep -q 'assertHedgeIntentStatus' $sdk_client_sources
grep -q 'assertSettlementEventStatus' $sdk_client_sources
grep -q '"nonce"' $sdk_client_sources
grep -q 'RFQ settlement event status response returned malformed nonce' sdk/test/sdk-client-accounting-responses.test.mjs
grep -q 'assertPnlSummary' $sdk_client_sources
grep -q 'assertPnlTradeRecord' $sdk_client_sources
grep -q 'modelDescription' $sdk_client_sources
grep -q 'function isPositiveSafeInteger' $sdk_client_sources
grep -q 'function isNonNegativeSafeInteger' $sdk_client_sources
grep -q 'function isSafeInteger' $sdk_client_sources
grep -q 'isoUtcTimestampPattern' $sdk_client_sources
grep -q 'function isIsoUtcTimestampString' $sdk_client_sources
grep -q 'new Date(parsed).toISOString() === value' $sdk_client_sources
grep -q 'isHealthResponse' $sdk_client_sources
grep -q 'isReadinessResponse' $sdk_client_sources
grep -q 'healthResponseFields = \["status"\]' $sdk_client_sources
grep -q 'readinessResponseFields = \["status", "components"\]' $sdk_client_sources
grep -q 'hasExactOwnFields(value, healthResponseFields)' $sdk_client_sources
grep -q 'hasExactOwnFields(value, readinessResponseFields)' $sdk_client_sources
grep -q 'isReadinessComponents' $sdk_client_sources
grep -q 'const readinessDependencyComponents' $sdk_client_sources
grep -q 'expectedComponents.has(key)' $sdk_client_sources
grep -q 'async metrics' $sdk_client_sources
grep -q 'normalizeBaseUrl' $sdk_client_sources
grep -q 'traceId: string' sdk/src/types.ts
grep -q 'export type ReadinessComponentName' sdk/src/types.ts
grep -q 'components: ReadinessComponents' sdk/src/types.ts
grep -q 'export const rfqErrorCodes' sdk/src/types.ts
grep -q 'export type RFQErrorCode' sdk/src/types.ts
grep -q 'code: RFQErrorCode' sdk/src/types.ts
grep -q 'rfqErrorCodeSet.has' $sdk_client_sources
grep -q 'RFQClientErrorCode' $sdk_client_sources
grep -q 'RFQClientTraceIdProvider' $sdk_client_sources
grep -q 'resolveTraceIdProvider' $sdk_client_sources
grep -q 'requestHeaders' $sdk_client_sources
grep -q 'retryAfterSeconds' $sdk_client_sources
grep -Fq 'retryAfterSecondsPattern = /^[1-9][0-9]*$/' $sdk_client_sources
grep -q 'response.headers.get("retry-after")' $sdk_client_sources
grep -q 'Number.isSafeInteger(seconds)' $sdk_client_sources
grep -q 'traceIdFromResponse' $sdk_client_sources
grep -q 'normalizeTraceId' $sdk_client_sources
grep -q 'function hasExactOwnFields' $sdk_client_sources
grep -q 'keys.length !== expectedFields.length' $sdk_client_sources
grep -q 'expectedFields.every((field) => hasOwnField(value, field))' $sdk_client_sources
grep -q 'assertResponsePayload' $sdk_client_sources
grep -q 'withResponseTrace' $sdk_client_sources
grep -q 'response.headers.get("x-trace-id")' $sdk_client_sources
grep -q 'ignores prototype-backed API error bodies' sdk/test/sdk-client-errors.test.mjs
grep -q 'tr_error_header' sdk/test/sdk-client-errors.test.mjs
grep -q 'tr_header_unknown' sdk/test/sdk-client-errors.test.mjs
grep -q 'tr_malformed_json' sdk/test/sdk-client-responses.test.mjs
grep -q 'tr_malformed_field' sdk/test/sdk-client-responses.test.mjs
grep -q 'ignores unsafe response trace ids and falls back to safe trace headers' sdk/test/sdk-client-errors.test.mjs
grep -q 'tr_safe_header' sdk/test/sdk-client-errors.test.mjs
grep -q 'falls back to safe `x-trace-id` response headers' README.md
grep -q 'falls back to safe `x-trace-id` response headers' book/Volume6-Frontend-And-SDK/Chapter04-SDK.md
grep -q 'prototype-backed error body' README.md
grep -q 'prototype-backed error bodies' book/Volume6-Frontend-And-SDK/Chapter04-SDK.md
grep -q 'unsafe body or header values are ignored' README.md
grep -q 'Unsafe response trace ids' book/Volume6-Frontend-And-SDK/Chapter04-SDK.md
grep -q 'RFQClient baseUrl must be a string' $sdk_client_sources
grep -q 'RFQClient baseUrl must be an absolute http(s) URL' $sdk_client_sources
grep -q 'RFQClient baseUrl must not include credentials' $sdk_client_sources
grep -q 'RFQClient baseUrl host must not contain wildcards' $sdk_client_sources
grep -q 'RFQClient baseUrl must not include query strings or fragments' $sdk_client_sources
grep -q 'RFQClient rejects unsafe base URLs at construction' sdk/test/sdk-client-config.test.mjs
grep -q 'RFQClient baseUrl must be a string' sdk/test/sdk-client-config.test.mjs
grep -q 'RFQClient normalizes safe base URL origins and path prefixes' sdk/test/sdk-client-config.test.mjs
grep -q 'http://api.example.com/rfq/health' sdk/test/sdk-client-config.test.mjs
grep -q 'RFQClient rejects unsafe trace id options' sdk/test/sdk-client-config.test.mjs
grep -q 'RFQClient traceId option must be a primitive string or function' sdk/test/sdk-client-config.test.mjs
grep -q 'RFQClient traceId provider result must be a primitive string' sdk/test/sdk-client-config.test.mjs
grep -q 'new String("tr_sdk_wrapper")' sdk/test/sdk-client-config.test.mjs
grep -q 'tr_sdk_' sdk/test/sdk.test.mjs
grep -q 'RFQClient rejects unsafe quote requests before sending HTTP' sdk/test/sdk-client-requests.test.mjs
grep -Fq '^[1-9][0-9]*$' $sdk_client_sources
grep -q 'toSettlementQuote(quote)' sdk/src/eip712.ts
grep -Fq '^[1-9][0-9]*$' sdk/src/settlement.ts
grep -q '01000000000' sdk/test/sdk-client-requests.test.mjs
grep -q '0998400000' sdk/test/sdk-settlement-validation.test.mjs
grep -q 'base URL and outgoing trace ids must be runtime primitive strings' README.md
grep -q 'no credentials, no wildcard host, and no query string or fragment' README.md
grep -q 'Integrators can pass `{ traceId:' README.md
grep -q 'static or dynamic `traceId` option' book/Volume6-Frontend-And-SDK/Chapter04-SDK.md
grep -q 'Boxed `String` trace ids fail before header construction' book/Volume6-Frontend-And-SDK/Chapter04-SDK.md
grep -q 'rejects non-string, empty, relative or non-`http(s)` base URLs' book/Volume6-Frontend-And-SDK/Chapter04-SDK.md
grep -q 'preserving safe path prefixes such as `/rfq`' book/Volume6-Frontend-And-SDK/Chapter04-SDK.md
grep -q 'RFQClient.quote()` validates outgoing quote requests locally' book/Volume6-Frontend-And-SDK/Chapter04-SDK.md
grep -q 'without leading zeros' book/Volume6-Frontend-And-SDK/Chapter04-SDK.md
grep -q 'RFQClient rejects unsafe submit requests before sending HTTP' sdk/test/sdk-client-requests.test.mjs
grep -q 'RFQClient.submit()` validates outgoing submit payloads locally with closed top-level own `quote` / `signature` fields' book/Volume6-Frontend-And-SDK/Chapter04-SDK.md
grep -q 'reject non-string address, signature and uint-like values' book/Volume6-Frontend-And-SDK/Chapter04-SDK.md
grep -q 'VITE_WALLETCONNECT_PROJECT_ID` 由 RainbowKit 使用' book/Volume6-Frontend-And-SDK/Chapter01-Frontend-Architecture.md
grep -q 'assertRequiredEnumField' $sdk_client_sources
grep -q 'assertRequiredNonNegativeIntegerField' $sdk_client_sources
grep -q 'assertQuoteResponse' $sdk_client_sources
grep -q 'assertSubmitQuoteResponse' $sdk_client_sources
grep -q 'readJsonResponse' $sdk_client_sources
grep -q 'malformed successful JSON responses' sdk/test/sdk-client-responses.test.mjs
grep -q 'malformed health and readiness status responses' sdk/test/sdk-client-status-responses.test.mjs
grep -q 'externalUrl: "ok"' sdk/test/sdk-client-status-responses.test.mjs
grep -q 'malformed hedge status responses' sdk/test/sdk-client-status-responses.test.mjs
grep -q 'createdAt: "2026-06-27"' sdk/test/sdk-client-status-responses.test.mjs
grep -q 'malformed submit and quote status responses' sdk/test/sdk-client-responses.test.mjs
grep -q 'deadline: "1893456000"' sdk/test/sdk-client-responses.test.mjs
grep -q 'q_rejected' sdk/test/sdk-client-responses.test.mjs
grep -q 'lifecycle payload consistency between status and settlement pointers' book/Volume6-Frontend-And-SDK/Chapter04-SDK.md
grep -q 'malformed settlement status responses' sdk/test/sdk-client-accounting-responses.test.mjs
grep -q 'blockNumber: "123456"' sdk/test/sdk-client-accounting-responses.test.mjs
grep -q 'observedAt: "June 27, 2026"' sdk/test/sdk-client-accounting-responses.test.mjs
grep -q 'malformed PnL summary responses' sdk/test/sdk-client-accounting-responses.test.mjs
grep -q 'totalTrades: "1"' sdk/test/sdk-client-accounting-responses.test.mjs
grep -q 'realizedAt: "2026-02-31T00:00:00.000Z"' sdk/test/sdk-client-accounting-responses.test.mjs
grep -q 'isBytes32Hex' $sdk_client_sources
grep -q 'isSignatureHex' $sdk_client_sources
grep -q 'SECP256K1N_HALF' $sdk_client_sources
grep -q 'malleateSignature(await validTypedDataSignature())' sdk/test/sdk-client-responses.test.mjs
grep -q 'canonical low-s EIP-712 signature' book/Volume6-Frontend-And-SDK/Chapter04-SDK.md
grep -q 'malformed successful response fields' sdk/test/sdk-client-responses.test.mjs
grep -q 'assertOwnResponseFields' $sdk_client_sources
grep -q 'assertNoUnknownResponseFields' $sdk_client_sources
grep -q 'allowed.has(key)' $sdk_client_sources
grep -q 'assertOptionalOwnResponseField' $sdk_client_sources
grep -q 'quoteResponseFields = \["quoteId", "snapshotId", "amountOut", "minAmountOut", "deadline", "nonce", "signature"\]' $sdk_client_sources
grep -Fq 'Object.create({ status: "ok" })' sdk/test/sdk-client-status-responses.test.mjs
grep -q 'Object.create({' sdk/test/sdk-client-status-responses.test.mjs
grep -q 'payload: Object.create(quoteResponse)' sdk/test/sdk-client-responses.test.mjs
grep -q 'withPrototype({ txHash: submitResponse.txHash }, { status: "accepted" })' sdk/test/sdk-client-responses.test.mjs
grep -q 'successful response validators require closed own response fields' book/Volume6-Frontend-And-SDK/Chapter04-SDK.md
grep -q 'routeHint: "debug"' sdk/test/sdk-client-responses.test.mjs
grep -q 'relayer: quote.user' sdk/test/sdk-client-responses.test.mjs
grep -q 'venue: "x".repeat(129)' sdk/test/sdk-client-status-responses.test.mjs
grep -q 'chainName: "mainnet"' sdk/test/sdk-client-accounting-responses.test.mjs
grep -q 'reconciliationId: "recon_1"' sdk/test/sdk-client-accounting-responses.test.mjs
grep -q 'routeId: "route_1"' sdk/test/sdk-client-accounting-responses.test.mjs
grep -q 'Stringified numbers and wrapper objects are rejected instead of being coerced with `Number(...)`' book/Volume6-Frontend-And-SDK/Chapter04-SDK.md
grep -Fq 'return typeof value === "string" && /^(0|-?[1-9][0-9]*)$/.test(value)' $sdk_client_sources
grep -q 'grossPnlTokenOut: "01600000"' sdk/test/sdk-client-accounting-responses.test.mjs
grep -q 'grossPnlTokenOut: "-0"' sdk/test/sdk-client-accounting-responses.test.mjs
grep -q 'malformed modelDescription' sdk/test/sdk-client-accounting-responses.test.mjs
grep -q 'canonical signed gross PnL strings without leading zeros or negative zero' book/Volume6-Frontend-And-SDK/Chapter04-SDK.md
grep -q 'canonical UTC ISO timestamps generated with `Date.prototype.toISOString()`' book/Volume6-Frontend-And-SDK/Chapter04-SDK.md
grep -q 'client.health' sdk/test/sdk.test.mjs
grep -q 'client.getSettlement' sdk/test/sdk.test.mjs
grep -q 'client.getHedge' sdk/test/sdk.test.mjs
grep -q 'client.pnl' sdk/test/sdk.test.mjs
grep -q 'client.ready' sdk/test/sdk.test.mjs
grep -q 'version: "debug-build"' sdk/test/sdk-client-status-responses.test.mjs
grep -q 'generatedAt: "2026-06-27T00:00:00.000Z"' sdk/test/sdk-client-status-responses.test.mjs
grep -q 'RFQClient.health()` and `RFQClient.ready()` require closed own top-level response fields matching OpenAPI' book/Volume6-Frontend-And-SDK/Chapter04-SDK.md
grep -q 'percent-encodes safe dynamic status path identifiers' sdk/test/sdk-client-requests.test.mjs
grep -q 'q%3Atest-id' sdk/test/sdk-client-requests.test.mjs
grep -q 'new RFQClient("http://127.0.0.1:3000/", {' sdk/test/sdk.test.mjs
grep -q 'degraded readiness payloads' sdk/test/sdk-client-status-responses.test.mjs
grep -q 'falls back for unknown API error codes' sdk/test/sdk-client-errors.test.mjs
grep -q 'exposes Retry-After seconds for rate limited responses' sdk/test/sdk-client-errors.test.mjs
grep -q 'ignores non-canonical Retry-After headers' sdk/test/sdk-client-errors.test.mjs
grep -q '"60.0"' sdk/test/sdk-client-errors.test.mjs
grep -q '"6e1"' sdk/test/sdk-client-errors.test.mjs
grep -q 'retryAfterSeconds' README.md
grep -q 'canonical positive decimal delay-seconds value' README.md
grep -q 'zero, leading-zero, decimal, exponent, HTTP-date and oversized values are ignored' book/Volume6-Frontend-And-SDK/Chapter04-SDK.md
grep -q 'client.metrics' sdk/test/sdk.test.mjs
grep -q 'function submitQuote' contracts/src/RFQSettlement.sol
grep -q 'InvalidNonce' contracts/src/RFQSettlement.sol
grep -q 'quote.nonce == 0' contracts/src/RFQSettlement.sol
grep -q 'ITreasuryMinimal' contracts/src/RFQSettlement.sol
grep -q 'release(quote.tokenOut, quote.user, quote.amountOut)' contracts/src/RFQSettlement.sol
grep -q 'function setTreasury' contracts/src/RFQSettlement.sol
grep -q 'function setTokenWhitelist' contracts/src/RFQSettlement.sol
grep -q 'function grantRole' contracts/src/RFQSettlement.sol
grep -q 'function revokeRole' contracts/src/RFQSettlement.sol
grep -q '_roleMemberCounts' contracts/src/RFQSettlement.sol
grep -q 'CannotRevokeLastAdmin' contracts/src/RFQSettlement.sol
grep -q 'SIGNER_ADMIN_ROLE' contracts/src/RFQSettlement.sol
grep -q 'TOKEN_ADMIN_ROLE' contracts/src/RFQSettlement.sol
grep -q 'function setPaused' contracts/src/RFQSettlement.sol
grep -q '@openzeppelin/contracts/access/AccessControl.sol' contracts/src/RFQSettlement.sol
grep -q '@openzeppelin/contracts/utils/cryptography/EIP712.sol' contracts/src/RFQSettlement.sol
grep -q '@openzeppelin/contracts/utils/cryptography/ECDSA.sol' contracts/src/RFQSettlement.sol
grep -q '@openzeppelin/contracts/utils/Pausable.sol' contracts/src/RFQSettlement.sol
grep -q '@openzeppelin/contracts/utils/ReentrancyGuard.sol' contracts/src/RFQSettlement.sol
grep -q 'ECDSA.tryRecover' contracts/src/RFQSettlement.sol
grep -q 'trySafeTransferFrom' contracts/src/RFQSettlement.sol
grep -q 'using SafeERC20 for IERC20' contracts/src/RFQSettlement.sol
grep -q 'InputTransferAmountMismatch' contracts/src/RFQSettlement.sol
grep -q 'OutputTransferAmountMismatch' contracts/src/RFQSettlement.sol
grep -q '_collectTokenIn(quote)' contracts/src/RFQSettlement.sol
grep -q '_releaseTokenOut(quote)' contracts/src/RFQSettlement.sol
grep -q '_observedDecrease' contracts/src/RFQSettlement.sol
grep -q '_observedIncrease' contracts/src/RFQSettlement.sol
grep -q 'contract Treasury' contracts/src/Treasury.sol
grep -q 'function release' contracts/src/Treasury.sol
grep -q 'function emergencyWithdraw' contracts/src/Treasury.sol
grep -q 'onlySettlement' contracts/src/Treasury.sol
grep -q 'TransferFailed' contracts/src/Treasury.sol
grep -q '@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol' contracts/src/Treasury.sol
grep -q '@openzeppelin/contracts/utils/ReentrancyGuard.sol' contracts/src/Treasury.sol
grep -q 'using SafeERC20 for IERC20' contracts/src/Treasury.sol
grep -q 'trySafeTransfer' contracts/src/Treasury.sol
grep -q '"version": "5.6.1"' contracts/lib/openzeppelin-contracts/package.json
grep -q 'contracts/lib/openzeppelin-contracts' .gitmodules
grep -q 'testSettlementCanReleaseFunds' contracts/test/Treasury.t.sol
grep -q 'testOnlySettlementCanReleaseFunds' contracts/test/Treasury.t.sol
grep -q 'testOwnerCanEmergencyWithdraw' contracts/test/Treasury.t.sol
grep -q 'testRejectsFailedTokenTransfers' contracts/test/Treasury.t.sol
grep -q 'testRejectsNonContractTokenTransfers' contracts/test/Treasury.t.sol
grep -q 'testRejectsReentrantRelease' contracts/test/Treasury.t.sol
grep -q 'testSubmitQuoteTransfersTokensAndConsumesNonce' contracts/test/RFQSettlement.t.sol
grep -q 'testFuzzSubmitQuoteSettlesBoundedAmounts' contracts/test/RFQSettlement.t.sol
grep -q 'testFuzzSubmitQuoteRejectsMinOutAboveAmountOutWithoutSideEffects' contracts/test/RFQSettlement.t.sol
grep -q 'testFuzzSubmitQuoteRejectsExpiredDeadlineWithoutSideEffects' contracts/test/RFQSettlement.t.sol
grep -q 'testFuzzSubmitQuoteAllowsDifferentUsersToReuseNonce' contracts/test/RFQSettlement.t.sol
grep -q '_boundUint(rawNonce, 1, type(uint128).max)' contracts/test/RFQSettlement.t.sol
grep -q 'fuzz treasury tokenOut not debited' contracts/test/RFQSettlement.t.sol
grep -q 'fuzz nonce consumed on expiry' contracts/test/RFQSettlement.t.sol
grep -q 'testSubmitQuoteEmitsQuoteSettledForIndexer' contracts/test/RFQSettlement.t.sol
grep -q 'testSubmitQuoteRejectsReplay' contracts/test/RFQSettlement.t.sol
grep -q 'testSubmitQuoteRejectsUntrustedSigner' contracts/test/RFQSettlement.t.sol
grep -q 'testOwnerCanRotateTrustedSigner' contracts/test/RFQSettlement.t.sol
grep -q 'testOwnerCanRotateTreasury' contracts/test/RFQSettlement.t.sol
grep -q 'testOnlyOwnerCanManageAdminControls' contracts/test/RFQSettlement.t.sol
grep -q 'testOwnerCanTransferOwnershipAndNewOwnerCanPause' contracts/test/RFQSettlement.t.sol
grep -q 'testRejectsInvalidAdminAddresses' contracts/test/RFQSettlement.t.sol
grep -q 'testSubmitQuoteRejectsInvalidSignatureLength' contracts/test/RFQSettlement.t.sol
grep -q 'testSubmitQuoteRejectsInvalidSignatureV' contracts/test/RFQSettlement.t.sol
grep -q 'testSubmitQuoteRejectsHighSignatureS' contracts/test/RFQSettlement.t.sol
grep -q 'testSubmitQuoteRejectsExpiredQuote' contracts/test/RFQSettlement.t.sol
grep -q 'testSubmitQuoteRejectsWrongChainId' contracts/test/RFQSettlement.t.sol
grep -q 'testSubmitQuoteRejectsUnwhitelistedToken' contracts/test/RFQSettlement.t.sol
grep -q 'testWhitelistRejectsNonContractTokenIn' contracts/test/RFQSettlement.t.sol
grep -q 'testWhitelistRejectsNonContractTokenOut' contracts/test/RFQSettlement.t.sol
grep -q 'testRejectsInvalidTreasuryConfiguration' contracts/test/RFQSettlement.t.sol
grep -q 'testRejectsNonContractSettlementConfiguration' contracts/test/Treasury.t.sol
grep -q 'testRevokedOwnerCannotTransferOwnershipToRestoreAdminRoles' contracts/test/RFQSettlement.t.sol
grep -q 'testSubmitQuoteRejectsAmountOutBelowMinimum' contracts/test/RFQSettlement.t.sol
grep -q 'testSubmitQuoteRejectsZeroNonce' contracts/test/RFQSettlement.t.sol
grep -q 'contract DeployRFQSettlement' contracts/script/Deploy.s.sol
grep -q 'contract RFQDeploymentFactory' contracts/script/Deploy.s.sol
grep -q 'new Treasury' contracts/script/Deploy.s.sol
grep -q 'treasury.setSettlement' contracts/script/Deploy.s.sol
grep -q '_assertDeploymentInvariants' contracts/script/Deploy.s.sol
grep -q '_assertRoleHandoff' contracts/script/Deploy.s.sol
grep -q 'settlement.transferOwnership(contractAdmin)' contracts/script/Deploy.s.sol
grep -q 'treasury.transferOwnership(contractAdmin)' contracts/script/Deploy.s.sol
grep -q 'RFQ_TRUSTED_SIGNER' contracts/script/Deploy.s.sol
grep -q 'RFQ_CONTRACT_ADMIN' contracts/script/Deploy.s.sol
grep -q 'RFQ_TOKEN_WHITELIST_JSON' contracts/script/Deploy.s.sol
grep -q 'validateDeploymentConfig' contracts/script/Deploy.s.sol
grep -q 'EmptyTokenWhitelist' contracts/script/Deploy.s.sol
grep -q 'DuplicateWhitelistToken' contracts/script/Deploy.s.sol
grep -q 'testDeployAtomicallyConfiguresStackAndTransfersAdministration' contracts/test/Deploy.t.sol
grep -q 'testDeployRejectsUnsafeDeploymentConfigBeforeCreatingFactory' contracts/test/Deploy.t.sol
grep -q 'factory retained admin role' contracts/test/Deploy.t.sol
grep -q 'treasury settlement mismatch' contracts/test/Deploy.t.sol
grep -q 'settlement treasury mismatch' contracts/test/Deploy.t.sol
grep -q 'RFQ_CONTRACT_ADMIN=0x' README.md
grep -q 'factory retains no authority' README.md
grep -q 'contract-test' Makefile
grep -q 'contract-abi-check' Makefile
grep -q 'compose-check' Makefile
grep -q 'compose:check' package.json
grep -q 'verify:' Makefile
grep -q '"verify": "make verify"' package.json
grep -q 'make skeleton-check' scripts/verify.sh
grep -q 'make examples-check' scripts/verify.sh
grep -q 'make config-check' scripts/verify.sh
grep -q 'make docs-check' scripts/verify.sh
grep -q 'make book-template-check' scripts/verify.sh
grep -q 'make adr-check' scripts/verify.sh
grep -q 'make security-check' scripts/verify.sh
grep -q 'make transport-security-check' scripts/verify.sh
grep -q 'make metrics-check' scripts/verify.sh
grep -q 'make runbook-check' scripts/verify.sh
grep -q 'make grafana-check' scripts/verify.sh
grep -q 'make deployment-check' scripts/verify.sh
grep -q 'make ci-check' scripts/verify.sh
grep -q 'make compose-check' scripts/verify.sh
grep -q 'make kms-signer-check' scripts/verify.sh
grep -q 'make eip712-check' scripts/verify.sh
grep -q 'make contract-abi-check' scripts/verify.sh
grep -q 'make rate-limit-check' scripts/verify.sh
grep -q 'make api-error-check' scripts/verify.sh
grep -q 'make api-schema-check' scripts/verify.sh
grep -q 'make api-route-check' scripts/verify.sh
grep -q 'make database-schema-check' scripts/verify.sh
grep -q 'make benchmark-quote' scripts/verify.sh
grep -q 'make benchmark-submit' scripts/verify.sh
grep -q 'make backend-test' scripts/verify.sh
grep -q 'make sdk-test' scripts/verify.sh
grep -q 'make frontend-test' scripts/verify.sh
grep -q 'make smoke-api-local' scripts/verify.sh
grep -q 'make contract-test' scripts/verify.sh
grep -q 'forge not found; skipping contract-test' scripts/verify.sh
grep -q 'backend-build' Makefile
grep -q 'backend-test' Makefile
grep -q 'frontend-test' Makefile
grep -q 'examples-check' Makefile
grep -q 'examples:check' package.json
grep -q 'config-check' Makefile
grep -q 'config:check' package.json
grep -q 'book-template-check' Makefile
grep -q 'book:template:check' package.json
grep -q 'adr-check' Makefile
grep -q 'adr:check' package.json
grep -q 'security-check' Makefile
grep -q 'security:check' package.json
grep -q 'transport-security-check' Makefile
grep -q 'transport:security:check' package.json
grep -q 'metrics-check' Makefile
grep -q 'metrics:check' package.json
grep -q 'runbook-check' Makefile
grep -q 'runbook:check' package.json
grep -q 'grafana-check' Makefile
grep -q 'grafana:check' package.json
grep -q 'deployment-check' Makefile
grep -q 'deployment:check' package.json
grep -q 'ci-check' Makefile
grep -q 'ci:check' package.json
grep -q 'eip712-check' Makefile
grep -q 'rate-limit-check' Makefile
grep -q 'rate-limit:check' package.json
grep -q 'api-schema-check' Makefile
grep -q 'api:schema:check' package.json
grep -q 'api-route-check' Makefile
grep -q 'api:route:check' package.json
grep -q 'database-schema-check' Makefile
grep -q 'database:schema:check' package.json
grep -q 'benchmark-quote' Makefile
grep -q 'benchmark-submit' Makefile
grep -q 'benchmark:quote' package.json
grep -q 'benchmark:submit' package.json
grep -q 'make benchmark-quote' README.md
grep -q 'make benchmark-submit' README.md
grep -q 'RFQ_BENCHMARK_MAX_P95_MS' README.md
grep -q 'RFQ_BENCHMARK_SUBMIT_MAX_P95_MS' README.md
grep -q 'make benchmark-quote' book/Volume5-BackendEngineering/Chapter02-Quote-Service.md
grep -q 'make benchmark-submit' book/Volume5-BackendEngineering/Chapter02-Quote-Service.md
grep -q 'make benchmark-submit' book/Volume5-BackendEngineering/Chapter06-Execution-Service.md
grep -q 'make benchmark-quote' book/Volume7-ProductionDeployment/Chapter03-Monitoring.md
grep -q 'make benchmark-submit' book/Volume7-ProductionDeployment/Chapter03-Monitoring.md
grep -q 'RFQ_BENCHMARK_QUOTE_REQUESTS' benchmark/quote-benchmark.mjs
grep -q 'RFQ_BENCHMARK_MAX_P95_MS' benchmark/quote-benchmark.mjs
grep -q 'POST /quote' benchmark/quote-benchmark.mjs
grep -q 'buildServer' benchmark/quote-benchmark.mjs
grep -q 'rateLimit: false' benchmark/quote-benchmark.mjs
grep -q 'RFQ_BENCHMARK_SUBMIT_REQUESTS' benchmark/submit-benchmark.mjs
grep -q 'RFQ_BENCHMARK_SUBMIT_MAX_P95_MS' benchmark/submit-benchmark.mjs
grep -q 'POST /submit' benchmark/submit-benchmark.mjs
grep -q 'setupRoute: "POST /quote"' benchmark/submit-benchmark.mjs
grep -q 'maxAbsoluteInventory' benchmark/submit-benchmark.mjs
grep -q 'rateLimit: false' benchmark/submit-benchmark.mjs
grep -q 'smoke-api-local' Makefile
grep -q 'FOUNDRY_DISABLE_NIGHTLY_WARNING=1 forge build' Makefile
grep -q 'FOUNDRY_DISABLE_NIGHTLY_WARNING=1 forge test --offline' Makefile
grep -q 'FOUNDRY_DISABLE_NIGHTLY_WARNING' .github/workflows/contract-ci.yml
grep -q 'forge test' .github/workflows/contract-ci.yml
grep -q 'make contract-abi-check' .github/workflows/contract-ci.yml
grep -q 'make eip712-check' .github/workflows/contract-ci.yml
grep -Fq '"sdk/src/abi.ts"' .github/workflows/contract-ci.yml
grep -Fq '"sdk/src/eip712.ts"' .github/workflows/contract-ci.yml
grep -Fq '"backend/src/modules/signer/signer.service.ts"' .github/workflows/contract-ci.yml
grep -Fq '"scripts/check-contract-abi-consistency.mjs"' .github/workflows/contract-ci.yml
grep -Fq '"scripts/check-eip712-consistency.mjs"' .github/workflows/contract-ci.yml
grep -q 'pnpm install --frozen-lockfile' .github/workflows/backend-ci.yml
grep -q 'make verify' .github/workflows/backend-ci.yml
grep -Fq '"pnpm-lock.yaml"' .github/workflows/backend-ci.yml
grep -Eq 'actions/setup-node@[0-9a-f]{40} # v6\.' .github/workflows/backend-ci.yml
grep -q 'submodules: recursive' .github/workflows/backend-ci.yml
grep -q 'persist-credentials: false' .github/workflows/backend-ci.yml
grep -q 'node-version: "22"' .github/workflows/backend-ci.yml
grep -Fq '"infra/**"' .github/workflows/backend-ci.yml
grep -Fq '"docker-compose.yml"' .github/workflows/backend-ci.yml
grep -Fq '".env.example"' .github/workflows/backend-ci.yml
grep -Fq '"README.md"' .github/workflows/backend-ci.yml
grep -q '      - master' .github/workflows/backend-ci.yml
grep -q '      - master' .github/workflows/docs-ci.yml
grep -q '      - master' .github/workflows/contract-ci.yml
grep -Eq 'actions/setup-node@[0-9a-f]{40} # v6\.' .github/workflows/docs-ci.yml
grep -q 'submodules: recursive' .github/workflows/docs-ci.yml
grep -q 'node-version: "22"' .github/workflows/docs-ci.yml
grep -Eq 'actions/setup-node@[0-9a-f]{40} # v6\.' .github/workflows/contract-ci.yml
grep -q 'node-version: "22"' .github/workflows/contract-ci.yml
test -s .github/workflows/release.yml
test -s .github/dependabot.yml
grep -q 'name: Release Artifacts' .github/workflows/release.yml
grep -q 'needs: verify' .github/workflows/release.yml
grep -q 'run: make verify' .github/workflows/release.yml
grep -q 'sbom: true' .github/workflows/release.yml
grep -q 'provenance: mode=max' .github/workflows/release.yml
grep -q 'cosign sign --yes' .github/workflows/release.yml
grep -q 'helm package' .github/workflows/release.yml
grep -q 'release-manifest.json' .github/workflows/release.yml
grep -q 'make api-error-check' .github/workflows/docs-ci.yml
grep -q 'make examples-check' .github/workflows/docs-ci.yml
grep -q 'make config-check' .github/workflows/docs-ci.yml
grep -q 'make rate-limit-check' .github/workflows/docs-ci.yml
grep -q 'make api-schema-check' .github/workflows/docs-ci.yml
grep -q 'make api-route-check' .github/workflows/docs-ci.yml
grep -q 'make database-schema-check' .github/workflows/docs-ci.yml
grep -q 'make docs-check' .github/workflows/docs-ci.yml
grep -q 'make book-template-check' .github/workflows/docs-ci.yml
grep -q 'make adr-check' .github/workflows/docs-ci.yml
grep -q 'make security-check' .github/workflows/docs-ci.yml
grep -q 'make transport-security-check' .github/workflows/docs-ci.yml
grep -q 'make metrics-check' .github/workflows/docs-ci.yml
grep -q 'make runbook-check' .github/workflows/docs-ci.yml
grep -q 'make grafana-check' .github/workflows/docs-ci.yml
grep -q 'make deployment-check' .github/workflows/docs-ci.yml
grep -q 'make ci-check' .github/workflows/docs-ci.yml
grep -q 'make sdk-composition-check' .github/workflows/docs-ci.yml
grep -Fq '"examples/**"' .github/workflows/docs-ci.yml
grep -Fq '"benchmark/**"' .github/workflows/docs-ci.yml
grep -Fq '"benchmark/**"' .github/workflows/backend-ci.yml
grep -Fq '"scripts/check-api-schema-consistency.mjs"' .github/workflows/docs-ci.yml
grep -Fq '"scripts/check-api-route-consistency.mjs"' .github/workflows/docs-ci.yml
grep -q 'path parameter ${parameterName} must cap identifiers at 128 characters' scripts/check-api-route-consistency.mjs
grep -q 'path parameter ${parameterName} must define the shared safe identifier pattern' scripts/check-api-route-consistency.mjs
grep -q 'backend must enforce bounded safe status identifiers' scripts/check-api-route-consistency.mjs
grep -q 'SDK must reject unsafe status identifiers before fetch' scripts/check-api-route-consistency.mjs
grep -Fq '"scripts/check-database-schema-consistency.mjs"' .github/workflows/docs-ci.yml
grep -Fq '"scripts/check-examples-consistency.mjs"' .github/workflows/docs-ci.yml
grep -Fq '"scripts/check-config-consistency.mjs"' .github/workflows/docs-ci.yml
grep -Fq '"scripts/check-security-docs-consistency.mjs"' .github/workflows/docs-ci.yml
grep -Fq '"scripts/check-metrics-consistency.mjs"' .github/workflows/docs-ci.yml
grep -Fq '"scripts/check-runbook-consistency.mjs"' .github/workflows/docs-ci.yml
grep -Fq '"scripts/check-rate-limit-consistency.mjs"' .github/workflows/docs-ci.yml
grep -Fq '"scripts/check-grafana-dashboard-consistency.mjs"' .github/workflows/docs-ci.yml
grep -Fq '"scripts/check-deployment-manifests-consistency.mjs"' .github/workflows/docs-ci.yml
grep -Fq '"scripts/check-ci-workflows-consistency.mjs"' .github/workflows/docs-ci.yml
grep -Fq '"infra/prometheus/**"' .github/workflows/docs-ci.yml
grep -Fq '"infra/grafana/**"' .github/workflows/docs-ci.yml
grep -Fq '"infra/k8s/**"' .github/workflows/docs-ci.yml
grep -Fq '"infra/helm/**"' .github/workflows/docs-ci.yml
grep -Fq '"backend/src/modules/rate-limit/rate-limit.service.ts"' .github/workflows/docs-ci.yml
grep -Fq '"backend/src/main.ts"' .github/workflows/docs-ci.yml
grep -Fq '"sdk/src/client*.ts"' .github/workflows/docs-ci.yml
grep -Fq '"sdk/test/sdk-client-config.test.mjs"' .github/workflows/docs-ci.yml
grep -Fq '"sdk/test/sdk-client-errors.test.mjs"' .github/workflows/docs-ci.yml
grep -Fq '"sdk/test/sdk-client-requests.test.mjs"' .github/workflows/docs-ci.yml
grep -Fq '"sdk/test/sdk-client-accounting-responses.test.mjs"' .github/workflows/docs-ci.yml
grep -Fq '"sdk/test/sdk-client-responses.test.mjs"' .github/workflows/docs-ci.yml
grep -Fq '"sdk/test/sdk-client-status-responses.test.mjs"' .github/workflows/docs-ci.yml
grep -Fq '"sdk/test/sdk-settlement.test.mjs"' .github/workflows/docs-ci.yml
grep -Fq '"sdk/test/sdk.test.mjs"' .github/workflows/docs-ci.yml
grep -q 'QUOTE_TYPEHASH' scripts/check-eip712-consistency.mjs
grep -q 'backend signer Quote fields must match SDK Quote fields' scripts/check-eip712-consistency.mjs
grep -q 'OpenAPI ErrorResponse enum must match backend RFQErrorCode' scripts/check-api-error-consistency.mjs
grep -q 'SDK rfqErrorCodes array must match backend RFQErrorCode' scripts/check-api-error-consistency.mjs
grep -q 'SDK rfqErrorCodes constant array not found' scripts/check-api-error-consistency.mjs
grep -q 'docs/api/errors.md table must match backend RFQErrorCode' scripts/check-api-error-consistency.mjs
grep -q 'readReachableSourceTree("backend/src/main.ts")' scripts/check-api-error-consistency.mjs
grep -q 'extractDocumentedErrorStatuses' scripts/check-api-error-consistency.mjs
grep -q 'extractBackendApiErrorStatuses' scripts/check-api-error-consistency.mjs
grep -q 'HTTP status list must cover backend APIError statuses' scripts/check-api-error-consistency.mjs
grep -q 'extractOpenApiResponses' scripts/check-api-error-consistency.mjs
grep -q 'OpenAPI ${response.key} error response must use ErrorResponse' scripts/check-api-error-consistency.mjs
grep -Fq '["GET /ready 503", "#/components/schemas/ReadinessResponse"]' scripts/check-api-error-consistency.mjs
grep -q 'extractOpenApiResponseSchemaRef' scripts/check-api-error-consistency.mjs
grep -q 'extractOpenApiTraceHeaderRef' scripts/check-api-error-consistency.mjs
grep -q 'OpenAPI components.headers.TraceId must define the reusable trace header' scripts/check-api-error-consistency.mjs
grep -q 'safe incoming x-trace-id propagation' scripts/check-api-error-consistency.mjs
grep -q 'safe incoming trace propagation and unsafe trace fallback' scripts/check-api-error-consistency.mjs
grep -q 'OpenAPI ${response.key} must reference components.headers.TraceId' scripts/check-api-error-consistency.mjs
grep -q 'TraceId:' docs/api/openapi.yaml
grep -q '#/components/headers/TraceId' docs/api/openapi.yaml
grep -q 'backend/test/api.test.mjs' scripts/check-api-error-consistency.mjs
grep -q 'backend/test/api-risk.test.mjs' scripts/check-api-error-consistency.mjs
grep -q 'backend/test/api-signer.test.mjs' scripts/check-api-error-consistency.mjs
grep -q 'backend/test/api-submit-dependencies.test.mjs' scripts/check-api-error-consistency.mjs
grep -q 'backend/test/api-submit-settlement-dependencies.test.mjs' scripts/check-api-error-consistency.mjs
grep -q 'backend/test/api-submit.test.mjs' scripts/check-api-error-consistency.mjs
grep -q 'backend/test/api-gateway-runtime.test.mjs' scripts/check-api-error-consistency.mjs
grep -q 'backend/test/api-validation-gateway.test.mjs' scripts/check-api-error-consistency.mjs
grep -q 'backend/test/api-validation.test.mjs' scripts/check-api-error-consistency.mjs
grep -q 'apiTraceContractTestSource' scripts/check-api-error-consistency.mjs
grep -q 'assertTraceHeaderContract' scripts/check-api-error-consistency.mjs
grep -q 'backend onRequest hook must attach x-trace-id to every response' scripts/check-api-error-consistency.mjs
grep -q 'backend sendError must keep x-trace-id aligned with ErrorResponse.traceId' scripts/check-api-error-consistency.mjs
grep -q 'backend API tests must assert x-trace-id exists on successful responses' scripts/check-api-error-consistency.mjs
grep -q 'defaultRateLimitConfig' scripts/check-rate-limit-consistency.mjs
grep -q 'Retry-After' scripts/check-rate-limit-consistency.mjs
grep -q 'sdk/src/client.ts' scripts/check-rate-limit-consistency.mjs
grep -q 'sdk/test/sdk-client-errors.test.mjs' scripts/check-rate-limit-consistency.mjs
grep -q 'frontend/src/lib/errors.ts' scripts/check-rate-limit-consistency.mjs
grep -q 'frontend/src/components/QuoteStatusPanel.tsx' scripts/check-rate-limit-consistency.mjs
grep -q 'retryAfterSeconds' scripts/check-rate-limit-consistency.mjs
grep -Fq 'sdk/src/client*.ts' scripts/check-ci-workflows-consistency.mjs
grep -q 'make rate-limit-check' scripts/check-ci-workflows-consistency.mjs
grep -q 'Prometheus alert rules must cover backend metric' scripts/check-metrics-consistency.mjs
grep -q 'backend/src/modules/rate-limit/rate-limit.service.ts' scripts/check-metrics-consistency.mjs
grep -q 'MetricsService rate limit endpoint labels must match backend RateLimitedEndpoint' scripts/check-metrics-consistency.mjs
grep -q 'MetricsService signer operation labels must match SignerMetricOperation' scripts/check-metrics-consistency.mjs
grep -q 'MetricsService readiness dependency labels must match backend readiness components' scripts/check-metrics-consistency.mjs
grep -q 'extractConstStringArray' scripts/check-metrics-consistency.mjs
grep -q 'Grafana overview dashboard must query alert metric' scripts/check-grafana-dashboard-consistency.mjs
grep -q 'typescript-check' Makefile
grep -q 'api-error-check' Makefile
grep -q '65-byte canonical low-s EIP-712 signature' docs/api/openapi.yaml
grep -q 'Expected ${label} to be a 65-byte hex string' scripts/smoke-api.mjs
grep -q 'recoverTypedDataAddress' scripts/smoke-api.mjs
grep -q 'privateKeyToAccount' scripts/smoke-api.mjs
grep -q 'recovered quote signer' scripts/smoke-api.mjs
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

grep -q 'risk engine is unavailable' backend/test/api-risk.test.mjs
grep -q 'RISK_ENGINE_UNAVAILABLE' backend/test/api-risk.test.mjs
grep -q 'RISK_ENGINE_UNAVAILABLE' book/Volume5-BackendEngineering/Chapter04-Risk-Service.md
grep -q 'stale' docs/api/openapi.yaml
grep -q 'getReadiness' docs/api/openapi.yaml
grep -q 'ReadinessResponse' docs/api/openapi.yaml
grep -q 'ReadinessComponentStatus' docs/api/openapi.yaml
grep -q 'marketSnapshotStore:' docs/api/openapi.yaml
grep -q 'not ready because at least one quote dependency is degraded' docs/api/openapi.yaml
grep -q 'signer sign/verify capability' docs/api/openapi.yaml
grep -q 'getHedgeIntent' docs/api/openapi.yaml
grep -q 'HedgeIntentStatus' docs/api/openapi.yaml
grep -q 'RFQ API returns filled and failed hedge outcomes from the hedge status store' backend/test/api-hedge.test.mjs
grep -q 'HEDGE_NOT_FOUND' docs/api/openapi.yaml
grep -q 'HEDGE_STORE_UNAVAILABLE' docs/api/openapi.yaml
grep -q 'HEDGE_STORE_UNAVAILABLE' docs/api/errors.md
grep -q 'Hedge intent creation failure does not roll back an accepted settlement' docs/api/openapi.yaml
grep -q 'getSettlementEvent' docs/api/openapi.yaml
grep -q 'SettlementEventStatus' docs/api/openapi.yaml
grep -q 'quoteHash' docs/api/openapi.yaml
grep -q 'persist the emitted nonce for chainId/user/nonce' docs/api/openapi.yaml
grep -q 'assertEqual(settlementStatus.nonce, quoteResponse.nonce, "settlement nonce")' scripts/smoke-api.mjs
grep -q 'settlementStatus?.nonce' frontend/src/components/QuoteStatusPanel.tsx
grep -q 'hashSettlementQuote' backend/src/modules/settlement/settlement-event.service.ts
grep -q 'blockNumber?: number' backend/src/modules/settlement/settlement-event.service.ts
grep -q 'normalizeTxHash' backend/src/modules/settlement/settlement-event.service.ts
grep -q 'Settlement event txHash must be a 32-byte hex string' backend/src/modules/settlement/settlement-event.service.ts
grep -Fq '0x[0-9a-fA-F]{64}' backend/test/api.test.mjs
grep -q 'Expected ${label} to be a 32-byte hex string' scripts/smoke-api.mjs
grep -q 'normalizeEventOrdinal' backend/src/modules/settlement/settlement-event.service.ts
grep -q 'non-negative safe integer' backend/src/modules/settlement/settlement-event.service.ts
grep -q 'normalizes transaction hashes for idempotency' backend/test/settlement-event.test.mjs
grep -q 'rejects invalid transaction hashes before side effects' backend/test/settlement-event-validation.test.mjs
grep -q 'rejects invalid chain event ordinals before side effects' backend/test/settlement-event-validation.test.mjs
grep -q 'quoteHash' backend/src/shared/types/rfq.ts
grep -q 'blockNumber: number' backend/src/shared/types/rfq.ts
grep -q 'quoteHash' sdk/src/types.ts
grep -q 'blockNumber: number' sdk/src/types.ts
grep -q 'settlement quoteHash' scripts/smoke-api.mjs
grep -q 'settlement block number' scripts/smoke-api.mjs
grep -q 'Quote Hash' frontend/src/components/QuoteStatusPanel.tsx
grep -q 'Block' frontend/src/components/QuoteStatusPanel.tsx
grep -q 'blockNumber' book/Volume5-BackendEngineering/Chapter06-Execution-Service.md
grep -q 'txHash` as a runtime string and a 32-byte hex string' book/Volume5-BackendEngineering/Chapter06-Execution-Service.md
grep -q 'non-negative safe integers' book/Volume5-BackendEngineering/Chapter06-Execution-Service.md
grep -q 'settlement_events.block_number` and `settlement_events.log_index` with a `0..9007199254740991` range check' book/Volume5-BackendEngineering/Chapter06-Execution-Service.md
grep -q 'blockNumber' docs/diagrams/submit-sequence.md
grep -q 'backend settlement quote hash fields must match RFQSettlement QUOTE_TYPEHASH' scripts/check-eip712-consistency.mjs
grep -q 'SDK settlement quote hash fields must match RFQSettlement QUOTE_TYPEHASH' scripts/check-eip712-consistency.mjs
grep -q 'SETTLEMENT_EVENT_NOT_FOUND' docs/api/openapi.yaml
grep -q 'SETTLEMENT_EVENT_STORE_UNAVAILABLE' docs/api/openapi.yaml
grep -q 'SETTLEMENT_EVENT_STORE_UNAVAILABLE' docs/api/errors.md
grep -q 'PNL_STORE_UNAVAILABLE' docs/api/openapi.yaml
grep -q 'PNL_STORE_UNAVAILABLE' docs/api/errors.md
grep -q 'getPnlSummary' docs/api/openapi.yaml
grep -q 'PnlSummary' docs/api/openapi.yaml
grep -q 'PnlTradeRecord' docs/api/openapi.yaml
grep -q 'modelDescription' docs/api/openapi.yaml
grep -q 'Every response includes an x-trace-id header' docs/api/openapi.yaml
grep -q 'Every HTTP response includes an `x-trace-id` header' README.md
grep -q 'assertTraceHeader' backend/test/api.test.mjs
grep -q 'onRequest` hook' book/Volume5-BackendEngineering/Chapter01-API-Gateway.md
grep -q 'Fastify parser' book/Volume5-BackendEngineering/Chapter01-API-Gateway.md
grep -q 'readOwnEnvValue(env, "RFQ_QUOTE_TTL_SECONDS")' $gateway_sources
grep -q 'readOwnEnvValue(env, "HOST")' $gateway_sources
grep -q 'RFQ API reads startup environment only from own fields' backend/test/api-gateway-env.test.mjs
grep -q 'Object.create({ HOST: "0.0.0.0", PORT: "8080" })' backend/test/api-gateway-env.test.mjs
grep -q 'Gateway startup reads environment configuration only from own fields' book/Volume5-BackendEngineering/Chapter01-API-Gateway.md
grep -q 'Backend startup reads only own environment fields' README.md
grep -q 'RFQ_BODY_LIMIT_BYTES' book/Volume5-BackendEngineering/Chapter01-API-Gateway.md
grep -q 'RFQ_CORS_ALLOWED_ORIGINS' book/Volume5-BackendEngineering/Chapter01-API-Gateway.md
grep -q 'CORS preflight' book/Volume5-BackendEngineering/Chapter01-API-Gateway.md
grep -q '拒绝 path、query、fragment、credentials 和 wildcard' book/Volume5-BackendEngineering/Chapter01-API-Gateway.md
grep -q 'baseline security headers' book/Volume5-BackendEngineering/Chapter01-API-Gateway.md
grep -q 'RFQ_ENABLE_HSTS' book/Volume5-BackendEngineering/Chapter01-API-Gateway.md
grep -q 'graceful shutdown signal handling' book/Volume5-BackendEngineering/Chapter01-API-Gateway.md
grep -q 'not-found handler' book/Volume5-BackendEngineering/Chapter01-API-Gateway.md
grep -q 'IntString' docs/api/openapi.yaml
grep -Fq 'pattern: "^(0|-?[1-9][0-9]*)$"' docs/api/openapi.yaml
grep -q 'IntString must be canonical and reject leading zeros and negative zero' scripts/check-api-schema-consistency.mjs
grep -q 'SafeIdentifier' docs/api/openapi.yaml
grep -q 'Internal rejection reason for rejected quote records' docs/api/openapi.yaml
grep -q 'QUOTE_ALREADY_USED' docs/api/openapi.yaml
grep -q 'QUOTE_FAILED' docs/api/openapi.yaml
grep -q 'maxLength: 128' docs/api/openapi.yaml
grep -Fq 'pattern: "^[A-Za-z0-9_:-]+$"' docs/api/openapi.yaml
grep -q 'pattern: "^tr_.+"' docs/api/openapi.yaml
grep -q 'allowBuilds' pnpm-workspace.yaml
grep -q 'onlyBuiltDependencies' pnpm-workspace.yaml
grep -q 'RFQ_SIGNER_PRIVATE_KEY' .env.example
grep -q 'RFQ_QUOTE_TTL_SECONDS=30' .env.example
grep -q 'RFQ_BODY_LIMIT_BYTES=32768' .env.example
grep -q 'RFQ_CORS_ALLOWED_ORIGINS=http://localhost:5173' .env.example
grep -q 'RFQ_ENABLE_HSTS=false' .env.example
grep -q 'VITE_RFQ_API_BASE_URL=http://localhost:3000' .env.example
grep -q 'VITE_RFQ_SETTLEMENT_ADDRESS=0x0000000000000000000000000000000000000004' .env.example
grep -q 'VITE_WALLETCONNECT_PROJECT_ID=00000000000000000000000000000000' .env.example
grep -q 'WalletConnect project id must be a safe string' .env.example
grep -q 'HOST=127.0.0.1' .env.example
grep -q 'Production Configuration' README.md
grep -q 'rfq-backend-secrets' README.md
grep -q 'asymmetric `ECC_SECG_P256K1` signing key' README.md
grep -q '`RFQ_SIGNER_PRIVATE_KEY` is rejected outside local mode' README.md
grep -q 'RFQ_QUOTE_TTL_SECONDS' README.md
grep -q 'RFQ_BODY_LIMIT_BYTES' README.md
grep -q 'must be a base-10 integer from 1 to 3600' README.md
grep -q 'must be a base-10 integer from 1024 to 1048576' README.md
grep -q 'rejects non-boolean `logger`, `enableHsts` or `trustProxy` values' README.md
grep -q 'cryptographically recovers the EIP-712 signer from the returned signature' README.md
grep -q 'RFQ_CORS_ALLOWED_ORIGINS' README.md
grep -q 'startup rejects entries with paths, query strings, fragments, credentials, or wildcards' README.md
grep -q 'VITE_WALLETCONNECT_PROJECT_ID` configures RainbowKit wallet connection and must be a 128-character-or-shorter safe string' README.md
grep -q 'RFQ_ENABLE_HSTS' README.md
grep -q 'RFQ_QUOTE_TTL_SECONDS' docs/api/openapi.yaml
grep -q 'RFQ_CORS_ALLOWED_ORIGINS' docs/api/openapi.yaml
grep -q 'without path, query, fragment, credentials, or wildcards' docs/api/openapi.yaml
grep -q 'baseline browser security headers' docs/api/openapi.yaml
grep -q 'Unknown routes and unsupported methods' docs/api/openapi.yaml
grep -q '"413":' docs/api/openapi.yaml
grep -q 'body too large' docs/api/errors.md
grep -q 'malformed JSON' docs/api/errors.md
grep -q 'CORS preflight origin' docs/api/errors.md
grep -q 'path、query、fragment、credentials 和 wildcard' docs/api/errors.md
grep -q '未匹配路由' docs/api/errors.md
grep -q 'RFQ_QUOTE_TTL_SECONDS' book/Volume5-BackendEngineering/Chapter02-Quote-Service.md
grep -q '`1e2`、`30.0`、`0x1e`' book/Volume5-BackendEngineering/Chapter02-Quote-Service.md
grep -q 'requires a non-array options object, rejects inherited supported option fields' book/Volume5-BackendEngineering/Chapter01-API-Gateway.md
grep -q 'requires `rateLimit` to be `false` or an object whose partial rate-limit fields are own fields' book/Volume5-BackendEngineering/Chapter01-API-Gateway.md
grep -q 'RFQ_QUOTE_TTL_SECONDS' backend/test/api-gateway-env.test.mjs
grep -q 'RFQ_QUOTE_TTL_SECONDS must be a base-10 integer between 1 and 3600' backend/test/api-gateway-env.test.mjs
grep -q 'RFQ_BODY_LIMIT_BYTES must be a base-10 integer between 1024 and 1048576' backend/test/api-gateway-env.test.mjs
grep -q 'PORT must be a base-10 integer between 1 and 65535' backend/test/api-gateway.test.mjs
grep -q 'RFQ API rejects unsafe direct runtime options at startup' backend/test/api-gateway.test.mjs
grep -q 'buildServer options must be an object' backend/test/api-gateway.test.mjs
grep -q 'buildServer options.logger must be an own field when provided' backend/test/api-gateway.test.mjs
grep -q 'buildServer rateLimit must be an object or false' backend/test/api-gateway.test.mjs
grep -q 'buildServer rateLimit.windowMs must be an own field when provided' backend/test/api-gateway.test.mjs
grep -q 'configured quote TTL' backend/test/quote-service.test.mjs
grep -q 'QuoteService snapshots runtime configuration at construction' backend/test/quote-service-config.test.mjs
grep -q 'QuoteService rejects unsafe runtime configuration at construction' backend/test/quote-service-config.test.mjs
grep -q 'snapshots `QuoteServiceConfig` at construction after validation' book/Volume5-BackendEngineering/Chapter02-Quote-Service.md
grep -q 'runtime config fail-fast' book/Volume5-BackendEngineering/Chapter02-Quote-Service.md
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
grep -q 'recoveredSigner' scripts/smoke-api.mjs
grep -q 'rfq_submit_latency_seconds_count 2' scripts/smoke-api.mjs
grep -q 'rfq_inventory_balance' scripts/smoke-api.mjs
grep -q 'rfq_hedge_lag_seconds_count 1' scripts/smoke-api.mjs
grep -q 'rfq_inventory_balance' backend/test/api.test.mjs
grep -q 'hedge intent creation fails' backend/test/api-hedge.test.mjs
grep -q 'lastPenaltyRead' backend/test/api-hedge.test.mjs
grep -q 'QuoteService keeps inventory skew and hedge risk premium separate in pricing input' backend/test/quote-service.test.mjs
grep -q 'HedgeService accumulates bounded quote risk penalty after hedge failures' backend/test/hedge.test.mjs
grep -q 'hedge status store failures' backend/test/api-hedge.test.mjs
grep -q 'HEDGE_INTENT_FAILED' backend/test/api-hedge.test.mjs
grep -q 'quote risk penalty' book/Volume5-BackendEngineering/Chapter07-Hedge-Service.md
grep -q '`quoteRiskPenaltyBps` output is a Quote Service dependency boundary' book/Volume5-BackendEngineering/Chapter07-Hedge-Service.md
grep -q 'fails the requested quote with `PRICING_UNAVAILABLE`' book/Volume5-BackendEngineering/Chapter07-Hedge-Service.md
grep -q '`createHedgeIntent` output is an Execution Service dependency boundary' book/Volume5-BackendEngineering/Chapter07-Hedge-Service.md
grep -q 'the submit response omits `hedgeOrderId`' book/Volume5-BackendEngineering/Chapter07-Hedge-Service.md
grep -q 'HEDGE_INTENT_FAILED' book/Volume5-BackendEngineering/Chapter07-Hedge-Service.md
grep -q 'HEDGE_STORE_UNAVAILABLE' book/Volume5-BackendEngineering/Chapter07-Hedge-Service.md
grep -q 'post-settlement quote status persistence fails' backend/test/api-submit-dependencies.test.mjs
grep -q 'rfq_quote_status_update_errors_total' backend/test/api-submit-dependencies.test.mjs
grep -q 'Duplicate settlement events are idempotent' book/Volume5-BackendEngineering/Chapter06-Execution-Service.md
grep -q 'rfq_quote_status_update_errors_total' book/Volume5-BackendEngineering/Chapter08-Metrics-Service.md
grep -q 'quoteStatus.status' scripts/smoke-api.mjs
grep -q 'buildServer' backend/test/api.test.mjs
grep -q 'production startup requires explicit AWS KMS signer identity without private key material' backend/test/api-gateway-signer-env.test.mjs
grep -q 'non-local external signer mode requires explicit injection and identity' backend/test/api-gateway-signer-env.test.mjs
grep -q 'RFQ_SIGNER_MODE=local is not allowed when NODE_ENV=production' backend/test/api-gateway-signer-env.test.mjs
grep -q 'RFQ_SIGNER_PRIVATE_KEY must not be configured' backend/test/api-gateway-signer-env.test.mjs
grep -q 'RFQ_AWS_KMS_KEY_ID' backend/test/api-gateway-signer-env.test.mjs
grep -q 'RFQ_TRUSTED_SIGNER_ADDRESS' backend/test/api-gateway-signer-env.test.mjs
grep -q 'built-in Anvil signer fallback is only for unset `NODE_ENV`, `development`, or `test`' README.md
grep -q '默认 Anvil key 只允许用于 unset `NODE_ENV`、`development` 或 `test`' book/Volume5-BackendEngineering/Chapter05-Signer-Service.md
grep -q 'marks requested quotes as failed when signer is unavailable' backend/test/quote-service.test.mjs
grep -q 'preserves signer errors when marking failed quotes fails' backend/test/quote-service.test.mjs
grep -q 'signing is unavailable' backend/test/api-signer.test.mjs
grep -q 'preserves signer errors when failed quote persistence fails' backend/test/api-signer.test.mjs
grep -q 'rfq_signer_errors_total' backend/test/api-signer.test.mjs
grep -q 'unconfigured market data pairs before pricing and signing' backend/test/api-market-data.test.mjs
grep -q 'settlement constraints before simulated settlement' backend/test/api-submit-dependencies.test.mjs
grep -q 'settlementRejectionFailureCode' $gateway_sources
grep -q 'failed quote status persistence fails' backend/test/api-submit-dependencies.test.mjs
grep -q 'target_status="FAILED"' backend/test/api-submit-dependencies.test.mjs
grep -q 'settlement verifier failures' backend/test/api-submit-settlement-dependencies.test.mjs
grep -q 'SETTLEMENT_UNAVAILABLE' backend/test/api-submit-settlement-dependencies.test.mjs
grep -q 'SETTLEMENT_UNAVAILABLE' book/Volume5-BackendEngineering/Chapter06-Execution-Service.md
grep -q 'settlement event store failures' backend/test/api-status.test.mjs
grep -q 'settlement event write failures' backend/test/api-submit-settlement-dependencies.test.mjs
grep -q 'Settlement event store write failure' book/Volume5-BackendEngineering/Chapter06-Execution-Service.md
grep -q 'SETTLEMENT_EVENT_STORE_UNAVAILABLE' book/Volume5-BackendEngineering/Chapter06-Execution-Service.md
grep -q 'A signed quote may bind to only one canonical settlement event at a time' book/Volume5-BackendEngineering/Chapter06-Execution-Service.md
grep -q 'errorCode, "TOKEN_NOT_WHITELISTED"' backend/test/api-submit-dependencies.test.mjs
grep -q 'retry.body.code, "QUOTE_FAILED"' backend/test/api-submit-dependencies.test.mjs
grep -q 'LocalSettlementVerifier accepts contract-shaped settlement quotes' backend/test/settlement-verifier.test.mjs
grep -q 'LocalSettlementVerifier rejects malformed verification payload envelopes before settlement checks' backend/test/settlement-verifier-validation.test.mjs
grep -q 'LocalSettlementVerifier rejects malformed settlement quote fields before policy checks' backend/test/settlement-verifier-validation.test.mjs
grep -q 'q_bad_amount_leading_zero' backend/test/settlement-verifier-validation.test.mjs
grep -q 'q_invalid_signature_object' backend/test/settlement-verifier.test.mjs
grep -q 'Local settlement verifier quoteId must contain only letters, numbers, underscore, colon, or hyphen' backend/test/settlement-verifier-validation.test.mjs
grep -q 'Local settlement verifier quoteId must be a primitive string' backend/test/settlement-verifier-validation.test.mjs
grep -q 'Local settlement verifier quoteId must be 128 characters or fewer' backend/test/settlement-verifier-validation.test.mjs
grep -q 'Local settlement verifier settlementAddress must be a 20-byte hex address' backend/test/settlement-verifier-policy-validation.test.mjs
grep -q 'Local settlement verifier trustedSignerAddress must be a 20-byte hex address' backend/test/settlement-verifier-policy-validation.test.mjs
grep -q 'LocalSettlementVerifier rejects disabled settlement chains' backend/test/settlement-verifier.test.mjs
grep -q 'LocalSettlementVerifier rejects expired settlement quotes' backend/test/settlement-verifier.test.mjs
grep -q 'LocalSettlementVerifier rejects invalid settlement token pairs' backend/test/settlement-verifier.test.mjs
grep -q 'LocalSettlementVerifier rejects invalid settlement amounts' backend/test/settlement-verifier.test.mjs
grep -q 'LocalSettlementVerifier rejects settlement amountOut below minimum' backend/test/settlement-verifier.test.mjs
grep -q 'LocalSettlementVerifier rejects non-canonical settlement signatures' backend/test/settlement-verifier.test.mjs
grep -q 'LocalSettlementVerifier rejects signatures outside the trusted EIP-712 signer and settlement domain' backend/test/settlement-verifier.test.mjs
grep -q 'q_untrusted_signer' backend/test/settlement-verifier.test.mjs
grep -q 'q_wrong_settlement_domain' backend/test/settlement-verifier.test.mjs
grep -q 'LocalSettlementVerifier snapshots policy configuration at construction' backend/test/settlement-verifier.test.mjs
grep -q 'LocalSettlementVerifier rejects unsafe policy configuration at construction' backend/test/settlement-verifier-policy-validation.test.mjs
grep -q 'q_bad_nonce_leading_zero' backend/test/settlement-verifier-validation.test.mjs
! grep -q 'BigInt(quote.amountIn) <= 0n' backend/src/modules/settlement/settlement-verifier.service.ts
grep -Fq 'typeof token !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(token)' backend/src/modules/settlement/settlement-verifier.service.ts
grep -q 'new String(tokenIn)' backend/test/settlement-verifier-policy-validation.test.mjs
grep -q 'signature shape, canonical low-s/v checks' book/Volume5-BackendEngineering/Chapter06-Execution-Service.md
grep -q 'The settlement verifier always recovers the signature against that explicit signer identity' README.md
grep -q 'buildDefaultSettlementVerifierPolicy(signerRuntimeConfig, managedRiskPairs)' $gateway_sources
grep -q 'trustedSignerAddress: signerConfig.trustedSignerAddress' $gateway_sources
grep -q 'export function buildQuoteTypedData' backend/src/modules/signer/signer.service.ts
grep -q 'settlement verifier policy fail-fast' book/Volume5-BackendEngineering/Chapter06-Execution-Service.md
grep -q 'JavaScript regex coercion 进入 `/submit` 结算验证路径' book/Volume5-BackendEngineering/Chapter06-Execution-Service.md
grep -q 'amount fields and nonce must be own canonical positive uint strings without leading zeros' book/Volume5-BackendEngineering/Chapter06-Execution-Service.md
grep -q 'only converts `amountOut` and `minAmountOut` to BigInt for the minimum-output comparison' book/Volume5-BackendEngineering/Chapter06-Execution-Service.md
grep -q 'RISK_REJECTED' backend/test/api-risk.test.mjs
grep -q 'risk rejection when rejected quote persistence fails' backend/test/api-risk.test.mjs
grep -q 'Rejected quote persistence unavailable' book/Volume5-BackendEngineering/Chapter04-Risk-Service.md
grep -q 'SLIPPAGE_TOO_WIDE' backend/test/api-risk.test.mjs
grep -q 'stale market data' backend/test/api-market-data.test.mjs
grep -q 'market data timestamps too far in the future' backend/test/api-market-data.test.mjs
grep -q 'market data failures' backend/test/api-market-data.test.mjs
grep -q 'invalid market data before pricing and signing' backend/test/api-market-data.test.mjs
grep -q 'routing engine failures' backend/test/api-quote-dependencies.test.mjs
grep -q 'ROUTING_UNAVAILABLE' backend/test/api-quote-dependencies.test.mjs
grep -q 'ROUTING_UNAVAILABLE' book/Volume5-BackendEngineering/Chapter02-Quote-Service.md
grep -q 'quote store failures' backend/test/api-quote-dependencies.test.mjs
grep -q 'quote status store failures' backend/test/api-status.test.mjs
grep -q 'QUOTE_STORE_UNAVAILABLE' backend/test/api-status.test.mjs
grep -q 'QUOTE_STORE_UNAVAILABLE' book/Volume5-BackendEngineering/Chapter02-Quote-Service.md
grep -q 'Quote status store unavailable' book/Volume5-BackendEngineering/Chapter01-API-Gateway.md
grep -q 'pricing engine failures' backend/test/api-quote-dependencies.test.mjs
grep -q 'market data shape is invalid' backend/test/api-readiness.test.mjs
grep -q 'degrades readiness when market data is stale' backend/test/api-readiness.test.mjs
grep -q 'degrades readiness when market data timestamp is too far in the future' backend/test/api-readiness.test.mjs
grep -q 'degrades readiness when routing probe fails' backend/test/api-readiness.test.mjs
grep -q 'degrades readiness when pricing probe fails' backend/test/api-readiness.test.mjs
grep -q 'degrades readiness when risk probe fails' backend/test/api-readiness.test.mjs
grep -q 'degrades readiness when signer probe fails' backend/test/api-readiness.test.mjs
grep -q 'degrades readiness when storage dependency probes fail' backend/test/api-readiness-storage.test.mjs
grep -q 'Signer readiness probe failed' book/Volume5-BackendEngineering/Chapter01-API-Gateway.md
grep -q 'Routing, pricing or risk readiness probe failed' book/Volume5-BackendEngineering/Chapter01-API-Gateway.md
grep -q 'pricing.*组件变为.*degraded' book/Volume5-BackendEngineering/Chapter01-API-Gateway.md
grep -q 'risk.*组件变为.*degraded' book/Volume5-BackendEngineering/Chapter01-API-Gateway.md
grep -q 'nested probe payload required fields 在构造期 fail fast' book/Volume5-BackendEngineering/Chapter01-API-Gateway.md
grep -q 'rateLimitStore.*degraded' book/Volume5-BackendEngineering/Chapter01-API-Gateway.md
grep -q 'readiness signer degraded' book/Volume5-BackendEngineering/Chapter05-Signer-Service.md
grep -q 'toxic-flow users' backend/test/api-risk.test.mjs
grep -q 'TOXIC_FLOW_SCORE_EXCEEDED' backend/test/api-risk.test.mjs
grep -q 'TOKEN_IN_INVENTORY_LIMIT_EXCEEDED' backend/test/api-risk.test.mjs
grep -q 'trace ids' backend/test/api-validation-gateway.test.mjs
grep -q 'malformed JSON bodies' backend/test/api-validation-gateway.test.mjs
grep -q 'oversized JSON bodies' backend/test/api-validation-gateway.test.mjs
grep -q 'RFQ_BODY_LIMIT_BYTES' backend/test/api-gateway-env.test.mjs
grep -q 'CORS headers for allowed browser origins' backend/test/api-gateway-runtime.test.mjs
grep -q 'CORS preflight for allowed origins' backend/test/api-gateway-runtime.test.mjs
grep -q 'CORS preflight for disallowed origins' backend/test/api-gateway-runtime.test.mjs
grep -q 'RFQ_CORS_ALLOWED_ORIGINS' backend/test/api-gateway-env.test.mjs
grep -q 'normalizes RFQ_CORS_ALLOWED_ORIGINS at startup' backend/test/api-gateway-env.test.mjs
grep -q 'https://app.example.com?debug=true' backend/test/api-gateway-env.test.mjs
grep -q 'URL origins without path, query, fragment, credentials, or wildcards' $gateway_sources
grep -q 'security headers on successful responses' backend/test/api-gateway-runtime.test.mjs
grep -q 'emits HSTS when enabled' backend/test/api-gateway-runtime.test.mjs
grep -q 'RFQ_ENABLE_HSTS' backend/test/api-gateway-env.test.mjs
grep -q 'assertSecurityHeaders' backend/test/api-gateway-runtime.test.mjs
grep -q 'graceful shutdown handlers' backend/test/api-gateway-runtime.test.mjs
grep -q 'graceful shutdown failures' backend/test/api-gateway-runtime.test.mjs
grep -q 'unmatched routes to structured errors' backend/test/api-validation-gateway.test.mjs
grep -q 'settlement shape' backend/test/api-validation.test.mjs
grep -q 'expired submit quotes' backend/test/api-submit.test.mjs
grep -q 'quote.nonce must be a positive uint string' backend/test/submit-validation.test.mjs
grep -q 'Settlement event quote.nonce must be a positive uint string' backend/test/settlement-event-validation.test.mjs
grep -q 'unissued submit quotes' backend/test/api-submit.test.mjs
grep -q 'replayed submit quotes' backend/test/submit-concurrency.test.mjs
grep -q 'concurrent submit attempts for the same signed quote' backend/test/submit-concurrency.test.mjs
grep -q 'assert.equal(verifyCalls, 1)' backend/test/submit-concurrency.test.mjs
grep -q 'same millisecond' backend/test/api-quote-identity.test.mjs
grep -q 'rate limits quote requests by client' backend/test/api-rate-limit.test.mjs
grep -q 'rate limits submit requests before validation and settlement' backend/test/api-rate-limit.test.mjs
grep -q 'rate limits quote status requests by client' backend/test/api-rate-limit.test.mjs
grep -q 'rfq_rate_limited_total\\{endpoint="quote"\\} 1' backend/test/api-rate-limit.test.mjs
grep -q 'rfq_rate_limited_total\\{endpoint="submit"\\} 1' backend/test/api-rate-limit.test.mjs
grep -q 'rfq_rate_limited_total\\{endpoint="status"\\} 1' backend/test/api-rate-limit.test.mjs
grep -q 'PnL record creation fails' backend/test/api-pnl.test.mjs
grep -q 'malformed PnL store results as post-settlement PnL failures' backend/test/api-pnl.test.mjs
grep -q 'internalState: "unsafe"' backend/test/api-pnl.test.mjs
grep -q 'PnL summary store failures' backend/test/api-pnl.test.mjs
grep -q 'rfq_pnl_record_errors_total' book/Volume5-BackendEngineering/Chapter08-Metrics-Service.md
grep -q 'PnL attribution after settlement is best-effort' book/Volume5-BackendEngineering/Chapter06-Execution-Service.md
grep -q 'ReconciliationService.reconcileSettlementToQuote()' book/Volume5-BackendEngineering/Chapter06-Execution-Service.md
grep -q 'ReconciliationService.reconcileRemovedSettlementToQuote()' book/Volume5-BackendEngineering/Chapter06-Execution-Service.md
grep -q 'ReconciliationService.reconcileSettlementToHedge()' book/Volume5-BackendEngineering/Chapter06-Execution-Service.md
grep -q 'ReconciliationService.reconcileRemovedSettlementToHedge()' book/Volume5-BackendEngineering/Chapter06-Execution-Service.md
grep -q 'ReconciliationService.reconcileSettlementToPnl()' book/Volume5-BackendEngineering/Chapter06-Execution-Service.md
grep -q 'ReconciliationService.reconcileRemovedSettlementToPnl()' book/Volume5-BackendEngineering/Chapter06-Execution-Service.md
grep -q 'SettlementEventService.getSettlementEventsByQuoteHash' book/Volume5-BackendEngineering/Chapter06-Execution-Service.md
grep -q 'make reconciliation-check' book/Volume5-BackendEngineering/Chapter06-Execution-Service.md
grep -q 'PnL attribution input validation' book/Volume5-BackendEngineering/Chapter06-Execution-Service.md
grep -q 'quote-snapshot PnL' backend/test/pnl.test.mjs
grep -q 'applies each chain event idempotently' backend/test/settlement-event.test.mjs
grep -q 'InMemoryRateLimiter enforces endpoint-specific windows' backend/test/rate-limit.test.mjs
grep -q 'InMemoryRateLimiter snapshots configuration at construction' backend/test/rate-limit.test.mjs
grep -q 'InMemoryRateLimiter rejects unsafe configuration at construction' backend/test/rate-limit.test.mjs
grep -q 'assertRateLimitConfig(config)' backend/src/modules/rate-limit/rate-limit.service.ts
grep -q 'Rate limit config must be an object' backend/src/modules/rate-limit/rate-limit.service.ts
grep -q 'Rate limit config.windowMs must be an own field' backend/test/rate-limit.test.mjs
grep -q 'Rate limit input.endpoint must be an own field' backend/test/rate-limit.test.mjs
grep -q 'InMemoryRateLimiter rejects unsafe request inputs before writing buckets' backend/test/rate-limit.test.mjs
grep -q 'InMemoryRateLimiter rejects unsafe timestamps before writing buckets' backend/test/rate-limit.test.mjs
grep -q 'InMemoryRateLimiter evicts expired client buckets before checking' backend/test/rate-limit.test.mjs
grep -q '配置在构造期 snapshot' book/Volume5-BackendEngineering/Chapter01-API-Gateway.md
grep -q 'Malformed config、dependency、script result、runtime input' book/Volume5-BackendEngineering/Chapter01-API-Gateway.md
grep -q 'Redis error 不会 fail open' book/Volume5-BackendEngineering/Chapter01-API-Gateway.md
grep -q 'x-ratelimit-remaining' book/Volume5-BackendEngineering/Chapter01-API-Gateway.md
grep -q 'unsafe rate limit configuration at startup' backend/test/api-gateway.test.mjs
test -s backend/src/modules/pricing/price-normalization.ts
test -s backend/src/modules/pricing/token-registry.ts
test -s backend/test/api-token-registry-runtime.test.mjs
test -s backend/test/price-normalization.test.mjs
test -s backend/test/token-registry.test.mjs
test -s scripts/check-price-normalization-consistency.mjs
grep -q 'assertPositiveSafeInteger(config.volatilityDivisor, "volatilityDivisor")' backend/src/modules/pricing/pricing.engine.ts
grep -q 'assertBpsUpperBound(config.maxTotalAdjustmentBps, "maxTotalAdjustmentBps")' backend/src/modules/pricing/pricing.engine.ts
grep -q 'cloneFormulaPricingConfig' backend/src/modules/pricing/pricing.engine.ts
grep -q 'assertPricingInput(input)' backend/src/modules/pricing/pricing.engine.ts
grep -q 'assertObject(config, "config")' backend/src/modules/pricing/pricing.engine.ts
grep -q 'assertObject(input.request, "request")' backend/src/modules/pricing/pricing.engine.ts
grep -q 'assertObject(input.snapshot, "snapshot")' backend/src/modules/pricing/pricing.engine.ts
grep -q 'assertObject(input.routePlan, "routePlan")' backend/src/modules/pricing/pricing.engine.ts
grep -q 'formulaPricingConfigFields = \[' backend/src/modules/pricing/pricing.engine.ts
grep -q 'pricingInputFields = \["request", "snapshot", "routePlan", "inventorySkewBps", "hedgeCostBps"\]' backend/src/modules/pricing/pricing.engine.ts
grep -q 'quoteRequestFields = \["chainId", "user", "tokenIn", "tokenOut", "amountIn", "slippageBps"\]' backend/src/modules/pricing/pricing.engine.ts
grep -q 'pricingSnapshotFields = \["snapshotId", "midPrice", "liquidityUsd", "marketSpreadBps", "volatilityBps"\]' backend/src/modules/pricing/pricing.engine.ts
grep -q 'routePlanFields = \["routeId", "venue", "tokenIn", "tokenOut", "expectedLiquidityUsd"\]' backend/src/modules/pricing/pricing.engine.ts
grep -q 'assertOwnFields(config, formulaPricingConfigFields, "config")' backend/src/modules/pricing/pricing.engine.ts
grep -q 'assertOwnFields(input, pricingInputFields, "input")' backend/src/modules/pricing/pricing.engine.ts
grep -q 'assertOwnFields(input.request, quoteRequestFields, "request")' backend/src/modules/pricing/pricing.engine.ts
grep -q 'assertOwnFields(input.snapshot, pricingSnapshotFields, "snapshot")' backend/src/modules/pricing/pricing.engine.ts
grep -q 'assertOwnFields(input.routePlan, routePlanFields, "routePlan")' backend/src/modules/pricing/pricing.engine.ts
grep -q 'Formula pricing ${path}.${field} must be an own field' backend/src/modules/pricing/pricing.engine.ts
grep -q 'maxSafeIdentifierLength = 128' backend/src/modules/pricing/pricing.engine.ts
grep -Fq 'safeIdentifierPattern = /^[A-Za-z0-9_:-]+$/' backend/src/modules/pricing/pricing.engine.ts
grep -q 'assertSafeIdentifier(input.snapshot.snapshotId, "snapshot.snapshotId")' backend/src/modules/pricing/pricing.engine.ts
grep -q 'assertSafeIdentifier(input.routePlan.routeId, "routePlan.routeId")' backend/src/modules/pricing/pricing.engine.ts
grep -q 'Formula pricing ${field} must be a primitive string' backend/src/modules/pricing/pricing.engine.ts
grep -q 'routePlan token pair must match request token pair' backend/src/modules/pricing/pricing.engine.ts
grep -q 'maxSizeImpactBps must be less than or equal to maxTotalAdjustmentBps' backend/src/modules/pricing/pricing.engine.ts
grep -Fq 'typeof value !== "string" || !/^[1-9][0-9]*$/.test(value)' backend/src/modules/pricing/pricing.engine.ts
grep -q 'normalizeHumanPrice(input.snapshot.midPrice)' backend/src/modules/pricing/pricing.engine.ts
grep -Fq '!/^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(value)' backend/src/modules/pricing/price-normalization.ts
grep -q 'convertBaseUnitAmount(amountIn, midPrice, tokenIn.decimals, tokenOut.decimals)' backend/src/modules/pricing/pricing.engine.ts
grep -q 'calculateUsdNotional(amountIn, midPrice, tokenIn, tokenOut)' backend/src/modules/pricing/pricing.engine.ts
grep -q 'pricingVersion: `formula-v4:${input.routePlan.venue}`' backend/src/modules/pricing/pricing.engine.ts
grep -q 'RFQ_TOKEN_REGISTRY_JSON' $gateway_sources
grep -q 'decimals-aware readiness pricing probe' backend/test/api-token-registry-runtime.test.mjs
grep -q 'WETH 18 decimals to USDC 6 decimals' backend/test/price-normalization.test.mjs
grep -q 'FormulaPricingEngine snapshots pricing configuration at construction' backend/test/pricing.test.mjs
grep -q 'FormulaPricingEngine rejects unsafe pricing configuration at construction' backend/test/pricing-config-validation.test.mjs
grep -q 'FormulaPricingEngine rejects malformed pricing payload envelopes before quoting' backend/test/pricing-input-shape-validation.test.mjs
grep -q 'FormulaPricingEngine rejects inherited pricing input fields before quoting' backend/test/pricing-input-shape-validation.test.mjs
grep -q 'FormulaPricingEngine rejects unsafe pricing inputs before quoting' backend/test/pricing-validation.test.mjs
grep -q 'Object.create(defaultFormulaPricingConfig)' backend/test/pricing-config-validation.test.mjs
grep -q 'Formula pricing config.baseSpreadBps must be an own field' backend/test/pricing-config-validation.test.mjs
grep -q 'Formula pricing input.request must be an own field' backend/test/pricing-input-shape-validation.test.mjs
grep -q 'Formula pricing input.inventorySkewBps must be an own field' backend/test/pricing-input-shape-validation.test.mjs
grep -q 'Formula pricing input.hedgeCostBps must be an own field' backend/test/pricing-input-shape-validation.test.mjs
grep -q 'Formula pricing request.chainId must be an own field' backend/test/pricing-input-shape-validation.test.mjs
grep -q 'Formula pricing snapshot.snapshotId must be an own field' backend/test/pricing-input-shape-validation.test.mjs
grep -q 'Formula pricing routePlan.routeId must be an own field' backend/test/pricing-input-shape-validation.test.mjs
grep -q 'amountIn: "01000000000"' backend/test/pricing-validation.test.mjs
grep -q 'midPrice: "01.25"' backend/test/pricing-validation.test.mjs
grep -q 'liquidityUsd: "01000000000000"' backend/test/pricing-validation.test.mjs
grep -q 'expectedLiquidityUsd: "01000000000000"' backend/test/pricing-validation.test.mjs
grep -q 'Formula pricing snapshot.snapshotId must be a primitive string' backend/test/pricing-validation.test.mjs
grep -q 'Formula pricing snapshot.snapshotId must contain only letters, numbers, underscore, colon, or hyphen' backend/test/pricing-validation.test.mjs
grep -q 'Formula pricing routePlan.routeId must be a primitive string' backend/test/pricing-validation.test.mjs
grep -q 'Formula pricing routePlan.routeId must be 128 characters or fewer' backend/test/pricing-validation.test.mjs
grep -q 'missing required own top-level `request` / `snapshot` / `routePlan` / `inventorySkewBps` / `hedgeCostBps` fields fail before nested field access' book/Volume5-BackendEngineering/Chapter03-Pricing-Service.md
grep -q 'request, snapshot and route-plan required fields must be own fields' book/Volume5-BackendEngineering/Chapter03-Pricing-Service.md
grep -q '`snapshot.snapshotId` and `routePlan.routeId` as primitive-string `SafeIdentifier` values with 1-128 characters' book/Volume5-BackendEngineering/Chapter03-Pricing-Service.md
grep -q 'malformed route plan 时，Quote Service 应在调用 Pricing Service 前返回 `ROUTING_UNAVAILABLE`' book/Volume5-BackendEngineering/Chapter03-Pricing-Service.md
grep -q 'canonical decimal form without leading zeros' book/Volume5-BackendEngineering/Chapter03-Pricing-Service.md
grep -q 'Snapshot mid price must be a canonical positive decimal string without leading zeros' book/Volume5-BackendEngineering/Chapter03-Pricing-Service.md
grep -q 'rejects malformed pricing config objects and inherited config fields before reading numeric fields' book/Volume5-BackendEngineering/Chapter03-Pricing-Service.md
grep -q 'snapshots `FormulaPricingConfig` at construction after validation' book/Volume5-BackendEngineering/Chapter03-Pricing-Service.md
grep -q '先拒绝 malformed pricing config object' book/Volume2-MarketData-And-Pricing/Chapter07-Pricing-Formula.md
grep -q '`FormulaPricingConfig` 的 required fields 都是 own fields' book/Volume2-MarketData-And-Pricing/Chapter07-Pricing-Formula.md
grep -q '顶层 `request`、`snapshot`、`routePlan`、`inventorySkewBps`、`hedgeCostBps` 必须是 own fields' book/Volume2-MarketData-And-Pricing/Chapter07-Pricing-Formula.md
grep -q '嵌套 request、snapshot 和 routePlan 的 required fields 也必须是 own fields' book/Volume2-MarketData-And-Pricing/Chapter07-Pricing-Formula.md
grep -q '`snapshot.snapshotId` 和 `routePlan.routeId`，都必须是 primitive string 形态的 1-128 字符 `SafeIdentifier`' book/Volume2-MarketData-And-Pricing/Chapter07-Pricing-Formula.md
grep -q '`midPrice`、`amountIn`、market liquidity 和 route liquidity 必须使用 canonical decimal form without leading zeros' book/Volume2-MarketData-And-Pricing/Chapter07-Pricing-Formula.md
grep -q 'pricing config fail-fast' book/Volume2-MarketData-And-Pricing/Chapter07-Pricing-Formula.md
grep -q 'restricted toxic-flow users' backend/test/risk.test.mjs
grep -q 'toxic-flow score threshold' backend/test/risk.test.mjs
grep -q 'quoted spreads above policy limit' backend/test/risk.test.mjs
grep -q 'assertObject(policy, "policy")' backend/src/modules/risk/risk.engine.ts
grep -q 'assertArray(chainIds, "enabledChainIds")' backend/src/modules/risk/risk.engine.ts
grep -q 'assertObject(input.request, "request")' backend/src/modules/risk/risk.engine.ts
grep -q 'assertObject(input.pricing, "pricing")' backend/src/modules/risk/risk.engine.ts
grep -q 'assertObject(input.inventoryProjection, "inventoryProjection")' backend/src/modules/risk/risk.engine.ts
grep -q 'basicRiskPolicyFields = \[' backend/src/modules/risk/risk.engine.ts
grep -q 'toxicFlowScoreFields = \["user", "scoreBps"\]' backend/src/modules/risk/risk.engine.ts
grep -q 'riskInputFields = \["request", "pricing", "snapshot"\]' backend/src/modules/risk/risk.engine.ts
grep -q 'riskInputOptionalFields = \["inventoryProjection"\]' backend/src/modules/risk/risk.engine.ts
grep -q 'quoteRequestFields = \["chainId", "user", "tokenIn", "tokenOut", "amountIn", "slippageBps"\]' backend/src/modules/risk/risk.engine.ts
grep -q 'pricingResultFields = \[' backend/src/modules/risk/risk.engine.ts
grep -q 'inventoryProjectionFields = \["tokenIn", "tokenOut"\]' backend/src/modules/risk/risk.engine.ts
grep -q 'inventoryPositionFields = \["chainId", "token", "balance"\]' backend/src/modules/risk/risk.engine.ts
grep -q 'assertOwnFields(policy, basicRiskPolicyFields, "policy")' backend/src/modules/risk/risk.engine.ts
grep -q 'assertOwnFields(score, toxicFlowScoreFields, "toxicFlowScores entry")' backend/src/modules/risk/risk.engine.ts
grep -q 'assertOwnFields(input, riskInputFields, "input")' backend/src/modules/risk/risk.engine.ts
grep -q 'assertOwnOptionalFields(input, riskInputOptionalFields, "input")' backend/src/modules/risk/risk.engine.ts
grep -q 'assertOwnFields(input.request, quoteRequestFields, "request")' backend/src/modules/risk/risk.engine.ts
grep -q 'assertOwnFields(input.pricing, pricingResultFields, "pricing")' backend/src/modules/risk/risk.engine.ts
grep -q 'assertOwnFields(input.inventoryProjection, inventoryProjectionFields, "inventoryProjection")' backend/src/modules/risk/risk.engine.ts
grep -q 'assertOwnFields(position, inventoryPositionFields, `inventoryProjection.${field}`)' backend/src/modules/risk/risk.engine.ts
grep -q 'Basic risk ${path}.${field} must be an own field' backend/src/modules/risk/risk.engine.ts
grep -q 'Basic risk ${path}.${field} must be an own field when provided' backend/src/modules/risk/risk.engine.ts
grep -q 'BasicRiskEngine rejects unsafe policy configuration at construction' backend/test/risk-validation.test.mjs
grep -q 'BasicRiskEngine rejects malformed runtime payload envelopes before policy evaluation' backend/test/risk-runtime-validation.test.mjs
grep -q 'BasicRiskEngine rejects inherited runtime input fields before policy evaluation' backend/test/risk-runtime-validation.test.mjs
grep -q 'BasicRiskEngine rejects unsafe runtime inputs before policy evaluation' backend/test/risk-runtime-validation.test.mjs
grep -q 'Basic risk policy.policyVersion must be an own field' backend/test/risk-validation.test.mjs
grep -q 'Basic risk toxicFlowScores entry.user must be an own field' backend/test/risk-validation.test.mjs
grep -q 'Basic risk input.request must be an own field' backend/test/risk-runtime-validation.test.mjs
grep -q 'Basic risk input.pricing must be an own field' backend/test/risk-runtime-validation.test.mjs
grep -q 'Basic risk input.inventoryProjection must be an own field when provided' backend/test/risk-runtime-validation.test.mjs
grep -q 'Basic risk request.chainId must be an own field' backend/test/risk-runtime-validation.test.mjs
grep -q 'Basic risk pricing.amountOut must be an own field' backend/test/risk-runtime-validation.test.mjs
grep -q 'Basic risk inventoryProjection.tokenIn must be an own field' backend/test/risk-runtime-validation.test.mjs
grep -q 'Basic risk inventoryProjection.tokenIn.chainId must be an own field' backend/test/risk-runtime-validation.test.mjs
grep -q 'malformed policy object、inherited policy fields、policy array fields、toxic-flow score entries and inherited score fields must be rejected before field access' book/Volume5-BackendEngineering/Chapter04-Risk-Service.md
grep -q 'missing required own top-level `request` / `pricing` fields' book/Volume5-BackendEngineering/Chapter04-Risk-Service.md
grep -q 'inherited optional `inventoryProjection`' book/Volume5-BackendEngineering/Chapter04-Risk-Service.md
grep -q 'missing required own projection / position fields fail before nested field access' book/Volume5-BackendEngineering/Chapter04-Risk-Service.md
grep -q 'canonical decimal form without leading zeros' book/Volume5-BackendEngineering/Chapter04-Risk-Service.md
grep -q 'JavaScript regex coercion' book/Volume5-BackendEngineering/Chapter04-Risk-Service.md
grep -q '`BasicRiskPolicy` 在构造期 fail fast' book/Volume5-BackendEngineering/Chapter04-Risk-Service.md
grep -q 'snapshots `BasicRiskPolicy` at construction after validation' book/Volume5-BackendEngineering/Chapter04-Risk-Service.md
grep -q 'pricing spread exceeds risk guard before signing' backend/test/api-risk.test.mjs
grep -q 'QUOTED_SPREAD_TOO_WIDE' book/Volume5-BackendEngineering/Chapter04-Risk-Service.md
grep -q 'maxQuotedSpreadBps' book/Volume3-RiskEngine/Chapter05-Position-Limits.md
grep -q 'rfq_quote_requests_total' infra/prometheus/rules/rfq-alerts.yml
grep -q 'RFQQuoteResponsesStalled' infra/prometheus/rules/rfq-alerts.yml
grep -q 'rfq_quote_responses_total' book/Volume7-ProductionDeployment/Chapter05-Runbook.md
grep -q 'RFQQuoteLatencyP95High' infra/prometheus/rules/rfq-alerts.yml
grep -q 'RFQQuoteRiskRejectSpike' infra/prometheus/rules/rfq-alerts.yml
grep -q 'RFQTreasuryLiquidityInsufficient' infra/prometheus/rules/rfq-alerts.yml
grep -q 'RFQPortfolioVarLimitExceeded' infra/prometheus/rules/rfq-alerts.yml
grep -q 'RFQRiskDependencyUnavailable' infra/prometheus/rules/rfq-alerts.yml
grep -q 'TREASURY_LIQUIDITY_INSUFFICIENT' book/Volume7-ProductionDeployment/Chapter05-Runbook.md
grep -q 'RFQSignerErrors' infra/prometheus/rules/rfq-alerts.yml
grep -q 'RFQSignerSignThroughputStalled' infra/prometheus/rules/rfq-alerts.yml
grep -q 'rfq_signer_requests_total' book/Volume7-ProductionDeployment/Chapter05-Runbook.md
grep -q 'RFQSignerLatencyP95High' infra/prometheus/rules/rfq-alerts.yml
grep -q 'RFQHedgeIntentErrors' infra/prometheus/rules/rfq-alerts.yml
grep -q 'rfq_hedge_intent_errors_total' infra/prometheus/rules/rfq-alerts.yml
grep -q 'RFQHedgeIntentThroughputStalled' infra/prometheus/rules/rfq-alerts.yml
grep -q 'rfq_hedge_intents_total' book/Volume7-ProductionDeployment/Chapter05-Runbook.md
grep -q 'RFQSettlementThroughputStalled' infra/prometheus/rules/rfq-alerts.yml
grep -q 'rfq_settlements_total' book/Volume7-ProductionDeployment/Chapter05-Runbook.md
grep -q 'RFQHedgeLagHigh' infra/prometheus/rules/rfq-alerts.yml
grep -q 'rfq_hedge_lag_seconds_bucket' infra/prometheus/rules/rfq-alerts.yml
grep -q 'RFQHedgeLagHigh' book/Volume7-ProductionDeployment/Chapter05-Runbook.md
grep -q 'RFQQuoteStatusUpdateErrors' infra/prometheus/rules/rfq-alerts.yml
grep -q 'rfq_quote_status_update_errors_total' infra/prometheus/rules/rfq-alerts.yml
grep -q 'RFQPnlRecordErrors' infra/prometheus/rules/rfq-alerts.yml
grep -q 'rfq_pnl_record_errors_total' infra/prometheus/rules/rfq-alerts.yml
grep -q 'RFQPnlThroughputStalled' infra/prometheus/rules/rfq-alerts.yml
grep -q 'rfq_pnl_trades_total' book/Volume7-ProductionDeployment/Chapter05-Runbook.md
grep -q 'RFQRealizedPnlNegative' infra/prometheus/rules/rfq-alerts.yml
grep -q 'rfq_realized_pnl_token_out' book/Volume7-ProductionDeployment/Chapter05-Runbook.md
grep -q 'uid: prometheus' infra/grafana/provisioning/datasources/prometheus.yml
grep -q '"uid": "prometheus"' infra/grafana/provisioning/dashboards/rfq-overview.json
grep -q 'rfq_settlements_total' infra/grafana/provisioning/dashboards/rfq-overview.json
grep -q 'rfq_hedge_intent_errors_total' infra/grafana/provisioning/dashboards/rfq-overview.json
grep -q 'rfq_hedge_lag_seconds_bucket' infra/grafana/provisioning/dashboards/rfq-overview.json
grep -q 'rfq_quote_status_update_errors_total' infra/grafana/provisioning/dashboards/rfq-overview.json
grep -q 'rfq_pnl_record_errors_total' infra/grafana/provisioning/dashboards/rfq-overview.json
grep -q 'rfq_inventory_balance' infra/grafana/provisioning/dashboards/rfq-overview.json
grep -q 'rfq_realized_pnl_token_out' infra/grafana/provisioning/dashboards/rfq-overview.json
grep -q 'rfq_pnl_trades_total' infra/grafana/provisioning/dashboards/rfq-overview.json
grep -q 'Post-Settlement Persistence Drift' book/Volume7-ProductionDeployment/Chapter05-Runbook.md
grep -q 'settlement-to-quote reconciliation' book/Volume7-ProductionDeployment/Chapter05-Runbook.md
grep -q 'ReconciliationService.reconcileSettlementToQuote()' book/Volume7-ProductionDeployment/Chapter05-Runbook.md
grep -q 'ReconciliationService.reconcileSettlementToHedge()' book/Volume7-ProductionDeployment/Chapter05-Runbook.md
grep -q 'settlement-to-PnL reconciliation' book/Volume7-ProductionDeployment/Chapter05-Runbook.md
grep -q 'ReconciliationService.reconcileSettlementToPnl()' book/Volume7-ProductionDeployment/Chapter05-Runbook.md
grep -q 'ReconciliationService.reconcileRemovedSettlementToQuote()' book/Volume7-ProductionDeployment/Chapter05-Runbook.md
grep -q 'ReconciliationService.reconcileRemovedSettlementToHedge()' book/Volume7-ProductionDeployment/Chapter05-Runbook.md
grep -q 'ReconciliationService.reconcileRemovedSettlementToPnl()' book/Volume7-ProductionDeployment/Chapter05-Runbook.md
grep -q '{ chainId, quoteHash }' book/Volume7-ProductionDeployment/Chapter05-Runbook.md
grep -q 'make reconciliation-check' book/Volume7-ProductionDeployment/Chapter05-Runbook.md
grep -q 'reconciliation-check: backend-build' Makefile
grep -q 'scripts/reconciliation-check.mjs' Makefile
grep -q 'run_step make reconciliation-check' scripts/verify.sh
grep -q 'reconciliation:check' package.json
test -s scripts/cex-orderbook-integration-check.mjs
grep -q 'cex-orderbook-integration-check: backend-build' Makefile
grep -q 'cex-orderbook-check:' Makefile
grep -q 'run_step make cex-orderbook-check' scripts/verify.sh
grep -q 'scripts/check-cex-orderbook-consistency.mjs' Makefile
grep -q 'cex:orderbook:integration:check' package.json
grep -q 'RFQ_CEX_INTEGRATION_CONFIRM=yes' scripts/cex-orderbook-integration-check.mjs
grep -q 'getLastUpdateAtMs' scripts/cex-orderbook-integration-check.mjs
grep -q 'reconcileSettlementToQuote' scripts/reconciliation-check.mjs
grep -q 'reconcileSettlementToHedge' scripts/reconciliation-check.mjs
grep -q 'reconcileSettlementToPnl' scripts/reconciliation-check.mjs
grep -q '"11".repeat(64)}1b' scripts/reconciliation-check.mjs
grep -q 'quoteRetryReport' scripts/reconciliation-check.mjs
grep -q 'hedgeRetryReport' scripts/reconciliation-check.mjs
grep -q 'pnlRetryReport' scripts/reconciliation-check.mjs
grep -q 'quoteHashQuoteRetryReport' scripts/reconciliation-check.mjs
grep -q 'unmatchedQuoteHashReport' scripts/reconciliation-check.mjs
grep -q 'removedQuoteReport' scripts/reconciliation-check.mjs
grep -q 'removedQuoteRetryReport' scripts/reconciliation-check.mjs
grep -q 'removedHedgeReport' scripts/reconciliation-check.mjs
grep -q 'removedPnlReport' scripts/reconciliation-check.mjs
grep -q 'removedHedgeRetryReport' scripts/reconciliation-check.mjs
grep -q 'removedPnlRetryReport' scripts/reconciliation-check.mjs
grep -q 'rfq-backend-secrets' book/Volume7-ProductionDeployment/Chapter02-Kubernetes.md
grep -q 'Missing or malformed signer Secret' book/Volume7-ProductionDeployment/Chapter02-Kubernetes.md
grep -q 'asymmetric `ECC_SECG_P256K1` key' book/Volume7-ProductionDeployment/Chapter02-Kubernetes.md
grep -q '`RFQ_SIGNER_MODE=remote`' book/Volume7-ProductionDeployment/Chapter02-Kubernetes.md
grep -q 'kind: Deployment' infra/k8s/backend-deployment.yaml
grep -q 'path: /ready' infra/k8s/backend-deployment.yaml
grep -q 'secretKeyRef' infra/k8s/backend-deployment.yaml
grep -q 'rfq-backend-secrets' infra/k8s/backend-deployment.yaml
grep -q 'kind: Secret' infra/k8s/backend-secret.yaml
grep -q 'RFQ_SIGNER_SERVICE_TOKEN' infra/k8s/backend-secret.yaml
! grep -q 'RFQ_AWS_KMS_KEY_ID' infra/k8s/backend-secret.yaml
grep -q 'RFQ_AWS_KMS_KEY_ID' infra/k8s/signer-secret.yaml
grep -q 'RFQ_TRUSTED_SIGNER_ADDRESS' infra/k8s/backend-secret.yaml
! grep -q 'RFQ_SIGNER_PRIVATE_KEY' infra/k8s/backend-secret.yaml
grep -q 'RFQ_SETTLEMENT_ADDRESS' infra/k8s/backend-secret.yaml
grep -q 'serviceAccountName: rfq-backend' infra/k8s/backend-deployment.yaml
grep -q 'serviceAccountName: rfq-signer-kms' infra/k8s/signer-deployment.yaml
grep -q 'kind: ServiceAccount' infra/k8s/backend-service-account.yaml
! grep -q 'eks.amazonaws.com/role-arn' infra/k8s/backend-service-account.yaml
grep -q 'eks.amazonaws.com/role-arn' infra/k8s/signer-service-account.yaml
grep -q 'RFQ_QUOTE_TTL_SECONDS' infra/k8s/configmap.yaml
grep -q 'RFQ_BODY_LIMIT_BYTES' infra/k8s/configmap.yaml
grep -q 'RFQ_CORS_ALLOWED_ORIGINS' infra/k8s/configmap.yaml
grep -q 'RFQ_ENABLE_HSTS' infra/k8s/configmap.yaml
grep -q 'terminationGracePeriodSeconds: 30' infra/k8s/backend-deployment.yaml
grep -q 'preStop' infra/k8s/backend-deployment.yaml
grep -q 'HOST: "0.0.0.0"' infra/k8s/configmap.yaml
grep -q 'prometheus.io/scrape' infra/k8s/backend-service.yaml
grep -q 'prometheus.io/path' infra/k8s/backend-service.yaml
grep -q '/metrics' infra/k8s/backend-service.yaml
grep -q 'path: /ready' infra/helm/rfq-market-maker/templates/deployment.yaml
grep -q 'secretKeyRef' infra/helm/rfq-market-maker/templates/deployment.yaml
! grep -q 'RFQ_AWS_KMS_KEY_ID' infra/helm/rfq-market-maker/templates/deployment.yaml
grep -q 'RFQ_AWS_KMS_KEY_ID' infra/helm/rfq-market-maker/templates/signer-deployment.yaml
grep -q 'RFQ_TRUSTED_SIGNER_ADDRESS' infra/helm/rfq-market-maker/templates/deployment.yaml
! grep -q 'RFQ_SIGNER_PRIVATE_KEY' infra/helm/rfq-market-maker/templates/deployment.yaml
grep -q 'RFQ_SETTLEMENT_ADDRESS' infra/helm/rfq-market-maker/templates/deployment.yaml
grep -q 'serviceAccountName: {{ .Values.serviceAccount.name }}' infra/helm/rfq-market-maker/templates/deployment.yaml
grep -q 'kind: ServiceAccount' infra/helm/rfq-market-maker/templates/service-account.yaml
grep -q 'RFQ_QUOTE_TTL_SECONDS' infra/helm/rfq-market-maker/values.yaml
grep -q 'RFQ_BODY_LIMIT_BYTES' infra/helm/rfq-market-maker/values.yaml
grep -q 'RFQ_CORS_ALLOWED_ORIGINS' infra/helm/rfq-market-maker/values.yaml
grep -q 'RFQ_ENABLE_HSTS' infra/helm/rfq-market-maker/values.yaml
grep -q 'terminationGracePeriodSeconds' infra/helm/rfq-market-maker/values.yaml
grep -q 'preStopSleepSeconds' infra/helm/rfq-market-maker/values.yaml
grep -q 'preStop' infra/helm/rfq-market-maker/templates/deployment.yaml
grep -q 'terminationGracePeriodSeconds' infra/helm/rfq-market-maker/templates/deployment.yaml
grep -q 'HOST: "0.0.0.0"' infra/helm/rfq-market-maker/values.yaml
grep -q 'signerSecret' infra/helm/rfq-market-maker/values.yaml
grep -q 'rfq-backend-secrets' infra/helm/rfq-market-maker/values.yaml
grep -q 'baseline browser security headers' docs/security/audit-checklist.md
grep -q 'CORS origin allowlist' docs/security/audit-checklist.md
grep -q 'audit checklist must mark implemented baseline controls' scripts/check-security-docs-consistency.mjs
grep -q 'audit checklist must mark implemented control' scripts/check-security-docs-consistency.mjs
grep -q 'runbook FQDN egress procedure must include' scripts/check-security-docs-consistency.mjs
grep -Fq -- '- [x] EIP-712 domain includes name, version, chainId and verifyingContract.' docs/security/audit-checklist.md
grep -Fq -- '- [x] `submitQuote` rejects expired quotes.' docs/security/audit-checklist.md
grep -Fq -- '- [x] Risk Engine runs before Signer Service.' docs/security/audit-checklist.md
grep -Fq -- '- [x] CEX reference sources validate price without inflating executable liquidity; every published pair retains an accepted Binance hedge source bound to the API and worker shared route table.' docs/security/audit-checklist.md
grep -Fq -- '- [x] Settlement events use `(chainId, txHash, logIndex)` idempotency.' docs/security/audit-checklist.md
grep -Fq -- '- [x] Indexer handles chain reorgs.' docs/security/audit-checklist.md
grep -Fq -- '- [x] Inventory updates are replayable.' docs/security/audit-checklist.md
grep -Fq -- '- [x] Sensitive thresholds are not exposed to users.' docs/security/audit-checklist.md
grep -Fq -- '- [x] ClickHouse analytics do not become operational source of truth.' docs/security/audit-checklist.md
grep -Fq -- '- [x] Signer key rotation is documented.' docs/security/audit-checklist.md
grep -Fq -- '- [x] Emergency pause procedure is documented.' docs/security/audit-checklist.md
grep -Fq -- '- [x] `submitQuote` uses SafeERC20 for transfers.' docs/security/audit-checklist.md
grep -Fq -- '- [x] `submitQuote` verifies exact user/Treasury balance deltas and rejects fee-on-transfer or rebasing settlement drift.' docs/security/audit-checklist.md
grep -Fq -- '- [x] AccessControl protects signer and token whitelist updates.' docs/security/audit-checklist.md
grep -Fq -- '- [x] Treasury, Settlement and newly whitelisted token configuration rejects EOAs, and Treasury rotation requires the candidate Treasury to point back to the active Settlement.' docs/security/audit-checklist.md
grep -Fq -- '- [x] DEFAULT_ADMIN_ROLE cannot be orphaned by revoking the last admin.' docs/security/audit-checklist.md
grep -Fq -- '- [x] A Settlement owner without DEFAULT_ADMIN_ROLE cannot transfer ownership to restore administrative roles.' docs/security/audit-checklist.md
grep -q 'SettlementEventService.removeSettlementEvent()' book/Volume5-BackendEngineering/Chapter06-Execution-Service.md
grep -q 'allow the worker to find the common ancestor' book/Volume7-ProductionDeployment/Chapter05-Runbook.md
grep -q '固定使用 OpenZeppelin Contracts `5.6.1`' book/Volume4-SmartContracts/Chapter02-RFQSettlement.md
grep -q 'user debit == treasury credit == amountIn' book/Volume4-SmartContracts/Chapter02-RFQSettlement.md
grep -q 'Non-standard ERC20 settlement drift' docs/security/threat-model.md
grep -q 'SIGNER_ADMIN_ROLE' book/Volume4-SmartContracts/Chapter02-RFQSettlement.md
grep -q 'TOKEN_ADMIN_ROLE' book/Volume4-SmartContracts/Chapter02-RFQSettlement.md
grep -q 'includes focused fuzz tests for bounded valid settlement amounts' book/Volume4-SmartContracts/Chapter06-Testing.md
grep -q 'rejection fuzz paths assert `AmountOutBelowMinimum` and `QuoteExpired` leave nonce and balances unchanged' book/Volume4-SmartContracts/Chapter06-Testing.md
grep -q 'testSubmitQuoteAcceptsNoReturnERC20Transfers' contracts/test/RFQSettlement.t.sol
grep -q 'testSubmitQuoteRejectsFalseReturnTokenInBeforeConsumingNonce' contracts/test/RFQSettlement.t.sol
grep -q 'testSubmitQuoteRejectsFalseReturnTokenOutAndRollsBackTokenIn' contracts/test/RFQSettlement.t.sol
grep -q 'testSubmitQuoteRejectsFeeOnTransferTokenInAndRollsBack' contracts/test/RFQSettlement.t.sol
grep -q 'testSubmitQuoteRejectsFeeOnTransferTokenOutAndRollsBack' contracts/test/RFQSettlement.t.sol
grep -q 'testAccessControlSeparatesSignerAndTokenWhitelistRoles' contracts/test/RFQSettlement.t.sol
grep -q 'testAccessControlRevocationRemovesAdminCapability' contracts/test/RFQSettlement.t.sol
grep -q 'testCannotRevokeLastDefaultAdminRole' contracts/test/RFQSettlement.t.sol
grep -q 'testDefaultAdminCanBeRevokedAfterGrantingReplacement' contracts/test/RFQSettlement.t.sol
grep -q 'DEFAULT_ADMIN_ROLE` 使用成员计数防止最后一个默认管理员被撤销' book/Volume4-SmartContracts/Chapter02-RFQSettlement.md
grep -q 'run the normal quote-path canary in staging' docs/security/key-management.md
grep -q 'RFQSettlement.setTrustedSignerAuthorization(oldSigner, false)' docs/security/key-management.md
grep -q 'Emergency Pause Procedure' book/Volume7-ProductionDeployment/Chapter05-Runbook.md
grep -q 'RFQSettlement.setPaused(true)' book/Volume7-ProductionDeployment/Chapter05-Runbook.md
grep -q 'negative submit canary' book/Volume7-ProductionDeployment/Chapter05-Runbook.md
grep -q 'two-person approval' book/Volume7-ProductionDeployment/Chapter05-Runbook.md
grep -q 'OpenAPI trading contract must not expose sensitive risk field' scripts/check-security-docs-consistency.mjs
grep -q 'Public API responses must not expose internal risk thresholds' book/Volume5-BackendEngineering/Chapter04-Risk-Service.md
grep -q 'policyVersion or internal reasonCode values' book/Volume5-BackendEngineering/Chapter04-Risk-Service.md
grep -q 'approved decision 的 `reasonCode` 为 NULL' book/Volume5-BackendEngineering/Chapter04-Risk-Service.md
grep -q 'PostgreSQL `risk_decisions.reason_code` CHECK constraint 必须匹配后端 `RiskRejectReasonCode` union' book/Volume5-BackendEngineering/Chapter04-Risk-Service.md
grep -q 'pricing adjustment breakdown' book/Volume5-BackendEngineering/Chapter01-API-Gateway.md
grep -q 'ClickHouse is an analytics replica only' book/Volume5-BackendEngineering/Chapter08-Metrics-Service.md
grep -q 'never from ClickHouse query results' book/Volume5-BackendEngineering/Chapter08-Metrics-Service.md
grep -q 'must never be used as the operational source of truth' book/Volume7-ProductionDeployment/Chapter03-Monitoring.md
grep -q 'storage ADR must keep ClickHouse analytical-only boundary' scripts/check-security-docs-consistency.mjs
grep -q 'Pod Termination Or Rollout Drain' book/Volume7-ProductionDeployment/Chapter05-Runbook.md
grep -q 'Fastify close' book/Volume7-ProductionDeployment/Chapter05-Runbook.md
grep -q 'terminationGracePeriodSeconds=30' book/Volume7-ProductionDeployment/Chapter02-Kubernetes.md
grep -q 'preStop' book/Volume7-ProductionDeployment/Chapter02-Kubernetes.md
grep -q 'RFQ_SHUTDOWN_TIMEOUT_MS=20000' book/Volume7-ProductionDeployment/Chapter02-Kubernetes.md
grep -q 'PROCESS_SHUTDOWN_TIMEOUT' book/Volume7-ProductionDeployment/Chapter05-Runbook.md
test -s docs/adr/ADR-0014-Use-Bounded-Graceful-Shutdown.md
grep -q 'installBoundedShutdown' backend/src/runtime/process-shutdown.ts
grep -q 'RFQ_SHUTDOWN_TIMEOUT_MS' backend/test/process-shutdown.test.mjs
grep -q 'service.annotations' infra/helm/rfq-market-maker/templates/service.yaml
grep -q 'prometheus.io/scrape' infra/helm/rfq-market-maker/values.yaml
grep -q 'prometheus.io/path' infra/helm/rfq-market-maker/values.yaml
grep -q 'name: rfq-market-maker' infra/helm/rfq-market-maker/Chart.yaml
grep -q '/docker-entrypoint-initdb.d/001-schema.sql' book/Volume7-ProductionDeployment/Chapter01-Docker.md
grep -q 'Redis uses `redis-cli ping`' book/Volume7-ProductionDeployment/Chapter01-Docker.md
grep -q 'recovers the `/quote` EIP-712 signer from the returned signature before submit' book/Volume7-ProductionDeployment/Chapter01-Docker.md

test -s backend/src/settlement-indexer-main.ts
test -s backend/src/db/migrations/007-settlement-indexer.sql
test -s backend/src/modules/indexer/settlement-indexer.reader.ts
test -s backend/src/modules/indexer/settlement-indexer.store.ts
test -s backend/src/modules/indexer/postgres-settlement-indexer.store.ts
test -s backend/src/modules/indexer/settlement-indexer.worker.ts
test -s backend/src/modules/indexer/settlement-indexer.metrics.ts
test -s backend/test/settlement-indexer-reader.test.mjs
test -s backend/test/settlement-indexer-runtime.test.mjs
test -s backend/test/settlement-indexer-metrics.test.mjs
test -s backend/test/postgres-settlement-indexer-store.test.mjs
test -s backend/test/settlement-indexer.test.mjs
test -s docs/adr/ADR-0006-Use-Independent-Settlement-Indexer.md
test -s scripts/check-settlement-indexer-consistency.mjs
test -s infra/k8s/settlement-indexer-deployment.yaml
test -s infra/k8s/settlement-indexer-service.yaml
test -s infra/k8s/settlement-indexer-secret.yaml
test -s infra/k8s/settlement-indexer-network-policy.yaml
test -s infra/helm/rfq-market-maker/templates/settlement-indexer-deployment.yaml
test -s infra/helm/rfq-market-maker/templates/settlement-indexer-service.yaml
test -s infra/helm/rfq-market-maker/templates/settlement-indexer-network-policy.yaml
grep -q 'CREATE TABLE settlement_indexer_cursors' backend/src/db/migrations/007-settlement-indexer.sql
grep -q 'CREATE TABLE settlement_indexer_checkpoints' backend/src/db/migrations/007-settlement-indexer.sql
grep -q 'findSignedQuoteByChainUserNonce' backend/src/modules/indexer/settlement-indexer.worker.ts
grep -q 'removeOrphanedUncheckpointedEvents' backend/src/modules/indexer/settlement-indexer.worker.ts
grep -q 'SettlementIndexerError("DEEP_REORG")' backend/src/modules/indexer/settlement-indexer.worker.ts
grep -q 'revision = \$4' backend/src/modules/indexer/postgres-settlement-indexer.store.ts
grep -q 'next_block = \$5' backend/src/modules/indexer/postgres-settlement-indexer.store.ts
grep -q 'rfq_settlement_indexer_lag_blocks' backend/src/modules/indexer/settlement-indexer.metrics.ts
grep -q 'RFQSettlementIndexerDeepReorg' infra/prometheus/rules/rfq-alerts.yml
grep -q 'job_name: rfq-settlement-indexer' infra/prometheus/prometheus.yml
grep -q 'backend/dist/settlement-indexer-main.js' infra/k8s/settlement-indexer-deployment.yaml
grep -q 'RFQ_SETTLEMENT_INDEXER_CONFIG_JSON' infra/k8s/settlement-indexer-secret.yaml
! grep -q 'RFQ_AWS_KMS_KEY_ID' infra/k8s/settlement-indexer-secret.yaml
grep -q 'settlementIndexer:' infra/helm/rfq-market-maker/values.yaml
grep -q 'make settlement-indexer-check' .github/workflows/docs-ci.yml

test -s scripts/check-hedge-execution-consistency.mjs
grep -q 'quantizeHedgeAmount' backend/src/modules/hedge/hedge-route.ts
grep -q 'validateTokenRegistry' backend/src/modules/hedge/hedge-route.ts
grep -q 'filledAmount !== targetAmount' backend/src/modules/hedge/hedge-worker.ts
grep -q 'HedgeWorker requires FILLED cumulative quantity to equal the quantized target' backend/test/hedge-worker.test.mjs
grep -q 'HedgeWorker permits only sub-step dust between intent and a complete venue fill' backend/test/hedge-worker.test.mjs
grep -q 'make hedge-execution-check' .github/workflows/docs-ci.yml

test -s backend/src/db/migrations/018-quote-control.sql
test -s backend/src/db/migrations/019-pair-quote-control.sql
test -s backend/src/modules/quote-control/quote-control.store.ts
test -s backend/src/modules/quote-control/postgres-quote-control.store.ts
test -s backend/test/quote-control.test.mjs
test -s backend/test/postgres-quote-control-store.test.mjs
test -s backend/test/api-quote-control.test.mjs
grep -q 'server.get("/admin/quote-control"' backend/src/api/quote-control-routes.ts
grep -q 'server.put("/admin/quote-control"' backend/src/api/quote-control-routes.ts
grep -q 'server.get("/admin/quote-control/pairs/:chainId/:tokenA/:tokenB"' backend/src/api/quote-control-routes.ts
grep -q 'server.put("/admin/quote-control/pairs/:chainId/:tokenA/:tokenB"' backend/src/api/quote-control-routes.ts
grep -q 'getPairState' backend/src/api/trading-routes.ts
grep -q 'QUOTE_PAUSED' backend/src/api/trading-routes.ts
grep -q 'QUOTE_CONTROL_UNAVAILABLE' backend/src/api/trading-routes.ts
grep -q 'assertDependencyMethod(deps.quoteControlStore, "quoteControlStore", "getState")' backend/src/modules/health/readiness.service.ts
grep -q 'rfq_quote_paused 1' backend/test/readiness.test.mjs
grep -q 'rfq_quote_pairs_paused 1' backend/test/readiness.test.mjs
grep -q 'expectedVersion' docs/api/openapi.yaml
grep -q 'quote_control_audit' docs/database/schema.sql
grep -q 'quote_pair_control_audit' docs/database/schema.sql
grep -q 'RFQQuoteCreationPaused' infra/prometheus/rules/rfq-alerts.yml
grep -q 'RFQQuotePairsPaused' infra/prometheus/rules/rfq-alerts.yml
grep -q 'admin:write' docs/security/key-management.md

test -s backend/src/db/migrations/020-toxic-flow-scores.sql
test -s backend/src/modules/risk/toxic-flow-score.store.ts
test -s backend/src/modules/risk/postgres-toxic-flow-score.store.ts
test -s backend/src/modules/risk/dynamic-toxic-flow-risk.engine.ts
test -s backend/src/api/toxic-flow-score-routes.ts
test -s backend/test/toxic-flow-score-store.test.mjs
test -s backend/test/postgres-toxic-flow-score-store.test.mjs
test -s backend/test/dynamic-toxic-flow-risk.test.mjs
test -s backend/test/api-toxic-flow-score.test.mjs
grep -q 'server.get("/admin/toxic-flow/scores/:chainId/:user"' backend/src/api/toxic-flow-score-routes.ts
grep -q 'server.put("/admin/toxic-flow/scores/:chainId/:user"' backend/src/api/toxic-flow-score-routes.ts
grep -q 'DynamicToxicFlowRiskEngine' $gateway_sources
grep -q 'toxic_flow_score_audit' docs/database/schema.sql
grep -q "('020', 'toxic-flow-scores')" docs/database/schema.sql
grep -q 'RFQ_TOXIC_FLOW_MAX_SCORE_AGE_MS' infra/k8s/configmap.yaml
grep -q 'rfq_toxic_flow_score_updates_total' backend/src/modules/metrics/metrics.service.ts
grep -q 'RFQToxicFlowScoreErrors' infra/prometheus/rules/rfq-alerts.yml

test -s docs/adr/ADR-0008-Use-Bounded-Signer-Overlap-For-Key-Rotation.md
grep -q 'MAX_TRUSTED_SIGNERS = 5' contracts/src/RFQSettlement.sol
grep -q 'setTrustedSignerAuthorization' contracts/src/RFQSettlement.sol
grep -q 'trustedSignerOverlapAddresses' backend/src/modules/settlement/settlement-verifier.service.ts
grep -q 'RFQ_TRUSTED_SIGNER_OVERLAP_ADDRESSES' backend/src/modules/signer/signer-runtime.ts
grep -q 'accepts an explicitly configured overlap signer' backend/test/settlement-verifier.test.mjs
grep -q 'Signer rotation uses two backend rollouts' docs/security/audit-checklist.md

test -s contracts/script/LocalE2EToken.s.sol
test -s scripts/settlement-e2e.mjs
test -s scripts/settlement-e2e.sh
test -s backend/test/market-runtime.test.mjs
test -s backend/test/gateway-settlement-policy.test.mjs
grep -q 'service: new StaticMarketDataService({' backend/src/runtime/market-runtime.ts
grep -q 'defaultPairs: configuredPairs' backend/src/runtime/market-runtime.ts
grep -q 'buildDefaultSettlementVerifierPolicy(signerRuntimeConfig, managedRiskPairs)' $gateway_sources
grep -q 'waitForTransactionReceipt' scripts/settlement-e2e.mjs
grep -q 'functionName: "submitQuote"' scripts/settlement-e2e.mjs
grep -q 'RFQ_ALLOW_SIMULATED_SETTLEMENT = "false"' scripts/settlement-e2e.mjs
grep -q 'settlement-e2e: backend-build contract-build' Makefile
grep -q 'run: make settlement-e2e' .github/workflows/contract-ci.yml
grep -q 'run_step make settlement-e2e' scripts/verify.sh

test -s frontend/playwright.config.ts
test -s frontend/e2e/rfq-flow.spec.ts
test -s .github/workflows/frontend-e2e.yml
grep -q '"@playwright/test": "1.61.0"' frontend/package.json
grep -q 'requests, submits, and renders the authoritative RFQ lifecycle' frontend/e2e/rfq-flow.spec.ts
grep -q 'rejects an invalid pair before sending a quote request' frontend/e2e/rfq-flow.spec.ts
grep -q 'run: make frontend-e2e' .github/workflows/frontend-e2e.yml
grep -q 'run: make frontend-e2e' .github/workflows/release.yml

echo "skeleton check passed"
