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

```http
POST /quote
POST /submit
GET /quote/:id
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

核心保护包括 EIP-712 verification、trusted signer、nonce replay protection、deadline expiry、token whitelist、pause、reentrancy protection 和 SafeERC20。

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
RFQ_SIGNER_PRIVATE_KEY=0x...
RFQ_SETTLEMENT_ADDRESS=0x...
```

The backend signer uses the same `ProductionGradeRFQ` EIP-712 domain as the SDK and `RFQSettlement` contract.

Local API smoke path:

```sh
make smoke-api-local
```

## TypeScript SDK

`@rfq-market-maker/sdk` exposes `RFQClient` for the current API surface:

```ts
const client = new RFQClient("http://localhost:3000");

await client.quote(request);
await client.submit({ quote, signature });
await client.getQuote("q_...");
await client.health();
await client.metrics();
```

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
