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
- **Risk Engine**: 使用 chain-scoped token policy 校验单笔金额、投影库存、spread、slippage 和 toxic flow，并执行 portfolio VaR、chain/token/portfolio Delta 与可解释的 Gamma-like 非线性组合 guardrail。
- **Toxic-Flow Analyzer**: 从 canonical settlement 和 policy-horizon market snapshot 异步生成 reorg-aware markout，按用户窗口聚合并以 CAS 发布审计化动态风险分数。
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
GET /admin/quote-control
PUT /admin/quote-control
GET /admin/quote-control/pairs/:chainId/:tokenA/:tokenB
PUT /admin/quote-control/pairs/:chainId/:tokenA/:tokenB
GET /admin/toxic-flow/scores/:chainId/:user
PUT /admin/toxic-flow/scores/:chainId/:user
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

核心保护包括 EIP-712 verification、trusted signer、nonce replay protection、deadline expiry、token whitelist、pause、reentrancy protection 和 SafeERC20。安全基础设施固定使用 OpenZeppelin Contracts `5.6.1` git submodule；克隆后先执行 `git submodule update --init --recursive`。`Treasury` 作为独立 custody 边界随部署脚本一起创建，并配置为信任对应的 `RFQSettlement` 地址；Treasury、Settlement 和新增白名单 Token 的管理入口会在配置期拒绝 EOA，Treasury 轮换还要求候选合约已反向绑定当前 Settlement。`RFQSettlement` 将用户 `tokenIn` 转入 Treasury，常规 `tokenOut` 放款走 settlement-only `release`，并校验两条 token 腿的 user/Treasury 实际余额差额与 signed quote 精确一致，从而原子拒绝 fee-on-transfer 或 rebasing drift；应急资金迁移走 owner-only `emergencyWithdraw`。

Local deployment script:

```sh
cd contracts
RFQ_TRUSTED_SIGNER=0x0000000000000000000000000000000000000001 \
RFQ_CONTRACT_ADMIN=0x0000000000000000000000000000000000000003 \
RFQ_TOKEN_WHITELIST_JSON='{"tokens":["0x0000000000000000000000000000000000000002"]}' \
forge script script/Deploy.s.sol:DeployRFQSettlement
```

`RFQ_CONTRACT_ADMIN` is the final owner and `DEFAULT_ADMIN_ROLE` holder and should be a multisig or governed administration address in production. The script deploys a dedicated `RFQDeploymentFactory`; one factory transaction creates both contracts, wires Treasury to Settlement, applies the complete token whitelist, verifies postconditions, and then transfers both ownership boundaries plus all Settlement admin roles to that address. The factory retains no authority over the deployed stack.

After broadcasting from the exact release commit, run the read-only deployment canary against the target RPC before enabling quotes. It fixes every code and state read to one fresh block, compares Settlement, Treasury and factory runtime bytecode with the local Foundry artifacts while accounting for Solidity immutable slots, recomputes the EIP-712 domain, and requires exact signer, whitelist and role-member counts. The RPC URL is never printed:

```sh
RFQ_CHAIN_INTEGRATION_CONFIRM=yes \
RFQ_CHAIN_INTEGRATION_RPC_URL=https://target-chain-rpc.example \
RFQ_CHAIN_INTEGRATION_CHAIN_ID=1 \
RFQ_CHAIN_INTEGRATION_SETTLEMENT_ADDRESS=0x... \
RFQ_CHAIN_INTEGRATION_TREASURY_ADDRESS=0x... \
RFQ_CHAIN_INTEGRATION_FACTORY_ADDRESS=0x... \
RFQ_CHAIN_INTEGRATION_ADMIN_ADDRESS=0x... \
RFQ_CHAIN_INTEGRATION_TRUSTED_SIGNERS_JSON='{"primary":"0x...","authorized":["0x..."]}' \
RFQ_CHAIN_INTEGRATION_TOKEN_WHITELIST_JSON='{"tokens":["0x...","0x..."]}' \
RFQ_CHAIN_INTEGRATION_EXPECT_PAUSED=false \
make contract-deployment-integration-check
```

Any mismatch is a failed deployment, including stale/wrong-chain RPC data, altered bytecode, split Treasury wiring, an unexpected admin or signer, an extra whitelist member, retained factory authority, or a wrong pause/domain state. Do not copy the observed value back into the expected configuration merely to make the check pass.

## Local Configuration

Copy `.env.example` for local backend configuration. The included signer key is the public Anvil development key and must only be used on local chains.

```text
HOST=127.0.0.1
PORT=3000
RFQ_LOG_LEVEL=info
RFQ_SHUTDOWN_TIMEOUT_MS=20000
RFQ_QUOTE_TTL_SECONDS=30
RFQ_QUOTE_IDEMPOTENCY_LEASE_MS=60000
RFQ_BODY_LIMIT_BYTES=32768
RFQ_SUBMIT_RESERVATION_LEASE_MS=900000
RFQ_CORS_ALLOWED_ORIGINS=http://localhost:5173
RFQ_ENABLE_HSTS=false
RFQ_TRUST_PROXY=false
RFQ_RATE_LIMIT_BACKEND=memory
# RFQ_REDIS_URL=redis://127.0.0.1:6379/0
# RFQ_API_KEY_CONFIG_JSON={"keys":[{"keyId":"client_primary","principalId":"institution_a","secretSha256":"...","scopes":["quote:write","submit:write","status:read","pnl:read"]}]}
# Use a separate operations key with only admin:read/admin:write for quote-control changes.
VITE_RFQ_API_BASE_URL=http://localhost:3000
VITE_RFQ_SETTLEMENT_ADDRESS=0x...
VITE_WALLETCONNECT_PROJECT_ID=00000000000000000000000000000000
RFQ_TOKEN_REGISTRY_JSON={"tokens":[{"chainId":1,"tokenAddress":"0x0000000000000000000000000000000000000002","symbol":"TOKEN2","decimals":18,"isWhitelisted":true,"riskTier":"low","usdReference":false},{"chainId":1,"tokenAddress":"0x0000000000000000000000000000000000000003","symbol":"TOKEN3","decimals":18,"isWhitelisted":true,"riskTier":"low","usdReference":true}]}
RFQ_RISK_POLICY_JSON={"policyVersion":"token-limit-risk-v2","enabledChainIds":[1],"tokenLimits":[{"chainId":1,"tokenAddress":"0x0000000000000000000000000000000000000002","maxAmountIn":"1000000000000000000000","minAmountOut":"1","maxNotionalUsd":"1000000","maxAbsoluteInventory":"10000000000000000000000"},{"chainId":1,"tokenAddress":"0x0000000000000000000000000000000000000003","maxAmountIn":"1000000000000000000000","minAmountOut":"1","maxNotionalUsd":"1000000","maxAbsoluteInventory":"10000000000000000000000"}],"restrictedUsers":[],"toxicFlowScores":[],"maxToxicScoreBps":8000,"maxUserOpenNotionalUsd":"2000000","maxPairOpenNotionalUsd":"5000000","portfolioVar":{"modelVersion":"component-sum-v1","maxPortfolioVarUsd":"500000","confidenceMultiplierBps":23300,"horizonSeconds":86400,"maxSnapshotAgeMs":5000,"maxFutureSkewMs":5000,"valuationPairs":[{"chainId":1,"tokenAddress":"0x0000000000000000000000000000000000000002","usdReferenceTokenAddress":"0x0000000000000000000000000000000000000003"}]},"portfolioDelta":{"modelVersion":"gross-net-asset-delta-v2","softGrossLimitUsd":"500000","hardGrossLimitUsd":"1000000","softNetLimitUsd":"250000","hardNetLimitUsd":"500000","assetLimits":[{"chainId":1,"tokenAddress":"0x0000000000000000000000000000000000000002","softLimitUsd":"250000","hardLimitUsd":"500000"}]},"gammaGuardrail":{"modelVersion":"piecewise-convexity-v1","elevatedInventoryUtilizationBps":6000,"criticalInventoryUtilizationBps":8500,"largeTradeUtilizationBps":2500,"blockTradeUtilizationBps":7000,"elevatedVolatilityUtilizationBps":5000,"extremeVolatilityUtilizationBps":8000,"maxRiskMultiplierBps":20000},"minLiquidityUsd":"1000000","maxVolatilityBps":500,"maxSlippageBps":500,"maxQuotedSpreadBps":1000}
RFQ_DAILY_LOSS_CONFIG_JSON={"policyVersion":"daily-loss-v1","limits":[{"chainId":1,"tokenAddress":"0x0000000000000000000000000000000000000003","maxLossUsdE18":"100000000000000000000"}]}
# RFQ_USD_REFERENCE_CONFIG_JSON={"policyVersion":"usd-reference-v1","networks":[{"chainId":1,"networkType":"l1","rpcUrl":"https://rpc.example.com","feeds":[{"tokenAddress":"0x0000000000000000000000000000000000000003","aggregator":"0x0000000000000000000000000000000000000005","decimals":8,"description":"TOKEN3 / USD","minAnswer":"90000000","maxAnswer":"110000000"}]}],"maxPriceAgeMs":60000,"maxFutureSkewMs":1000,"maxDeviationBps":100,"cacheTtlMs":1000}
RFQ_TOXIC_FLOW_MAX_SCORE_AGE_MS=86400000
RFQ_TOXIC_FLOW_MAX_FUTURE_SKEW_MS=60000
RFQ_TOXIC_FLOW_MIN_SAMPLE_SIZE=5
# RFQ_MARKET_PAIRS=1:0xTokenIn:0xTokenOut
# RFQ_CEX_PAIRS=1:0xBaseToken:0xUsdQuoteToken:binance:ETHUSDT:hedge,1:0xBaseToken:0xUsdQuoteToken:coinbase:ETH-USD:reference
RFQ_CEX_REQUIRE_LIVE_BOOK=false
RFQ_CEX_MAX_SOURCE_AGE_MS=2000
RFQ_CEX_MIN_SOURCES=1
RFQ_CEX_MAX_SOURCE_DEVIATION_BPS=100
RFQ_CEX_MAX_SPREAD_BPS=100
# RFQ_HEDGE_ROUTES_JSON={"routes":[...]}
RFQ_HEDGE_FAILURE_PENALTY_BPS=25
RFQ_HEDGE_MAX_FAILURE_PENALTY_BPS=150
RFQ_HEDGE_FAILURE_LOOKBACK_MS=300000
RFQ_SETTLEMENT_INDEXER_MAX_CURSOR_AGE_MS=60000
RFQ_SETTLEMENT_INDEXER_MAX_BLOCK_LAG=2
# RFQ_BINANCE_SYMBOL_RULES_MAX_AGE_MS=300000
# RFQ_MARKET_DATA_PROVIDER=chainlink
# RFQ_CHAINLINK_CONFIG_JSON={...}
RFQ_ALLOW_SIMULATED_SETTLEMENT=true
# RFQ_RECEIPT_CONFIG_JSON={"chains":[...]}
RFQ_SIGNER_MODE=local
RFQ_SIGNER_PRIVATE_KEY=0x...
RFQ_SETTLEMENT_ADDRESS=0x...
```

