# Quote Sequence Diagram

本图描述 `POST /quote` 的第一阶段目标链路。实现时，报价必须先通过市场数据、定价和风控，再进入 EIP-712 签名。

```mermaid
sequenceDiagram
  autonumber
  participant User as Trader / SDK
  participant API as RFQ API Gateway
  participant MD as Market Data Service
  participant Pricing as Pricing Engine
  participant Risk as Risk Engine
  participant Signer as EIP-712 Signer
  participant Store as PostgreSQL / Redis

  User->>API: POST /quote(chainId, user, tokenIn, tokenOut, amountIn, slippageBps)
  API->>API: Validate request schema and token support
  API->>MD: Load market snapshot
  MD-->>API: snapshotId, midPrice, liquidity, volatility
  API->>Pricing: Calculate quote with snapshot and inventory context
  Pricing-->>API: amountOut, spread, sizeImpact, inventorySkew, volatilityPremium, hedgeCost
  API->>Risk: Check limits, inventory, toxicity, notional, chain policy
  alt Risk accepted
    Risk-->>API: approved risk decision
    API->>Signer: Sign EIP-712 Quote
    Signer-->>API: signature, signer, deadline, nonce
    API->>Store: Persist quote, snapshotId, risk decision
    API-->>User: quoteId, snapshotId, amountOut, minAmountOut, deadline, nonce, signature
  else Risk rejected
    Risk-->>API: reject reason and policy id
    API->>Store: Persist rejection for observability
    API-->>User: RFQ error response
  end
```

## Design Notes

- `Risk Engine` 必须位于 `Signer` 之前。
- `deadline` 必须足够短，避免市场状态漂移。
- `snapshotId` 是排查报价争议、风控争议和 PnL 归因的关键字段。
- Rejected quote 也应该记录，但不能返回可执行签名。
