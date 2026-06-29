# ER Diagram

本图描述 RFQ 系统第一版操作型数据库关系。PostgreSQL 保存权威业务状态，ClickHouse 保存分析副本。

```mermaid
erDiagram
  QUOTES ||--o{ RISK_DECISIONS : has
  QUOTES ||--o{ SETTLEMENT_EVENTS : settles
  SETTLEMENT_EVENTS ||--o{ HEDGE_ORDERS : triggers
  QUOTES ||--o{ PNL_RECORDS : attributes
  MARKET_SNAPSHOTS ||--o{ QUOTES : prices
  INVENTORY_POSITIONS ||--o{ HEDGE_ORDERS : rebalances

  QUOTES {
    text id PK
    bigint chain_id
    text user_address
    text token_in
    text token_out
    numeric amount_in
    numeric amount_out
    numeric min_amount_out
    numeric nonce
    timestamptz deadline
    text snapshot_id
    text status
  }

  MARKET_SNAPSHOTS {
    text id PK
    bigint chain_id
    text token_in
    text token_out
    numeric mid_price
    numeric liquidity_usd
    integer volatility_bps
    timestamptz observed_at
  }

  RISK_DECISIONS {
    text id PK
    text quote_id FK
    text decision
    text reason_code
    text policy_version
  }

  SETTLEMENT_EVENTS {
    text id PK
    text quote_id
    bigint chain_id
    text tx_hash
    integer log_index
    bigint block_number
    numeric amount_in
    numeric amount_out
  }

  INVENTORY_POSITIONS {
    text id PK
    bigint chain_id
    text token_address
    numeric balance
    numeric target_balance
    numeric max_exposure
  }

  HEDGE_ORDERS {
    text id PK
    text settlement_event_id FK
    bigint chain_id
    text token_address
    text side
    numeric amount
    text venue
    text status
  }

  PNL_RECORDS {
    text id PK
    text quote_id FK
    bigint chain_id
    text token_in
    text token_out
    numeric amount_in
    numeric amount_out
    numeric gross_pnl_token_out
    integer gross_pnl_bps
    text model
    timestamptz realized_at
  }
```

## Notes

- `settlement_events` 使用 `(chain_id, tx_hash, log_index)` 作为幂等键。
- `quotes` 使用 partial unique index `(chain_id, user_address, nonce) WHERE nonce IS NOT NULL`，保证 signed quote 的 `chainId:user:nonce` 本地查找键唯一，同时允许 requested / rejected quote 在签名前没有 nonce。
- `quotes.snapshot_id` 对应 `market_snapshots.id`，用于报价回放。
- `risk_decisions.policy_version` 用于解释风控变更后的历史行为。
- `inventory_positions` 是当前操作状态，不替代事件账本。
- `pnl_records` 使用 `(quote_id, model)` 防止同一归因模型对同一成交重复入账；生产版可将明细同步到 ClickHouse 做高维分析。