The backend signer uses the same `ProductionGradeRFQ` EIP-712 domain as the SDK and `RFQSettlement` contract. Local development uses `RFQ_SIGNER_MODE=local` inside the isolated Compose signer service, derives the trusted signer from `RFQ_SIGNER_PRIVATE_KEY`, and binds signatures to `RFQ_SETTLEMENT_ADDRESS`. Non-local API runtime uses `RFQ_SIGNER_MODE=remote` over HTTPS, while only the isolated signer workload uses `RFQ_SIGNER_MODE=aws-kms`; both require an explicit `RFQ_TRUSTED_SIGNER_ADDRESS` and reject raw private keys. The settlement verifier always recovers the signature against that explicit signer identity before settlement evidence is consumed, and the remote signer client performs the same recovery before returning a quote. `HOST` defaults to `127.0.0.1` and must not contain whitespace; `PORT` defaults to `3000` and must be a base-10 integer from 1 to 65535. Backend startup reads only own environment fields, so prototype-backed `HOST`, `PORT`, `RFQ_SHUTDOWN_TIMEOUT_MS`, `RFQ_QUOTE_TTL_SECONDS`, signer, CORS, HSTS, proxy, Redis, token-registry or risk-policy values are treated as unset. `RFQ_SHUTDOWN_TIMEOUT_MS` defaults to 20000 and accepts only canonical base-10 integers from 1000 through 120000; the first termination signal starts bounded cleanup, while timeout or a second signal exits 1. Kubernetes keeps this at 20 seconds inside a reviewed 5-second `preStop` and 30-second termination window. `RFQ_QUOTE_TTL_SECONDS` controls the signed quote lifetime and must be a base-10 integer from 1 to 3600; keep it short enough to limit stale price execution. `RFQ_BODY_LIMIT_BYTES` controls the maximum JSON request body size and must be a base-10 integer from 1024 to 1048576. `RFQ_CORS_ALLOWED_ORIGINS` is a comma-separated allowlist of HTTP(S) URL origins that may call the API; startup rejects entries with paths, query strings, fragments, credentials, or wildcards, then normalizes each accepted origin with `URL.origin`. `RFQ_ENABLE_HSTS` must only be enabled when the public API is served through HTTPS. `RFQ_TRUST_PROXY` defaults to `false`; only enable it when a trusted reverse proxy or ingress strips untrusted `x-forwarded-for` input and writes the client IP. `RFQ_TOKEN_REGISTRY_JSON` is the trusted, startup-validated source for each supported chain/token address, symbol, decimals, whitelist state and USD-reference status. `RFQ_RISK_POLICY_JSON` defines chain/token exposure, portfolio VaR/Delta and market-regime limits. Its required `gammaGuardrail` computes bounded utilization for both projected inventory legs, every USD-reference notional leg and current volatility with integer ceiling; `piecewise-convexity-v1` maps each dimension to `0/2500/5000` bps premium and rejects with `GAMMA_GUARDRAIL_TRIGGERED` when the combined multiplier reaches `maxRiskMultiplierBps`. Missing inventory projection fails closed as `RISK_ENGINE_UNAVAILABLE`. Outside local environments, `RFQ_DAILY_LOSS_CONFIG_JSON` and PostgreSQL are mandatory for the default risk engine. Every managed USD-reference token needs a positive `maxLossUsdE18`; the guard sums only completed hedge-net PnL in the current UTC day, rejects at the exact negative boundary with `DAILY_LOSS_LIMIT_EXCEEDED`, degrades readiness after the budget is exhausted, and fails closed when accounting evidence is unavailable or malformed. `RFQ_USD_REFERENCE_CONFIG_JSON` is also mandatory and must provide a reviewed Chainlink token/USD feed for every managed token marked `usdReference`; startup rejects missing coverage or symbol/feed identity mismatch. The oracle guard validates RPC chain identity, feed metadata, L2 sequencer state, round completeness, timestamps and circuit-breaker bounds before comparing the answer with the 1 USD peg. A confirmed deviation above `maxDeviationBps` records `USD_REFERENCE_DEPEG`, degrades readiness and blocks Signer; unavailable or malformed oracle evidence fails closed as `RISK_ENGINE_UNAVAILABLE`. Short-lived caching coalesces concurrent reads, while the exact feed round and daily accounting window are hashed into `risk_decisions.policy_version` for replay correlation. `VITE_RFQ_API_BASE_URL` configures the browser API endpoint and must be an absolute HTTP(S) URL with an optional path prefix, no credentials, no wildcard host, and no query string or fragment. `VITE_RFQ_SETTLEMENT_ADDRESS` configures the browser-side `RFQSettlement.submitQuote` target. `VITE_WALLETCONNECT_PROJECT_ID` configures RainbowKit wallet connection and must be a 128-character-or-shorter safe string containing only letters, numbers, underscore, or hyphen.

`RFQ_LOG_LEVEL` accepts only `debug`, `info`, `warn`, or `error` and defaults to `info`. The API and all standalone workers emit service-bound JSON records with ISO timestamps. API completion records use the normalized route template rather than dynamic URLs and include `traceId`, method, status and duration; probe successes are debug-only. Rejections and failures contain stable public error codes, while request bodies, headers, API credentials, signatures, private keys and cookies are excluded or redacted. Worker job logs may contain durable audit identifiers, but never CEX credentials, RPC credentials or raw exception payloads. Background base-provider and snapshot-persistence failures log only the first transition per configured pair as `MARKET_DATA_REFRESH_FAILED` or `MARKET_SNAPSHOT_PERSIST_FAILED`; repeated retries increment metrics without flooding logs, and one matching `*_RECOVERED` info record closes the incident state. CEX connector retries follow the same boundary per normalized exchange/symbol: each outage starts with one `CEX_ORDER_BOOK_CONNECTOR_ERROR` warning and ends only after a usable synchronized book emits `CEX_ORDER_BOOK_CONNECTOR_RECOVERED`; every underlying error still increments the fixed-exchange metric.

During a reviewed key rotation, `RFQ_TRUSTED_SIGNER_OVERLAP_ADDRESSES` may contain at most four distinct non-zero old or next signer addresses. It expands settlement verification only and never changes which KMS key signs new quotes. The verifier snapshots the primary plus overlap set at startup; `RFQSettlement` applies the matching bound of five authorized signers and requires explicit old-key retirement after TTL and settlement-observation buffers expire.

`RFQ_TOXIC_FLOW_MAX_SCORE_AGE_MS` bounds analyzer evidence age from 1000 ms through seven days, `RFQ_TOXIC_FLOW_MAX_FUTURE_SKEW_MS` permits only bounded clock skew from 0 through five minutes, and `RFQ_TOXIC_FLOW_MIN_SAMPLE_SIZE` prevents low-sample scores from rejecting users. The rejection threshold remains the reviewed `maxToxicScoreBps` in `RFQ_RISK_POLICY_JSON`, so deployments cannot silently diverge analyzer evidence policy from the base risk policy.

`maxUserOpenNotionalUsd` and `maxPairOpenNotionalUsd` bound cumulative activity across signed quotes that remain executable. Before signing, Quote Service converts the trusted USD-reference side to an exact 18-decimal USD integer and reserves it until the quote deadline. PostgreSQL mode sorts and sequentially acquires transaction-scoped quote/user/pair locks before summing unexpired `requested`, `signed`, or `failed` rows and inserting, preventing concurrent API replicas from passing the same limit through write skew. A failed signed quote remains counted because its signature may still be retried directly on-chain. Confirmed submitted/settled rows stop counting but remain until expiry so a reorg that restores `signed` status automatically restores exposure; pre-sign failures release explicitly, and bounded `SKIP LOCKED` cleanup removes expired rows.

Backend CI proves this boundary against PostgreSQL rather than SQL mocks alone. The check creates isolated `requested` quotes through `PostgresQuoteRepository`, races two database sessions against user, pair and Treasury capacity, requires exactly one durable winner, verifies idempotent replay and capacity recovery after release, then removes every fixture. To reproduce it against the local Compose database after migrations:

```bash
DATABASE_URL='postgres://rfq:rfq@127.0.0.1:5432/rfq_market_maker?minPool=2&maxPool=10' \
NODE_ENV=test RFQ_QUOTE_EXPOSURE_INTEGRATION_CONFIRM=yes \
make quote-exposure-integration-check
```

