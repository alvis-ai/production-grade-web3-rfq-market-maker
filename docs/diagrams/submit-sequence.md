# Submit Sequence Diagram

本图描述 signed quote 从用户提交到链上结算，再到链下状态更新的流程。当前 backend skeleton 在 `/submit` 中同步模拟 settlement、inventory update 和 hedge intent；生产部署中链上 `QuoteSettled` 事件仍是最终 source of truth。

```mermaid
sequenceDiagram
  autonumber
  participant User as Trader / Wallet
  participant API as RFQ API
  participant Chain as RFQSettlement
  participant Treasury as Treasury
  participant TokenIn as ERC20 tokenIn
  participant TokenOut as ERC20 tokenOut
  participant Indexer as Event Indexer
  participant Inventory as Inventory Service
  participant Hedge as Hedge Engine
  participant Metrics as Metrics / PnL

  User->>API: POST /submit or request tx payload
  API->>API: validate signed quote payload
  API->>Inventory: apply simulated settlement delta
  Inventory->>Hedge: create hedge intent
  API->>Metrics: record submit, settlement and hedge counters
  API-->>User: 202 accepted with txHash
  User-->>Chain: production mode submitQuote(quote, signature)
  Chain->>Chain: verify EIP-712 signature
  Chain->>Chain: check trusted signer, nonce, deadline, chainId, whitelist
  Chain->>TokenIn: transferFrom(user, treasury, amountIn)
  Chain->>Treasury: release(tokenOut, user, amountOut)
  Treasury->>TokenOut: transfer(user, amountOut)
  Chain-->>Indexer: emit QuoteSettled(quoteHash, user, tokenIn, ...)
  Indexer->>Inventory: idempotent inventory update
  Inventory->>Hedge: production hedge intent
  Inventory->>Metrics: record exposure and realized trade
```

## Invariants

- 合约验证失败时不能更新 nonce 为已使用。
- 第一阶段 skeleton 可同步模拟库存更新；生产库存更新必须以链上事件为准。
- 事件消费必须使用 `chainId + txHash + logIndex` 幂等，并保存 `quoteHash` 和 `blockNumber` 作为链上 `QuoteSettled` 与链下 quote payload 的一致性锚点和 reorg 排查依据。
- Hedge failure 不能回滚已经确认的 settlement，但必须进入风险和告警闭环。
