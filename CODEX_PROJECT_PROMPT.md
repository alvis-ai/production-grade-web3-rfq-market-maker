
# CODEX_PROJECT_PROMPT.md

# Production-Grade Web3 RFQ Market Maker

## 0. Role

You are Codex acting as a senior Web3 full-stack engineer, smart contract engineer, DeFi system architect, and technical writer.

Your goal is to initialize and progressively build a production-grade open-source project:

> Production-Grade Web3 RFQ Market Maker  
> 从零构建生产级 RFQ / Prop AMM 做市系统

The project should be suitable as:
- a GitHub portfolio project,
- a senior Web3 engineer interview project,
- a technical design document library,
- a runnable reference implementation.

---

## 1. Project Goal

Build a complete RFQ + Prop AMM market-making system.

Core flow:

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

The system should include:

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
- Full documentation

---

## 2. Technology Stack

### Backend

Use:

- Node.js
- TypeScript
- NestJS or Fastify
- PostgreSQL
- Redis
- Kafka or Redpanda
- ClickHouse
- Prometheus
- Grafana

### Smart Contract

Use:

- Solidity
- Foundry
- OpenZeppelin
- EIP-712
- SafeERC20
- ReentrancyGuard
- Pausable
- AccessControl

### Frontend

Use:

- React
- Vite
- TypeScript
- Wagmi
- Viem
- RainbowKit
- TanStack Query

### Infra

Use:

- Docker Compose
- Kubernetes
- Helm
- GitHub Actions

---

## 3. Required Repository Structure

Initialize this repository structure:

```text
production-grade-web3-rfq-market-maker/

├── README.md
├── LICENSE
├── Makefile
├── docker-compose.yml
├── .gitignore
├── .editorconfig
├── .github/
│   └── workflows/
│       ├── backend-ci.yml
│       ├── contract-ci.yml
│       └── docs-ci.yml
│
├── book/
│   ├── Volume1-SystemArchitecture/
│   │   ├── README.md
│   │   ├── Chapter01-Why-RFQ.md
│   │   ├── Chapter02-Prop-AMM-Evolution.md
│   │   ├── Chapter03-Requirements.md
│   │   ├── Chapter04-System-Overview.md
│   │   ├── Chapter05-Business-Flow.md
│   │   ├── Chapter06-C4-Architecture.md
│   │   ├── Chapter07-Microservices.md
│   │   ├── Chapter08-Failure-Recovery.md
│   │   └── Chapter09-Architecture-Review.md
│   │
│   ├── Volume2-MarketData-And-Pricing/
│   │   ├── README.md
│   │   ├── Chapter01-Market-Data.md
│   │   ├── Chapter02-Price-Normalization.md
│   │   ├── Chapter03-Mid-Price.md
│   │   ├── Chapter04-Spread.md
│   │   ├── Chapter05-Size-Impact.md
│   │   ├── Chapter06-Volatility-Premium.md
│   │   └── Chapter07-Pricing-Formula.md
│   │
│   ├── Volume3-RiskEngine/
│   │   ├── README.md
│   │   ├── Chapter01-Inventory.md
│   │   ├── Chapter02-Delta.md
│   │   ├── Chapter03-Gamma.md
│   │   ├── Chapter04-VaR.md
│   │   ├── Chapter05-Position-Limits.md
│   │   ├── Chapter06-Toxic-Flow.md
│   │   └── Chapter07-Risk-State-Machine.md
│   │
│   ├── Volume4-SmartContracts/
│   │   ├── README.md
│   │   ├── Chapter01-EIP712.md
│   │   ├── Chapter02-RFQSettlement.md
│   │   ├── Chapter03-Nonce-And-Replay.md
│   │   ├── Chapter04-Slippage.md
│   │   ├── Chapter05-Security.md
│   │   └── Chapter06-Testing.md
│   │
│   ├── Volume5-BackendEngineering/
│   │   ├── README.md
│   │   ├── Chapter01-API-Gateway.md
│   │   ├── Chapter02-Quote-Service.md
│   │   ├── Chapter03-Pricing-Service.md
│   │   ├── Chapter04-Risk-Service.md
│   │   ├── Chapter05-Signer-Service.md
│   │   ├── Chapter06-Execution-Service.md
│   │   ├── Chapter07-Hedge-Service.md
│   │   └── Chapter08-Metrics-Service.md
│   │
│   ├── Volume6-Frontend-And-SDK/
│   │   ├── README.md
│   │   ├── Chapter01-Frontend-Architecture.md
│   │   ├── Chapter02-Quote-UI.md
│   │   ├── Chapter03-Submit-Flow.md
│   │   └── Chapter04-SDK.md
│   │
│   └── Volume7-ProductionDeployment/
│       ├── README.md
│       ├── Chapter01-Docker.md
│       ├── Chapter02-Kubernetes.md
│       ├── Chapter03-Monitoring.md
│       ├── Chapter04-CI-CD.md
│       └── Chapter05-Runbook.md
│
├── docs/
│   ├── adr/
│   │   ├── ADR-0001-Use-RFQ-Instead-Of-AMM.md
│   │   ├── ADR-0002-Use-EIP712-For-Quotes.md
│   │   ├── ADR-0003-Use-Postgres-Redis-Kafka-ClickHouse.md
│   │   └── ADR-0004-Use-Inventory-Based-Pricing.md
│   │
│   ├── api/
│   │   ├── openapi.yaml
│   │   └── errors.md
│   │
│   ├── database/
│   │   ├── schema.sql
│   │   └── er-diagram.md
│   │
│   ├── diagrams/
│   │   ├── system-overview.md
│   │   ├── quote-sequence.md
│   │   ├── submit-sequence.md
│   │   ├── hedge-sequence.md
│   │   └── risk-state-machine.md
│   │
│   ├── security/
│   │   ├── threat-model.md
│   │   ├── audit-checklist.md
│   │   └── key-management.md
│   │
│   └── interview/
│       ├── README.md
│       ├── rfq-questions.md
│       ├── smart-contract-questions.md
│       ├── backend-questions.md
│       └── system-design-questions.md
│
├── contracts/
│   ├── foundry.toml
│   ├── remappings.txt
│   ├── src/
│   │   ├── RFQSettlement.sol
│   │   ├── Treasury.sol
│   │   └── interfaces/
│   │       └── IRFQSettlement.sol
│   ├── test/
│   │   └── RFQSettlement.t.sol
│   └── script/
│       └── Deploy.s.sol
│
├── backend/
│   ├── package.json
│   ├── tsconfig.json
│   ├── src/
│   │   ├── main.ts
│   │   ├── modules/
│   │   │   ├── quote/
│   │   │   ├── pricing/
│   │   │   ├── risk/
│   │   │   ├── signer/
│   │   │   ├── execution/
│   │   │   ├── hedge/
│   │   │   ├── inventory/
│   │   │   └── metrics/
│   │   └── shared/
│   │       ├── config/
│   │       ├── logger/
│   │       └── types/
│   └── test/
│
├── frontend/
│   ├── package.json
│   ├── vite.config.ts
│   ├── src/
│   │   ├── app/
│   │   ├── components/
│   │   ├── pages/
│   │   ├── hooks/
│   │   └── lib/
│   └── public/
│
├── sdk/
│   ├── package.json
│   ├── src/
│   │   ├── client.ts
│   │   ├── types.ts
│   │   └── eip712.ts
│   └── test/
│
├── infra/
│   ├── docker/
│   ├── k8s/
│   ├── helm/
│   ├── prometheus/
│   └── grafana/
│
├── scripts/
├── benchmark/
└── examples/
```

---

## 4. Documentation Standard

Every chapter in `book/` must follow this template:

```markdown
# Chapter X: Title

## Abstract

## Learning Objectives

## Background

## Problem Statement

## Requirements

### Functional Requirements

### Non-Functional Requirements

## Existing Solutions

## Trade-Off Analysis

## System Design

## Architecture Diagram

## Sequence Diagram

## State Machine

## Data Model

## API Design

## Engineering Decisions

## Failure Scenarios

## Security Considerations

## Performance Considerations

## Testing Strategy

## Interview Notes

## Summary

## References
```

Use Mermaid diagrams wherever useful.

Do not write shallow documentation. Each chapter should read like a serious technical design document.