`portfolioVar` adds a portfolio-wide pre-sign budget using the conservative `component-sum-v1` model. Every non-USD risk token must name an explicit USD-reference valuation pair. The reservation transaction combines canonical inventory, every unexpired executable quote delta, and the candidate quote; values each non-cash position with the latest bounded-age pair snapshot; and rejects `PORTFOLIO_VAR_LIMIT_EXCEEDED` before signing when `ceil(abs(exposureUsd) * volatilityBps * confidenceMultiplierBps / 10000^2)` exceeds the configured aggregate budget. PostgreSQL mode uses a chain-wide advisory lock plus a short `SHARE` lock on `inventory_positions`, while local mode uses a per-chain mutex. Accepted reservations persist pre/post VaR components and snapshot ids in `var_evaluation` for replay and audit.

`portfolioDelta` reuses those same locked positions and valuation snapshots to calculate per-chain/token absolute USD delta, signed net portfolio USD delta, and absolute gross portfolio USD delta before and after the candidate quote. `assetLimits` must cover every non-cash VaR valuation asset exactly; missing or extra chain/token entries fail startup. Crossing any asset, gross, or net hard limit rejects before signing with `PORTFOLIO_DELTA_LIMIT_EXCEEDED`; crossing only a soft limit keeps the reservation executable, persists component and aggregate `softLimitBreached` evidence in `delta_evaluation`, and increments `rfq_portfolio_delta_soft_breaches_total`. Limits use strict `>` comparisons, so an exact boundary remains admissible. USD-reference cash legs are excluded from delta components; their liquidity remains protected by the separate Treasury reservation gate.

The same pre-sign reservation also protects actual Treasury output capacity in receipt-confirmed runtimes. Using the chain RPC already declared by `RFQ_RECEIPT_CONFIG_JSON`, the backend first verifies that `eth_chainId` matches the configured chain, then reads `RFQSettlement.treasury()` and `tokenOut.balanceOf(treasury)` at one block. A successful identity check is cached for the provider lifetime to keep the quote hot path bounded; failed checks are evicted and retried, and no balance read occurs on an unverified chain. The backend then acquires a `(chainId, tokenOut)` PostgreSQL advisory lock and compares that observed balance with the sum of every unexpired quote's `amountOut`. A quote that would oversubscribe the asset is rejected internally as `TREASURY_LIQUIDITY_INSUFFICIENT` before KMS signing. Output reservations remain counted until TTL even after settlement, so a stale pre-settlement RPC observation cannot reuse balance during the non-atomic chain/database transition. RPC errors, a chain mismatch, or malformed contract results fail closed as risk unavailable and degrade risk readiness.

`RFQ_API_KEY_CONFIG_JSON` is optional for local development and required for every non-local `NODE_ENV`. Each entry stores a public key id, stable principal id, fixed scopes, optional canonical expiry timestamp, and only `SHA-256(secret)`; clients send `x-api-key: keyId.secret`. The gateway uses constant-time digest comparison, returns one generic 401 response for missing, malformed, unknown, expired, or incorrect credentials, and keys distributed rate limits by authenticated key id. Quote ownership is bound to the stable principal rather than the key id, so rotated keys for one institution retain access while another principal receives the same 404 response as a missing quote for quote, settlement, and hedge lookups; submit validation and PnL summaries use the same boundary. The direct browser demo should remain local or sit behind a trusted backend-for-frontend; never embed an institutional API secret in a `VITE_*` variable.

The API quote kill switch is shared across replicas through PostgreSQL. `GET/PUT /admin/quote-control` manages the global state, while `GET/PUT /admin/quote-control/pairs/:chainId/:tokenA/:tokenB` manages one normalized, direction-independent pair. Reads require `admin:read`; writes require `admin:write`, a non-empty reason, and the last observed `expectedVersion`. Global updates append `quote_control_audit`; pair updates start at version 1 and atomically append `quote_pair_control_audit` with the authenticated principal/key actor. `POST /quote` checks both states before pricing and signing: either pause returns `QUOTE_PAUSED`/503, while an unreadable or malformed state returns `QUOTE_CONTROL_UNAVAILABLE`/503. Existing signed quotes, `/submit`, status queries, settlement indexing, inventory updates, hedging, and reconciliation remain available so an incident pause cannot hide or abandon already-created economic obligations.

Dynamic toxic-flow scores are stored per normalized `chainId + user` and managed through `GET/PUT /admin/toxic-flow/scores/:chainId/:user`. Updates require `admin:write`, an exact `expectedVersion`, bounded score/markout evidence, and a versioned analyzer policy; every successful write appends `toxic_flow_score_audit`. The default Risk Engine applies fresh scores after deterministic token/inventory/market checks. Unknown users retain base policy, while stale, future, malformed, or unreadable known scores fail closed and are recorded internally as `RISK_ENGINE_UNAVAILABLE` without exposing risk thresholds to quote clients.

The toxic-flow analyzer (`pnpm --dir backend start:toxic-flow-analyzer`) is an isolated process with health and metrics on port 3005. Migration 021 creates a settlement-triggered revision queue and canonical markout evidence. Replicas claim only eligible jobs with `FOR UPDATE SKIP LOCKED`, select the first same-direction `market_snapshots` row after `RFQ_TOXIC_FLOW_MARKOUT_HORIZON_SECONDS` and within the configured maximum lag, calculate cross-decimal maker-side drift, then aggregate the canonical user window and publish through the same audited score CAS store. Missing snapshots retain the job with bounded exponential retry. Settlement reorgs invalidate the derived markout and publish a corrected aggregate, including a zeroed empty-sample clearing version when no canonical evidence remains. PostgreSQL is the operational truth; this worker does not depend on ClickHouse or the HTTP admin endpoint.

`POST /quote` accepts a principal-scoped `Idempotency-Key` containing 16 to 128 safe ASCII characters and requires it outside local environments. Reusing the same key with the same normalized payload returns the exact persisted signed response; changing the payload returns `IDEMPOTENCY_KEY_CONFLICT`, while an active owner lease returns `IDEMPOTENCY_REQUEST_IN_PROGRESS`. PostgreSQL binds the key to `quote_id` before quote persistence so a crashed replica cannot sign a second nonce; after lease expiry it recovers an already persisted signed quote or fails the incomplete request closed. `RFQ_QUOTE_IDEMPOTENCY_LEASE_MS` defaults to at least `60000`, must be between `10000` and `3900000`, and must exceed the signed quote TTL.

`RFQ_SUBMIT_RESERVATION_LEASE_MS` defaults to `900000` and must be between `60000` and `3600000`. Local mode uses an in-memory quote reservation; PostgreSQL mode uses `quote_submit_reservations` to atomically claim a quote across API replicas before receipt verification and post-trade effects. Release is owner-token conditional, stale rows become claimable using database time, reservation store failures return `SUBMIT_RESERVATION_UNAVAILABLE`/503, and contention returns the existing `QUOTE_ALREADY_USED`/409 contract.

Local development permits synthetic settlement only when `RFQ_ALLOW_SIMULATED_SETTLEMENT=true`. In receipt-confirmed mode the wallet broadcasts `RFQSettlement.submitQuote`, then sends the resulting `txHash` to `POST /submit`. Every non-local runtime requires each `RFQ_RECEIPT_CONFIG_JSON` RPC URL to use HTTPS; development may use explicit HTTP endpoints such as local Anvil or `host.docker.internal`. Before using the hash, the backend calls `eth_chainId` and requires an exact configured-chain match. It then treats the hash only as an RPC lookup key: it waits for configured confirmations, verifies transaction `from`, `to`, and decoded `submitQuote` calldata against the stored quote/signature, requires a successful receipt, and requires exactly one matching `QuoteSettled` event before inventory, hedge, PnL, or quote-status side effects.

When `DATABASE_URL` is configured, quote audit records and the complete post-trade path use PostgreSQL. Settlement event insertion, both inventory token deltas, and a durable reconciliation revision commit in one transaction; duplicate `(chain_id, tx_hash, log_index)` events cannot apply inventory twice, while a partial unique index permits only one canonical settlement per quote and still allows a replacement after reorg. Inventory pricing reads the shared `inventory_positions` projection on every request, so horizontally scaled replicas use one exposure state. Hedge intents and PnL records are durable idempotent projections keyed by settlement event and quote/model. Startup takes a transaction-scoped advisory lock and repairs inventory from canonical settlement events plus every externally executed hedge fill before readiness. Reorg removal marks an event non-canonical instead of deleting audit history and rebuilds inventory in the same transaction. Quote/PnL reconciliation removes chain-derived pointers, while submission-attempted or terminal CEX hedge evidence remains because a chain reorg cannot undo a potentially accepted external trade.

PnL attribution exposes two independent models. `quote_snapshot_edge_v1` uses the immutable quote-time snapshot and trusted decimals to report `fairAmountOut - amountOut` as gross edge in tokenOut base units, grouped by `(chainId, tokenOut)`. `hedge_fill_net_v1` becomes complete only after exact CEX fills and commissions reconcile: it freezes the venue base/quote assets and on-chain quote token before submission, values quote-asset fees directly, values base-asset fees at each fill's exact quote/base ratio, conservatively marks the sub-step residual at aggregate execution VWAP, and groups completed totals by `(chainId, valuationToken, valuationAsset)`. Third-asset fees such as BNB produce `UNVALUED_COMMISSION_ASSET`, terminal partial hedges produce `PARTIAL_HEDGE_UNCLOSED` until the remaining exposure is closed, pending hedges remain `pending`, and pre-migration routes remain `LEGACY_ROUTE_ACCOUNTING_UNAVAILABLE`; none are counted as zero. Wallet-paid settlement gas is not a maker expense and remains outside both models. Migration `006` preserves gross attribution history, while migration `024` adds route-bound net accounting without reinterpreting legacy rows.

The reconciliation worker (`pnpm --dir backend start:reconciliation-worker`) continuously converges those post-trade projections and exposes health and metrics on port 3003. Multiple replicas lease quote-scoped desired revisions with `FOR UPDATE SKIP LOCKED`; a canonical revision restores hedge, PnL, and complete quote pointers, while a no-canonical revision removes only reversible projections. A canonical state change increments the desired revision without stealing an active lease, so an old worker cannot mark newer chain state processed. Exponential retries retain stable low-cardinality error codes and no job is discarded because of retry count.

