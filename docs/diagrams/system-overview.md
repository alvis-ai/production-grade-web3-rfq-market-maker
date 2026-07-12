# System Overview Diagram

本图描述 RFQ / Prop AMM 做市系统的核心组件和数据流。系统采用链下复杂决策、链上最小验证的结构。

```mermaid
flowchart TB
  subgraph Client["Client Layer"]
    Trader["Trader / Wallet"]
    SDK["TypeScript SDK"]
    UI["Frontend Trading UI"]
  end

  subgraph API["API Layer"]
    Gateway["RFQ API Gateway"]
    QuoteAPI["POST /quote"]
    SubmitAPI["POST /submit"]
    HealthAPI["GET /health /metrics"]
  end

  subgraph Decision["Off-chain Decision Layer"]
    MarketData["Market Data Service"]
    Pricing["Pricing Engine"]
    Risk["Risk Engine"]
    Signer["EIP-712 Signer"]
    Inventory["Inventory Service"]
    Hedge["Hedge Engine"]
    Routing["Routing Engine"]
    Indexer["Settlement Indexer"]
    Reconciliation["Reconciliation Worker"]
  end

  subgraph Data["Data and Observability"]
    Postgres["PostgreSQL"]
    Redis["Redis"]
    Redpanda["Kafka / Redpanda"]
    ClickHouse["ClickHouse"]
    Prometheus["Prometheus"]
    Grafana["Grafana"]
  end

  subgraph Chain["Blockchain Layer"]
    Settlement["RFQSettlement"]
    Tokens["ERC20 Tokens"]
    RPC["Configured Chain RPC"]
  end

  Trader --> UI
  UI --> SDK
  SDK --> Gateway
  Gateway --> QuoteAPI
  Gateway --> SubmitAPI
  Gateway --> HealthAPI

  QuoteAPI --> MarketData
  MarketData --> Pricing
  Pricing --> Risk
  Risk --> Signer
  Signer --> Gateway

  UI --> Settlement
  UI --> SubmitAPI
  Settlement --> Tokens
  Settlement --> RPC
  SubmitAPI --> RPC
  Indexer --> RPC
  SubmitAPI --> Postgres
  Indexer --> Postgres
  Postgres --> Inventory
  Postgres --> Reconciliation
  Reconciliation --> Hedge
  Hedge --> Routing

  Gateway --> Postgres
  Gateway --> Redis
  Inventory --> Redpanda
  Postgres --> Redpanda
  Redpanda --> ClickHouse
  Gateway --> Prometheus
  Prometheus --> Grafana
```

## Core Invariant

报价系统的核心不变量是 quote 和 execution 的一致性：链上提交的 `Quote` 必须等于链下签名时风控和定价通过的 `Quote`，并且必须在 TTL、nonce、token whitelist、chainId 和 trusted signer 约束下执行。
