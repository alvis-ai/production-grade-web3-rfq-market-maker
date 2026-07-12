# Production-Grade Web3 RFQ Market Maker

## Project Description

这是一个 Web3 RFQ / Prop AMM 做市系统参考工程，覆盖从链下报价到链上结算的完整业务链路。系统以 RFQ 报价为入口，通过市场数据、定价、库存风控、EIP-712 签名、合约校验、成交结算、库存更新、对冲和指标观测共同保证报价与执行的一致性。

项目内容包括系统设计文档、ADR、Mermaid 架构图、OpenAPI 接口定义、数据库模型、后端 RFQ 服务、Solidity 结算合约、前端交易页面、TypeScript SDK 和部署配置。

## Core Flow

```text
/quote
  -> market data
  -> pricing engine
  -> risk engine
  -> EIP-712 signed quote
  -> /submit
  -> smart contract verification
  -> settlement
  -> inventory update
  -> hedge engine
  -> metrics / PnL
```

## System Components

- **RFQ API**: 接收报价请求，聚合市场数据、定价、风控和签名结果。
- **Market Data Service**: 维护外部价格源、链上流动性和归一化价格快照。
- **Routing Engine**: 在内部库存、外部交易场所和未来聚合路径之间选择报价路径。
- **Pricing Engine**: 基于 mid price、spread、size impact、volatility premium 和库存偏移生成报价。
- **Risk Engine**: 校验库存、delta、gamma、VaR、position limits 和 toxic flow 风险。
- **EIP-712 Signer**: 只对通过风控的短生命周期 quote 进行签名。
- **RFQSettlement Contract**: 在链上校验签名、nonce、deadline、token whitelist 和成交边界。
- **Inventory Service**: 记录成交后的库存变化，并向定价和对冲模块提供状态。
- **Hedge Engine**: 根据库存敞口触发外部交易场所或链上路径的对冲动作。
- **Observability**: 暴露 quote、submit、settlement、PnL 和风险状态相关指标。
- **Analytics Pipeline**: 通过 PostgreSQL transactional outbox、Redpanda 和 ClickHouse 保存可重放的高维业务事件；outbox 与业务写入原子提交，Redpanda/ClickHouse 故障不进入交易请求事务。
- **Frontend / SDK**: 提供交易表单、报价状态展示和 TypeScript 客户端封装。

## Repository Layout

```text
backend/     TypeScript / Fastify RFQ service
contracts/   Solidity RFQ settlement contracts and Foundry tests
frontend/    React quote UI
sdk/         TypeScript SDK and EIP-712 helpers
docs/        ADRs, API specs, diagrams, database schema, security docs
book/        Long-form engineering design volumes
infra/       Docker, Kubernetes, Helm, Prometheus and Grafana configuration
```

## Technology Stack

- Backend: Node.js, TypeScript, Fastify, PostgreSQL, Redis, Redpanda, ClickHouse
- Smart Contract: Solidity, Foundry, OpenZeppelin, EIP-712, SafeERC20, ReentrancyGuard, Pausable, AccessControl
- Frontend: React, Vite, TypeScript, Wagmi, Viem, RainbowKit, TanStack Query
- Infra: Docker Compose, Kubernetes, Helm, GitHub Actions, Prometheus, Grafana

## API Surface

The OpenAPI specification lives in [`docs/api/openapi.yaml`](docs/api/openapi.yaml). Core endpoints:

Every HTTP response includes an `x-trace-id` header for request correlation. Clients may send a safe `tr_`-prefixed `x-trace-id`; the gateway echoes it when it passes length and character checks, otherwise it falls back to a generated request id. Structured error responses also include the same value in `traceId`, so SDKs, frontend error panels, logs, and metrics can be joined during incident triage.

```http
POST /quote
POST /submit
GET /quote/:id
GET /settlements/:id
GET /hedges/:id
GET /pnl
GET /health
GET /ready
GET /metrics
```

Example `POST /quote` request:

```json
{
  "chainId": 1,
  "user": "0xUser",
  "tokenIn": "0xUSDC",
  "tokenOut": "0xWETH",
  "amountIn": "1000000000",
  "slippageBps": 50
}
```

Example `POST /quote` response:

```json
{
  "quoteId": "q_abc123",
  "snapshotId": "s_98765",
  "amountOut": "332100000000000000",
  "minAmountOut": "330400000000000000",
  "deadline": 1730000000,
  "nonce": "12345",
  "signature": "0x..."
}
```

## Smart Contract Surface

核心合约为 `RFQSettlement`，关键入口为：

```solidity
function submitQuote(
    Quote calldata quote,
    bytes calldata signature
) external nonReentrant whenNotPaused returns (uint256 amountOut);
```

核心保护包括 EIP-712 verification、trusted signer、nonce replay protection、deadline expiry、token whitelist、pause、reentrancy protection 和 SafeERC20。`Treasury` 作为独立 custody 边界随部署脚本一起创建，并配置为信任对应的 `RFQSettlement` 地址；`RFQSettlement` 将用户 `tokenIn` 转入 Treasury，常规 `tokenOut` 放款走 settlement-only `release`，应急资金迁移走 owner-only `emergencyWithdraw`。

Local deployment script:

```sh
cd contracts
RFQ_TRUSTED_SIGNER=0x0000000000000000000000000000000000000001 \
RFQ_TOKEN_WHITELIST_JSON='{"tokens":["0x0000000000000000000000000000000000000002"]}' \
forge script script/Deploy.s.sol:DeployRFQSettlement
```

## Local Configuration

Copy `.env.example` for local backend configuration. The included signer key is the public Anvil development key and must only be used on local chains.

```text
HOST=127.0.0.1
PORT=3000
RFQ_QUOTE_TTL_SECONDS=30
RFQ_BODY_LIMIT_BYTES=32768
RFQ_CORS_ALLOWED_ORIGINS=http://localhost:5173
RFQ_ENABLE_HSTS=false
RFQ_TRUST_PROXY=false
RFQ_RATE_LIMIT_BACKEND=memory
# RFQ_REDIS_URL=redis://127.0.0.1:6379/0
VITE_RFQ_API_BASE_URL=http://localhost:3000
VITE_RFQ_SETTLEMENT_ADDRESS=0x...
VITE_WALLETCONNECT_PROJECT_ID=00000000000000000000000000000000
RFQ_TOKEN_REGISTRY_JSON={"tokens":[{"chainId":1,"tokenAddress":"0x0000000000000000000000000000000000000002","symbol":"TOKEN2","decimals":18,"isWhitelisted":true,"riskTier":"low","usdReference":true},{"chainId":1,"tokenAddress":"0x0000000000000000000000000000000000000003","symbol":"TOKEN3","decimals":18,"isWhitelisted":true,"riskTier":"low","usdReference":true}]}
# RFQ_MARKET_PAIRS=1:0xTokenIn:0xTokenOut
# RFQ_CEX_PAIRS=1:0xTokenIn:0xTokenOut:binance:ETHUSDT,1:0xTokenIn:0xTokenOut:coinbase:ETH-USDT
RFQ_CEX_MAX_SOURCE_AGE_MS=2000
RFQ_CEX_MIN_SOURCES=1
RFQ_CEX_MAX_SOURCE_DEVIATION_BPS=100
RFQ_CEX_MAX_SPREAD_BPS=100
# RFQ_HEDGE_ROUTES_JSON={"routes":[...]}
# RFQ_MARKET_DATA_PROVIDER=chainlink
# RFQ_CHAINLINK_CONFIG_JSON={...}
RFQ_ALLOW_SIMULATED_SETTLEMENT=true
# RFQ_RECEIPT_CONFIG_JSON={"chains":[...]}
RFQ_SIGNER_PRIVATE_KEY=0x...
RFQ_SETTLEMENT_ADDRESS=0x...
```