The settlement indexer (`pnpm --dir backend start:settlement-indexer`) independently discovers confirmed `QuoteSettled` logs, so post-trade state does not depend on the browser successfully calling `/submit` after wallet broadcast. `RFQ_SETTLEMENT_INDEXER_CONFIG_JSON` fixes each chain RPC, settlement address, deployment start block, confirmation depth, scan range, reorg window, and request timeout. Non-local indexer RPC URLs must use HTTPS. Startup and every chain poll verify `eth_chainId` before reading the head or claiming a PostgreSQL cursor; a mismatch reports `RPC_OR_STORE_UNAVAILABLE`, leaves the cursor unchanged, and keeps readiness unavailable. For every log it resolves the complete signed quote by `(chainId, user, nonce)`, verifies the on-chain `quoteHash` and all emitted fields, and only then applies the existing idempotent settlement path. PostgreSQL leases and revision/next-block CAS support multiple replicas. Range-end block-hash checkpoints detect reorgs; orphan events are marked non-canonical before the cursor rolls back, causing inventory rebuild and durable quote/hedge/PnL reconciliation. An unknown quote or a reorg deeper than `reorgLookbackBlocks` stops that chain and alerts instead of silently skipping economic state.

`make settlement-indexer-e2e` is the destructive local proof for the complete core flow and therefore requires `RFQ_SETTLEMENT_INDEXER_E2E_CONFIRM=yes` plus a disposable loopback PostgreSQL database. It deploys the real contracts to an isolated Anvil chain and proves that a `/submit` callback creates a durable queued hedge which the indexer later sees as a duplicate. The same transaction then crosses production `HedgeWorker` and `HedgeFeeWorker` boundaries through a signature-verifying Binance fixture, requiring an exact `LIMIT GTC` fill, `base-and-quote-v2` evidence, neutralized base inventory, reconciled commission and complete `hedge_fill_net_v1` PnL. A second wallet-only broadcast is discovered independently before the test reverts the chain snapshot and mines a replacement branch. Final assertions require the orphan event to become non-canonical, the quote to return to `signed`, reversible chain-derived state to disappear, terminal CEX evidence to survive, inventory to rebuild, and the cursor to continue on the replacement chain. Its uniquely named rows are removed even after failure.

Receipt-confirmed API runtimes also treat that cursor as pre-sign risk evidence. After reading Treasury liquidity at one RPC head, Quote Service subtracts the configured receipt confirmations, compares the resulting safe head with `settlement_indexer_cursors.next_block`, and rejects signing as `RISK_ENGINE_UNAVAILABLE` when the cursor row is missing, belongs to another Settlement contract, is older than `RFQ_SETTLEMENT_INDEXER_MAX_CURSOR_AGE_MS`, or exceeds `RFQ_SETTLEMENT_INDEXER_MAX_BLOCK_LAG`. Confirmation depth is therefore not mistaken for indexer lag, while initial backfills and stalled workers cannot leave the API quoting against an unboundedly stale inventory projection. The same all-chain check is folded into readiness's fixed `risk` component; local synthetic-settlement mode has no receipt chains and leaves the guard disabled. Prometheus exposes the latest configured-chain guard state plus one of seven bounded failure reasons, while client responses retain the generic risk-unavailable contract. Unsupported request chain IDs fail closed without becoming metric labels.

The destructive integration check requires an explicit acknowledgement and a disposable PostgreSQL database. It verifies initial convergence, reorg cleanup, and a replacement canonical transaction for the same quote, then removes its uniquely named fixtures:

```sh
DATABASE_URL=postgres://rfq:rfq@127.0.0.1:5432/rfq_market_maker \
RFQ_RECONCILIATION_INTEGRATION_CONFIRM=yes \
make reconciliation-integration-check
```

The hedge worker is a separate process (`pnpm --dir backend start:hedge-worker`) with its own CEX credentials and health surface on port 3001. Every managed pair has at least one approved USD-reference leg. The shared `delta-neutral-v2` planner sells the received `tokenIn/amountIn` when only `tokenOut` is the USD reference, and buys the paid `tokenOut/amountOut` when `tokenIn` is a USD reference, including stablecoin-to-stablecoin inventory rebalancing; pairs with no reference leg fail closed. `RFQ_HEDGE_ROUTES_JSON` maps the selected `chainId/token` base asset to a Binance symbol, `baseAsset`, `quoteAsset`, on-chain `quoteToken`, both token decimals, raw-unit step size, `priceTick`, and `maxSlippageBps`. Startup requires the shared token registry, requires `quoteToken` to be a whitelisted USD reference, verifies both decimals, and later rejects any job whose signed quote reference leg differs from the route. API and worker also share `RFQ_BINANCE_BASE_URL`, request timeout and `RFQ_BINANCE_SYMBOL_RULES_MAX_AGE_MS`. A bounded single-flight cache reads unsigned `GET /api/v3/exchangeInfo?symbol=...`; exact decimal arithmetic requires live symbol status, base/quote assets, `PRICE_FILTER` tick, `LOT_SIZE` step and notional bounds to agree with the route and candidate order. Drift degrades API/worker readiness, and validation runs before route persistence or submission authorization so a definite preflight failure cannot be mistaken for an ambiguous external POST. Multiple replicas claim due `hedge_orders` with `FOR UPDATE SKIP LOCKED` and expiring leases. Before every new order the worker derives a buy ceiling or sell floor from the immutable signed/settled quote amounts, applies the reviewed route slippage, rounds conservatively to `priceTick`, and persists that tick-aligned `LIMIT GTC` policy as `bounded-limit-v1` together with a deterministic 36-character client order id and immutable route accounting metadata. It queries Binance by that id and submits only when the order is absent; pre-migration submission-attempted rows remain query-only and are never relabelled with a policy they did not use. Binance `-1021` is handled separately from ambiguous transport failures: concurrent requests share one unsigned `GET /api/v3/time` synchronization, calculate a bounded request-midpoint offset, and retry the rejected signed operation exactly once with a fresh timestamp and signature. The hedge lease must exceed four configured request-timeout windows plus one second, covering query, clock synchronization, signed retry, and submit without allowing another replica to reclaim the same job mid-iteration. Every Binance signed order or trade-history body needed for a protocol decision is streamed once through a 2 MiB cap before JSON decoding and remains inside the same request timeout after headers arrive. Successful clock-sync and `exchangeInfo` bodies use the same deadline and cap; non-success bodies that are not needed are canceled immediately. Oversized, malformed or stalled bodies fail closed without cloning or decoding a signed response twice. A venue `FILLED` response is terminal only when cumulative executed quantity equals the raw-unit quantized target exactly. Every new positive fill also persists Binance `orderId` and `cummulativeQuoteQty` as `base-and-quote-v2` evidence; base quantity and quote quantity must advance together monotonically, while pre-migration fills remain explicitly labeled `base-only-v1`. Inventory updates commit immediately from this cumulative order evidence. A separate fee lease then pages signed `GET /api/v3/myTrades` by `symbol + orderId + fromId`, waits until the returned base/quote sums match the order totals, and idempotently stores each venue trade with its exact `commission` and `commissionAsset`. The same completion transaction writes `hedge_fill_net_v1` or an explicit unavailable reason. `/hedges/:id` still exposes asset-separated fees, while `/pnl` exposes gross and hedge-net models without adding unrelated assets. The only permitted residual is the original amount below one venue step; an undersized `FILLED` response remains queued for reconciliation instead of silently declaring a partial hedge complete. Network timeouts, rate limits, unknown responses, pending orders, repeated timestamp rejection, and temporarily incomplete trade history remain queued because an externally accepted order or accounting record must never be guessed from local retry exhaustion. A job with `submission_attempted_at` also remains queued on later local route, credential, or configuration errors; only venue reconciliation of its persisted client id may establish terminal state. Before any external submission, explicit venue rejection or deterministic route/quantity/price error can produce `failed`.

Backend CI proves that path against a disposable PostgreSQL service and a signature-verifying Binance protocol fixture. The check starts from a canonical settlement event, lets the production reconciliation worker create hedge/PnL projections, executes the production hedge and fee workers, and requires persisted `LIMIT GTC` policy, exact fill/commission evidence, neutralized base inventory and completed hedge-net PnL. It refuses non-loopback databases and unrelated due worker jobs:

```sh
DATABASE_URL=postgres://rfq:rfq@127.0.0.1:5432/rfq_market_maker \
RFQ_HEDGE_WORKER_E2E_CONFIRM=yes \
make db-migrate hedge-worker-e2e
```

Recent hedge failures feed back into subsequent quote pricing through a bounded rolling window. `RFQ_HEDGE_FAILURE_PENALTY_BPS` adds cost per distinct failed settlement, `RFQ_HEDGE_MAX_FAILURE_PENALTY_BPS` caps the total, and `RFQ_HEDGE_FAILURE_LOOKBACK_MS` defaults to five minutes. PostgreSQL counts only failures whose settlement remains canonical and uses immutable `risk_failure_at` rather than mutable row update time; retries for the same settlement do not multiply or refresh the event. Expired or reorg-orphaned failures contribute zero, preventing a historical incident from permanently widening every future quote.

`RFQ_HEDGE_MAX_ORDER_AGE_MS` defaults to 30 seconds and is persisted before submission as part of each new order's execution policy. PostgreSQL authorizes cancellation from database time only after that immutable age elapses, writes `cancel_requested_at` before the signed Binance `DELETE /api/v3/order`, and permits retries to repeat query-first cancellation by the original client id. A lost cancel response, HTTP 5xx, `-2011`, or temporarily missing order remains queued as unknown; only a queried or returned `CANCELED` / `EXPIRED` / `REJECTED` terminal result fails the hedge. If cancellation races a fill, `FILLED` wins, while any terminal partial fill still updates inventory and fee reconciliation from cumulative venue evidence. Migration 025 orders submitted before migration 026 intentionally have no invented expiry policy and remain query-only for operator reconciliation.

