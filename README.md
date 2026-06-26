# Production-Grade Web3 RFQ Market Maker

从零构建生产级 RFQ / Prop AMM 做市系统。这个仓库的目标不是只展示一个最小 demo，而是沉淀一套可以用于 GitHub 作品集、高级 Web3 工程师面试、技术设计文档和可运行参考实现的完整工程。

## Project Purpose

本项目围绕专业做市场景中的核心问题展开：如何在链上结算的约束下，将报价、风控、签名、执行、库存、对冲和观测打通，并保证报价和成交之间的一致性。

核心链路固定为：

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

## System Scope

第一阶段只初始化仓库骨架和核心设计文档，不实现后端、前端或合约代码。后续阶段会逐步补齐：

- RFQ Quote API
- Pricing Engine
- Risk Engine
- Market Data Service
- EIP-712 Signer
- RFQ Settlement Smart Contract
- Execution Engine
- Inventory Service
- Hedge Engine
- Routing Engine
- Metrics / Observability
- Frontend Trading UI
- TypeScript SDK
- Docker / Kubernetes deployment

## Technology Direction

- Backend: Node.js, TypeScript, NestJS or Fastify, PostgreSQL, Redis, Kafka or Redpanda, ClickHouse
- Smart Contract: Solidity, Foundry, OpenZeppelin, EIP-712, SafeERC20, ReentrancyGuard, Pausable, AccessControl
- Frontend: React, Vite, TypeScript, Wagmi, Viem, RainbowKit, TanStack Query
- Infra: Docker Compose, Kubernetes, Helm, GitHub Actions, Prometheus, Grafana

## API Direction

未来 API 将至少包括：

```http
POST /quote
POST /submit
GET /quote/:id
GET /health
GET /metrics
```

Example quote request:

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

Example quote response:

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

## Smart Contract Direction

核心合约为 `RFQSettlement`，关键入口为：

```solidity
function submitQuote(
    Quote calldata quote,
    bytes calldata signature
) external nonReentrant whenNotPaused returns (uint256 amountOut);
```

核心保护包括 EIP-712 verification、trusted signer、nonce replay protection、deadline expiry、token whitelist、pause、reentrancy protection 和 SafeERC20。

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

## First Batch Documents

- [Volume 1: System Architecture](book/Volume1-SystemArchitecture/README.md)
- [Chapter 1: Why RFQ](book/Volume1-SystemArchitecture/Chapter01-Why-RFQ.md)
- [ADR-0001: Use RFQ Instead Of Pure AMM](docs/adr/ADR-0001-Use-RFQ-Instead-Of-AMM.md)
- [System Overview Diagram](docs/diagrams/system-overview.md)
- [Quote Sequence Diagram](docs/diagrams/quote-sequence.md)
- [RFQ Interview Questions](docs/interview/rfq-questions.md)

## Repository Status

This repository is in the first documentation and skeleton phase. The current commit establishes the architecture vocabulary, directory layout, first design decision, and core RFQ reasoning before implementation begins.
