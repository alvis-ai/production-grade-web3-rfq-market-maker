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
  participant Chain as EVM RPC / Treasury
  participant Signer as EIP-712 Signer
  participant Store as PostgreSQL / Redis

  User->>API: POST /quote(chainId, user, tokenIn, tokenOut, amountIn, slippageBps)
  API->>API: Validate request schema and token support
  API->>MD: Load market snapshot
  MD-->>API: snapshotId, midPrice, liquidity, marketSpread, volatility
  API->>Pricing: Calculate quote with snapshot and inventory context
  Pricing-->>API: amountOut, totalSpread, sizeImpact, marketSpread, inventorySkew, volatilityPremium, hedgeCost
  API->>Risk: Check limits, inventory, toxicity, notional, chain policy
  alt Risk accepted
    Risk-->>API: approved risk decision
    API->>Chain: read treasury and tokenOut balance at one block
    Chain-->>API: treasury, balance, blockNumber
    API->>Store: reserve user, pair, and tokenOut capacity until TTL
    alt Treasury capacity insufficient
      Store-->>API: TREASURY_LIQUIDITY_INSUFFICIENT
      API-->>User: RISK_REJECTED
    else Capacity reserved
    API->>Signer: Sign EIP-712 Quote
    Signer-->>API: signature, signer, deadline, nonce
    API->>Store: Persist quote, snapshotId, risk decision
    API-->>User: quoteId, snapshotId, amountOut, minAmountOut, deadline, nonce, signature
    end
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
- 生产环境必须把真实 Treasury `tokenOut` 余额与所有未过期 quote 的输出预留比较；链 RPC 和数据库无法原子提交，因此 settled reservation 仍保留到 TTL，优先保证不超卖。