Before enabling a new Binance execution route, run the opt-in Spot Testnet canary with a dedicated testnet key whose withdrawal permission is disabled. The script fixes the origin to `https://testnet.binance.vision`, requires `RFQ_BINANCE_TESTNET_INTEGRATION_CONFIRM=place-and-cancel`, checks live symbol filters and enforces a configured limit price at least 100 bps away from the current book by default. It succeeds only after the production adapter proves `absent -> pending -> queried -> canceled -> terminal` with zero executed base/quote quantity and no account trades. Configure the testnet key/secret, symbol, side, quantity, non-marketable price, base/quote assets, token decimals, raw step size and price tick, then run:

```sh
make binance-testnet-integration-check
```

`make binance-testnet-check` runs the deterministic signed-REST fixture in CI and never contacts Binance; it does not replace the credentialed target-environment canary.

The analytics worker is another isolated process (`pnpm --dir backend start:analytics-worker`) with health and metrics on port 3002. PostgreSQL triggers append versioned quote lifecycle, quote routing, market snapshot, risk, settlement, inventory, hedge and PnL events to `analytics_outbox` in the same transaction as each operational state change. Replicas lease rows with `FOR UPDATE SKIP LOCKED`, publish keyed envelopes to the fixed `rfq.analytics.v1` Redpanda topic with all-replica acknowledgements, and mark rows published only after broker acknowledgement. A crash between broker acknowledgement and the PostgreSQL update can duplicate an event, so the ClickHouse projection uses `event_id` with `ReplacingMergeTree`; Kafka offsets are committed only after a successful ClickHouse batch insert. PostgreSQL remains the sole operational source of truth.

The end-to-end check writes uniquely identified synthetic trades that satisfy the current operational schema, waits for all eight event types including immutable route attribution, compares the applied migration set with every compiled migration, and then removes only its own PostgreSQL and ClickHouse fixtures. `make analytics-e2e` starts the production analytics worker and waits for `/ready`; PostgreSQL, Redpanda and ClickHouse must already be running. Readiness probes use a one-second request deadline, ClickHouse requests use a five-second deadline, the integration process has a 60-second hard deadline, and the complete worker lifecycle has a 120-second hard deadline with bounded TERM/KILL child cleanup. Analytics CI builds the backend once before starting Redpanda and ClickHouse, then runs the compiled migration entrypoint behind a two-minute step deadline before entering a separate five-minute E2E step. This prevents resource-heavy dependencies from competing with TypeScript compilation and prevents a build/migration stall from being mistaken for a worker-delivery stall. Override `RFQ_ANALYTICS_E2E_READY_REQUEST_TIMEOUT_MS`, `RFQ_ANALYTICS_INTEGRATION_REQUEST_TIMEOUT_MS`, `RFQ_ANALYTICS_INTEGRATION_TIMEOUT_MS`, or `RFQ_ANALYTICS_E2E_TIMEOUT_SECONDS` only when a reviewed remote canary has a documented latency budget; no individual dependency call may bypass the outer deadline. The check refuses to run without an explicit acknowledgement, defaults to loopback dependencies, and requires `RFQ_ANALYTICS_INTEGRATION_ALLOW_REMOTE=yes` before any non-loopback database or ClickHouse target:

```sh
DATABASE_URL=postgres://rfq:rfq@127.0.0.1:5432/rfq_market_maker \
RFQ_ANALYTICS_KAFKA_BROKERS=127.0.0.1:19092 \
RFQ_ANALYTICS_KAFKA_TOPIC=rfq.analytics.v1 \
RFQ_ANALYTICS_KAFKA_SSL=false \
RFQ_CLICKHOUSE_URL=http://127.0.0.1:8123 \
RFQ_CLICKHOUSE_PASSWORD=rfq-clickhouse-dev \
RFQ_ANALYTICS_INTEGRATION_CONFIRM=yes \
make db-migrate analytics-e2e
```

Analytics CI starts disposable PostgreSQL, Redpanda and ClickHouse containers and enforces the same current-compiled-schema trigger-to-projection path on every relevant push and pull request. This is distinct from unit fixtures: the gate requires broker acknowledgement, consumer offset progression after ClickHouse insertion, exact high-precision JSON fields, and `FINAL` uniqueness by stable outbox event id.

`RFQ_MARKET_PAIRS` is the runtime pair allowlist: it controls background snapshot prefetch, configures the static provider's supported pairs, and derives the default settlement verifier chain/token policy. A pair accepted for quoting therefore cannot silently diverge from the default receipt-verification policy. `RFQ_CEX_PAIRS` adds exchange-specific Level-2 sources using `chainId:baseToken:usdQuoteToken:exchange:symbol:role`, where role is `hedge` or `reference`. The current execution worker is Binance-only, so startup rejects a Coinbase hedge role. Every non-local market must include at least one Binance hedge source and one reference source from an independent exchange; `RFQ_CEX_MIN_SOURCES` has a hard production floor of two and cannot be overridden to one. This prevents a single venue from authorizing both price and executable depth and exposes cross-venue basis through the configured deviation guard. A reviewed fiat-USD reference market such as Coinbase `ETH-USD` can also surface stablecoin basis/depeg symptoms, but source topology alone is not a complete stablecoin oracle. The API and Hedge Worker consume the same `RFQ_HEDGE_ROUTES_JSON`: every hedge source must match one route on `chainId`, base token, USD quote token, venue and symbol, and route decimals must match the shared token registry. Missing or divergent route metadata fails API startup, so an unconfigured Binance symbol cannot inflate executable depth. One synchronized `BASE/USD` book publishes two RFQ snapshots: `baseToken -> usdQuoteToken` uses executable bids, while `usdQuoteToken -> baseToken` uses executable asks and an exact fixed-point reciprocal price. Both directions keep independent `snapshotId`, volatility history, `liquidityUsd`, and conservative `marketSpreadBps`; bid and ask depth are never added together. Prices and quantities use exact 18-decimal fixed-point arithmetic, and `midPrice` always means human tokenOut units per one human tokenIn. After rejecting cross-venue outliers in the requested direction, all accepted sources determine the common directional median and conservative maximum executable spread, but only accepted and route-bound `hedge` sources contribute `liquidityUsd`; a reference-only surviving quorum invalidates both directional cache entries. `formula-v4` therefore computes size impact from depth the deployed hedge worker can actually route, while retaining Coinbase as independent price evidence. A source participates only after full-book synchronization and while its event time, two-sided spread and payload remain valid. Insufficient quorum or missing hedge liquidity deletes both directional CEX cache entries immediately. Non-local runtime defaults `RFQ_CEX_REQUIRE_LIVE_BOOK=true`: both directions of every configured CEX pair must hit the primary CEX cache, so cold, stale, divergent or unsynchronized books fail closed instead of falling through to base cache or `static`. Non-local `static` mode is accepted only when `RFQ_CEX_PAIRS` is non-empty and live-book enforcement remains enabled; an empty source set now fails startup rather than signing against demonstration prices. Operators may explicitly set live-book enforcement to `false` outside local environments only when `RFQ_MARKET_DATA_PROVIDER=chainlink`, making the approved oracle fallback visible in configuration; configured CEX snapshots still retain the independent-source startup policy because they remain the higher-priority cache when healthy. Readiness probes the protected CEX direction when this policy is active. Unchanged books do not receive synthetic observation times, and stale, malformed or sequence-gapped sources must obtain a new full snapshot before becoming ready again.

Binance and Coinbase WebSocket handshakes have a ten-second deadline. A socket that remains in `CONNECTING` or emits an explicit error is closed, its local book is cleared, and reconnection uses bounded exponential backoff with equal jitter; a half-open connection cannot leave a required source unavailable forever. Incoming CEX WebSocket text frames are capped at 1 MiB before JSON decoding, and Binance REST snapshots are streamed with a 2 MiB cap. Coinbase's official `level2` snapshot has no exchange event time, so bounded local receipt time seeds snapshot freshness; subsequent `l2update` messages use exchange time and are checked only against prior stream events, avoiding a false regression caused by network transit. The same subscription includes Coinbase's one-second `heartbeat`: only a valid post-snapshot heartbeat may advance source freshness without mutating or re-emitting the order book, and heartbeat time, sequence, and last trade id must remain monotonic. Binary frames, oversized or malformed payloads, actual exchange/heartbeat regression, and invalid heartbeat fields invalidate the source and require a fresh full snapshot; reconnect jitter is capped at 30 seconds so a fleet does not retry an exchange in lockstep. Order-book and error observers are best-effort boundaries: an observer failure neither turns a synchronized book into an exchange failure nor prevents a genuinely invalid source from closing, clearing state, and entering backoff.

The base provider defaults to `static`. Set `RFQ_MARKET_DATA_PROVIDER=chainlink` with `RFQ_CHAINLINK_CONFIG_JSON` to read configured AggregatorV3 proxy feeds. Every feed requires the reviewed onchain `description`, `decimals`, and raw positive `minAnswer`/`maxAnswer` circuit-breaker bounds; a wrong proxy with compatible decimals cannot silently price another pair. Remote RPC transport must use HTTPS, with plaintext HTTP accepted only for a loopback fixture. Every network declares `networkType` as `l1` or `l2`; L2 configurations must provide both a Sequencer Uptime Feed and recovery grace period, while L1 configurations reject sequencer fields. The backend rejects non-positive, out-of-bound, future-dated, stale, malformed, metadata-mismatched rounds and uses the oracle `updatedAt` as the snapshot observation time. CEX snapshots live in a separate higher-priority cache, so the fallback provider cannot overwrite a synchronized order book merely because its updater ran later.

Before enabling a Chainlink-backed pair or changing its RPC/proxy/bounds, run the read-only target canary from the exact release image or workspace. It loads the same `RFQ_CHAINLINK_CONFIG_JSON` as the API, selects one explicit chain/pair, proves the RPC chain ID before any feed read, reads both RFQ directions through the production service, and verifies feed metadata, circuit breakers, freshness and the L2 sequencer policy without creating a quote or transaction. The output contains only public feed/snapshot evidence and never the RPC URL or provider error:

```sh
RFQ_CHAINLINK_INTEGRATION_CONFIRM=read-live-oracle \
RFQ_CHAINLINK_INTEGRATION_CHAIN_ID=11155111 \
RFQ_CHAINLINK_INTEGRATION_TOKEN_IN=0x1111111111111111111111111111111111111111 \
RFQ_CHAINLINK_INTEGRATION_TOKEN_OUT=0x2222222222222222222222222222222222222222 \
make chainlink-integration-check
```

`make chainlink-canary-check` runs the deterministic L1/L2 fixture in CI and never contacts an RPC. A fixture pass does not replace the target-environment read.

The opt-in live check opens the public Binance and Coinbase market-data streams without credentials and drives the production `CEXOrderBookMonitor` with a two-source quorum. It requires both full books to be synchronized and fresh, verifies cross-source deviation and spread bounds, requires `cex:binance+coinbase` snapshots in both RFQ directions, and proves that only Binance hedge depth contributes executable liquidity. The symbols default to the matching `ETHUSDT` and `ETH-USD` markets and can be overridden together for another shared base asset:

```sh
RFQ_CEX_INTEGRATION_CONFIRM=yes \
RFQ_CEX_INTEGRATION_BINANCE_SYMBOL=ETHUSDT \
RFQ_CEX_INTEGRATION_COINBASE_SYMBOL=ETH-USD \
make cex-orderbook-integration-check
```

`make smoke-api-local` starts the built backend, requests a quote, cryptographically recovers the EIP-712 signer from the returned signature using `RFQ_SIGNER_PRIVATE_KEY` and `RFQ_SETTLEMENT_ADDRESS`, submits the quote, verifies replay rejection, and checks settlement, hedge, PnL and Prometheus metrics.

Direct `buildServer(options)` embedding follows the same runtime bounds for `bodyLimitBytes` and `quoteTtlSeconds`, and rejects non-boolean `logger`, `enableHsts` or `trustProxy` values before the Fastify instance is created.

The frontend reads `VITE_RFQ_API_BASE_URL`, `VITE_RFQ_SETTLEMENT_ADDRESS` and `VITE_WALLETCONNECT_PROJECT_ID` from `/runtime-config.js` before falling back to Vite build/dev-server values. It shows the active API endpoint in the trading console header, sends a dynamic `tr_web_*` `x-trace-id` through the SDK for each API request, and uses Wagmi/RainbowKit with the SDK contract helpers for wallet-driven settlement. Before enabling `submitQuote`, it reads the exact `tokenIn.allowance(user, settlement)` and requests only the quoted `amountIn`; a non-zero insufficient allowance is first reset to zero for USDT-style compatibility, and every approval must have a successful receipt before the allowance is re-read. Wallet and contract-call failures are normalized into bounded UI messages, preferring viem/wagmi `shortMessage`, `details` or custom-error cause text when present. After a wallet transaction hash or accepted submit response, the console automatically follows quote, settlement, hedge, fee-reconciliation and PnL state with bounded 1-8 second exponential polling. Resource identities are checked before display, and every async path is bound to a quote-session version so edits or wallet changes prevent stale responses from repopulating a cleared trade. Production uses same-origin `/api`; a source-restricted rootless Nginx BFF injects the institution key from a read-only Secret and forwards only six reviewed route/method pairs.

The gross model is bound to the immutable quote-time market snapshot and aggregates `/pnl` totals by `(chainId, tokenOut)`; the net model uses its separate valuation-token grouping.

The hedge status response keeps exact fees separated in `commissionTotals`; consumers must not add quantities whose assets differ.

## Local Docker Stack

The local compose stack can run the reference backend, static frontend, Prometheus, Grafana and data dependencies:

```sh
docker compose up --build
```

Start the credential-isolated Binance hedge worker only after supplying IP-restricted testnet credentials with `TRADE` and `USER_DATA` access and withdrawals disabled:

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

Start independent on-chain settlement discovery after an RPC endpoint and deployed contract are available:

```sh
docker compose --profile indexer up --build settlement-indexer
```

Start automatic post-trade toxic-flow scoring after the gateway is persisting market snapshots:

```sh
docker compose --profile toxic-flow up --build toxic-flow-analyzer
```

Local ports:

- Backend API: `http://localhost:3000`
- Frontend console: `http://localhost:5173`
- Prometheus: `http://localhost:9090`
- Grafana: `http://localhost:3001`
- Analytics worker metrics: `http://localhost:3002/metrics`
- Reconciliation worker metrics: `http://localhost:3003/metrics`
- Settlement indexer metrics: `http://localhost:3004/metrics`
- Toxic-flow analyzer metrics: `http://localhost:3005/metrics`
- Redpanda external listener: `localhost:19092`
- ClickHouse HTTP: `http://localhost:8123`

## Production Configuration

Every non-local standalone backend also requires `RFQ_API_KEY_CONFIG_JSON`; startup fails closed when scoped API authentication is absent or explicitly disabled.

`RFQ_TRUSTED_SIGNER_OVERLAP_ADDRESSES` is optional and must be absent outside a bounded rotation window. When present it is a comma-separated list of no more than four unique non-zero addresses; use the two-rollout procedure in `docs/security/key-management.md` so every replica accepts old and new signatures before the KMS signing key changes.

In non-local environments, the API requires `RFQ_SIGNER_MODE=remote`, an HTTPS `RFQ_SIGNER_SERVICE_URL`, `RFQ_SIGNER_SERVICE_TOKEN`, trusted signer, settlement address and a mounted CA through `NODE_EXTRA_CA_CERTS`. Only the isolated signer process uses `RFQ_SIGNER_MODE=aws-kms`, KMS region/key id, key-scoped workload identity and server TLS certificate/key. The API never receives a KMS key id, KMS IAM role or signer TLS private key. The signer independently enforces chain, token, TTL and raw-amount bounds before KMS signing, while the API re-verifies the returned signer. The KMS key must be an asymmetric `ECC_SECG_P256K1` signing key; DER decoding, low-s normalization and recovery remain fail-closed. `RFQ_SIGNER_PRIVATE_KEY` is rejected outside local mode. Signer readiness performs a real sign-and-recover probe, caches success for 30 seconds and coalesces concurrent probes. The built-in Anvil signer fallback is only for unset `NODE_ENV`, `development`, or `test`. Production forces `RFQ_RATE_LIMIT_BACKEND=redis`, requires `RFQ_REDIS_URL` to use `rediss://`, and rejects the embedded `buildServer({ rateLimit: false })` escape hatch; benchmark or fixture code cannot disable distributed rate limiting under a non-local `NODE_ENV`. Production also requires hostname-verified PostgreSQL TLS, rejects plaintext dependency transport, and mandates receipt-confirmed settlement.

Before initial signer rollout or key rotation, run the opt-in AWS KMS identity canary from the target signer workload identity. It forces the production `aws-kms` runtime, invokes one `MessageType=DIGEST` / `ECDSA_SHA_256` signature over a short-lived synthetic EIP-712 quote, independently recovers `RFQ_TRUSTED_SIGNER_ADDRESS`, and prints only the quote digest and signature hash. Configure the KMS key/region, trusted signer, Settlement address and a policy-valid synthetic chain/token/amount tuple, set `RFQ_AWS_KMS_INTEGRATION_CONFIRM=sign-eip712-digest`, then run:

```sh
make aws-kms-integration-check
```

The canary never broadcasts or returns the raw signature and sanitizes provider/close failures so KMS key ids and credential details are not written to output. `make aws-kms-canary-check` is the deterministic CI fixture; a successful direct KMS check proves key access, domain binding and signer identity, but does not replace the isolated service TLS/auth/audit path or a complete `/quote -> settlement` canary.

The backend release image includes the canary at `scripts/aws-kms-integration-check.mjs` without embedding configuration. Inside a signer Pod, supply only the canary tuple and confirmation through the process environment and run `node scripts/aws-kms-integration-check.mjs`; the Pod already receives KMS region/key id, trusted signer and Settlement address from its reviewed deployment Secret/configuration.

After the signer, gateway, market-data, pricing, risk and persistence rollout is ready, run the opt-in target API quote canary with a dedicated API key limited to `quote:write,status:read`. It requires HTTPS, checks `/ready`, requests one policy-valid minimum-size quote, repeats the exact request with the same principal-scoped idempotency key, requires field-for-field identical SDK-validated responses, reads the persisted `signed` status, bounds the returned TTL, and independently recovers `RFQ_TRUSTED_SIGNER_ADDRESS` against `RFQ_SETTLEMENT_ADDRESS`. Configure the target base URL, dedicated API key, chain, user, pair, amount and reviewed maximum TTL, acknowledge the durable quote side effects with `RFQ_API_INTEGRATION_CONFIRM=request-and-replay-quote`, then run:

```sh
RFQ_API_INTEGRATION_BASE_URL=https://rfq-api.example \
RFQ_API_INTEGRATION_API_KEY="${RFQ_CANARY_API_KEY}" \
RFQ_SETTLEMENT_ADDRESS=0x1111111111111111111111111111111111111111 \
RFQ_TRUSTED_SIGNER_ADDRESS=0x2222222222222222222222222222222222222222 \
RFQ_API_INTEGRATION_CHAIN_ID=1 \
RFQ_API_INTEGRATION_USER=0x3333333333333333333333333333333333333333 \
RFQ_API_INTEGRATION_TOKEN_IN=0x4444444444444444444444444444444444444444 \
RFQ_API_INTEGRATION_TOKEN_OUT=0x5555555555555555555555555555555555555555 \
RFQ_API_INTEGRATION_AMOUNT_IN=1000 \
RFQ_API_INTEGRATION_SLIPPAGE_BPS=10 \
RFQ_API_INTEGRATION_MAX_TTL_SECONDS=60 \
RFQ_API_INTEGRATION_MAX_CLOCK_SKEW_SECONDS=5 \
RFQ_API_INTEGRATION_CONFIRM=request-and-replay-quote \
make target-api-quote-integration-check
```