The backend signer uses the same `ProductionGradeRFQ` EIP-712 domain as the SDK and `RFQSettlement` contract. The default settlement verifier derives its trusted signer address and verifying contract from the same `RFQ_SIGNER_PRIVATE_KEY` and `RFQ_SETTLEMENT_ADDRESS` startup config, then recovers the EIP-712 signer during `/submit` before settlement evidence is consumed. `HOST` defaults to `127.0.0.1` and must not contain whitespace; `PORT` defaults to `3000` and must be a base-10 integer from 1 to 65535. Backend startup reads only own environment fields, so prototype-backed `HOST`, `PORT`, `RFQ_QUOTE_TTL_SECONDS`, signer, CORS, HSTS, proxy, Redis or token-registry values are treated as unset. `RFQ_QUOTE_TTL_SECONDS` controls the signed quote lifetime and must be a base-10 integer from 1 to 3600; keep it short enough to limit stale price execution. `RFQ_BODY_LIMIT_BYTES` controls the maximum JSON request body size and must be a base-10 integer from 1024 to 1048576. `RFQ_CORS_ALLOWED_ORIGINS` is a comma-separated allowlist of HTTP(S) URL origins that may call the API; startup rejects entries with paths, query strings, fragments, credentials, or wildcards, then normalizes each accepted origin with `URL.origin`. `RFQ_ENABLE_HSTS` must only be enabled when the public API is served through HTTPS. `RFQ_TRUST_PROXY` defaults to `false`; only enable it when a trusted reverse proxy or ingress strips untrusted `x-forwarded-for` input and writes the client IP. `RFQ_TOKEN_REGISTRY_JSON` is the trusted, startup-validated source for each supported chain/token address, symbol, decimals, whitelist state, risk tier and USD-reference status; quote requests never supply or override token decimals. `VITE_RFQ_API_BASE_URL` configures the browser API endpoint and must be an absolute HTTP(S) URL with an optional path prefix, no credentials, no wildcard host, and no query string or fragment. `VITE_RFQ_SETTLEMENT_ADDRESS` configures the browser-side `RFQSettlement.submitQuote` target. `VITE_WALLETCONNECT_PROJECT_ID` configures RainbowKit wallet connection and must be a 128-character-or-shorter safe string containing only letters, numbers, underscore, or hyphen.

Local development permits synthetic settlement only when `RFQ_ALLOW_SIMULATED_SETTLEMENT=true`. In receipt-confirmed mode the wallet broadcasts `RFQSettlement.submitQuote`, then sends the resulting `txHash` to `POST /submit`. The backend treats that hash only as an RPC lookup key: it waits for configured confirmations, verifies transaction `from`, `to`, and decoded `submitQuote` calldata against the stored quote/signature, requires a successful receipt, and requires exactly one matching `QuoteSettled` event before inventory, hedge, PnL, or quote-status side effects.

When `DATABASE_URL` is configured, quote audit records and the complete post-trade path use PostgreSQL. Settlement event insertion, both inventory token deltas, and a durable reconciliation revision commit in one transaction; duplicate `(chain_id, tx_hash, log_index)` events cannot apply inventory twice, while a partial unique index permits only one canonical settlement per quote and still allows a replacement after reorg. Inventory pricing reads the shared `inventory_positions` projection on every request, so horizontally scaled replicas use one exposure state. Hedge intents and PnL records are durable idempotent projections keyed by settlement event and quote/model. Startup takes a transaction-scoped advisory lock and repairs inventory from canonical settlement events plus every externally executed hedge fill before readiness. Reorg removal marks an event non-canonical instead of deleting audit history and rebuilds inventory in the same transaction. Quote/PnL reconciliation removes chain-derived pointers, while submission-attempted or terminal CEX hedge evidence remains because a chain reorg cannot undo a potentially accepted external trade.

The reconciliation worker (`pnpm --dir backend start:reconciliation-worker`) continuously converges those post-trade projections and exposes health and metrics on port 3003. Multiple replicas lease quote-scoped desired revisions with `FOR UPDATE SKIP LOCKED`; a canonical revision restores hedge, PnL, and complete quote pointers, while a no-canonical revision removes only reversible projections. A canonical state change increments the desired revision without stealing an active lease, so an old worker cannot mark newer chain state processed. Exponential retries retain stable low-cardinality error codes and no job is discarded because of retry count.

The destructive integration check requires an explicit acknowledgement and a disposable PostgreSQL database. It verifies initial convergence, reorg cleanup, and a replacement canonical transaction for the same quote, then removes its uniquely named fixtures:

```sh
DATABASE_URL=postgres://rfq:rfq@127.0.0.1:5432/rfq_market_maker \
RFQ_RECONCILIATION_INTEGRATION_CONFIRM=yes \
make reconciliation-integration-check
```

