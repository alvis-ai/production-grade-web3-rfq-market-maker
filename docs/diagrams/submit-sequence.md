# Submit Sequence Diagram

本图描述 signed quote 经用户钱包提交到链上，再由后端确认交易回执并更新链下状态的流程。Synthetic settlement 只保留给显式开启的本地参考环境；生产链路以链上 `QuoteSettled` 事件为最终 source of truth。

```mermaid
sequenceDiagram
  autonumber
  participant User as Trader / Wallet
  participant API as RFQ API
  participant Chain as RFQSettlement
  participant Treasury as Treasury
  participant TokenIn as ERC20 tokenIn
  participant TokenOut as ERC20 tokenOut
  participant RPC as Chain RPC
  participant Inventory as Inventory Service
  participant Jobs as Reconciliation Jobs
  participant Worker as Reconciliation Worker
  participant Hedge as Hedge Engine
  participant Metrics as Metrics / PnL

  User->>Chain: submitQuote(quote, signature)
  Chain->>Chain: verify EIP-712 signature
  Chain->>Chain: check trusted signer, nonce, deadline, chainId, whitelist
  Chain->>TokenIn: transferFrom(user, treasury, amountIn)
  Chain->>Treasury: release(tokenOut, user, amountOut)
  Treasury->>TokenOut: transfer(user, amountOut)
  Chain-->>User: txHash
  Chain-->>RPC: receipt + QuoteSettled event
  User->>API: POST /submit(quote, signature, txHash)
  API->>API: validate stored signed quote and signature
  API->>RPC: waitForTransactionReceipt(confirmations)
  RPC-->>API: receipt, transaction, logs
  API->>API: verify from, to, submitQuote calldata and success
  API->>API: decode exactly one matching QuoteSettled
  API->>Inventory: idempotent inventory update
  Inventory->>Jobs: enqueue desired revision in settlement transaction
  Inventory->>Hedge: create hedge intent
  Inventory->>Metrics: record exposure and realized trade
  API-->>User: 202 accepted with settlement pointers
  Worker->>Jobs: claim due revision with lease
  Worker->>Hedge: idempotently repair hedge projection
  Worker->>Metrics: idempotently repair PnL projection
  Worker->>API: repair complete quote pointers
  Worker->>Jobs: mark exact revision processed
```

## Invariants

- 合约验证失败时不能更新 nonce 为已使用。
- `txHash` 只是非可信查询键；receipt、transaction 和 event 必须由配置的 RPC 独立读取。
- 非本地环境默认禁止 synthetic settlement，无真实匹配事件时不得更新库存。
- 事件消费必须使用 `chainId + txHash + logIndex` 幂等，并保存 `quoteHash` 和 `blockNumber` 作为链上 `QuoteSettled` 与链下 quote payload 的一致性锚点和 reorg 排查依据。
- Hedge failure 不能回滚已经确认的 settlement，但必须进入风险和告警闭环。
- API 在 settlement 后任意一步崩溃不能丢失 post-trade projection；durable desired revision 必须由独立 worker 最终收敛，旧 revision 不能覆盖 reorg 后的新 canonical 状态。