This canary creates one short-lived quote, risk decision, signer audit record and temporary exposure reservation. It never calls `/submit` or broadcasts a transaction, emits only the quote/snapshot identifiers plus digest and signature hash, and replaces target transport or API failure details with a fixed error. The release image includes `scripts/target-api-quote-integration-check.mjs` and the compiled SDK; run it from a controlled operator workload that can reach the public API. `make target-api-quote-check` runs the deterministic HTTPS protocol fixture in CI without contacting a deployed environment.

Before enabling a staging market end to end, use a dedicated testnet wallet and an API principal limited to `quote:write,submit:write,status:read` to run one real settlement. The canary rejects known production chain IDs and requires `RFQ_SETTLEMENT_CANARY_ENVIRONMENT=staging-testnet`; verifies target chain, contract code, pause/whitelist/signer state, gas, balances, a pre-existing allowance no larger than the reviewed input cap, quote idempotency, TTL and signer; simulates the exact SDK calldata; broadcasts exactly once; then verifies transaction calldata, `QuoteSettled`, nonce consumption, exact user/Treasury balance deltas and backend settlement/hedge/PnL identifiers. Prepare a key file owned by the current user with mode `0600`, fund only the bounded test assets and gas needed for this operation, and run:

```sh
RFQ_SETTLEMENT_CANARY_CONFIRM=broadcast-one-settlement \
RFQ_SETTLEMENT_CANARY_ENVIRONMENT=staging-testnet \
RFQ_SETTLEMENT_CANARY_API_BASE_URL=https://staging-rfq.example \
RFQ_SETTLEMENT_CANARY_API_KEY="${RFQ_STAGING_CANARY_API_KEY}" \
RFQ_SETTLEMENT_CANARY_RPC_URL="${RFQ_STAGING_RPC_URL}" \
RFQ_SETTLEMENT_CANARY_CHAIN_ID=11155111 \
RFQ_SETTLEMENT_CANARY_SETTLEMENT_ADDRESS=0x1111111111111111111111111111111111111111 \
RFQ_SETTLEMENT_CANARY_TRUSTED_SIGNER_ADDRESS=0x2222222222222222222222222222222222222222 \
RFQ_SETTLEMENT_CANARY_EXPECTED_USER_ADDRESS=0x3333333333333333333333333333333333333333 \
RFQ_SETTLEMENT_CANARY_USER_KEY_FILE=/secure/rfq-canary-user-key \
RFQ_SETTLEMENT_CANARY_TOKEN_IN=0x4444444444444444444444444444444444444444 \
RFQ_SETTLEMENT_CANARY_TOKEN_OUT=0x5555555555555555555555555555555555555555 \
RFQ_SETTLEMENT_CANARY_AMOUNT_IN=1000 \
RFQ_SETTLEMENT_CANARY_MAX_AMOUNT_IN=1000 \
RFQ_SETTLEMENT_CANARY_MAX_AMOUNT_OUT=1000 \
RFQ_SETTLEMENT_CANARY_MIN_TTL_SECONDS=15 \
RFQ_SETTLEMENT_CANARY_MAX_TTL_SECONDS=120 \
RFQ_SETTLEMENT_CANARY_CONFIRMATIONS=2 \
make target-settlement-integration-check
```

Never point this command at a production chain or reuse a production user, signer, deployer, admin or Treasury key. The script does not approve tokens, retry a transaction or clean up an economic settlement. If submission is ambiguous it stops with an explicit non-retryable result; if a hash was returned, it preserves only that public hash for manual reconciliation while redacting API, RPC and wallet-provider details. The release image includes the script but no key or endpoint. `make target-settlement-check` exercises the full deterministic chain/API fixture in CI without broadcasting.

Leave `RFQ_TRUST_PROXY=false`; only enable it when a trusted reverse proxy or ingress strips untrusted `x-forwarded-for` headers and sets the canonical client address. When enabled, the rate limiter keys by the first `x-forwarded-for` entry after enforcing the 128 character limit and `[A-Za-z0-9_.:-]` character set; otherwise it uses the direct socket IP. Redis uses one atomic Lua operation for counter, TTL and limit decisions across replicas. Redis errors return `RATE_LIMIT_UNAVAILABLE`/503 and degrade `rateLimitStore` readiness; the gateway never silently fails open.

Production Kubernetes requires Cilium DNS-aware policy enforcement. API-to-signer HTTPS is allowed only between exact pod selectors on TCP 3006. The API FQDN list excludes AWS; only the signer workload may reach regional AWS STS/KMS 443. Every other dependency remains an exact workload-owned FQDN and port, with no generic 443 or wildcard rule.

Application images and Kubernetes workloads run without root. API and workers disable ServiceAccount token automount; only the signer ServiceAccount mounts the audience-scoped token required for KMS workload identity. The API ServiceAccount has no IAM annotation.

The Kubernetes API workload uses an `autoscaling/v2` HPA with a 2-to-10 replica range, a 70-percent CPU target, prompt scale-up and stabilized scale-down. Every API and worker Deployment has its own `policy/v1` PDB allowing at most one unavailable replica during eviction-aware maintenance. Hard hostname and zone `topologySpreadConstraints` require the minimum two replicas to occupy two eligible nodes in two zones; a cluster without those labeled failure domains leaves replicas Pending rather than silently co-locating them. The Helm chart requires Kubernetes 1.31 or newer for stable `minDomains` and unhealthy-Pod eviction behavior. Workers remain at explicit replica counts because durable queue pressure and external capacity, not polling CPU, are the correct autoscaling inputs.

Kubernetes deployments load these values from `rfq-backend-secrets`. Replace the placeholders in `infra/k8s/backend-secret.yaml` before applying manifests, or create the same Secret out of band:

```sh
kubectl -n rfq-market-maker create secret generic rfq-backend-secrets \
  --from-literal=DATABASE_URL='postgres://user:password@postgres.example.com:5432/rfq_market_maker?sslmode=verify-full' \
  --from-literal=RFQ_SIGNER_SERVICE_TOKEN='<same-43+-character-token-as-signer>' \
  --from-literal=RFQ_TRUSTED_SIGNER_ADDRESS=0x... \
  --from-literal=RFQ_SETTLEMENT_ADDRESS=0x... \
  --from-literal=RFQ_REDIS_URL=rediss://user:password@redis.example.com:6380/0 \
  --from-literal=RFQ_API_KEY_CONFIG_JSON='{"keys":[{"keyId":"client_primary","principalId":"institution_a","secretSha256":"<sha256-of-secret>","scopes":["quote:write","submit:write","status:read","pnl:read"]}]}'
```

Create `rfq-signer-secrets` separately with the KMS key id, the matching service token, trusted signer, settlement address and `tls.crt`/`tls.key`. Mount the issuing CA as `ca.crt` only in `rfq-backend-secrets`; never expose the signer TLS private key or KMS key id to API pods.

For a signer rotation, add `RFQ_TRUSTED_SIGNER_OVERLAP_ADDRESSES` to `rfq-backend-secrets` only for the bounded overlap window. The plain Kubernetes Deployment imports it through `envFrom`; Helm additionally requires `signerSecret.trustedSignerOverlapAddresses.enabled=true`. Remove the Secret key and disable the Helm reference after old-key retirement.

Create a separate worker Secret so API pods never receive venue credentials. The Binance key should permit spot trading only, use an IP allowlist, and have withdrawals disabled:

```sh
kubectl -n rfq-market-maker create secret generic rfq-hedge-worker-secrets \
  --from-literal=DATABASE_URL='postgres://worker:password@postgres.example.com:5432/rfq_market_maker?sslmode=verify-full' \
  --from-literal=RFQ_BINANCE_API_KEY=... \
  --from-literal=RFQ_BINANCE_API_SECRET=...
```

Create a separate analytics Secret so API and hedge pods never receive Kafka or ClickHouse credentials:

```sh
kubectl -n rfq-market-maker create secret generic rfq-analytics-worker-secrets \
  --from-literal=DATABASE_URL='postgres://analytics:password@postgres.example.com:5432/rfq_market_maker?sslmode=verify-full' \
  --from-literal=RFQ_ANALYTICS_KAFKA_SASL_USERNAME=... \
  --from-literal=RFQ_ANALYTICS_KAFKA_SASL_PASSWORD=... \
  --from-literal=RFQ_CLICKHOUSE_USERNAME=... \
  --from-literal=RFQ_CLICKHOUSE_PASSWORD=...
```

Create a reconciliation-only database Secret. This role needs read access to quotes and settlements plus bounded write access to quote status, hedge, PnL, and reconciliation job tables, but no DDL privileges:

```sh
kubectl -n rfq-market-maker create secret generic rfq-reconciliation-worker-secrets \
  --from-literal=DATABASE_URL='postgres://reconciliation:password@postgres.example.com:5432/rfq_market_maker?sslmode=verify-full'
```

Create a settlement-indexer Secret with an indexer database role and the RPC-bearing chain configuration. Set `startBlock` to the actual `RFQSettlement` deployment block and keep the settlement address aligned with signer and receipt verification configuration:

```sh
kubectl -n rfq-market-maker create secret generic rfq-settlement-indexer-secrets \
  --from-literal=DATABASE_URL='postgres://indexer:password@postgres.example.com:5432/rfq_market_maker?sslmode=verify-full' \
  --from-literal=RFQ_SETTLEMENT_INDEXER_CONFIG_JSON='{"chains":[{"chainId":1,"rpcUrl":"https://rpc.example.com","settlementAddress":"0x...","startBlock":20000000,"confirmations":12,"maxBlockRange":500,"reorgLookbackBlocks":5000,"requestTimeoutMs":10000}]}'
```