The hedge worker is a separate process (`pnpm --dir backend start:hedge-worker`) with its own CEX credentials and health surface on port 3001. `RFQ_HEDGE_ROUTES_JSON` maps each `chainId/token` base asset to a Binance symbol, token decimals, and raw-unit step size. Multiple replicas claim due `hedge_orders` with `FOR UPDATE SKIP LOCKED` and expiring leases. Before every market order the worker persists a deterministic 36-character client order id and queries Binance by that id; it submits only when the order is absent. Network timeouts, rate limits, unknown responses, and pending orders remain queued because an externally accepted order must never be marked failed from local retry exhaustion. Only an explicit venue terminal status or deterministic route/quantity error produces `failed`.

The analytics worker is another isolated process (`pnpm --dir backend start:analytics-worker`) with health and metrics on port 3002. PostgreSQL triggers append versioned quote, market snapshot, risk, settlement, inventory, hedge and PnL events to `analytics_outbox` in the same transaction as each operational state change. Replicas lease rows with `FOR UPDATE SKIP LOCKED`, publish keyed envelopes to the fixed `rfq.analytics.v1` Redpanda topic with all-replica acknowledgements, and mark rows published only after broker acknowledgement. A crash between broker acknowledgement and the PostgreSQL update can duplicate an event, so the ClickHouse projection uses `event_id` with `ReplacingMergeTree`; Kafka offsets are committed only after a successful ClickHouse batch insert. PostgreSQL remains the sole operational source of truth.

The optional end-to-end check writes uniquely identified synthetic trades, waits for all seven event types, and then removes only its own PostgreSQL and ClickHouse fixtures. It refuses to run without an explicit acknowledgement and should still target disposable local dependencies:

```sh
DATABASE_URL=postgres://rfq:rfq@127.0.0.1:5432/rfq_market_maker \
RFQ_CLICKHOUSE_URL=http://127.0.0.1:8123 \
RFQ_ANALYTICS_INTEGRATION_CONFIRM=yes \
make analytics-integration-check
```

`RFQ_MARKET_PAIRS` controls background snapshot prefetch. `RFQ_CEX_PAIRS` adds exchange-specific Level-2 sources using `chainId:tokenIn:tokenOut:exchange:symbol`; configure Binance and Coinbase separately because their symbols differ. Every active pair must be covered by `RFQ_TOKEN_REGISTRY_JSON`, both tokens must be whitelisted, and at least one side must be an approved USD reference. A CEX pair additionally requires `tokenOut` to be the USD reference because the order-book adapter reports depth as quote-currency USD notional. Prices and quantities use exact 18-decimal fixed-point arithmetic. `midPrice` always means human tokenOut units per one human tokenIn; `formula-v2` converts the result back to tokenOut base units with both registry decimals and computes size impact from rational USD notional rather than raw token base units. A source participates only after full-book synchronization and while its exchange event time, two-sided spread and payload remain valid. Cross-venue outliers beyond `RFQ_CEX_MAX_SOURCE_DEVIATION_BPS` are removed before the median; if fewer than `RFQ_CEX_MIN_SOURCES` remain, the CEX cache entry is deleted immediately. Non-local environments default to two sources per pair, while local development defaults to one. Unchanged books do not receive synthetic observation times, and stale, malformed or sequence-gapped sources must obtain a new full snapshot before becoming ready again.

The base provider defaults to `static`. Set `RFQ_MARKET_DATA_PROVIDER=chainlink` with `RFQ_CHAINLINK_CONFIG_JSON` to read configured AggregatorV3 feeds. Every network declares `networkType` as `l1` or `l2`; L2 configurations must provide both a Sequencer Uptime Feed and recovery grace period, while L1 configurations reject sequencer fields. The backend rejects non-positive, future-dated, stale, malformed, or decimals-mismatched rounds and uses the oracle `updatedAt` as the snapshot observation time. CEX snapshots live in a separate higher-priority cache, so the fallback provider cannot overwrite a synchronized order book merely because its updater ran later.

The opt-in live check opens a public market-data stream without credentials and verifies full-book synchronization, event freshness, a non-crossed spread and positive near-mid depth:

```sh
RFQ_CEX_INTEGRATION_CONFIRM=yes \
RFQ_CEX_INTEGRATION_EXCHANGE=coinbase \
RFQ_CEX_INTEGRATION_SYMBOL=ETH-USD \
make cex-orderbook-integration-check
```