---

## 5. First Task

Start by creating the repository skeleton and these files:

1. `README.md`
2. `book/Volume1-SystemArchitecture/README.md`
3. `book/Volume1-SystemArchitecture/Chapter01-Why-RFQ.md`
4. `docs/adr/ADR-0001-Use-RFQ-Instead-Of-AMM.md`
5. `docs/diagrams/system-overview.md`
6. `docs/diagrams/quote-sequence.md`
7. `docs/interview/rfq-questions.md`

Use the content direction from this prompt.

---

## 6. Chapter 1 Content Requirement

Write `Chapter01-Why-RFQ.md` in Chinese.

It must include:

- Why AMM exists
- Why AMM is not enough for professional market making
- Price Impact
- Inventory Management
- Risk Management
- MEV
- Quote / Execute inconsistency
- RFQ definition
- Signed Quote
- TTL
- EIP-712
- RFQ flow
- RFQ vs AMM comparison table
- Why this project chooses RFQ + Prop AMM
- Mermaid sequence diagram
- Mermaid system diagram
- Interview notes

Tone:

- serious,
- professional,
- suitable for senior Web3 engineer interview,
- not too casual.

---

## 7. ADR-0001 Content Requirement

Write `ADR-0001-Use-RFQ-Instead-Of-AMM.md`.

Use this format:

```markdown
# ADR-0001: Use RFQ Instead Of Pure AMM

## Status

Accepted

## Context

## Decision

## Consequences

### Positive

### Negative

### Mitigation

## Alternatives Considered
```

Alternatives:

- Pure AMM
- Order Book
- DEX Aggregator
- RFQ + Prop AMM

Decision:

Use RFQ + Prop AMM as the core trading model.

---

## 8. API Direction

The API should eventually include:

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

---

## 9. Smart Contract Direction

The core Solidity contract will be:

```solidity
contract RFQSettlement
```

Core function:

```solidity
function submitQuote(
    Quote calldata quote,
    bytes calldata signature
) external nonReentrant whenNotPaused returns (uint256 amountOut);
```

Quote struct:

```solidity
struct Quote {
    address user;
    address tokenIn;
    address tokenOut;
    uint256 amountIn;
    uint256 amountOut;
    uint256 minAmountOut;
    uint256 nonce;
    uint256 deadline;
    uint256 chainId;
}
```

Required protections:

- EIP-712 verification
- trusted signer
- nonce replay protection
- deadline expiry
- token whitelist
- pause
- reentrancy protection
- SafeERC20

---

## 10. Backend Direction

The backend should eventually include these modules:

- Quote Module
- Pricing Module
- Risk Module
- Signer Module
- Execution Module
- Inventory Module
- Hedge Module
- Metrics Module

Each module should expose clear service interfaces.

---

## 11. Design Principles

Follow these principles:

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

---

## 12. Acceptance Criteria For First Commit

The first commit is accepted if:

- Repository skeleton is created.
- README clearly explains project purpose.
- Chapter 1 is at least 5,000 Chinese characters.
- ADR-0001 exists and is complete.
- At least 3 Mermaid diagrams exist.
- Interview questions contain at least 20 RFQ questions.
- Markdown files render correctly.
- No placeholder-only files.
- Directory structure matches the plan.

---

## 13. Next Tasks After First Commit

After completing the first commit, continue with:

1. Chapter 2: Prop AMM Evolution
2. Chapter 3: Requirements
3. Chapter 4: System Overview
4. OpenAPI draft
5. Database schema draft
6. RFQSettlement Solidity skeleton
7. Quote service TypeScript skeleton
8. Pricing engine interface
9. Risk engine interface
10. EIP-712 SDK helper

---

## 14. Writing Style

Use Chinese for book and design docs.

Use English for:
- code,
- filenames,
- API specs,
- Solidity comments if appropriate,
- package names,
- interface names.

Avoid vague statements. Explain trade-offs.

Every major design decision should answer:

- Why this design?
- What does it solve?
- What does it cost?
- What can go wrong?
- How do we mitigate it?

---

## 15. Start Now

Begin by generating the repository structure and the first batch of documents.

Do not ask for confirmation.

Create files directly.