Create a toxic-flow analyzer Secret containing only its least-privilege database role. The role needs canonical settlement and market-snapshot reads, markout job leases, markout writes, and CAS score/audit writes; it needs no DDL, signer, RPC, venue, Kafka, ClickHouse, Redis, or admin API credential:

```sh
kubectl -n rfq-market-maker create secret generic rfq-toxic-flow-analyzer-secrets \
  --from-literal=DATABASE_URL='postgres://toxic_analyzer:password@postgres.example.com:5432/rfq_market_maker?sslmode=verify-full'
```

Use a third, migration-only Secret for the init container's DDL-capable database role. Runtime API and worker roles should not own schema privileges:

```sh
kubectl -n rfq-market-maker create secret generic rfq-database-migration-secrets \
  --from-literal=DATABASE_URL='postgres://migrator:password@postgres.example.com:5432/rfq_market_maker?sslmode=verify-full'
```

The API credential digest JSON is exposed to the backend only through Helm `apiKeySecret`; it is not part of the ConfigMap or worker Secrets. The internal frontend uses a separate plaintext institutional key Secret containing `api-key.conf`; rootless Nginx injects it only for six allowlisted trading routes. Deploy one source-restricted TLS frontend per institution, never expose admin/health/metrics routes, and roll the frontend Deployment after rotating this Secret.

The Helm chart uses `signerSecret` for API-side signer token/CA/trust metadata and `signerService.secret` for KMS/TLS material. Only `signerService.serviceAccount.annotations` binds `kms:Sign`; the API service account remains unannotated. Other worker Secrets retain their existing least-privilege ownership.

API, hedge, analytics, reconciliation, settlement-indexer, and toxic-flow analyzer Kubernetes Deployments run the migration entrypoint in an init container using `migrationSecret`. Migration discovery and execution are serialized by a PostgreSQL session advisory lock, allowing multiple rollout pods to start safely while ensuring all migrations through `034-quote-route-attribution.sql` are committed before any process checks readiness. A competing init container retries the session lock for at most four minutes; the CLI logs `connecting`、`acquiring-lock`、`reading-state` and each applied version, always closes its pool on completion or failure, and enforces a five-minute hard deadline by default. `RFQ_MIGRATION_TIMEOUT_MS` can set that deadline from 1000 to 1800000 ms; keep it above the expected schema-change duration and below the platform's init-container restart budget. Before applying migration 017 to an existing deployment, stop quote admission and wait at least the maximum quote TTL; historical rows receive isolated legacy principals and are intentionally unavailable through institutional APIs. The DDL-capable migrator credential is not mounted into runtime containers. The isolated signer uses a separate verify-full `RFQ_SIGNER_AUDIT_DATABASE_URL` whose role only has `INSERT` on `signer_audit_events` and `USAGE` on its sequence; migration 028 binds every new audit row to the persisted risk decision, policy version and request trace, and audit persistence must complete before a signature is returned. Production operators must provision `rfq.analytics.v1` before starting analytics consumers; auto topic creation is intentionally disabled.

Artifact release is handled by `.github/workflows/release.yml`. A `v*.*.*` tag or manual dispatch first reruns `make verify` and Foundry tests in a read-only job, then builds the backend and frontend images for `linux/amd64` and publishes them to GHCR with BuildKit SBOM and `mode=max` provenance. Before either digest is signed, the workflow pulls the immutable images and probes both under a read-only root filesystem, bounded `/tmp`, non-root user, no capabilities and `no-new-privileges`. It then signs each returned digest through Cosign keyless OIDC, packages the Helm chart, publishes it as an OCI chart, and uploads `release-manifest.json`. The publishing job cannot run unless verification passes; the workflow has no pull-request trigger or cluster credentials. All Actions use full commit SHA pins; Dependabot proposes weekly updates.

Production deployment must consume both backend and frontend digests from `release-manifest.json`:

```sh
helm upgrade --install rfq-market-maker \
  oci://ghcr.io/OWNER/charts/rfq-market-maker \
  --version RELEASE_VERSION \
  --set-string image.repository=ghcr.io/OWNER/REPOSITORY-backend \
  --set-string image.digest=sha256:RELEASE_DIGEST \
  --set-string frontend.image.repository=ghcr.io/OWNER/REPOSITORY-frontend \
  --set-string frontend.image.digest=sha256:FRONTEND_RELEASE_DIGEST \
  --atomic --wait
```

The Helm helpers render `repository@digest` whenever the backend or frontend digest is set; tags are non-production fallbacks. Raw manifests deliberately contain unavailable all-zero digests and therefore fail closed until an operator replaces them with verified release digests. Verify the Cosign issuer/workflow identity before promotion and retain the release manifest with the deployment audit record.

Local API smoke path:

```sh
make smoke-api-local
```

Repository quality gate:

```sh
make verify
```

`make verify` runs skeleton, examples, configuration, documentation, book template, ADR, security documentation, metrics consistency, runbook consistency, Grafana dashboard consistency, deployment manifest consistency, CI workflow consistency, Docker Compose, KMS signer, EIP-712, ABI, API rate-limit, API error-code, API schema, API route, database schema, quote and submit benchmarks, backend, SDK, frontend and local API smoke checks through one entrypoint. If Foundry is installed locally it also runs contract tests plus the deterministic target-chain deployment verifier; when both Foundry and Anvil are available it additionally runs the receipt-confirmed settlement E2E below. Contract CI always installs both tools and enforces all three gates.

Receipt-confirmed settlement E2E:

```sh
make settlement-e2e
```

This starts an isolated Anvil chain, deploys two ERC-20 fixtures, then uses the real `RFQDeploymentFactory` to atomically create, wire and hand off `Treasury` plus `RFQSettlement`. It runs the same deployment canary against that real RPC before obtaining a backend-signed quote, broadcasting `submitQuote` from the quote user, and submitting only its `txHash` to the backend. The gate independently validates runtime artifacts, administration, transaction calldata, receipt and `QuoteSettled`, then checks on-chain balances, nonce consumption, inventory, hedge, PnL and metrics. It is distinct from synthetic API smoke coverage and does not require a persistent local chain.

Settlement, production hedge, callback-loss and reorg E2E (disposable PostgreSQL only):

```sh
DATABASE_URL=postgres://rfq:rfq@127.0.0.1:5432/rfq_market_maker \
RFQ_SETTLEMENT_INDEXER_E2E_CONFIRM=yes \
make db-migrate settlement-indexer-e2e
```

This second gate exercises the production PostgreSQL stores and workers against a real Anvil event stream and a deterministic signature-verifying Binance API. Contract CI runs it after migrations and requires callback deduplication, a queued hedge accepted across the Execution Service boundary, exact hedge and fee convergence, complete net PnL, wallet-only recovery, and reorg-safe rollback on a replaced chain branch.

Browser end-to-end gate (install Chromium once with `pnpm --dir frontend e2e:install`):

```sh
make frontend-e2e
```

This starts an isolated in-memory backend and Vite UI on dedicated loopback ports, then drives a real Chromium session through quote creation, API settlement, authoritative quote/settlement/hedge/PnL reads, and client-side rejection without replacing backend routes with mocks. GitHub Actions runs this as a dedicated workflow and the release verifier repeats it before publishing artifacts; repository administrators should mark the workflow as required in branch protection.

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
const authenticatedClient = new RFQClient("https://rfq.example.com", { apiKey: () => currentApiKey });

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

`RFQClientError` preserves structured API errors. It uses safe own-field `ErrorResponse.traceId` values when the backend returns the standard error body, and falls back to safe `x-trace-id` response headers when an upstream proxy, malformed JSON, prototype-backed error body, or malformed successful response field prevents normal error parsing. Response trace ids must match the same `tr_[A-Za-z0-9._:-]+` and 128-character limit as outgoing client trace ids; unsafe body or header values are ignored. For HTTP 429 `RATE_LIMITED` responses, the SDK exposes `retryAfterSeconds` only when the `Retry-After` header is a canonical positive decimal delay-seconds value in the JavaScript safe integer range, so callers can back off without parsing headers directly and non-canonical proxy values are ignored. Successful quote, submit, quote status, settlement, hedge, and PnL responses are validated field by field, including 128-character bounded safe identifiers, signatures, token addresses, hashes, canonical positive uint strings without leading zeros, signed int/decimal strings and timestamps. For PnL, the SDK independently recomputes decimals-aware gross attribution, verifies one hedge-net record per gross trade, validates status-specific closed fields and availability reasons, and independently recomputes both gross `(chainId, tokenOut)` totals and completed hedge-net `(chainId, valuationToken, valuationAsset)` totals.

`RFQClient` validates its base URL, static `traceId` values, trace provider type, and fetch dependency at construction. Dynamic trace provider results are validated before each request. The base URL and outgoing trace ids must be runtime primitive strings before URL parsing or header construction, so JavaScript callers get a stable `RFQClientError` instead of native coercion behavior. The accepted base URL is an absolute HTTP(S) URL with an optional path prefix; credentials, wildcard hosts, query strings and fragments are rejected before any request leaves the process. By default it uses `globalThis.fetch`; server-side runtimes, tests, and constrained execution environments can pass `{ fetch: customFetch }` to keep transport ownership explicit. Integrators can pass `{ traceId: "tr_session_123" }` or `{ traceId: () => "tr_request_123" }` to propagate a safe `x-trace-id` header on SDK requests.

The SDK also exports `erc20Abi`, `rfqSettlementAbi`, `treasuryAbi`, `buildErc20AllowanceReadRequest`, `buildErc20ApprovalWriteRequest`, `buildSubmitQuoteArgs`, `hashSettlementQuote`, and `buildTreasuryTransferArgs` for viem/wagmi allowance management, contract calls, event reconciliation, public state reads, role administration helpers, and custom-error revert decoding.

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
- [Volume 7: Production Deployment](book/Volume7-ProductionDeployment/README.md)