`make smoke-api-local` starts the built backend, requests a quote, cryptographically recovers the EIP-712 signer from the returned signature using `RFQ_SIGNER_PRIVATE_KEY` and `RFQ_SETTLEMENT_ADDRESS`, submits the quote, verifies replay rejection, and checks settlement, hedge, PnL and Prometheus metrics.

Direct `buildServer(options)` embedding follows the same runtime bounds for `bodyLimitBytes` and `quoteTtlSeconds`, and rejects non-boolean `logger`, `enableHsts` or `trustProxy` values before the Fastify instance is created.

The frontend reads `VITE_RFQ_API_BASE_URL`, `VITE_RFQ_SETTLEMENT_ADDRESS` and `VITE_WALLETCONNECT_PROJECT_ID` at Vite build/dev-server time. It shows the active API endpoint in the trading console header, sends a dynamic `tr_web_*` `x-trace-id` through the SDK for each API request, and uses Wagmi/RainbowKit with the SDK `rfqSettlementAbi`, `buildSubmitQuoteArgs`, and `hashSettlementQuote` helpers for wallet-driven `submitQuote` transactions and settlement-event reconciliation. Wallet and contract-call failures are normalized into bounded UI messages, preferring viem/wagmi `shortMessage`, `details` or custom-error cause text when present.

## Local Docker Stack

The local compose stack can run the reference backend, static frontend, Prometheus, Grafana and data dependencies:

```sh
docker compose up --build
```

Start the credential-isolated Binance hedge worker only after supplying trade-only testnet credentials:

```sh
RFQ_BINANCE_API_KEY=... RFQ_BINANCE_API_SECRET=... \
  docker compose --profile hedge up --build hedge-worker
```

Start the local transactional analytics pipeline, including topic initialization:

```sh
docker compose --profile analytics up --build analytics-worker
```

Start durable post-trade convergence independently of the API process:

```sh
docker compose --profile reconciliation up --build reconciliation-worker
```

Local ports:

- Backend API: `http://localhost:3000`
- Frontend console: `http://localhost:5173`
- Prometheus: `http://localhost:9090`
- Grafana: `http://localhost:3001`
- Analytics worker metrics: `http://localhost:3002/metrics`
- Reconciliation worker metrics: `http://localhost:3003/metrics`
- Redpanda external listener: `localhost:19092`
- ClickHouse HTTP: `http://localhost:8123`

## Production Configuration

When `NODE_ENV` is set to any non-local environment such as `production` or `staging`, the backend refuses to start unless `RFQ_SIGNER_PRIVATE_KEY`, `RFQ_SETTLEMENT_ADDRESS`, and `DATABASE_URL` are explicitly configured. It also defaults `RFQ_ALLOW_SIMULATED_SETTLEMENT` to `false`, requires at least one valid chain in `RFQ_RECEIPT_CONFIG_JSON`, forces `RFQ_RATE_LIMIT_BACKEND=redis`, and requires a valid `RFQ_REDIS_URL`. The signer private key must be a 32-byte hex string and the settlement contract must be a 20-byte hex address; every receipt chain settlement address must match the EIP-712 settlement address. The built-in Anvil signer fallback is only for unset `NODE_ENV`, `development`, or `test`; synthetic settlement, process-local rate limits, and in-memory operational stores have the same local-only boundary.

Leave `RFQ_TRUST_PROXY=false` unless the public API is behind a trusted load balancer or ingress that removes incoming spoofed `x-forwarded-for` headers and sets the canonical client address. When enabled, the rate limiter keys by the first `x-forwarded-for` entry after enforcing the 128 character limit and `[A-Za-z0-9_.:-]` character set; otherwise it uses the direct socket IP. Redis uses one atomic Lua operation for counter, TTL and limit decisions across replicas. Redis errors return `RATE_LIMIT_UNAVAILABLE`/503 and degrade `rateLimitStore` readiness; the gateway never silently fails open.

Kubernetes deployments load these values from `rfq-backend-secrets`. Replace the placeholders in `infra/k8s/backend-secret.yaml` before applying manifests, or create the same Secret out of band:

```sh
kubectl -n rfq-market-maker create secret generic rfq-backend-secrets \
  --from-literal=DATABASE_URL=postgres://user:password@postgres.example.com:5432/rfq_market_maker \
  --from-literal=RFQ_SIGNER_PRIVATE_KEY=0x... \
  --from-literal=RFQ_SETTLEMENT_ADDRESS=0x... \
  --from-literal=RFQ_REDIS_URL=rediss://user:password@redis.example.com:6380/0
```

Create a separate worker Secret so API pods never receive venue credentials. The Binance key should permit spot trading only, use an IP allowlist, and have withdrawals disabled:

```sh
kubectl -n rfq-market-maker create secret generic rfq-hedge-worker-secrets \
  --from-literal=DATABASE_URL=postgres://worker:password@postgres.example.com:5432/rfq_market_maker \
  --from-literal=RFQ_BINANCE_API_KEY=... \
  --from-literal=RFQ_BINANCE_API_SECRET=...
```

Create a separate analytics Secret so API and hedge pods never receive Kafka or ClickHouse credentials:

```sh
kubectl -n rfq-market-maker create secret generic rfq-analytics-worker-secrets \
  --from-literal=DATABASE_URL=postgres://analytics:password@postgres.example.com:5432/rfq_market_maker \
  --from-literal=RFQ_ANALYTICS_KAFKA_SASL_USERNAME=... \
  --from-literal=RFQ_ANALYTICS_KAFKA_SASL_PASSWORD=... \
  --from-literal=RFQ_CLICKHOUSE_USERNAME=... \
  --from-literal=RFQ_CLICKHOUSE_PASSWORD=...
```

Create a reconciliation-only database Secret. This role needs read access to quotes and settlements plus bounded write access to quote status, hedge, PnL, and reconciliation job tables, but no DDL privileges:

```sh
kubectl -n rfq-market-maker create secret generic rfq-reconciliation-worker-secrets \
  --from-literal=DATABASE_URL=postgres://reconciliation:password@postgres.example.com:5432/rfq_market_maker
```

Use a third, migration-only Secret for the init container's DDL-capable database role. Runtime API and worker roles should not own schema privileges:

```sh
kubectl -n rfq-market-maker create secret generic rfq-database-migration-secrets \
  --from-literal=DATABASE_URL=postgres://migrator:password@postgres.example.com:5432/rfq_market_maker
```

The Helm chart expects signer keys through `signerSecret`, the Redis URL through `redisSecret`, and the API PostgreSQL URL through `databaseSecret.name` / `databaseSecret.urlKey`. `hedgeWorker.secret` references the separate worker database and Binance credential keys; `analyticsWorker.secret` references the analytics database, Kafka SASL and ClickHouse credentials. Routing and broker endpoint metadata stay in non-secret values.

API, hedge, analytics, and reconciliation Kubernetes Deployments run the migration entrypoint in an init container using `migrationSecret`. Migration discovery and execution are serialized by a PostgreSQL session advisory lock, allowing multiple rollout pods to start safely while ensuring `005-post-trade-reconciliation.sql` and all earlier migrations are committed before any process checks readiness. The DDL-capable migrator credential is not mounted into runtime containers. Production operators must provision `rfq.analytics.v1` before starting analytics consumers; auto topic creation is intentionally disabled.

Local API smoke path:

```sh
make smoke-api-local
```

Repository quality gate:

```sh
make verify
```

`make verify` runs skeleton, examples, configuration, documentation, book template, ADR, security documentation, metrics consistency, runbook consistency, Grafana dashboard consistency, deployment manifest consistency, CI workflow consistency, Docker Compose, EIP-712, ABI, API rate-limit, API error-code, API schema, API route, database schema, quote and submit benchmarks, backend, SDK, frontend and local API smoke checks through one entrypoint. If Foundry is installed locally it also runs `make contract-test`; otherwise contract tests remain enforced by the dedicated GitHub Actions contract workflow.

Local benchmarks:

```sh
make benchmark-quote
make benchmark-submit
```

The quote benchmark builds the backend and exercises `POST /quote` through Fastify injection without binding a network port. Defaults are 100 samples, p95 <= 50 ms and zero HTTP errors. Override with `RFQ_BENCHMARK_QUOTE_REQUESTS`, `RFQ_BENCHMARK_MAX_P95_MS` and `RFQ_BENCHMARK_MAX_ERRORS` for local profiling.

