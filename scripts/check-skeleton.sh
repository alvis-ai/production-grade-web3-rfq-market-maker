#!/usr/bin/env sh
set -eu

test -s package.json
test -s pnpm-workspace.yaml
test -s pnpm-lock.yaml
test -s .dockerignore
test -s .env.example
test -s benchmark/quote-benchmark.mjs
test -s .github/workflows/backend-ci.yml
test -s .github/workflows/contract-ci.yml
test -s .github/workflows/docs-ci.yml
test -s backend/src/main.ts
test -s backend/test/api-error.test.mjs
test -s backend/test/api.test.mjs
test -s backend/test/hedge.test.mjs
test -s backend/test/inventory.test.mjs
test -s backend/test/market-data.test.mjs
test -s backend/test/metrics.test.mjs
test -s backend/test/quote-identity.test.mjs
test -s backend/test/quote-service.test.mjs
test -s backend/test/pnl.test.mjs
test -s backend/test/rate-limit.test.mjs
test -s backend/test/readiness.test.mjs
test -s backend/test/routing.test.mjs
test -s backend/test/settlement-event.test.mjs
test -s backend/test/settlement-verifier.test.mjs
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
grep -q 'ReadinessService rejects unsafe freshness configuration at construction' backend/test/readiness.test.mjs
test -s backend/src/modules/quote/quote.service.ts
test -s backend/src/modules/quote/quote-identity.ts
test -s backend/src/modules/quote/quote.repository.ts
grep -q 'checkHealth' backend/src/modules/quote/quote.repository.ts
test -s backend/src/modules/execution/execution.service.ts
test -s backend/src/modules/inventory/inventory.service.ts
grep -q 'checkHealth' backend/src/modules/inventory/inventory.service.ts
grep -q 'InventoryService calculates bounded quote skew by inventory direction' backend/test/inventory.test.mjs
grep -q 'assertPositiveBigInt(config.skewUnit, "skewUnit")' backend/src/modules/inventory/inventory.service.ts
grep -q 'assertBpsUpperBound(config.maxPositiveSkewBps, "maxPositiveSkewBps")' backend/src/modules/inventory/inventory.service.ts
grep -q 'assertSettlementDelta(delta)' backend/src/modules/inventory/inventory.service.ts
grep -q 'assertInventorySkewInput(input)' backend/src/modules/inventory/inventory.service.ts
grep -q 'InventoryService rejects unsafe skew configuration at construction' backend/test/inventory.test.mjs
grep -q 'InventoryService rejects unsafe settlement inputs before mutating balances' backend/test/inventory.test.mjs
grep -q 'InventoryService rejects unsafe projection and skew inputs' backend/test/inventory.test.mjs
grep -q 'rebuildFromSettlements' backend/src/modules/inventory/inventory.service.ts
grep -q 'InventoryService rebuilds inventory from settlement replay' backend/test/inventory.test.mjs
grep -q 'InventoryService rejects unsafe settlement replay before mutating balances' backend/test/inventory.test.mjs
grep -q 'Inventory settlement replay input must be an array' backend/src/modules/inventory/inventory.service.ts
grep -q 'Inventory replay validates the entire settlement delta batch before clearing balances' book/Volume3-RiskEngine/Chapter01-Inventory.md
grep -q 'inventory skew config fail-fast' book/Volume3-RiskEngine/Chapter01-Inventory.md
test -s backend/src/modules/hedge/hedge.service.ts
grep -q 'checkHealth' backend/src/modules/hedge/hedge.service.ts
test -s backend/src/modules/metrics/metrics.service.ts
grep -q 'checkHealth' backend/src/modules/metrics/metrics.service.ts
grep -q 'MetricsService sanitizes reason labels and renders core settlement metrics' backend/test/metrics.test.mjs
test -s backend/src/modules/pnl/pnl.service.ts
grep -q 'checkHealth' backend/src/modules/pnl/pnl.service.ts
test -s backend/src/modules/settlement/settlement-event.service.ts
grep -q 'checkHealth' backend/src/modules/settlement/settlement-event.service.ts
test -s backend/src/modules/settlement/settlement-verifier.service.ts
test -s backend/src/modules/market-data/market-data.service.ts
grep -q 'getMarketSnapshotIssue' backend/src/modules/market-data/market-data.service.ts
grep -q 'defaultStaticMarketDataConfig' backend/src/modules/market-data/market-data.service.ts
grep -q 'Market data pair is not configured' backend/src/modules/market-data/market-data.service.ts
grep -q 'defaultMaxSnapshotFutureSkewMs' backend/src/modules/market-data/market-data.service.ts
grep -q 'snapshot timestamp is too far in the future' backend/src/modules/market-data/market-data.service.ts
grep -q 'mid price is invalid' backend/src/modules/market-data/market-data.service.ts
grep -q 'liquidity is invalid' backend/src/modules/market-data/market-data.service.ts
grep -q 'assertStaticMarketDataConfig' backend/src/modules/market-data/market-data.service.ts
grep -q 'Static market data supportedPairs must not contain duplicate pairs' backend/src/modules/market-data/market-data.service.ts
grep -q 'getMarketSnapshotIssue rejects stale or future-skewed market snapshots' backend/test/market-data.test.mjs
grep -q 'StaticMarketDataService rejects unconfigured token pairs' backend/test/market-data.test.mjs
grep -q 'StaticMarketDataService rejects unsafe static market data config' backend/test/market-data.test.mjs
test -s backend/src/modules/rate-limit/rate-limit.service.ts
test -s backend/src/shared/errors/api-error.ts
grep -q 'APIError serializes stable client responses without internal reason codes' backend/test/api-error.test.mjs
test -s backend/src/modules/routing/routing.engine.ts
grep -q 'InternalInventoryRoutingEngine creates deterministic internal inventory route plans' backend/test/routing.test.mjs
grep -q 'assertRouteInput(input)' backend/src/modules/routing/routing.engine.ts
grep -q 'Routing request token pair must contain distinct tokens' backend/src/modules/routing/routing.engine.ts
grep -q 'InternalInventoryRoutingEngine rejects unsafe route inputs before planning' backend/test/routing.test.mjs
test -s backend/src/shared/validation/quote-request.ts
test -s backend/src/shared/validation/submit-request.ts
grep -q 'validateSubmitQuoteRequest rejects unsafe submit payloads before execution' backend/test/validation.test.mjs
test -s frontend/src/lib/rfq.ts
test -s frontend/src/lib/config.ts
test -s frontend/src/lib/errors.ts
test -s frontend/src/vite-env.d.ts
test -s frontend/src/app/web3.tsx
test -s frontend/src/pages/QuotePage.tsx
test -s frontend/src/components/WalletSubmitControl.tsx
test -s sdk/src/abi.ts
test -s sdk/src/eip712.ts
test -s sdk/src/index.ts
test -s sdk/src/quote-hash.ts
test -s sdk/src/settlement.ts
test -s sdk/test/sdk.test.mjs
test -s contracts/src/RFQSettlement.sol
test -s contracts/test/RFQSettlement.t.sol
test -s contracts/test/Deploy.t.sol
test -s examples/quote-request.json
test -s examples/submit-request.json
test -s scripts/check-examples-consistency.mjs
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
test -s scripts/smoke-api.mjs
test -s scripts/smoke-api-local.sh
test -s infra/docker/backend.Dockerfile
test -s infra/docker/frontend.Dockerfile
grep -q 'ENV HOST=0.0.0.0' infra/docker/backend.Dockerfile
grep -q 'ENV PORT=3000' infra/docker/backend.Dockerfile
grep -q 'COPY package.json pnpm-lock.yaml pnpm-workspace.yaml' infra/docker/backend.Dockerfile
grep -q -- '--frozen-lockfile' infra/docker/backend.Dockerfile
grep -q 'HEALTHCHECK' infra/docker/backend.Dockerfile
grep -q 'http://127.0.0.1:3000/health' infra/docker/backend.Dockerfile
grep -q 'FROM nginx:1.27-alpine AS runtime' infra/docker/frontend.Dockerfile
grep -q 'COPY package.json pnpm-lock.yaml pnpm-workspace.yaml' infra/docker/frontend.Dockerfile
grep -q -- '--frozen-lockfile' infra/docker/frontend.Dockerfile
grep -q 'VITE_RFQ_API_BASE_URL' infra/docker/frontend.Dockerfile
grep -q 'VITE_RFQ_SETTLEMENT_ADDRESS' infra/docker/frontend.Dockerfile
grep -q 'VITE_WALLETCONNECT_PROJECT_ID' infra/docker/frontend.Dockerfile
grep -q 'COPY sdk/src sdk/src' infra/docker/frontend.Dockerfile
grep -q 'pnpm --filter @rfq-market-maker/frontend build' infra/docker/frontend.Dockerfile
grep -q 'HEALTHCHECK' infra/docker/frontend.Dockerfile
grep -q 'http://127.0.0.1/' infra/docker/frontend.Dockerfile
grep -q 'backend:' docker-compose.yml
grep -q 'frontend:' docker-compose.yml
grep -q 'postgres:' docker-compose.yml
grep -q 'condition: service_healthy' docker-compose.yml
grep -q 'dockerfile: infra/docker/backend.Dockerfile' docker-compose.yml
grep -q 'dockerfile: infra/docker/frontend.Dockerfile' docker-compose.yml
grep -q 'VITE_RFQ_API_BASE_URL: http://localhost:3000' docker-compose.yml
grep -q 'VITE_RFQ_SETTLEMENT_ADDRESS: 0x0000000000000000000000000000000000000004' docker-compose.yml
grep -q 'VITE_WALLETCONNECT_PROJECT_ID: "00000000000000000000000000000000"' docker-compose.yml
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
test -s infra/helm/rfq-market-maker/Chart.yaml
test -s scripts/smoke-api.sh

