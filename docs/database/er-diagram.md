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
    integer slippage_bps
    numeric amount_out
    numeric min_amount_out
    numeric nonce
    bigint deadline
    text snapshot_id
    integer spread_bps
    integer size_impact_bps
    integer inventory_skew_bps
    text status
    text tx_hash
    text settlement_event_id
    text hedge_order_id
    text pnl_id
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
    text quote_id FK
    bigint chain_id
    text tx_hash
    text quote_hash
    bigint log_index
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
    text quote_id FK
    bigint chain_id
    text token_address
    text side
    numeric amount
    text venue
    text status
    text reason
    text external_order_id
    int attempt_count
    timestamptz next_attempt_at
    text lease_owner
    timestamptz lease_expires_at
    text venue_symbol
    text client_order_id
    timestamptz submission_attempted_at
    numeric filled_amount
    text last_error_code
    timestamptz created_at
    timestamptz updated_at
  }

  PNL_RECORDS {
    text id PK
    text quote_id FK
    bigint chain_id
    text user_address
    text token_in
    text token_out
    numeric amount_in
    numeric amount_out
    numeric min_amount_out
    numeric nonce
    bigint deadline
    numeric gross_pnl_token_out
    bigint gross_pnl_bps
    text model
    text model_description
    timestamptz realized_at
  }