The submit benchmark builds the backend, requests a fresh quote per sample, then measures `POST /submit` through settlement verification, inventory update, hedge intent creation and PnL attribution. Defaults are 50 measured submit samples, p95 <= 100 ms and zero setup or submit errors. Override with `RFQ_BENCHMARK_SUBMIT_REQUESTS`, `RFQ_BENCHMARK_SUBMIT_MAX_P95_MS` and `RFQ_BENCHMARK_SUBMIT_MAX_ERRORS`.

## TypeScript SDK

`@rfq-market-maker/sdk` exposes `RFQClient` for the current API surface:

```ts
const client = new RFQClient("http://localhost:3000");
const clientWithCustomFetch = new RFQClient("http://localhost:3000", { fetch: customFetch });
const tracedClient = new RFQClient("http://localhost:3000", { traceId: () => "tr_request_123" });

await client.quote(request);
await client.submit({ quote, signature });
await client.getQuote("q_...");
await client.getSettlement("se_...");
await client.getHedge("h_...");
await client.pnl();
await client.health();
await client.ready();
await client.metrics();
```

`RFQClientError` preserves structured API errors. It uses safe own-field `ErrorResponse.traceId` values when the backend returns the standard error body, and falls back to safe `x-trace-id` response headers when an upstream proxy, malformed JSON, prototype-backed error body, or malformed successful response field prevents normal error parsing. Response trace ids must match the same `tr_[A-Za-z0-9._:-]+` and 128-character limit as outgoing client trace ids; unsafe body or header values are ignored. For HTTP 429 `RATE_LIMITED` responses, the SDK exposes `retryAfterSeconds` only when the `Retry-After` header is a canonical positive decimal delay-seconds value in the JavaScript safe integer range, so callers can back off without parsing headers directly and non-canonical proxy values are ignored. Successful quote, submit, quote status, settlement, hedge, and PnL responses are validated field by field, including 128-character bounded safe identifiers, signatures, token addresses, hashes, canonical positive uint strings without leading zeros, signed int strings, timestamps, `totalTrades`, aggregate gross PnL consistency, and the fixed `modelDescription` that marks the current PnL output as simulated same-decimal attribution rather than cross-token accounting PnL.

`RFQClient` validates its base URL, static `traceId` values, trace provider type, and fetch dependency at construction. Dynamic trace provider results are validated before each request. The base URL and outgoing trace ids must be runtime primitive strings before URL parsing or header construction, so JavaScript callers get a stable `RFQClientError` instead of native coercion behavior. The accepted base URL is an absolute HTTP(S) URL with an optional path prefix; credentials, wildcard hosts, query strings and fragments are rejected before any request leaves the process. By default it uses `globalThis.fetch`; server-side runtimes, tests, and constrained execution environments can pass `{ fetch: customFetch }` to keep transport ownership explicit. Integrators can pass `{ traceId: "tr_session_123" }` or `{ traceId: () => "tr_request_123" }` to propagate a safe `x-trace-id` header on SDK requests.

The SDK also exports `rfqSettlementAbi`, `treasuryAbi`, `buildSubmitQuoteArgs`, `hashSettlementQuote`, and `buildTreasuryTransferArgs` for viem/wagmi contract calls, event reconciliation, public state reads, role administration helpers, and custom-error revert decoding.

## Design Principles

1. Quote and execution consistency is the core invariant.
2. Risk must be evaluated before quote signing.
3. Signed quotes must be short-lived.
4. Inventory is managed off-chain but enforced through pricing and limits.
5. Smart contracts should be minimal and deterministic.
6. Risky logic should stay off-chain.
7. All state changes should be observable through events and metrics.
8. Every decision should have ADR documentation.
9. Every critical component should be testable.
10. Every diagram should be reproducible with Mermaid.

## Documentation Index

- [Volume 1: System Architecture](book/Volume1-SystemArchitecture/README.md)
- [Volume 2: Market Data And Pricing](book/Volume2-MarketData-And-Pricing/README.md)
- [Volume 3: Risk Engine](book/Volume3-RiskEngine/README.md)
- [Volume 4: Smart Contracts](book/Volume4-SmartContracts/README.md)
- [Volume 5: Backend Engineering](book/Volume5-BackendEngineering/README.md)
- [Volume 6: Frontend And SDK](book/Volume6-Frontend-And-SDK/README.md)