grep -q 'server.post("/quote"' backend/src/main.ts
grep -q 'server.post("/submit"' backend/src/main.ts
grep -q 'server.get("/quote/:quoteId"' backend/src/main.ts
grep -q 'quoteService.getQuoteStatus' backend/src/main.ts
grep -q 'server.get("/settlements/:settlementEventId"' backend/src/main.ts
grep -q 'server.get("/hedges/:hedgeOrderId"' backend/src/main.ts
grep -q 'server.get("/pnl"' backend/src/main.ts
grep -q 'assertStatusIdentifier' backend/src/main.ts
grep -q 'RFQ API rejects empty status path identifiers before store lookup' backend/test/api.test.mjs
grep -q 'server.get("/ready"' backend/src/main.ts
grep -q 'readiness.status === "degraded"' backend/src/main.ts
grep -q 'server.get("/metrics"' backend/src/main.ts
grep -q 'validateQuoteRequest' backend/src/main.ts
grep -q 'validateSubmitQuoteRequest' backend/src/main.ts
grep -q 'chainId must be a positive safe integer' backend/src/shared/validation/quote-request.ts
grep -q 'positive safe integer' backend/src/shared/validation/submit-request.ts
grep -q 'assertExactFields' backend/src/shared/validation/quote-request.ts
grep -q 'assertExactFields' backend/src/shared/validation/submit-request.ts
grep -q 'unknown request fields' backend/test/api.test.mjs
grep -q 'Number.MAX_SAFE_INTEGER + 1' backend/test/api.test.mjs
grep -q 'additionalProperties: false' docs/api/openapi.yaml
grep -q 'maximum: 9007199254740991' docs/api/openapi.yaml
grep -q 'JavaScript safe integer maximum' scripts/check-api-schema-consistency.mjs
grep -q 'must reject unknown request fields' scripts/check-api-schema-consistency.mjs
grep -q 'QuoteResponse.signature must be a 65-byte EIP-712 signature' scripts/check-api-schema-consistency.mjs
grep -q 'SubmitQuoteResponse", "QuoteStatus", "SettlementEventStatus' scripts/check-api-schema-consistency.mjs
grep -q 'txHash must be a 32-byte transaction hash' scripts/check-api-schema-consistency.mjs
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
grep -q 'requiresExplicitSignerConfig' backend/src/main.ts
grep -q '"development", "test"' backend/src/main.ts
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
grep -q 'installGracefulShutdown' backend/src/main.ts
grep -q 'SIGTERM' backend/src/main.ts
grep -q 'SIGINT' backend/src/main.ts
grep -q 'server.close' backend/src/main.ts
grep -q 'server.setNotFoundHandler' backend/src/main.ts
grep -q 'Route not found' backend/src/main.ts
grep -q 'server.setErrorHandler' backend/src/main.ts
grep -q 'frameworkErrorToAPIError' backend/src/main.ts
grep -q 'FST_ERR_CTP_BODY_TOO_LARGE' backend/src/main.ts
grep -q 'requireConfiguredEnv' backend/src/main.ts
grep -q 'requireConfiguredPrivateKey' backend/src/main.ts
grep -q 'requireConfiguredAddress' backend/src/main.ts
grep -q 'NODE_ENV=${nodeEnv}' backend/src/main.ts
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
grep -q 'maxSnapshotFutureSkewMs' backend/src/modules/quote/quote.service.ts
grep -q 'assertPositiveSafeInteger(config.maxSnapshotAgeMs, "maxSnapshotAgeMs")' backend/src/modules/quote/quote.service.ts
grep -q 'assertPositiveSafeInteger(config.quoteTtlSeconds, "quoteTtlSeconds")' backend/src/modules/quote/quote.service.ts
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
grep -q 'lastTimestampMs' backend/src/modules/quote/quote-identity.ts
grep -q 'QuoteIdentityGenerator creates monotonic unique nonces within one millisecond' backend/test/quote-identity.test.mjs
grep -q 'per-millisecond sequence wraps' backend/test/quote-identity.test.mjs
grep -q 'class InMemoryQuoteRepository' backend/src/modules/quote/quote.repository.ts
grep -q 'markFailed' backend/src/modules/quote/quote.repository.ts
grep -q 'class BasicRiskEngine' backend/src/modules/risk/risk.engine.ts
! grep -q 'AllowAllRiskEngine' backend/src/modules/risk/risk.engine.ts
! grep -q 'allow-all-skeleton-v0' backend/src/modules/risk/risk.engine.ts
grep -q 'class InMemoryRateLimiter' backend/src/modules/rate-limit/rate-limit.service.ts
grep -q 'assertPositiveSafeInteger' backend/src/modules/rate-limit/rate-limit.service.ts
grep -q 'assertRateLimitInput(input)' backend/src/modules/rate-limit/rate-limit.service.ts
grep -q 'Rate limit clientId must be a non-empty string' backend/src/modules/rate-limit/rate-limit.service.ts
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
grep -q 'TOXIC_FLOW_RESTRICTED_USER' backend/src/modules/risk/risk.engine.ts
grep -q 'TOXIC_FLOW_SCORE_EXCEEDED' backend/src/modules/risk/risk.engine.ts
grep -q 'toxicFlowScores' backend/src/modules/risk/risk.engine.ts
grep -q 'restrictedUsers' backend/src/modules/risk/risk.engine.ts
grep -q 'class LocalEIP712SignerService' backend/src/modules/signer/signer.service.ts
grep -q 'class ObservedSignerService' backend/src/modules/signer/signer.service.ts
grep -q 'SIGNER_UNAVAILABLE' backend/src/modules/signer/signer.service.ts
grep -q 'privateKeyToAccount' backend/src/modules/signer/signer.service.ts
grep -q 'assertPrivateKey(config.privateKey)' backend/src/modules/signer/signer.service.ts
grep -q 'assertSignQuoteInput(input)' backend/src/modules/signer/signer.service.ts
grep -q 'ProductionGradeRFQ' backend/src/modules/signer/signer.service.ts
grep -q 'LocalEIP712SignerService binds signatures to the settlement contract address' backend/test/signer.test.mjs
grep -q 'LocalEIP712SignerService rejects unsafe signer configuration at construction' backend/test/signer.test.mjs
grep -q 'LocalEIP712SignerService rejects unsafe quote inputs before signing' backend/test/signer.test.mjs
grep -q 'RISK_REJECTED' backend/src/modules/quote/quote.service.ts
grep -q 'requireSubmittableSignedQuote' backend/src/modules/quote/quote.service.ts
grep -q 'QUOTE_FAILED' backend/src/modules/quote/quote.service.ts
grep -q 'markQuoteExpiredBestEffort' backend/src/modules/quote/quote.service.ts
grep -q 'QUOTE_EXPIRED' backend/src/modules/quote/quote.service.ts
grep -q 'findSignedQuoteByChainUserNonce' backend/src/modules/quote/quote.repository.ts
grep -q 'findSignedQuoteByQuoteId' backend/src/modules/quote/quote.repository.ts
grep -q 'chainUserNonceKey' backend/src/modules/quote/quote.repository.ts
grep -q 'assertRequestedQuoteInput(input)' backend/src/modules/quote/quote.repository.ts
grep -q 'assertRejectedQuoteInput(input)' backend/src/modules/quote/quote.repository.ts
grep -q 'Signed quote nonce key already exists' backend/src/modules/quote/quote.repository.ts
grep -q 'assertSignedQuoteInput(input)' backend/src/modules/quote/quote.repository.ts
grep -q 'Signed quote signature must be a 65-byte hex string' backend/src/modules/quote/quote.repository.ts
grep -q 'assertStatusTransition(current, status)' backend/src/modules/quote/quote.repository.ts
grep -q 'assertCanMarkFailed(current)' backend/src/modules/quote/quote.repository.ts
grep -q 'cannot transition from requested to ${nextStatus} through markStatus' backend/src/modules/quote/quote.repository.ts
grep -q 'cannot transition from signed to ${nextStatus} through markStatus' backend/src/modules/quote/quote.repository.ts
grep -q 'cannot transition from submitted to ${nextStatus}' backend/src/modules/quote/quote.repository.ts
grep -q 'terminal status expired' backend/src/modules/quote/quote.repository.ts
grep -q 'assertNonEmptyString(errorCode, "errorCode", "Failed quote")' backend/src/modules/quote/quote.repository.ts
grep -q 'assertQuoteStatusMetadata(metadata)' backend/src/modules/quote/quote.repository.ts
grep -q 'Quote status txHash must be a 32-byte hex string' backend/src/modules/quote/quote.repository.ts
grep -q 'rejects signed quote nonce key conflicts' backend/test/quote-service.test.mjs
grep -q 'findSignedQuoteByQuoteId' backend/test/quote-service.test.mjs
grep -q 'rejects signed quote identity rewrites' backend/test/quote-service.test.mjs
grep -q 'rejects unsafe signed quote persistence inputs' backend/test/quote-service.test.mjs
grep -q 'persists expired status when signed quote status is read after deadline' backend/test/quote-service.test.mjs
grep -q 'rejects expired signed quotes before signature verification' backend/test/quote-service.test.mjs
grep -q 'rejects unsafe requested and rejected quote persistence inputs' backend/test/quote-service.test.mjs
grep -q 'rejects terminal quote status regressions' backend/test/quote-service.test.mjs
grep -q 'cannot transition from requested to settled through markStatus' backend/test/quote-service.test.mjs
grep -q 'cannot transition from submitted to expired' backend/test/quote-service.test.mjs
grep -q 'rejects malformed quote status metadata' backend/test/quote-service.test.mjs
grep -q 'rejects malformed failed quote metadata' backend/test/quote-service.test.mjs
grep -q 'preserves settlement metadata across status updates' backend/test/quote-service.test.mjs
grep -q 'chainId:user:nonce' book/Volume5-BackendEngineering/Chapter02-Quote-Service.md
grep -q 'requested/rejected quote persistence validation' book/Volume5-BackendEngineering/Chapter02-Quote-Service.md
grep -q 'signed quote persistence validation' book/Volume5-BackendEngineering/Chapter02-Quote-Service.md
grep -q 'terminal quote status invariants' book/Volume5-BackendEngineering/Chapter02-Quote-Service.md
grep -q 'requested quotes cannot be marked submitted, settled or expired through the status updater' book/Volume5-BackendEngineering/Chapter02-Quote-Service.md
grep -q 'quote status metadata validation' book/Volume5-BackendEngineering/Chapter02-Quote-Service.md
grep -q 'indexes signed quotes by chain, user, and nonce' backend/test/quote-service.test.mjs
grep -q 'uq_quotes_chain_user_nonce' docs/database/schema.sql
grep -q 'quotes must keep the chain_id, user_address, nonce signed-quote lookup key' scripts/check-database-schema-consistency.mjs
grep -q 'partial unique index `(chain_id, user_address, nonce) WHERE nonce IS NOT NULL`' docs/database/er-diagram.md
grep -q 'chk_quotes_status' docs/database/schema.sql
grep -q 'chk_quotes_signature_and_tx_hash_hex' docs/database/schema.sql
grep -q 'chk_quotes_status_payload_consistency' docs/database/schema.sql
grep -q 'chk_quotes_signed_payload_consistency' docs/database/schema.sql
grep -q 'chk_quotes_rejection_payload_consistency' docs/database/schema.sql
grep -q 'chk_settlement_events_hashes' docs/database/schema.sql
grep -q 'chk_hedge_orders_side' docs/database/schema.sql
grep -q 'chk_pnl_records_model' docs/database/schema.sql
grep -q 'quotes must constrain lifecycle status values' scripts/check-database-schema-consistency.mjs
grep -q 'submitted and settled quotes must keep tx_hash and settlement_event_id pointers' scripts/check-database-schema-consistency.mjs
grep -q 'non-settlement quote statuses must not expose settlement, hedge, or PnL pointers' scripts/check-database-schema-consistency.mjs
grep -q 'signed lifecycle statuses must keep complete signed quote payload metadata' scripts/check-database-schema-consistency.mjs
grep -q 'rejected and failed quote statuses must keep reject_code' scripts/check-database-schema-consistency.mjs
grep -q 'settlement_events must constrain hash-shaped fields' scripts/check-database-schema-consistency.mjs
grep -q 'hedge_orders must constrain side enum values' scripts/check-database-schema-consistency.mjs
grep -q 'pnl_records must constrain supported attribution models' scripts/check-database-schema-consistency.mjs
grep -q '数据库层使用 CHECK constraints 固化应用层关键不变量' docs/database/er-diagram.md
grep -q 'status payload consistency' docs/database/er-diagram.md
grep -q 'PostgreSQL schema mirrors these invariants with quote status payload consistency checks' book/Volume5-BackendEngineering/Chapter02-Quote-Service.md
grep -q 'fk_quotes_snapshot_id' docs/database/schema.sql
grep -q 'fk_quotes_settlement_event_id' docs/database/schema.sql
grep -q 'fk_quotes_hedge_order_id' docs/database/schema.sql
grep -q 'fk_quotes_pnl_id' docs/database/schema.sql
grep -q 'quotes.snapshot_id must reference market_snapshots(id)' scripts/check-database-schema-consistency.mjs
grep -q 'quotes.settlement_event_id must reference settlement_events(id)' scripts/check-database-schema-consistency.mjs
grep -q 'quotes.hedge_order_id must reference hedge_orders(id)' scripts/check-database-schema-consistency.mjs
grep -q 'quotes.pnl_id must reference pnl_records(id)' scripts/check-database-schema-consistency.mjs
grep -q '状态指针不能悬空' docs/database/er-diagram.md
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
grep -q 'quote_hash' docs/database/er-diagram.md
grep -q 'quoteHash: "quote_hash"' scripts/check-database-schema-consistency.mjs
grep -q 'settlement_events must persist SettlementEventStatusResponse' scripts/check-database-schema-consistency.mjs
grep -q 'uq_hedge_orders_settlement_event' docs/database/schema.sql
grep -q 'settlement_event_id TEXT NOT NULL REFERENCES settlement_events(id)' docs/database/schema.sql
grep -q 'hedge_orders.settlement_event_id must be a required settlement_events(id) foreign key' scripts/check-database-schema-consistency.mjs
grep -q 'hedge_orders must keep one hedge intent per settlement event' scripts/check-database-schema-consistency.mjs
grep -q 'unique index `(settlement_event_id)`' docs/database/er-diagram.md
grep -q 'quote_id TEXT NOT NULL REFERENCES quotes(id)' docs/database/schema.sql
grep -q 'settlement_events.quote_id must be a required quotes(id) foreign key' scripts/check-database-schema-consistency.mjs
grep -q 'settlement_events.quote_id' docs/database/er-diagram.md
grep -q 'uq_settlement_events_quote_id' docs/database/schema.sql
grep -q 'settlement_events must keep one settlement event per quote' scripts/check-database-schema-consistency.mjs
grep -q 'unique index `(quote_id)`' docs/database/er-diagram.md
grep -q 'applySettlement' backend/src/modules/execution/execution.service.ts
grep -q 'applySettlementEvent' backend/src/modules/execution/execution.service.ts
grep -q 'settlementVerifier.verify' backend/src/modules/execution/execution.service.ts
grep -q 'SETTLEMENT_UNAVAILABLE' backend/src/modules/execution/execution.service.ts
grep -q 'SettlementEventStore' backend/src/modules/execution/execution.service.ts
grep -q 'settlementEventStoreFailure' backend/src/modules/execution/execution.service.ts
grep -q 'keccak256(toBytes(payload))' backend/src/modules/execution/execution.service.ts
grep -q 'buildSyntheticTxHash returns deterministic keccak256 bytes32 hashes' backend/test/execution.test.mjs
grep -q 'SkeletonExecutionService suppresses duplicate settlement side effects' backend/test/execution.test.mjs
grep -q 'validateSubmitQuoteRequest(request)' backend/src/modules/execution/execution.service.ts
grep -q 'Execution context quoteId must be a non-empty string' backend/src/modules/execution/execution.service.ts
grep -q 'SkeletonExecutionService rejects unsafe execution inputs before settlement side effects' backend/test/execution.test.mjs
grep -q 'class SettlementEventService' backend/src/modules/settlement/settlement-event.service.ts
grep -q 'interface SettlementEventStore' backend/src/modules/settlement/settlement-event.service.ts
grep -q 'getSettlementEvent' backend/src/modules/settlement/settlement-event.service.ts
grep -q 'listSettlementEvents' backend/src/modules/settlement/settlement-event.service.ts
grep -q 'removeSettlementEvent' backend/src/modules/settlement/settlement-event.service.ts
grep -q 'rebuildFromSettlements' backend/src/modules/settlement/settlement-event.service.ts
grep -q 'eventIdsByQuoteId' backend/src/modules/settlement/settlement-event.service.ts
grep -q 'txHash.slice(2)}_${logIndex}' backend/src/modules/settlement/settlement-event.service.ts
grep -q 'eventKey' backend/src/modules/settlement/settlement-event.service.ts
grep -q 'matchesExistingEvent' backend/src/modules/settlement/settlement-event.service.ts
grep -q 'assertSettlementEventInput' backend/src/modules/settlement/settlement-event.service.ts
grep -q 'Settlement event quote.amountOut must be greater than or equal to quote.minAmountOut' backend/src/modules/settlement/settlement-event.service.ts
grep -q 'keeps distinct events with the same tx hash prefix' backend/test/settlement-event.test.mjs
grep -q 'rejects conflicting events for an already settled quote' backend/test/settlement-event.test.mjs
grep -q 'lists settlement events in chain order' backend/test/settlement-event.test.mjs
grep -q 'removes reorged events and rebuilds inventory from canonical events' backend/test/settlement-event.test.mjs
grep -q 'treats duplicate reorg removals as idempotent' backend/test/settlement-event.test.mjs
grep -q 'rejects conflicting reorg removals before mutating state' backend/test/settlement-event.test.mjs
grep -q 'rejects conflicting payloads for an existing chain event key' backend/test/settlement-event.test.mjs
grep -q 'SettlementEventService rejects unsafe settlement quote inputs before side effects' backend/test/settlement-event.test.mjs
grep -q 'hashSettlementQuote rejects malformed quote fields before ABI encoding' backend/test/settlement-event.test.mjs
grep -q 'class ReconciliationService' backend/src/modules/reconciliation/reconciliation.service.ts
grep -q 'reconcileSettlementToQuote' backend/src/modules/reconciliation/reconciliation.service.ts
grep -q 'reconcileSettlementToHedge' backend/src/modules/reconciliation/reconciliation.service.ts
grep -q 'reconcileSettlementToPnl' backend/src/modules/reconciliation/reconciliation.service.ts
grep -q 'QUOTE_NOT_FOUND' backend/src/modules/reconciliation/reconciliation.service.ts
grep -q 'SIGNED_QUOTE_NOT_FOUND' backend/src/modules/reconciliation/reconciliation.service.ts
grep -q 'repairs quote status from settlement events' backend/test/reconciliation.test.mjs
grep -q 'reports terminal quote conflicts without stopping later events' backend/test/reconciliation.test.mjs
grep -q 'reports settlement events whose quotes are missing' backend/test/reconciliation.test.mjs
grep -q 'repairs hedge intents from settlement events' backend/test/reconciliation.test.mjs
grep -q 'requires hedge service for settlement-to-hedge repair' backend/test/reconciliation.test.mjs
grep -q 'repairs PnL records from settlement events and signed quotes' backend/test/reconciliation.test.mjs
grep -q 'reports PnL reconciliation events whose signed quote is missing' backend/test/reconciliation.test.mjs
grep -q 'requires PnL service for settlement-to-PnL repair' backend/test/reconciliation.test.mjs
grep -q 'class LocalSettlementVerifier' backend/src/modules/settlement/settlement-verifier.service.ts
grep -q 'TOKEN_NOT_WHITELISTED' backend/src/modules/settlement/settlement-verifier.service.ts
grep -q 'SETTLEMENT_REVERTED' backend/src/modules/settlement/settlement-verifier.service.ts
grep -q 'assertChainIds(policy.enabledChainIds)' backend/src/modules/settlement/settlement-verifier.service.ts
grep -q 'assertTokenWhitelist(policy.tokenWhitelist)' backend/src/modules/settlement/settlement-verifier.service.ts
grep -q 'createHedgeIntent' backend/src/modules/execution/execution.service.ts
grep -q 'recordHedgeFailure' backend/src/modules/execution/execution.service.ts
grep -q 'hedgeOrderId: hedgeResult?.hedgeOrderId' backend/src/modules/execution/execution.service.ts
grep -q 'getHedgeIntent' backend/src/modules/hedge/hedge.service.ts
grep -q 'getHedgeIntentBySettlementEvent' backend/src/modules/hedge/hedge.service.ts
grep -q 'settlementEventId: intent.settlementEventId' backend/src/modules/hedge/hedge.service.ts
grep -q 'hedgeOrderIdsBySettlementEvent' backend/src/modules/hedge/hedge.service.ts
grep -q 'returns the existing hedge intent for settlement retries' backend/test/hedge.test.mjs
grep -q 'getHedgeIntentBySettlementEvent' backend/test/hedge.test.mjs
grep -q 'settlementEventId: submitResponse.settlementEventId' sdk/test/sdk.test.mjs
grep -q 'hedge settlement event id' scripts/smoke-api.mjs
grep -q 'quoteRiskPenaltyBps' backend/src/modules/hedge/hedge.service.ts
grep -q 'failurePenaltyBps' backend/src/modules/hedge/hedge.service.ts
grep -q 'assertPositiveBps(config.failurePenaltyBps, "failurePenaltyBps")' backend/src/modules/hedge/hedge.service.ts
grep -q 'assertHedgeIntent(intent)' backend/src/modules/hedge/hedge.service.ts
grep -q 'assertHedgeRiskInput(input)' backend/src/modules/hedge/hedge.service.ts
grep -q 'failurePenaltyBps must be less than or equal to maxFailurePenaltyBps' backend/src/modules/hedge/hedge.service.ts
grep -q 'HedgeService rejects unsafe failure penalty configuration at construction' backend/test/hedge.test.mjs
grep -q 'HedgeService rejects unsafe intent inputs before writing hedge state' backend/test/hedge.test.mjs
grep -q 'HedgeService rejects unsafe risk feedback inputs before recording pressure' backend/test/hedge.test.mjs
grep -q 'failure penalty config fail-fast' book/Volume5-BackendEngineering/Chapter07-Hedge-Service.md
grep -q 'hedgeRiskPenaltyBps' backend/src/modules/quote/quote.service.ts
grep -q 'interface PnlStore' backend/src/modules/pnl/pnl.service.ts
grep -q 'class PnlService' backend/src/modules/pnl/pnl.service.ts
grep -q 'recordSettlement' backend/src/modules/pnl/pnl.service.ts
grep -q 'simulated_mid_price_v1' backend/src/modules/pnl/pnl.service.ts
grep -q 'pnlIdsByQuoteModel' backend/src/modules/pnl/pnl.service.ts
grep -q 'assertPnlInput(input)' backend/src/modules/pnl/pnl.service.ts
grep -q 'amountOut must be greater than or equal to quote.minAmountOut' backend/src/modules/pnl/pnl.service.ts
grep -q 'returns the existing attribution record for quote retries' backend/test/pnl.test.mjs
grep -q 'PnlService rejects unsafe attribution inputs before recording' backend/test/pnl.test.mjs
grep -q 'rfq_quote_errors_total' backend/src/modules/metrics/metrics.service.ts
grep -q 'rfq_quote_latency_seconds' backend/src/modules/metrics/metrics.service.ts
grep -q 'rfq_quote_rejections_total' backend/src/modules/metrics/metrics.service.ts
grep -q 'rfq_submit_latency_seconds' backend/src/modules/metrics/metrics.service.ts
grep -q 'rfq_rate_limited_total' backend/src/modules/metrics/metrics.service.ts
grep -q 'recordRateLimited' backend/src/main.ts
grep -q 'rfq_signer_requests_total' backend/src/modules/metrics/metrics.service.ts
grep -q 'rfq_signer_errors_total' backend/src/modules/metrics/metrics.service.ts
grep -q 'rfq_signer_latency_seconds' backend/src/modules/metrics/metrics.service.ts
grep -q 'rfq_readiness_status' backend/src/modules/metrics/metrics.service.ts
grep -q 'rfq_dependency_status' backend/src/modules/metrics/metrics.service.ts
grep -q '"routing"' backend/src/modules/metrics/metrics.service.ts
grep -q 'recordReadiness' backend/src/main.ts
grep -q 'rfq_readiness_status' book/Volume5-BackendEngineering/Chapter08-Metrics-Service.md
grep -q 'rfq_dependency_status' book/Volume5-BackendEngineering/Chapter08-Metrics-Service.md
grep -q 'rfq_rate_limited_total' book/Volume5-BackendEngineering/Chapter08-Metrics-Service.md
grep -q 'marketData、routing、pricing' book/Volume5-BackendEngineering/Chapter08-Metrics-Service.md
grep -q 'rfq_readiness_status' book/Volume7-ProductionDeployment/Chapter03-Monitoring.md
grep -q 'rfq_dependency_status' book/Volume7-ProductionDeployment/Chapter03-Monitoring.md
grep -q 'rfq_rate_limited_total' book/Volume7-ProductionDeployment/Chapter03-Monitoring.md
grep -q 'marketData|routing|pricing' book/Volume7-ProductionDeployment/Chapter03-Monitoring.md
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
grep -q 'rfq_hedge_lag_seconds' backend/src/modules/metrics/metrics.service.ts
grep -q 'recordHedgeLag' backend/src/main.ts
grep -q 'rfq_hedge_lag_seconds' book/Volume5-BackendEngineering/Chapter08-Metrics-Service.md
grep -q 'rfq_hedge_lag_seconds' book/Volume7-ProductionDeployment/Chapter03-Monitoring.md
grep -q 'RFQInventoryExposureHigh' infra/prometheus/rules/rfq-alerts.yml
grep -q 'rfq_inventory_balance' book/Volume7-ProductionDeployment/Chapter05-Runbook.md
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
grep -q 'rfqClient.quote' frontend/src/pages/QuotePage.tsx
grep -q 'rfqClient.submit' frontend/src/pages/QuotePage.tsx
grep -q 'rfqClient.getQuote' frontend/src/pages/QuotePage.tsx
grep -q 'RFQClientError' frontend/src/lib/errors.ts
grep -q 'traceId' frontend/src/lib/errors.ts
grep -q 'retryAfterSeconds' frontend/src/lib/errors.ts
grep -q 'toUIError' frontend/src/pages/QuotePage.tsx
grep -q 'setQuoteStatus(status)' frontend/src/pages/QuotePage.tsx
grep -q 'rfqClient.getSettlement' frontend/src/pages/QuotePage.tsx
grep -q 'rfqClient.getHedge' frontend/src/pages/QuotePage.tsx
grep -q 'rfqClient.pnl' frontend/src/pages/QuotePage.tsx
grep -q 'validateQuoteFormRequest(request)' frontend/src/pages/QuotePage.tsx
grep -q 'tokenIn and tokenOut must be different' frontend/src/lib/quote-request.ts
grep -q 'amountIn must be a positive uint string' frontend/src/lib/quote-request.ts
grep -q 'loadPostTradeSurfaces(status, response)' frontend/src/pages/QuotePage.tsx
grep -q 'loadPostTradeSurfaces(status, submitResult)' frontend/src/pages/QuotePage.tsx
grep -q 'parseIntegerInput' frontend/src/components/QuoteForm.tsx
grep -q 'Number.MAX_SAFE_INTEGER' frontend/src/components/QuoteForm.tsx
grep -q 'status.settlementEventId' frontend/src/pages/QuotePage.tsx
grep -q 'status.hedgeOrderId' frontend/src/pages/QuotePage.tsx
grep -q 'status.pnlId' frontend/src/pages/QuotePage.tsx
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
grep -q 'buildSubmitQuoteWriteRequest' frontend/src/components/WalletSubmitControl.tsx
grep -q 'writeContractAsync' frontend/src/components/WalletSubmitControl.tsx
grep -q 'walletMatchesQuote' frontend/src/components/WalletSubmitControl.tsx
grep -q 'Connected wallet must match quote user' frontend/src/components/WalletSubmitControl.tsx
grep -q 'Connected wallet network must match quote chainId' frontend/src/components/WalletSubmitControl.tsx
grep -q 'VITE_RFQ_API_BASE_URL' frontend/src/lib/config.ts
grep -q 'VITE_RFQ_SETTLEMENT_ADDRESS' frontend/src/lib/config.ts
grep -q 'VITE_WALLETCONNECT_PROJECT_ID' frontend/src/lib/config.ts
grep -q 'normalizeAddress' frontend/src/lib/config.ts
grep -q 'VITE_RFQ_API_BASE_URL must be an absolute http(s) URL' frontend/src/lib/config.ts
grep -q 'VITE_RFQ_SETTLEMENT_ADDRESS must be a 20-byte hex address' frontend/src/lib/config.ts
grep -q 'WagmiProvider' frontend/src/app/web3.tsx
grep -q 'RainbowKitProvider' frontend/src/app/web3.tsx
grep -q 'QueryClientProvider' frontend/src/app/web3.tsx
grep -q 'Web3Provider' frontend/src/components/WalletSubmitControl.tsx
grep -q 'new RFQClient(rfqApiBaseUrl)' frontend/src/lib/rfq.ts
grep -q 'Hedge Status' frontend/src/components/QuoteStatusPanel.tsx
grep -q 'Settlement Status' frontend/src/components/QuoteStatusPanel.tsx
grep -q 'Realized PnL' frontend/src/components/QuoteStatusPanel.tsx
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
grep -q 'treasuryAbi' sdk/src/index.ts
grep -q 'buildSubmitQuoteArgs' sdk/src/index.ts
grep -q 'buildSubmitQuoteWriteRequest' sdk/src/index.ts
grep -q 'hashSettlementQuote' sdk/src/index.ts
grep -q 'buildTreasuryTransferArgs' sdk/src/index.ts
grep -q 'hashSettlementQuote' sdk/src/quote-hash.ts
grep -q 'toSettlementQuote' sdk/src/quote-hash.ts
grep -q 'parseAddress' sdk/src/settlement.ts
grep -q 'parseSignature' sdk/src/settlement.ts
grep -q 'parsePositiveUInt' sdk/src/settlement.ts
grep -q 'treasury transfer input must be an object' sdk/test/sdk.test.mjs
grep -q 'quote must be an object' sdk/test/sdk.test.mjs
grep -q 'quote.amountOut must be greater than or equal to quote.minAmountOut' sdk/src/settlement.ts
grep -q 'buildQuoteTypedData' sdk/src/eip712.ts
grep -q 'assertQuoteShape' sdk/src/eip712.ts
grep -q 'quote.tokenIn and quote.tokenOut must be different' sdk/src/eip712.ts
grep -q 'ProductionGradeRFQ' sdk/src/eip712.ts
grep -q 'RFQClientError' sdk/test/sdk.test.mjs
grep -q 'buildQuoteTypedData' sdk/test/sdk.test.mjs
grep -q 'buildQuoteTypedData rejects invalid EIP-712 domain and quote fields' sdk/test/sdk.test.mjs
grep -q 'buildSubmitQuoteArgs' sdk/test/sdk.test.mjs
grep -q 'hashSettlementQuote matches RFQSettlement.hashQuote struct hashing' sdk/test/sdk.test.mjs
grep -q 'Settlement helpers reject invalid uint inputs before contract calls' sdk/test/sdk.test.mjs
grep -q 'buildTreasuryTransferArgs' sdk/test/sdk.test.mjs
grep -q 'RFQSettlement ABI exposes treasury custody controls' sdk/test/sdk.test.mjs
grep -q 'emergencyWithdraw' sdk/src/abi.ts
grep -q 'hashQuote' sdk/src/abi.ts
grep -q 'rfqSettlementAbi' sdk/test/sdk.test.mjs
grep -q 'recoverTypedDataAddress' sdk/test/sdk.test.mjs
grep -q 'verifyTypedData' sdk/test/sdk.test.mjs
grep -q 'submitQuote' sdk/src/abi.ts
grep -q 'setTreasury' sdk/src/abi.ts
grep -q 'TreasuryUpdated' sdk/src/abi.ts
grep -q 'setTokenWhitelist' sdk/src/abi.ts
grep -q 'grantRole' sdk/src/abi.ts
grep -q 'RoleGranted' sdk/src/abi.ts
grep -q 'RFQSettlement ABI exposes role-based admin controls' sdk/test/sdk.test.mjs
grep -q 'async submit' sdk/src/client.ts
grep -q 'async getQuote' sdk/src/client.ts
grep -q 'async getSettlement' sdk/src/client.ts
grep -q 'async getHedge' sdk/src/client.ts
grep -q 'async pnl' sdk/src/client.ts
grep -q 'async health' sdk/src/client.ts
grep -q 'async ready' sdk/src/client.ts
grep -q 'assertNonEmptyIdentifier' sdk/src/client.ts
grep -q 'RFQClient rejects empty dynamic status identifiers before fetch' sdk/test/sdk.test.mjs
grep -q 'assertQuoteStatus' sdk/src/client.ts
grep -q 'assertHedgeIntentStatus' sdk/src/client.ts
grep -q 'assertSettlementEventStatus' sdk/src/client.ts
grep -q 'assertPnlSummary' sdk/src/client.ts
grep -q 'assertPnlTradeRecord' sdk/src/client.ts
grep -q 'isHealthResponse' sdk/src/client.ts
grep -q 'isReadinessResponse' sdk/src/client.ts
grep -q 'isReadinessComponents' sdk/src/client.ts
grep -q 'async metrics' sdk/src/client.ts
grep -q 'normalizeBaseUrl' sdk/src/client.ts
grep -q 'traceId: string' sdk/src/types.ts
grep -q 'export const rfqErrorCodes' sdk/src/types.ts
grep -q 'export type RFQErrorCode' sdk/src/types.ts
grep -q 'code: RFQErrorCode' sdk/src/types.ts
grep -q 'rfqErrorCodeSet.has' sdk/src/client.ts
grep -q 'RFQClientErrorCode' sdk/src/client.ts
grep -q 'retryAfterSeconds' sdk/src/client.ts
grep -q 'response.headers.get("retry-after")' sdk/src/client.ts
grep -q 'RFQClient baseUrl must be an absolute http(s) URL' sdk/src/client.ts
grep -q 'RFQClient rejects unsafe base URLs at construction' sdk/test/sdk.test.mjs
grep -q 'assertRequiredEnumField' sdk/src/client.ts
grep -q 'assertRequiredNonNegativeIntegerField' sdk/src/client.ts
grep -q 'assertQuoteResponse' sdk/src/client.ts
grep -q 'assertSubmitQuoteResponse' sdk/src/client.ts
grep -q 'readJsonResponse' sdk/src/client.ts
grep -q 'malformed successful JSON responses' sdk/test/sdk.test.mjs
grep -q 'malformed health and readiness status responses' sdk/test/sdk.test.mjs
grep -q 'malformed hedge status responses' sdk/test/sdk.test.mjs
grep -q 'malformed submit and quote status responses' sdk/test/sdk.test.mjs
grep -q 'malformed settlement status responses' sdk/test/sdk.test.mjs
grep -q 'malformed PnL summary responses' sdk/test/sdk.test.mjs
grep -q 'isBytes32Hex' sdk/src/client.ts
grep -q 'isSignatureHex' sdk/src/client.ts
grep -q 'malformed successful response fields' sdk/test/sdk.test.mjs
grep -q 'client.health' sdk/test/sdk.test.mjs
grep -q 'client.getSettlement' sdk/test/sdk.test.mjs
grep -q 'client.getHedge' sdk/test/sdk.test.mjs
grep -q 'client.pnl' sdk/test/sdk.test.mjs
grep -q 'client.ready' sdk/test/sdk.test.mjs
grep -q 'percent-encodes dynamic status path identifiers' sdk/test/sdk.test.mjs
grep -q 'new RFQClient("http://127.0.0.1:3000/")' sdk/test/sdk.test.mjs
grep -q 'degraded readiness payloads' sdk/test/sdk.test.mjs
grep -q 'falls back for unknown API error codes' sdk/test/sdk.test.mjs
grep -q 'exposes Retry-After seconds for rate limited responses' sdk/test/sdk.test.mjs
grep -q 'retryAfterSeconds' README.md
grep -q 'client.metrics' sdk/test/sdk.test.mjs
grep -q 'function submitQuote' contracts/src/RFQSettlement.sol
grep -q 'ITreasuryMinimal' contracts/src/RFQSettlement.sol
grep -q 'release(quote.tokenOut, quote.user, quote.amountOut)' contracts/src/RFQSettlement.sol
grep -q 'function setTreasury' contracts/src/RFQSettlement.sol
grep -q 'function setTokenWhitelist' contracts/src/RFQSettlement.sol
grep -q 'function grantRole' contracts/src/RFQSettlement.sol
grep -q 'function revokeRole' contracts/src/RFQSettlement.sol
grep -q 'SIGNER_ADMIN_ROLE' contracts/src/RFQSettlement.sol
grep -q 'TOKEN_ADMIN_ROLE' contracts/src/RFQSettlement.sol
grep -q 'function setPaused' contracts/src/RFQSettlement.sol
grep -q 'ecrecover' contracts/src/RFQSettlement.sol
grep -q 'safeTransferFrom' contracts/src/RFQSettlement.sol
grep -q 'using SafeERC20 for address' contracts/src/RFQSettlement.sol
grep -q 'contract Treasury' contracts/src/Treasury.sol
grep -q 'function release' contracts/src/Treasury.sol
grep -q 'function emergencyWithdraw' contracts/src/Treasury.sol
grep -q 'onlySettlement' contracts/src/Treasury.sol
grep -q 'TransferFailed' contracts/src/Treasury.sol
grep -q 'using SafeERC20 for address' contracts/src/Treasury.sol
grep -q 'library SafeERC20' contracts/src/libraries/SafeERC20.sol
grep -q 'function safeTransferFrom' contracts/src/libraries/SafeERC20.sol
grep -q 'token.code.length' contracts/src/libraries/SafeERC20.sol
grep -q 'testSettlementCanReleaseFunds' contracts/test/Treasury.t.sol
grep -q 'testOnlySettlementCanReleaseFunds' contracts/test/Treasury.t.sol
grep -q 'testOwnerCanEmergencyWithdraw' contracts/test/Treasury.t.sol
grep -q 'testRejectsFailedTokenTransfers' contracts/test/Treasury.t.sol
grep -q 'testRejectsNonContractTokenTransfers' contracts/test/Treasury.t.sol
grep -q 'testRejectsReentrantRelease' contracts/test/Treasury.t.sol
grep -q 'testSubmitQuoteTransfersTokensAndConsumesNonce' contracts/test/RFQSettlement.t.sol
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
grep -q 'testSubmitQuoteRejectsNonContractTokenIn' contracts/test/RFQSettlement.t.sol
grep -q 'testSubmitQuoteRejectsNonContractTokenOut' contracts/test/RFQSettlement.t.sol
grep -q 'testSubmitQuoteRejectsAmountOutBelowMinimum' contracts/test/RFQSettlement.t.sol
grep -q 'contract DeployRFQSettlement' contracts/script/Deploy.s.sol
grep -q 'new Treasury' contracts/script/Deploy.s.sol
grep -q 'treasury.setSettlement' contracts/script/Deploy.s.sol
grep -q 'RFQ_TRUSTED_SIGNER' contracts/script/Deploy.s.sol
grep -q 'RFQ_TOKEN_WHITELIST_JSON' contracts/script/Deploy.s.sol
grep -q 'validateDeploymentConfig' contracts/script/Deploy.s.sol
grep -q 'EmptyTokenWhitelist' contracts/script/Deploy.s.sol
grep -q 'DuplicateWhitelistToken' contracts/script/Deploy.s.sol
grep -q 'testDeployInitializesTrustedSignerAndWhitelist' contracts/test/Deploy.t.sol
grep -q 'testDeployRejectsUnsafeDeploymentConfig' contracts/test/Deploy.t.sol
grep -q 'treasury settlement mismatch' contracts/test/Deploy.t.sol
grep -q 'settlement treasury mismatch' contracts/test/Deploy.t.sol
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
grep -q 'make metrics-check' scripts/verify.sh
grep -q 'make runbook-check' scripts/verify.sh
grep -q 'make grafana-check' scripts/verify.sh
grep -q 'make deployment-check' scripts/verify.sh
grep -q 'make ci-check' scripts/verify.sh
grep -q 'make compose-check' scripts/verify.sh
grep -q 'make eip712-check' scripts/verify.sh
grep -q 'make contract-abi-check' scripts/verify.sh
grep -q 'make rate-limit-check' scripts/verify.sh
grep -q 'make api-error-check' scripts/verify.sh
grep -q 'make api-schema-check' scripts/verify.sh
grep -q 'make api-route-check' scripts/verify.sh
grep -q 'make database-schema-check' scripts/verify.sh
grep -q 'make benchmark-quote' scripts/verify.sh
grep -q 'make backend-test' scripts/verify.sh
grep -q 'make sdk-test' scripts/verify.sh
grep -q 'make frontend-build' scripts/verify.sh
grep -q 'make smoke-api-local' scripts/verify.sh
grep -q 'make contract-test' scripts/verify.sh
grep -q 'forge not found; skipping contract-test' scripts/verify.sh
grep -q 'backend-build' Makefile
grep -q 'backend-test' Makefile
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
grep -q 'benchmark:quote' package.json
grep -q 'make benchmark-quote' README.md
grep -q 'RFQ_BENCHMARK_MAX_P95_MS' README.md
grep -q 'make benchmark-quote' book/Volume5-BackendEngineering/Chapter02-Quote-Service.md
grep -q 'make benchmark-quote' book/Volume7-ProductionDeployment/Chapter03-Monitoring.md
grep -q 'RFQ_BENCHMARK_QUOTE_REQUESTS' benchmark/quote-benchmark.mjs
grep -q 'RFQ_BENCHMARK_MAX_P95_MS' benchmark/quote-benchmark.mjs
grep -q 'POST /quote' benchmark/quote-benchmark.mjs
grep -q 'buildServer' benchmark/quote-benchmark.mjs
grep -q 'rateLimit: false' benchmark/quote-benchmark.mjs
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
grep -q 'actions/setup-node@v4' .github/workflows/backend-ci.yml
grep -q 'node-version: "22"' .github/workflows/backend-ci.yml
grep -Fq '"infra/**"' .github/workflows/backend-ci.yml
grep -Fq '"docker-compose.yml"' .github/workflows/backend-ci.yml
grep -Fq '".env.example"' .github/workflows/backend-ci.yml
grep -Fq '"README.md"' .github/workflows/backend-ci.yml
grep -q '      - master' .github/workflows/backend-ci.yml
grep -q '      - master' .github/workflows/docs-ci.yml
grep -q '      - master' .github/workflows/contract-ci.yml
grep -q 'actions/setup-node@v4' .github/workflows/docs-ci.yml
grep -q 'node-version: "22"' .github/workflows/docs-ci.yml
grep -q 'actions/setup-node@v4' .github/workflows/contract-ci.yml
grep -q 'node-version: "22"' .github/workflows/contract-ci.yml
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
grep -q 'make metrics-check' .github/workflows/docs-ci.yml
grep -q 'make runbook-check' .github/workflows/docs-ci.yml
grep -q 'make grafana-check' .github/workflows/docs-ci.yml
grep -q 'make deployment-check' .github/workflows/docs-ci.yml
grep -q 'make ci-check' .github/workflows/docs-ci.yml
grep -Fq '"examples/**"' .github/workflows/docs-ci.yml
grep -Fq '"benchmark/**"' .github/workflows/docs-ci.yml
grep -Fq '"benchmark/**"' .github/workflows/backend-ci.yml
grep -Fq '"scripts/check-api-schema-consistency.mjs"' .github/workflows/docs-ci.yml
grep -Fq '"scripts/check-api-route-consistency.mjs"' .github/workflows/docs-ci.yml
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
grep -Fq '"sdk/src/client.ts"' .github/workflows/docs-ci.yml
grep -Fq '"sdk/test/sdk.test.mjs"' .github/workflows/docs-ci.yml
grep -q 'QUOTE_TYPEHASH' scripts/check-eip712-consistency.mjs
grep -q 'backend signer Quote fields must match SDK Quote fields' scripts/check-eip712-consistency.mjs
grep -q 'OpenAPI ErrorResponse enum must match backend RFQErrorCode' scripts/check-api-error-consistency.mjs
grep -q 'SDK rfqErrorCodes array must match backend RFQErrorCode' scripts/check-api-error-consistency.mjs
grep -q 'SDK rfqErrorCodes constant array not found' scripts/check-api-error-consistency.mjs
grep -q 'docs/api/errors.md table must match backend RFQErrorCode' scripts/check-api-error-consistency.mjs
grep -q 'defaultRateLimitConfig' scripts/check-rate-limit-consistency.mjs
grep -q 'Retry-After' scripts/check-rate-limit-consistency.mjs
grep -q 'sdk/src/client.ts' scripts/check-rate-limit-consistency.mjs
grep -q 'frontend/src/lib/errors.ts' scripts/check-rate-limit-consistency.mjs
grep -q 'frontend/src/components/QuoteStatusPanel.tsx' scripts/check-rate-limit-consistency.mjs
grep -q 'retryAfterSeconds' scripts/check-rate-limit-consistency.mjs
grep -q 'sdk/src/client.ts' scripts/check-ci-workflows-consistency.mjs
grep -q 'make rate-limit-check' scripts/check-ci-workflows-consistency.mjs
grep -q 'Prometheus alert rules must cover backend metric' scripts/check-metrics-consistency.mjs
grep -q 'Grafana overview dashboard must query alert metric' scripts/check-grafana-dashboard-consistency.mjs
grep -q 'typescript-check' Makefile
grep -q 'api-error-check' Makefile
grep -q '65-byte EIP-712 signature' docs/api/openapi.yaml
grep -q 'Expected ${label} to be a 65-byte hex string' scripts/smoke-api.mjs
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
grep -q 'quoteHash' docs/api/openapi.yaml
grep -q 'hashSettlementQuote' backend/src/modules/settlement/settlement-event.service.ts
grep -q 'blockNumber?: number' backend/src/modules/settlement/settlement-event.service.ts
grep -q 'normalizeTxHash' backend/src/modules/settlement/settlement-event.service.ts
grep -q 'Settlement event txHash must be a 32-byte hex string' backend/src/modules/settlement/settlement-event.service.ts
grep -Fq '0x[0-9a-fA-F]{64}' backend/test/api.test.mjs
grep -q 'Expected ${label} to be a 32-byte hex string' scripts/smoke-api.mjs
grep -q 'normalizeEventOrdinal' backend/src/modules/settlement/settlement-event.service.ts
grep -q 'non-negative safe integer' backend/src/modules/settlement/settlement-event.service.ts
grep -q 'normalizes transaction hashes for idempotency' backend/test/settlement-event.test.mjs
grep -q 'rejects invalid transaction hashes before side effects' backend/test/settlement-event.test.mjs
grep -q 'rejects invalid chain event ordinals before side effects' backend/test/settlement-event.test.mjs
grep -q 'quoteHash' backend/src/shared/types/rfq.ts
grep -q 'blockNumber: number' backend/src/shared/types/rfq.ts
grep -q 'quoteHash' sdk/src/types.ts
grep -q 'blockNumber: number' sdk/src/types.ts
grep -q 'settlement quoteHash' scripts/smoke-api.mjs
grep -q 'settlement block number' scripts/smoke-api.mjs
grep -q 'Quote Hash' frontend/src/components/QuoteStatusPanel.tsx
grep -q 'Block' frontend/src/components/QuoteStatusPanel.tsx
grep -q 'blockNumber' book/Volume5-BackendEngineering/Chapter06-Execution-Service.md
grep -q 'txHash` as a 32-byte hex string' book/Volume5-BackendEngineering/Chapter06-Execution-Service.md
grep -q 'non-negative safe integers' book/Volume5-BackendEngineering/Chapter06-Execution-Service.md
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
grep -q 'graceful shutdown signal handling' book/Volume5-BackendEngineering/Chapter01-API-Gateway.md
grep -q 'not-found handler' book/Volume5-BackendEngineering/Chapter01-API-Gateway.md
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
grep -q 'VITE_RFQ_API_BASE_URL=http://localhost:3000' .env.example
grep -q 'VITE_RFQ_SETTLEMENT_ADDRESS=0x0000000000000000000000000000000000000004' .env.example
grep -q 'VITE_WALLETCONNECT_PROJECT_ID=00000000000000000000000000000000' .env.example
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
grep -q 'Unknown routes and unsupported methods' docs/api/openapi.yaml
grep -q '"413":' docs/api/openapi.yaml
grep -q 'body too large' docs/api/errors.md
grep -q 'malformed JSON' docs/api/errors.md
grep -q 'CORS preflight origin' docs/api/errors.md
grep -q '未匹配路由' docs/api/errors.md
grep -q 'RFQ_QUOTE_TTL_SECONDS' book/Volume5-BackendEngineering/Chapter02-Quote-Service.md
grep -q 'RFQ_QUOTE_TTL_SECONDS' backend/test/api.test.mjs
grep -q 'configured quote TTL' backend/test/quote-service.test.mjs
grep -q 'QuoteService rejects unsafe runtime configuration at construction' backend/test/quote-service.test.mjs
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
grep -q 'rfq_submit_latency_seconds_count 2' scripts/smoke-api.mjs
grep -q 'rfq_inventory_balance' scripts/smoke-api.mjs
grep -q 'rfq_hedge_lag_seconds_count 1' scripts/smoke-api.mjs
grep -q 'rfq_inventory_balance' backend/test/api.test.mjs
grep -q 'hedge intent creation fails' backend/test/api.test.mjs
grep -q 'lastPenaltyRead' backend/test/api.test.mjs
grep -q 'QuoteService includes hedge risk penalty in pricing input' backend/test/quote-service.test.mjs
grep -q 'HedgeService accumulates bounded quote risk penalty after hedge failures' backend/test/hedge.test.mjs
grep -q 'hedge status store failures' backend/test/api.test.mjs
grep -q 'HEDGE_INTENT_FAILED' backend/test/api.test.mjs
grep -q 'quote risk penalty' book/Volume5-BackendEngineering/Chapter07-Hedge-Service.md
grep -q 'HEDGE_INTENT_FAILED' book/Volume5-BackendEngineering/Chapter07-Hedge-Service.md
grep -q 'HEDGE_STORE_UNAVAILABLE' book/Volume5-BackendEngineering/Chapter07-Hedge-Service.md
grep -q 'post-settlement quote status persistence fails' backend/test/api.test.mjs
grep -q 'rfq_quote_status_update_errors_total' backend/test/api.test.mjs
grep -q 'Duplicate settlement events are idempotent' book/Volume5-BackendEngineering/Chapter06-Execution-Service.md
grep -q 'rfq_quote_status_update_errors_total' book/Volume5-BackendEngineering/Chapter08-Metrics-Service.md
grep -q 'quoteStatus.status' scripts/smoke-api.mjs
grep -q 'buildServer' backend/test/api.test.mjs
grep -q 'production startup requires explicit signer configuration' backend/test/api.test.mjs
grep -q 'non-local startup requires explicit signer configuration' backend/test/api.test.mjs
grep -q 'RFQ_SIGNER_PRIVATE_KEY is required when NODE_ENV=staging' backend/test/api.test.mjs
grep -q 'RFQ_SIGNER_PRIVATE_KEY is required when NODE_ENV=production' backend/test/api.test.mjs
grep -q 'RFQ_SIGNER_PRIVATE_KEY must be a 32-byte hex string when NODE_ENV=production' backend/test/api.test.mjs
grep -q 'RFQ_SETTLEMENT_ADDRESS must be a 20-byte hex address when NODE_ENV=production' backend/test/api.test.mjs
grep -q 'built-in Anvil signer fallback is only for unset `NODE_ENV`, `development`, or `test`' README.md
grep -q '默认 Anvil signer 只允许用于 unset `NODE_ENV`、`development` 或 `test`' book/Volume5-BackendEngineering/Chapter05-Signer-Service.md
grep -q 'marks requested quotes as failed when signer is unavailable' backend/test/quote-service.test.mjs
grep -q 'preserves signer errors when marking failed quotes fails' backend/test/quote-service.test.mjs
grep -q 'signing is unavailable' backend/test/api.test.mjs
grep -q 'preserves signer errors when failed quote persistence fails' backend/test/api.test.mjs
grep -q 'rfq_signer_errors_total' backend/test/api.test.mjs
grep -q 'unconfigured market data pairs before pricing and signing' backend/test/api.test.mjs
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
grep -q 'A signed quote may bind to only one settlement event' book/Volume5-BackendEngineering/Chapter06-Execution-Service.md
grep -q 'errorCode, "SETTLEMENT_REVERTED"' backend/test/api.test.mjs
grep -q 'retry.body.code, "QUOTE_FAILED"' backend/test/api.test.mjs
grep -q 'LocalSettlementVerifier accepts contract-shaped settlement quotes' backend/test/settlement-verifier.test.mjs
grep -q 'LocalSettlementVerifier rejects disabled settlement chains' backend/test/settlement-verifier.test.mjs
grep -q 'LocalSettlementVerifier rejects expired settlement quotes' backend/test/settlement-verifier.test.mjs
grep -q 'LocalSettlementVerifier rejects invalid settlement token pairs' backend/test/settlement-verifier.test.mjs
grep -q 'LocalSettlementVerifier rejects invalid settlement amounts' backend/test/settlement-verifier.test.mjs
grep -q 'LocalSettlementVerifier rejects settlement amountOut below minimum' backend/test/settlement-verifier.test.mjs
grep -q 'LocalSettlementVerifier rejects unsafe policy configuration at construction' backend/test/settlement-verifier.test.mjs
grep -q 'settlement verifier policy fail-fast' book/Volume5-BackendEngineering/Chapter06-Execution-Service.md
grep -q 'RISK_REJECTED' backend/test/api.test.mjs
grep -q 'risk rejection when rejected quote persistence fails' backend/test/api.test.mjs
grep -q 'Rejected quote persistence unavailable' book/Volume5-BackendEngineering/Chapter04-Risk-Service.md
grep -q 'SLIPPAGE_TOO_WIDE' backend/test/api.test.mjs
grep -q 'stale market data' backend/test/api.test.mjs
grep -q 'market data timestamps too far in the future' backend/test/api.test.mjs
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
grep -q 'degrades readiness when market data timestamp is too far in the future' backend/test/api.test.mjs
grep -q 'degrades readiness when routing probe fails' backend/test/api.test.mjs
grep -q 'degrades readiness when pricing probe fails' backend/test/api.test.mjs
grep -q 'degrades readiness when risk probe fails' backend/test/api.test.mjs
grep -q 'degrades readiness when signer probe fails' backend/test/api.test.mjs
grep -q 'degrades readiness when storage dependency probes fail' backend/test/api.test.mjs
grep -q 'readiness signer degraded' book/Volume5-BackendEngineering/Chapter01-API-Gateway.md
grep -q 'readiness routing degraded' book/Volume5-BackendEngineering/Chapter01-API-Gateway.md
grep -q 'readiness pricing degraded' book/Volume5-BackendEngineering/Chapter01-API-Gateway.md
grep -q 'readiness risk degraded' book/Volume5-BackendEngineering/Chapter01-API-Gateway.md
grep -q 'readiness config fail-fast' book/Volume5-BackendEngineering/Chapter01-API-Gateway.md
grep -q 'readiness storage dependency degraded' book/Volume5-BackendEngineering/Chapter01-API-Gateway.md
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
grep -q 'graceful shutdown handlers' backend/test/api.test.mjs
grep -q 'graceful shutdown failures' backend/test/api.test.mjs
grep -q 'unmatched routes to structured errors' backend/test/api.test.mjs
grep -q 'settlement shape' backend/test/api.test.mjs
grep -q 'expired submit quotes' backend/test/api.test.mjs
grep -q 'unissued submit quotes' backend/test/api.test.mjs
grep -q 'replayed submit quotes' backend/test/api.test.mjs
grep -q 'same millisecond' backend/test/api.test.mjs
grep -q 'rate limits quote requests by client' backend/test/api.test.mjs
grep -q 'rate limits submit requests before validation and settlement' backend/test/api.test.mjs
grep -q 'rate limits quote status requests by client' backend/test/api.test.mjs
grep -q 'rfq_rate_limited_total\\{endpoint="quote"\\} 1' backend/test/api.test.mjs
grep -q 'rfq_rate_limited_total\\{endpoint="submit"\\} 1' backend/test/api.test.mjs
grep -q 'rfq_rate_limited_total\\{endpoint="status"\\} 1' backend/test/api.test.mjs
grep -q 'PnL record creation fails' backend/test/api.test.mjs
grep -q 'PnL summary store failures' backend/test/api.test.mjs
grep -q 'rfq_pnl_record_errors_total' book/Volume5-BackendEngineering/Chapter08-Metrics-Service.md
grep -q 'PnL attribution after settlement is best-effort' book/Volume5-BackendEngineering/Chapter06-Execution-Service.md
grep -q 'ReconciliationService.reconcileSettlementToQuote()' book/Volume5-BackendEngineering/Chapter06-Execution-Service.md
grep -q 'ReconciliationService.reconcileSettlementToHedge()' book/Volume5-BackendEngineering/Chapter06-Execution-Service.md
grep -q 'ReconciliationService.reconcileSettlementToPnl()' book/Volume5-BackendEngineering/Chapter06-Execution-Service.md
grep -q 'make reconciliation-check' book/Volume5-BackendEngineering/Chapter06-Execution-Service.md
grep -q 'PnL attribution input validation' book/Volume5-BackendEngineering/Chapter06-Execution-Service.md
grep -q 'signed realized PnL' backend/test/pnl.test.mjs
grep -q 'applies each chain event idempotently' backend/test/settlement-event.test.mjs
grep -q 'InMemoryRateLimiter enforces endpoint-specific windows' backend/test/rate-limit.test.mjs
grep -q 'InMemoryRateLimiter rejects unsafe configuration at construction' backend/test/rate-limit.test.mjs
grep -q 'InMemoryRateLimiter rejects unsafe request inputs before writing buckets' backend/test/rate-limit.test.mjs
grep -q 'unsafe rate limit configuration at startup' backend/test/api.test.mjs
grep -q 'assertPositiveSafeInteger(config.volatilityDivisor, "volatilityDivisor")' backend/src/modules/pricing/pricing.engine.ts
grep -q 'assertBpsUpperBound(config.maxTotalAdjustmentBps, "maxTotalAdjustmentBps")' backend/src/modules/pricing/pricing.engine.ts
grep -q 'assertPricingInput(input)' backend/src/modules/pricing/pricing.engine.ts
grep -q 'routePlan token pair must match request token pair' backend/src/modules/pricing/pricing.engine.ts
grep -q 'maxSizeImpactBps must be less than or equal to maxTotalAdjustmentBps' backend/src/modules/pricing/pricing.engine.ts
grep -q 'FormulaPricingEngine rejects unsafe pricing configuration at construction' backend/test/pricing.test.mjs
grep -q 'FormulaPricingEngine rejects unsafe pricing inputs before quoting' backend/test/pricing.test.mjs
grep -q 'pricing config fail-fast' book/Volume2-MarketData-And-Pricing/Chapter07-Pricing-Formula.md
grep -q 'restricted toxic-flow users' backend/test/risk.test.mjs
grep -q 'toxic-flow score threshold' backend/test/risk.test.mjs
grep -q 'quoted spreads above policy limit' backend/test/risk.test.mjs
grep -q 'BasicRiskEngine rejects unsafe policy configuration at construction' backend/test/risk.test.mjs
grep -q 'BasicRiskEngine rejects unsafe runtime inputs before policy evaluation' backend/test/risk.test.mjs
grep -q 'policy config fail-fast' book/Volume5-BackendEngineering/Chapter04-Risk-Service.md
grep -q 'pricing spread exceeds risk guard before signing' backend/test/api.test.mjs
grep -q 'QUOTED_SPREAD_TOO_WIDE' book/Volume5-BackendEngineering/Chapter04-Risk-Service.md
grep -q 'maxQuotedSpreadBps' book/Volume3-RiskEngine/Chapter05-Position-Limits.md
grep -q 'rfq_quote_requests_total' infra/prometheus/rules/rfq-alerts.yml
grep -q 'RFQQuoteResponsesStalled' infra/prometheus/rules/rfq-alerts.yml
grep -q 'rfq_quote_responses_total' book/Volume7-ProductionDeployment/Chapter05-Runbook.md
grep -q 'RFQQuoteLatencyP95High' infra/prometheus/rules/rfq-alerts.yml
grep -q 'RFQQuoteRiskRejectSpike' infra/prometheus/rules/rfq-alerts.yml
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
grep -q 'make reconciliation-check' book/Volume7-ProductionDeployment/Chapter05-Runbook.md
grep -q 'reconciliation-check: backend-build' Makefile
grep -q 'scripts/reconciliation-check.mjs' Makefile
grep -q 'run_step make reconciliation-check' scripts/verify.sh
grep -q 'reconciliation:check' package.json
grep -q 'reconcileSettlementToQuote' scripts/reconciliation-check.mjs
grep -q 'reconcileSettlementToHedge' scripts/reconciliation-check.mjs
grep -q 'reconcileSettlementToPnl' scripts/reconciliation-check.mjs
grep -q 'quoteRetryReport' scripts/reconciliation-check.mjs
grep -q 'hedgeRetryReport' scripts/reconciliation-check.mjs
grep -q 'pnlRetryReport' scripts/reconciliation-check.mjs
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
grep -q 'terminationGracePeriodSeconds: 30' infra/k8s/backend-deployment.yaml
grep -q 'preStop' infra/k8s/backend-deployment.yaml
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
grep -q 'audit checklist must leave unresolved control unchecked' scripts/check-security-docs-consistency.mjs
grep -Fq -- '- [x] EIP-712 domain includes name, version, chainId and verifyingContract.' docs/security/audit-checklist.md
grep -Fq -- '- [x] `submitQuote` rejects expired quotes.' docs/security/audit-checklist.md
grep -Fq -- '- [x] Risk Engine runs before Signer Service.' docs/security/audit-checklist.md
grep -Fq -- '- [x] Settlement events use `(chainId, txHash, logIndex)` idempotency.' docs/security/audit-checklist.md
grep -Fq -- '- [x] Indexer handles chain reorgs.' docs/security/audit-checklist.md
grep -Fq -- '- [x] Inventory updates are replayable.' docs/security/audit-checklist.md
grep -Fq -- '- [x] Sensitive thresholds are not exposed to users.' docs/security/audit-checklist.md
grep -Fq -- '- [x] ClickHouse analytics do not become operational source of truth.' docs/security/audit-checklist.md
grep -Fq -- '- [x] Signer key rotation is documented.' docs/security/audit-checklist.md
grep -Fq -- '- [x] Emergency pause procedure is documented.' docs/security/audit-checklist.md
grep -Fq -- '- [x] `submitQuote` uses SafeERC20 for transfers.' docs/security/audit-checklist.md
grep -Fq -- '- [x] AccessControl protects signer and token whitelist updates.' docs/security/audit-checklist.md
grep -q 'SettlementEventService.removeSettlementEvent()' book/Volume5-BackendEngineering/Chapter06-Execution-Service.md
grep -q 'removed/reorg logs' book/Volume7-ProductionDeployment/Chapter05-Runbook.md
grep -q '本地 `SafeERC20` 库' book/Volume4-SmartContracts/Chapter02-RFQSettlement.md
grep -q 'SIGNER_ADMIN_ROLE' book/Volume4-SmartContracts/Chapter02-RFQSettlement.md
grep -q 'TOKEN_ADMIN_ROLE' book/Volume4-SmartContracts/Chapter02-RFQSettlement.md
grep -q 'testSubmitQuoteAcceptsNoReturnERC20Transfers' contracts/test/RFQSettlement.t.sol
grep -q 'testSubmitQuoteRejectsFalseReturnTokenInBeforeConsumingNonce' contracts/test/RFQSettlement.t.sol
grep -q 'testSubmitQuoteRejectsFalseReturnTokenOutAndRollsBackTokenIn' contracts/test/RFQSettlement.t.sol
grep -q 'testAccessControlSeparatesSignerAndTokenWhitelistRoles' contracts/test/RFQSettlement.t.sol
grep -q 'testAccessControlRevocationRemovesAdminCapability' contracts/test/RFQSettlement.t.sol
grep -q 'Run a canary signing check' docs/security/key-management.md
grep -q 'negative canary using the old signer' docs/security/key-management.md
grep -q 'Emergency Pause Procedure' book/Volume7-ProductionDeployment/Chapter05-Runbook.md
grep -q 'RFQSettlement.setPaused(true)' book/Volume7-ProductionDeployment/Chapter05-Runbook.md
grep -q 'negative submit canary' book/Volume7-ProductionDeployment/Chapter05-Runbook.md
grep -q 'two-person approval' book/Volume7-ProductionDeployment/Chapter05-Runbook.md
grep -q 'OpenAPI public contract must not expose sensitive risk field' scripts/check-security-docs-consistency.mjs
grep -q 'Public API responses must not expose internal risk thresholds' book/Volume5-BackendEngineering/Chapter04-Risk-Service.md
grep -q 'policyVersion or internal reasonCode values' book/Volume5-BackendEngineering/Chapter04-Risk-Service.md
grep -q 'pricing adjustment breakdown' book/Volume5-BackendEngineering/Chapter01-API-Gateway.md
grep -q 'ClickHouse is an analytics replica only' book/Volume5-BackendEngineering/Chapter08-Metrics-Service.md
grep -q 'never from ClickHouse query results' book/Volume5-BackendEngineering/Chapter08-Metrics-Service.md
grep -q 'must never be used as the operational source of truth' book/Volume7-ProductionDeployment/Chapter03-Monitoring.md
grep -q 'storage ADR must keep ClickHouse analytical-only boundary' scripts/check-security-docs-consistency.mjs
grep -q 'Pod Termination Or Rollout Drain' book/Volume7-ProductionDeployment/Chapter05-Runbook.md
grep -q 'Fastify close' book/Volume7-ProductionDeployment/Chapter05-Runbook.md
grep -q 'terminationGracePeriodSeconds=30' book/Volume7-ProductionDeployment/Chapter02-Kubernetes.md
grep -q 'preStop' book/Volume7-ProductionDeployment/Chapter02-Kubernetes.md
grep -q 'service.annotations' infra/helm/rfq-market-maker/templates/service.yaml
grep -q 'prometheus.io/scrape' infra/helm/rfq-market-maker/values.yaml
grep -q 'prometheus.io/path' infra/helm/rfq-market-maker/values.yaml
grep -q 'name: rfq-market-maker' infra/helm/rfq-market-maker/Chart.yaml
grep -q '/docker-entrypoint-initdb.d/001-schema.sql' book/Volume7-ProductionDeployment/Chapter01-Docker.md
grep -q 'Redis uses `redis-cli ping`' book/Volume7-ProductionDeployment/Chapter01-Docker.md

echo "skeleton check passed"