```

## Notes

- `settlement_events` 使用 `(chain_id, tx_hash, log_index)` 作为幂等键，并持久化 `quote_hash` 以绑定链上 `QuoteSettled` 事件和链下 EIP-712 quote payload。
- `settlement_events` 额外使用 `(chain_id, quote_hash)` 索引支持从 indexed `QuoteSettled.quoteHash` 回查本地成交事件，并与 `SettlementEventService.getSettlementEventsByQuoteHash` 保持同一访问路径，方便链上事件排障、reconciliation 和跨链环境下的 quote payload 证明。
- `settlement_events.log_index` 和 `settlement_events.block_number` 使用 BIGINT 保存链上 event ordinal，但必须位于 JavaScript safe integer range `0..9007199254740991`，与 indexer、reorg removal 和运行时排序逻辑的 number 表示一致。
- `settlement_events.quote_id` 是 `quotes.id` 的非空外键，并使用 unique index `(quote_id)` 保证一个 signed quote 只能绑定一个 settlement event；这同时保证 settlement-to-quote reconciliation 总能回到本地签发记录。
- `settlement_events.canonical` 与 `removed_at` 保留 reorg 审计历史：canonical event 必须没有 `removed_at`，removed event 必须有时间戳。正常查询和 reconciliation 只读取 canonical rows；同一精确事件重新成为 canonical 时可以幂等重激活，而不是插入第二条 event。
- `idx_settlement_events_canonical_block` 为 canonical chain-order replay 提供 partial index。服务启动时使用 transaction-scoped advisory lock，在同一数据库事务内从 canonical events 重建 `inventory_positions`，避免多副本同时修复投影。
- `quotes` 使用 partial unique index `(chain_id, user_address, nonce) WHERE nonce IS NOT NULL`，保证 signed quote 的 `chainId:user:nonce` 本地查找键唯一，同时允许 requested / rejected quote 在签名前没有 nonce。
- 数据库层使用 CHECK constraints 固化应用层关键不变量：操作表 primary id 使用 SafeIdentifier 约束、quote lifecycle status、risk decision status / reason_code consistency、hedge side/status（`queued`、`filled`、`failed`）、hedge `venue` 非空、PnL attribution model / model description、20-byte address、distinct token pair、market snapshot `source` 非空、market snapshot `bid_price <= mid_price <= ask_price`、market snapshot `volatility_bps` 在 0..10000 bps、signed quote pricing bps component ranges、32-byte tx/quote hash、65-byte canonical low-s EIP-712 signature with `v` in 27/28、`amount_out >= min_amount_out`，以及正数 signed amount/nonce、settled amount/nonce 和 hedge amount。
- `quotes`、`market_snapshots`、`risk_decisions`、`settlement_events`、`inventory_positions`、`hedge_orders` 和 `pnl_records` 的 primary id 都必须符合 SafeIdentifier：非空、不超过 128 个字符，并且只包含 letters、numbers、underscore、colon 或 hyphen，避免数据库保存 API/SDK 无法查询或展示的资源主键。
- `quotes` 的 status payload consistency 约束要求 signed payload 字段全有或全无，requested/rejected 状态不能携带 signed payload 字段，signed/expired/submitted/settled 状态必须保留完整 signed quote payload metadata，只有 rejected/failed 状态可以携带非空 `reject_code`，submitted/settled 状态必须至少保留 `tx_hash` 和 `settlement_event_id`。
- `quotes.pricing_version`、`quotes.risk_policy_version` 和 `quotes.reject_code` 在状态允许为 NULL 时可以缺失，但一旦写入必须是非空字符串，避免 signed/rejected/failed quote 带着不可解释的空白元数据。
- `quotes.deadline` 使用 BIGINT 保存 EIP-712 signed quote 的 Unix seconds，而不是 timestamptz；它必须位于 JavaScript safe integer range `1..9007199254740991`，保证数据库值与 API、Signer、Settlement verifier 和链上 `uint256 deadline` 语义一致。
- `quotes.snapshot_id` 是指向 `market_snapshots.id` 的必填 foreign key，用于报价回放；每条持久化 quote 都必须能回到用于定价的 market snapshot。
- `quotes.slippage_bps` 保存原始 `QuoteRequest.slippageBps`，必须是 `0..10000` bps 内的整数。EIP-712 `SignedQuote` 只携带最终 `minAmountOut`，数据库单独保留请求滑点，才能在报价回放、风控审计和用户争议处理中解释 `min_amount_out` 如何由 `amount_out` 推导而来。
- `quotes.spread_bps`、`quotes.size_impact_bps` 和 `quotes.inventory_skew_bps` 保存 signed quote 的定价组成。`spread_bps` 和 `size_impact_bps` 必须在 `0..10000` bps，`inventory_skew_bps` 必须在 `-10000..10000` bps；这些字段和 `pricing_version` 一起解释 `amount_out` 如何从 market snapshot、route liquidity、inventory skew 和 hedge risk penalty 推导而来。
- `market_snapshots.source` 必须是非空字符串，用于保留行情来源、provider 或聚合管线版本，避免报价回放时无法解释价格输入。
- `market_snapshots.liquidity_usd` 必须是非空正整数数值，匹配 Market Data、Routing 和 Pricing 对 `liquidityUsd` positive uint string 的运行时约束。
- `market_snapshots.volatility_bps` 必须是 `0..10000` bps 内的整数，与 Market Data、Routing 和 Pricing 对 required `volatilityBps` / volatility premium 的输入契约一致。
- runtime `MarketSnapshotStore` 必须镜像 `market_snapshots` 表的核心契约：同一 `snapshot_id` 只能对应同一 chain/token pair、price、liquidity、volatility、source 和 observedAt；完全相同写入可幂等重放，任何字段改写都必须失败，避免 quote 回放时一个 `snapshotId` 指向多个价格输入。
- `quotes.settlement_event_id`、`quotes.hedge_order_id`、`quotes.pnl_id` 是分别指向 `settlement_events.id`、`hedge_orders.id`、`pnl_records.id` 的 nullable foreign keys，保证 `GET /quote/:id` 状态指针不能悬空；权威成交、对冲和 PnL 明细仍分别位于这些下游表。
- `hedge_orders.status` 使用 `queued`、`filled`、`failed` 表达内部 intent 生命周期；`external_order_id` 可以在内部 queued intent 阶段为 NULL，但一旦外部 venue 返回引用就必须是非空字符串，`updated_at` 记录 filled/failed 状态转换时间。
- `hedge_orders.attempt_count`、`next_attempt_at`、`lease_owner` 和 `lease_expires_at` 构成多 worker 共享的 durable queue。lease 字段必须同时为空或同时存在，只有 queued row 可以持有 lease，终态转换必须清除 lease。`idx_hedge_orders_queued_claim` 支持按 due time 使用 `FOR UPDATE SKIP LOCKED` claim。
- `venue_symbol` 和 `client_order_id` 在外部调用前持久化；`uq_hedge_orders_venue_client_order` 防止同一 venue client id 指向多个本地 hedge。Binance client id 由 hedge id 确定性派生，worker 每次先查询再决定是否提交，避免 timeout 后重复对冲。
- `submission_attempted_at` 在 POST 前经 canonical settlement row lock 授权写入，或在 query-first 发现已有外部订单时写入。Reorg 后 worker 不再 claim 从未尝试提交的 intent，但会继续追踪 submission-attempted job 直到明确终态，避免遗忘可能已被 CEX 接受的订单。
- `last_error_code` 只保存低基数稳定错误码，不保存可能包含凭据或高基数 venue message。retryable/unknown/pending 状态保持 queued，只有确定失败才进入 failed；filled row 必须有 `external_order_id` 和正数 `filled_amount`。每次观察到更大的累计成交量时，`filled_amount` 与新增 token inventory delta 在同一数据库事务中提交；重复查询只应用差额，pending partial fill 也会立即进入风险敞口。
- `quotes.snapshot_id` 使用索引支持报价回放；nullable status pointers 使用 partial indexes，只索引非空的 `settlement_event_id`、`hedge_order_id` 和 `pnl_id`，支持审计 join 和 reconciliation 查询，同时避免大量未成交 quote 的空指针污染索引。
- 所有带 `chain_id` 的操作表都使用 CHECK constraint 限制为 JavaScript safe integer range `1..9007199254740991`，与后端、SDK 和 OpenAPI 的 `chainId` 契约一致，避免数据库保存无法被运行时代码安全表示的链 ID。
- `quotes.tx_hash` 是状态查询冗余字段，用于快速展示链上交易哈希；权威成交事件仍由 `settlement_events` 和 `quote_hash` 绑定。
- `risk_decisions.policy_version` 用于解释风控变更后的历史行为，必须是非空字符串；`reason_code` 只允许出现在 rejected decision 上，approved decision 必须保持 NULL，且 rejected reason 必须来自后端 `RiskRejectReasonCode` 稳定枚举。
- `inventory_positions` 是当前操作状态，不替代事件账本。
- `settlement_events` insert/reactivation 与 tokenIn/tokenOut 两条 `inventory_positions` delta 在同一个 PostgreSQL transaction 中提交；token address 按字典序加锁，避免相反交易对并发更新产生 deadlock。重复 event 不重复更新库存。
- 生产 Quote Service 直接读取共享 `inventory_positions` 计算 skew 和 projected exposure，不依赖 pod-local inventory cache；因此多副本风险决策看到同一个已提交敞口。
- `hedge_orders.settlement_event_id` 是 `settlement_events.id` 的非空外键，并使用 unique index `(settlement_event_id)` 防止同一 settlement event 重复创建 hedge intent；`quote_id` 是 `quotes.id` 的非空外键，保证 `/hedges/:id` 返回的 `quoteId` 可直接回到本地 quote；`reason` 必须匹配 Hedge Service 支持的 intent reason；`venue` 必须是非空字符串，用于保留对冲路由、交易场所或内部库存通道；`external_order_id` 可以在内部 queued intent 阶段为 NULL，但一旦写入必须是非空字符串。
- `quotes`、`inventory_positions` 和 `hedge_orders` 使用共享 `set_updated_at()` trigger，在每次 `UPDATE` 时由数据库刷新 `updated_at`，避免应用层漏写导致状态页或运维排障看到陈旧更新时间。
- `pnl_records` 使用 `(quote_id, model)` 防止同一归因模型对同一成交重复入账，并保存 `user_address`、amount、`min_amount_out`、`nonce`、safe-integer `deadline`、safe-integer signed `gross_pnl_bps` 和固定 `model_description` 作为 signed attribution snapshot；`model_description` 明确当前 `simulated_mid_price_v1` 是 same-decimal 模拟归因，不是跨资产会计 PnL；生产版可将明细同步到 ClickHouse 做高维分析。
- `hedge_orders` 与 `pnl_records` 是 settlement event 之后的 durable idempotent projections。它们不与链上 event+inventory 强行放在同一长事务；若进程在步骤间崩溃，settlement event 作为 source of truth，由 reconciliation 补齐缺失 projection 和 quote pointers。
