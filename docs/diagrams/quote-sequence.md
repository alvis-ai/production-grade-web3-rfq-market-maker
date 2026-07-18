# Quote Sequence Diagram

本图描述当前 `POST /quote` 的生产链路。市场数据、库存、估值与 Treasury balance 在请求外刷新；报价请求只消费有 freshness bound 的内存状态，依次通过定价、风控与 Redis exposure reservation，再进入 EIP-712 签名。

```mermaid
sequenceDiagram
  autonumber
  participant User as Trader / SDK
  participant API as RFQ API Gateway
  participant MD as Market Data Service
  participant Refresh as Background State Refreshers
  participant Hot as Immutable Hot State
  participant Pricing as Pricing Engine
  participant Risk as Risk Engine
  participant Chain as EVM RPC / Treasury
  participant Redis as Redis / Valkey Ledger
  participant Signer as EIP-712 Signer
  participant PG as PostgreSQL Audit

  loop Outside request handling
    Refresh->>Chain: verify chain and read treasury/token balances
    Chain-->>Refresh: validated per-target block evidence
    Refresh->>Hot: atomically publish complete generation
  end

  User->>API: POST /quote(chainId, user, tokenIn, tokenOut, amountIn, slippageBps)
  API->>API: Validate request schema and token support
  API->>MD: Load market snapshot
  MD-->>API: snapshotId, midPrice, liquidity, marketSpread, volatility
  par Independent durable setup
    API->>PG: Persist immutable market snapshot
  and
    API->>PG: Bind idempotency owner to quoteId
  end
  API->>Pricing: Calculate quote with snapshot and inventory context
  Pricing-->>API: amountOut, totalSpread, sizeImpact, marketSpread, inventorySkew, volatilityPremium, hedgeCost
  API->>Risk: Check limits, inventory, toxicity, notional, chain policy
  alt Risk accepted
    Risk-->>API: approved risk decision
    API->>Hot: read fresh Treasury target evidence
    Hot-->>API: balance, blockNumber, generation
    API->>Redis: atomically reserve user, pair, tokenOut, VaR and Delta until ledger deadline
    alt Treasury capacity insufficient
      Redis-->>API: TREASURY_LIQUIDITY_INSUFFICIENT
      API-->>User: RISK_REJECTED
    else Capacity reserved
    API->>Signer: Sign EIP-712 Quote
    Signer-->>API: signature, signer, deadline, nonce
    API->>PG: Persist quote, snapshotId, risk decision
    API-->>User: quoteId, snapshotId, amountOut, minAmountOut, deadline, nonce, signature
    end
  else Risk rejected
    Risk-->>API: reject reason and policy id
    API->>PG: Persist rejection for observability
    API-->>User: RFQ error response
  end
```

## Design Notes

- `Risk Engine` 必须位于 `Signer` 之前。
- `deadline` 必须足够短，避免市场状态漂移。
- `snapshotId` 是排查报价争议、风控争议和 PnL 归因的关键字段。
- Rejected quote 也应该记录，但不能返回可执行签名。
- 生产环境必须把新鲜 Treasury `tokenOut` hot balance 与所有未过期 quote 的输出预留比较；请求不回源 RPC，刷新失败后旧 generation 只在 freshness bound 内可用。
- 链状态和 Redis 无法原子提交，因此 reservation 保留到 quote deadline 之后的同步 grace，且 grace 必须长于 Treasury hot-state 最大年龄，优先保证不超卖。
