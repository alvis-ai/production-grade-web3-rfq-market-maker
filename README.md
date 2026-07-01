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
VITE_RFQ_API_BASE_URL=http://localhost:3000
VITE_RFQ_SETTLEMENT_ADDRESS=0x...
VITE_WALLETCONNECT_PROJECT_ID=00000000000000000000000000000000
RFQ_SIGNER_PRIVATE_KEY=0x...
RFQ_SETTLEMENT_ADDRESS=0x...
```

The backend signer uses the same `ProductionGradeRFQ` EIP-712 domain as the SDK and `RFQSettlement` contract. `HOST` defaults to `127.0.0.1` and must not contain whitespace; `PORT` defaults to `3000` and must be an integer from 1 to 65535. `RFQ_QUOTE_TTL_SECONDS` controls the signed quote lifetime and must be an integer from 1 to 3600; keep it short enough to limit stale price execution. `RFQ_BODY_LIMIT_BYTES` controls the maximum JSON request body size and must be an integer from 1024 to 1048576. `RFQ_CORS_ALLOWED_ORIGINS` is a comma-separated allowlist of browser origins that may call the API. `RFQ_ENABLE_HSTS` must only be enabled when the public API is served through HTTPS. `RFQ_TRUST_PROXY` defaults to `false`; only enable it when a trusted reverse proxy or ingress strips untrusted `x-forwarded-for` input and writes the client IP. `VITE_RFQ_SETTLEMENT_ADDRESS` configures the browser-side `RFQSettlement.submitQuote` target, and `VITE_WALLETCONNECT_PROJECT_ID` configures RainbowKit wallet connection.

The frontend reads `VITE_RFQ_API_BASE_URL`, `VITE_RFQ_SETTLEMENT_ADDRESS` and `VITE_WALLETCONNECT_PROJECT_ID` at Vite build/dev-server time. It shows the active API endpoint in the trading console header and uses Wagmi/RainbowKit with the SDK `rfqSettlementAbi`, `buildSubmitQuoteArgs`, and `hashSettlementQuote` helpers for wallet-driven `submitQuote` transactions and settlement-event reconciliation.

## Local Docker Stack

The local compose stack can run the reference backend, static frontend, Prometheus, Grafana and data dependencies:

```sh
docker compose up --build
```

Local ports:

- Backend API: `http://localhost:3000`
- Frontend console: `http://localhost:5173`
- Prometheus: `http://localhost:9090`
- Grafana: `http://localhost:3001`

## Production Configuration

When `NODE_ENV` is set to any non-local environment such as `production` or `staging`, the backend refuses to start unless `RFQ_SIGNER_PRIVATE_KEY` and `RFQ_SETTLEMENT_ADDRESS` are explicitly configured. The signer private key must be a 32-byte hex string and the settlement address must be a 20-byte hex address. The built-in Anvil signer fallback is only for unset `NODE_ENV`, `development`, or `test`.

Leave `RFQ_TRUST_PROXY=false` unless the public API is behind a trusted load balancer or ingress that removes incoming spoofed `x-forwarded-for` headers and sets the canonical client address. When enabled, the rate limiter keys by the first `x-forwarded-for` entry; otherwise it uses the direct socket IP.

Kubernetes deployments load these values from `rfq-backend-secrets`. Replace the placeholders in `infra/k8s/backend-secret.yaml` before applying manifests, or create the same Secret out of band:

```sh
kubectl -n rfq-market-maker create secret generic rfq-backend-secrets \
  --from-literal=RFQ_SIGNER_PRIVATE_KEY=0x... \
  --from-literal=RFQ_SETTLEMENT_ADDRESS=0x...
```

The Helm chart expects the same keys through `signerSecret.name`, `signerSecret.privateKeyKey` and `signerSecret.settlementAddressKey`.

Local API smoke path:

```sh
make smoke-api-local
```

Repository quality gate:

```sh
make verify
```

`make verify` runs skeleton, examples, configuration, documentation, book template, ADR, security documentation, metrics consistency, runbook consistency, Grafana dashboard consistency, deployment manifest consistency, CI workflow consistency, Docker Compose, EIP-712, ABI, API rate-limit, API error-code, API schema, API route, database schema, quote benchmark, backend, SDK, frontend and local API smoke checks through one entrypoint. If Foundry is installed locally it also runs `make contract-test`; otherwise contract tests remain enforced by the dedicated GitHub Actions contract workflow.

Local quote benchmark:

```sh
make benchmark-quote
```

The benchmark builds the backend and exercises `POST /quote` through Fastify injection without binding a network port. Defaults are 100 samples, p95 <= 50 ms and zero HTTP errors. Override with `RFQ_BENCHMARK_QUOTE_REQUESTS`, `RFQ_BENCHMARK_MAX_P95_MS` and `RFQ_BENCHMARK_MAX_ERRORS` for local profiling.

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

`RFQClientError` preserves structured API errors. It uses `ErrorResponse.traceId` when the backend returns the standard error body, and falls back to the `x-trace-id` response header when an upstream proxy, malformed JSON, or malformed successful response field prevents normal error parsing. For HTTP 429 `RATE_LIMITED` responses, the SDK exposes `retryAfterSeconds` from the `Retry-After` header so callers can back off without parsing headers directly. Successful quote, submit, quote status, settlement, hedge, and PnL responses are validated field by field, including identifiers, signatures, token addresses, hashes, uint/int amount strings, timestamps, `totalTrades`, and aggregate gross PnL consistency.

`RFQClient` validates its base URL, static `traceId` values, trace provider type, and fetch dependency at construction. Dynamic trace provider results are validated before each request. The base URL must be a runtime string before URL parsing, so JavaScript callers get a stable `RFQClientError` instead of a native `.trim()` failure. By default it uses `globalThis.fetch`; server-side runtimes, tests, and constrained execution environments can pass `{ fetch: customFetch }` to keep transport ownership explicit. Integrators can pass `{ traceId: "tr_session_123" }` or `{ traceId: () => "tr_request_123" }` to propagate a safe `x-trace-id` header on SDK requests.

The SDK also exports `rfqSettlementAbi`, `treasuryAbi`, `buildSubmitQuoteArgs`, `hashSettlementQuote`, and `buildTreasuryTransferArgs` for viem/wagmi contract calls and event reconciliation.

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
