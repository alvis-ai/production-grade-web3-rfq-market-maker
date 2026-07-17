# Chapter 08: Metrics Service

## Abstract

Metrics Service 让 RFQ 系统可观测。做市系统需要同时关注技术指标和业务风险指标：quote latency、risk reject rate、signer latency、settlement success、inventory exposure、hedge lag 和 PnL。没有指标，系统无法生产运行。

## Learning Objectives

- 定义 RFQ 系统核心指标。
- 区分 Prometheus 指标和 ClickHouse 分析。
- 说明 metrics 如何支撑故障恢复。
- 设计 dashboard 和 alert。

## Background

RFQ 故障往往不是单点崩溃，而是延迟升高、拒绝率异常、事件消费落后或对冲成本上升。Metrics Service 必须覆盖完整业务漏斗。

## Problem Statement

如果只监控 HTTP 500，无法发现风险拒绝暴增、signer 延迟、inventory 偏离或 hedge lag。这些才是做市系统的关键运营风险。

## Requirements

### Functional Requirements

- 暴露 `/metrics`。
- 记录 quote requested、signed、rejected、submitted、settled。
- 记录 latency histogram。
- 记录 inventory exposure。
- 记录 hedge lag 和 hedge cost。
- 支持 PnL 分析事件。

### Non-Functional Requirements

- Metrics emission 不应阻塞业务路径。
- 指标命名稳定。
- 高基数字段不进入 Prometheus label。
- 分析事件写入 ClickHouse。

## Existing Solutions

Prometheus 适合实时指标和告警。ClickHouse 适合高维分析和 PnL 归因。本项目两者结合。

## Trade-Off Analysis

只用 Prometheus 会受 label cardinality 限制。只用 ClickHouse 告警不够实时。组合使用更适合生产。

## System Design

```mermaid
flowchart LR
  Services[Backend Services]
  Prom[Prometheus Metrics]
  PG[(PostgreSQL)]
  Outbox[Transactional Outbox]
  Publisher[Outbox Publisher]
  Redpanda[Redpanda]
  Consumer[Analytics Consumer]
  ClickHouse[ClickHouse]
  Grafana[Grafana]
  Alerts[Alerts]

  Services --> Prom
  Services --> PG
  PG --> Outbox
  Outbox --> Publisher
  Publisher --> Redpanda
  Redpanda --> Consumer
  Consumer --> ClickHouse
  Prom --> Grafana
  ClickHouse --> Grafana
  Prom --> Alerts
```

## Architecture Diagram

Metrics 是横切关注点，覆盖 API、Quote、Pricing、Risk、Signer、Execution、Inventory 和 Hedge。

## Sequence Diagram

```mermaid
sequenceDiagram
  autonumber
  participant Q as Quote Service
  participant P as PostgreSQL
  participant O as Outbox Publisher
  participant K as Redpanda
  participant A as Analytics Consumer
  participant C as ClickHouse

  Q->>P: commit quote state
  P->>P: trigger appends outbox row
  O->>P: lease pending rows
  O->>K: keyed versioned envelope
  K-->>O: all replicas acknowledged
  O->>P: mark published
  K->>A: partition batch
  A->>C: insert batch by event_id
  C-->>A: insert acknowledged
  A->>K: commit next offset
```

## State Machine

```mermaid
stateDiagram-v2
  [*] --> EventCaptured
  EventCaptured --> PrometheusUpdated
  EventCaptured --> AnalyticsQueued
  AnalyticsQueued --> AnalyticsWritten
  AnalyticsQueued --> Retry
```

## Data Model

Prometheus metrics:

- `rfq_quote_requests_total`
- `rfq_quote_responses_total`
- `rfq_quote_errors_total`
- `rfq_quote_rejections_total`
- `rfq_portfolio_delta_soft_breaches_total`
- `rfq_quote_latency_seconds`
- `rfq_quote_paused`
- `rfq_quote_pairs_paused`
- `rfq_quote_control_updates_total`
- `rfq_quote_control_errors_total`
- `rfq_toxic_flow_score_updates_total`
- `rfq_toxic_flow_score_errors_total`
- `rfq_submit_requests_total`
- `rfq_submit_accepted_total`
- `rfq_submit_errors_total`
- `rfq_submit_reservation_contention_total`
- `rfq_submit_reservation_errors_total` with bounded `operation` label
- `rfq_submit_latency_seconds`
- `rfq_rate_limited_total`
- `rfq_api_auth_rejections_total`
- `rfq_signer_requests_total`
- `rfq_signer_errors_total`
- `rfq_signer_latency_seconds`
- `rfq_signer_service_requests_total`
- `rfq_signer_service_last_success_timestamp_seconds`
- `rfq_signer_service_audit_errors_total`
- `rfq_market_data_cache_hits_total`
- `rfq_market_data_cache_misses_total`
- `rfq_market_data_refreshes_total`
- `rfq_market_snapshot_samples_total`
- `rfq_cex_order_book_sources`
- `rfq_cex_order_book_pairs`
- `rfq_cex_order_book_deviation_rejected_sources`
- `rfq_cex_order_book_max_update_age_seconds`
- `rfq_cex_order_book_connector_errors_total`
- `rfq_readiness_status`
- `rfq_dependency_status`
- `rfq_settlements_total`
- `rfq_hedge_intents_total`
- `rfq_hedge_intent_errors_total`
- `rfq_hedge_lag_seconds`
- `rfq_hedge_worker_jobs_total`
- `rfq_hedge_worker_iteration_errors_total`
- `rfq_hedge_worker_order_cancellations_total`
- `rfq_hedge_worker_symbol_rules_valid`
- `rfq_hedge_worker_last_processed_timestamp_seconds`
- `rfq_hedge_fee_reconciliations_total`
- `rfq_hedge_fee_iteration_errors_total`
- `rfq_hedge_fee_last_processed_timestamp_seconds`
- `rfq_hedge_fee_pending`
- `rfq_hedge_fee_oldest_due_age_seconds`
- `rfq_quote_status_update_errors_total`
- `rfq_inventory_balance`
- `rfq_pnl_trades_total`
- `rfq_pnl_record_errors_total`
- `rfq_realized_pnl_token_out`
- `rfq_analytics_outbox_published_total`
- `rfq_analytics_outbox_retries_total`
- `rfq_analytics_outbox_deleted_total`
- `rfq_analytics_publisher_iteration_errors_total`
- `rfq_analytics_clickhouse_events_total`
- `rfq_analytics_consumer_errors_total`
- `rfq_analytics_last_published_timestamp_seconds`
- `rfq_analytics_last_consumed_timestamp_seconds`
- `rfq_analytics_outbox_pending`
- `rfq_analytics_outbox_oldest_age_seconds`
- `rfq_analytics_outbox_cleanup_eligible`
- `rfq_settlement_indexer_ranges_total`
- `rfq_settlement_indexer_events_total`
- `rfq_settlement_indexer_errors_total`
- `rfq_settlement_indexer_reorgs_total`
- `rfq_settlement_indexer_reorg_removed_events_total`
- `rfq_settlement_indexer_next_block`
- `rfq_settlement_indexer_safe_head`
- `rfq_settlement_indexer_lag_blocks`
- `rfq_settlement_indexer_last_poll_timestamp_seconds`
- `rfq_settlement_indexer_cursor_update_age_seconds`
- `rfq_settlement_indexer_risk_guard_safe`
- `rfq_settlement_indexer_risk_guard_failures_total`
- `rfq_usd_reference_health_safe`
- `rfq_usd_reference_health_failures_total`
- `rfq_daily_realized_pnl_usd`
- `rfq_daily_loss_limit_remaining_usd`
- `rfq_daily_loss_risk_safe`
- `rfq_daily_loss_risk_failures_total`

ClickHouse events include quoteId, snapshotId, policyVersion, pricingVersion, status and timestamps.

## API Design

`GET /metrics` exposes Prometheus text format. Analytics events are internal.

## Engineering Decisions

同步 API 的 metrics 实现按职责拆分为四个模块：`metrics.service.ts` 只保存进程内计数/观测并提供稳定记录接口，`metrics-contract.ts` 固定低基数 label 集和共享状态类型，`metrics-validation.ts` 在状态变化前校验领域输入，`prometheus-metrics.ts` 只把只读状态渲染成 Prometheus text format。渲染器不能反向依赖 stateful service，组合一致性检查同时限制各模块行数，避免指标增长再次形成单文件职责聚合。

The standalone post-trade worker exports `rfq_reconciliation_jobs_total`, `rfq_reconciliation_iteration_errors_total`, `rfq_reconciliation_pending_jobs`, `rfq_reconciliation_oldest_pending_age_seconds`, and `rfq_reconciliation_last_processed_timestamp_seconds`. Job outcome is bounded to repaired, already consistent, retry scheduled, or stale revision; quote ids and settlement ids are never Prometheus labels.

The standalone toxic-flow analyzer exports `rfq_toxic_flow_markouts_total`, `rfq_toxic_flow_analyzer_iteration_errors_total`, `rfq_toxic_flow_markout_pending`, `rfq_toxic_flow_markout_oldest_eligible_age_seconds`, and `rfq_toxic_flow_analyzer_last_processed_timestamp_seconds`. Outcome is bounded to scored, invalidated, or retry scheduled. User addresses, quote ids, settlement event ids, token addresses, and policy versions remain in PostgreSQL audit evidence and never become Prometheus labels.

The settlement indexer exports durable cursor, safe-head, lag, range, event, bounded error, reorg, removed-event, last-poll, and cursor-age metrics. Labels are limited to configured `chain_id`, `outcome=applied|duplicate`, and the closed error-code enum; transaction hash, quote hash, user and RPC URL remain absent.

The API-side pre-sign guard separately exports `rfq_settlement_indexer_risk_guard_safe{chain_id}` and `rfq_settlement_indexer_risk_guard_failures_total{chain_id,reason}`. `reason` is closed to `RPC_UNAVAILABLE|CURSOR_STORE_UNAVAILABLE|CURSOR_MISSING|CURSOR_INVALID|CONTRACT_MISMATCH|CURSOR_STALE|BLOCK_LAG`, and `chain_id` is limited to configured receipt chains. Unsupported request chains fail closed without being observed, so callers cannot create metric series. Observer failures are swallowed after the economic decision, so metrics cannot turn an allowed quote into a rejection or hide an unsafe cursor; RPC URLs, thresholds, addresses and database errors never enter labels.

The daily loss guard exports exact PostgreSQL-backed UTC-day hedge-net PnL as `rfq_daily_realized_pnl_usd{chain_id,token}`, remaining budget as `rfq_daily_loss_limit_remaining_usd{chain_id,token}`, the latest decision as `rfq_daily_loss_risk_safe{chain_id,token}`, and evidence failures as `rfq_daily_loss_risk_failures_total{chain_id,token,reason}`. Token labels are bounded to at most 100 startup-configured USD-reference limits, and reason is closed to `STORE_UNAVAILABLE|EVIDENCE_INVALID`. Quote ids, database errors and policy thresholds never become labels; observer errors cannot change the risk decision.

API market-data background tasks export `rfq_market_data_refreshes_total{outcome}` with `success|failure` and `rfq_market_snapshot_samples_total{outcome}` with `saved|unchanged|unavailable|failed`. Refresh counts represent configured base-provider pair attempts; sample counts represent per-pair cycle results. These fixed labels expose provider and persistence failures before quote traffic encounters a cold cache without leaking token pairs, RPC endpoints, snapshot ids or storage errors. Observer exceptions are swallowed so telemetry cannot alter cache writes, retries or graceful drain.

Prometheus intentionally omits the pair label. Structured logs supply configured-pair diagnosis only at state transitions: `MARKET_DATA_REFRESH_FAILED` / `MARKET_SNAPSHOT_PERSIST_FAILED` warn once until a successful cycle emits the matching `*_RECOVERED` info record. Raw RPC and PostgreSQL exceptions are discarded at this boundary, and logging failures cannot alter the metric, cache, retry, persistence or shutdown result.

CEX connector metrics intentionally count every retry error by the fixed `binance|coinbase` label, while logs mark only outage boundaries per configured exchange/symbol. `CEX_ORDER_BOOK_CONNECTOR_ERROR` warns once, and `CEX_ORDER_BOOK_CONNECTOR_RECOVERED` is emitted only after the connector again supplies a synchronized, fresh, valid-spread book. Observer and logger failures are isolated so telemetry cannot interrupt socket cleanup, exponential backoff, cache invalidation or recovery.

- No high-cardinality quoteId labels in Prometheus.
- Structured JSON logs complement Prometheus without turning dynamic identifiers into metric labels. API logs correlate a normalized route template with `traceId`、status and duration; worker logs bind bounded outcomes or durable audit ids to a fixed service name. The shared logger redacts credential-shaped fields and request serializers omit all headers, while `RFQ_LOG_LEVEL` applies consistently to API、hedge、analytics、reconciliation、settlement-indexer and toxic-flow processes.
- Use ClickHouse for quote-level analysis.
- Metrics failures must not break quote path.
- 当前后端实现已暴露 quote 和 submit latency histogram，使用固定 bucket，不带 user、quoteId 或 wallet label。
- Histogram observations must be finite numbers before mutation; finite negative latency values are clamped to zero, but `NaN` and `Infinity` are rejected so Prometheus output cannot contain non-numeric samples.
- `rfq_quote_rejections_total` 只使用稳定内部 `reasonCode` 作为 label，不暴露阈值、金额、地址或 quoteId。
- `rfq_portfolio_delta_soft_breaches_total` 统计已接受但 post-trade chain/token asset、gross 或 signed net delta 超过 soft limit 的首次 reservation；幂等重放不重复计数，指标故障不能回滚业务 reservation。
- `rfq_hedge_lag_seconds` 使用无高基数 label 的 histogram，记录 settlement accepted 到 hedge intent queued 的耗时；生产版可复用同一指标记录异步 hedge queue 和 venue submit lag。
- Hedge worker 只使用 `filled|failed|retry_scheduled` 三个固定 outcome label；`rfq_hedge_worker_order_cancellations_total` 只使用 `attempted|confirmed`，用来区分已持久化的超时撤单请求和 Binance 明确返回的撤单终态。`rfq_hedge_worker_symbol_rules_valid` 是无标签 gauge，只有 Binance `exchangeInfo` 中的交易状态、资产、`PRICE_FILTER` 和 `LOT_SIZE` 与全部共享路由一致时才为 1。`rfq_hedge_worker_iteration_errors_total` 记录 DB/poll loop 故障，`rfq_hedge_worker_last_processed_timestamp_seconds` 用于识别有新 intent 但 worker 无进展的停滞。不得把 symbol、order id 或 venue message 放入 label。
- Fee worker 只使用 `reconciled|retry_scheduled` 固定 status；`rfq_hedge_fee_pending` 和 `rfq_hedge_fee_oldest_due_age_seconds` 来自 PostgreSQL 的只读 scrape-time 聚合。统计查询失败时保留进程 counter，但不输出伪造的零 backlog；symbol、order id、trade id、commission asset 和 venue message 都不得成为 label。
- `rfq_quote_status_update_errors_total` 使用低基数 `target_status` label，记录 settlement 已接受后 quote 状态落库失败，或 settlement rejection 后 failed 状态落库失败的次数；该指标用于触发 reconciliation，而不是让已应用 settlement 回滚或掩盖原始拒绝原因。
- `rfq_market_data_cache_hits_total` 和 `rfq_market_data_cache_misses_total` 记录 `/quote` 行情读取是否命中后台预热缓存。它们不带 pair、token 或 exchange label，避免把交易对、地址或 CEX symbol 写入高基数 Prometheus 维度；具体 pair 级诊断应通过日志、trace 或 ClickHouse 事件完成。
- CEX order-book 指标只使用固定 `state="ready|stale|unavailable"`、`state="usable|blocked"` 和 `exchange="binance|coinbase"` 标签。`rfq_cex_order_book_sources`、`rfq_cex_order_book_pairs`、`rfq_cex_order_book_deviation_rejected_sources`、`rfq_cex_order_book_max_update_age_seconds` 与 `rfq_cex_order_book_connector_errors_total` 能区分连接故障、事件时间过期、quorum 不足和跨源价格偏离，同时不会把 token 地址、symbol 或错误消息写入 Prometheus 标签。
- `rfq_rate_limited_total` 使用固定 `endpoint="quote|submit|status"` label，把具体 HTTP route 收敛到稳定端点组，避免把 quoteId、settlementEventId、hedgeOrderId 或动态路径写入 Prometheus。
- `rfq_api_auth_rejections_total` 只使用固定 `reason="missing|malformed|invalid|expired|scope_denied"` label；不得把 key id、principal、header 或摘要写入指标。
- `rfq_submit_reservation_errors_total` 只使用固定 `operation="acquire|release"` label；contention 使用独立无标签 counter，不能把 quote id 或 owner token 写入 Prometheus。
- `rfq_signer_service_audit_errors_total` 是独立 signer 的无标签 counter，覆盖 audit append 失败和 readiness table check 失败。它与 KMS/provider `error` 分开告警，且不得把 quoteId、snapshotId、digest、地址、数据库主机或错误消息写入 label。
- Metrics Service validates fixed-label inputs before mutation: rate-limit endpoints must be `quote|submit|status`, signer operations must be `sign|verify`, and readiness metrics must provide own `status` / `components` fields plus the exact supported component set as own fields with `ok|degraded` statuses.
- Metrics Service validates dynamic label values before mutation: quote rejection reasons, hedge intent error reasons, quote status update targets and PnL record error reasons must be runtime strings before label normalization, so malformed observability calls cannot turn into native `.trim()` failures or mutate counters under unintended labels.
- 当前后端实现已暴露 `rfq_pnl_trades_total` 和 `rfq_realized_pnl_token_out`，用于验证 `/submit -> settlement -> inventory -> hedge -> PnL` 闭环；生产版应将 quote-level PnL 归因写入 ClickHouse。
- Non-local runtime stores the operational PnL ledger in PostgreSQL before exposing `pnlId`; `(quote_id, model)` makes retries idempotent, row parsing revalidates signed quote attribution and derived gross PnL, and ClickHouse remains an analytical sink rather than the operational source of truth.
- Public `GET /pnl` keeps principal-wide gross and hedge-net totals but bounds detail records with cursor pagination. The first page captures an inclusive, database-enforced immutable `pnl_records.created_at` cutoff, every continuation preserves that cutoff, and rows are traversed by `(realized_at DESC, id DESC)` with a covering index. This prevents newly inserted or backfilled attribution from shifting an active traversal; valid reorg deletion intentionally remains visible instead of preserving invalid PnL evidence. PostgreSQL computes global groups and status counters without materializing every trade in Node.js, while `trades` and `hedgeNet.records` remain one-to-one on each page.
- `rfq_pnl_record_errors_total` 使用低基数 `reason` label，记录 settlement 已应用后 PnL 归因写入失败；该指标用于触发 settlement-to-PnL reconciliation，不能让已应用 settlement 返回错误。
- Metrics Service validates inventory gauge positions and PnL trade records before mutating counters or gauges. Inventory position fields and PnL trade record fields must be own fields; inventory token, PnL user/token fields, signed PnL strings, amount fields and nonce must be runtime strings before regex validation, so inherited object properties or `String` wrapper objects cannot rely on JavaScript `RegExp.test()` coercion. PnL trade `pnlId` and `quoteId` must be primitive-string `SafeIdentifier` values with 1-128 characters matching `[A-Za-z0-9_:-]`, amount fields and nonce must be canonical positive uint strings without leading zeros, signed PnL strings must be canonical integer strings without leading zeros or negative zero, `realizedAt` must be a canonical UTC ISO timestamp generated with `Date.prototype.toISOString()`, and invalid metric inputs must fail before incrementing `rfq_pnl_trades_total` or writing `rfq_realized_pnl_token_out`; stored inventory positions are defensive copies so caller-side object mutation cannot rewrite Prometheus output.
- The submit handler records `rfq_inventory_balance` best-effort after settlement acceptance. Execution Service first validates post-settlement inventory positions from the inventory adapter, and the API wraps the final gauge mutation so malformed, inherited or mismatched inventory position samples cannot convert an already-applied settlement into a submit error.
- `rfq_quote_paused` 是全局状态的 0/1 gauge；`rfq_quote_pairs_paused` 是 readiness 刷新的 paused pair 总数且不带动态标签；`rfq_quote_control_updates_total` 记录成功的全局或 pair CAS 更新；`rfq_quote_control_errors_total{operation="read|update"}` 记录闭合校验、CAS、限流或存储导致的全局/pair 操作失败，不使用 actor、reason、version、chain 或 token 作为 label。具体 pair 由管理 API 与审计表查询，避免把动态交易对注入 Prometheus label。
- `rfq_toxic_flow_score_updates_total` 记录 analyzer 或运维账号成功发布的新 score version；`rfq_toxic_flow_score_errors_total{operation="read|update"}` 只使用固定操作标签。user、chain、score、policy version 和 actor 属于 `toxic_flow_score_audit` 的高基数审计字段，不得进入 Prometheus label。
- 当前后端实现已暴露 `rfq_readiness_status{status="ready|degraded"}` 和 `rfq_dependency_status{component="...",status="ok|degraded"}`，用于把最近一次 `/ready` 探测结果转成 Prometheus gauge。组件 label 固定为 marketData、marketSnapshotStore、routing、pricing、risk、signer、quoteRepository、quoteControl、riskDecisionStore、rateLimitStore、inventory、execution、settlementEventStore、pnl 和 metrics，不能使用动态下游地址、错误消息或实例 ID。
- `rfq_readiness_status` 只表达最近一次 readiness 业务探测结果，不替代进程存活、HTTP availability 或 Kubernetes liveness。生产告警应同时查看 `/health` 可达性、`up`、HTTP error rate 和业务依赖状态。
- ClickHouse is an analytics replica only: `/quote`, `/submit`, `/ready`, settlement reconciliation, inventory mutation, hedge intent creation and PnL attribution must read operational truth from PostgreSQL, settlement events and in-process service state, never from ClickHouse query results.
- The runnable analytics path is `PostgreSQL trigger -> analytics_outbox -> KafkaAnalyticsProducer -> rfq.analytics.v1 -> KafkaAnalyticsConsumer -> ClickHouseAnalyticsSink`. Trigger writes are part of the same transaction as operational state, so an API crash cannot commit a business row without its analytics intent. Kafka and ClickHouse calls never run in `/quote` or `/submit` request transactions.
- Outbox replicas claim ordered batches with `FOR UPDATE SKIP LOCKED`, lease-owner compare-and-set updates, bounded exponential retry and no retry-exhaustion deletion. The configured lease must cover `batchSize * Kafka request timeout + 1000ms`; published rows are retained for seven days by default and removed in bounded batches.
- Kafka producer uses aggregate id as the partition key, disables auto topic creation, requires all-replica acknowledgement, and enables idempotence with one in-flight request. This does not remove the database-to-broker acknowledgement gap, so the contract is explicitly at-least-once and every envelope carries stable `ao_<outbox_id>` identity plus matching headers.
- Kafka consumer validates message key, headers, schema version, canonical event timestamp and JSON bounds before projection. It writes each partition batch to ClickHouse in bounded 500-row chunks and manually commits the next offset only after every chunk succeeds; partial insert or validation failure leaves the offset uncommitted, so replay may duplicate already written chunks but cannot silently skip evidence.
- ClickHouse stores generic event metadata and JSON payload in `rfq_analytics_events` using `ReplacingMergeTree(ingested_at) ORDER BY event_id`. Merges eventually remove duplicate event ids; queries requiring immediate uniqueness must use `FINAL` or `argMax`. PostgreSQL remains authoritative even while ClickHouse is unavailable or behind.
- Analytics worker metrics expose outbox pending count/oldest age, retention-eligible rows, publish/retry/delete counters, ClickHouse projection throughput, consumer/publisher errors and last-progress timestamps. They contain no quote id, address, topic partition or event type labels.
- `make analytics-e2e` starts the production worker against running disposable PostgreSQL、Redpanda and ClickHouse dependencies, then inserts a transaction compatible with the `current compiled schema` containing quote lifecycle、quote routing、market snapshot、risk、settlement、inventory、hedge and PnL state. The gate requires eight atomically emitted outbox rows, broker-acknowledged publication, ClickHouse `FINAL` uniqueness, precision-safe route/liquidity payload fields, and exact parity between `_migrations` and compiled migration files before cleaning its own rows. Readiness HTTP、ClickHouse HTTP、integration process and complete shell lifecycle each have nested hard deadlines; stage output identifies the last completed boundary, and TERM/KILL cleanup is bounded so dependency stalls cannot consume a runner indefinitely. Analytics CI compiles once before starting Redpanda/ClickHouse, reuses that artifact for separately named two-minute migration and five-minute E2E steps, and retains a ten-minute job ceiling. This removes compilation/dependency resource contention, makes build or migration stalls distinguishable from delivery failure, and cannot be replaced by a unit mock.

## Failure Scenarios

- Prometheus scrape fails：service continues。
- `rfq_readiness_status{status="degraded"} == 1`：检查 `rfq_dependency_status` 中具体 degraded 组件，并按 market data、signer、settlement store、PnL store 等 runbook 分流。
- ClickHouse unavailable：buffer or drop per policy。
- Redpanda unavailable：outbox rows remain unpublished, leases expire, retries back off, and backlog alerts fire; do not delete pending rows or enable Kafka auto topic creation as an incident shortcut。
- ClickHouse insert or schema failure：consumer does not commit the Kafka offset, so the affected partition replays after repair. Repeated event ids are expected and must remain query-idempotent。
- Quote status update metric rises：run settlement-to-quote reconciliation。
- PnL record error metric rises：run settlement-to-PnL reconciliation。
- Metrics cardinality explosion：remove label and alert.

## Security Considerations

Metrics endpoint should not expose secrets, full user addresses as labels, or internal risk thresholds.

## Performance Considerations

Metrics emission should be non-blocking and low allocation. Histograms need sensible buckets.

## Testing Strategy

测试 metrics names、label cardinality、latency histograms、event emission 和 ClickHouse failure fallback。

## Interview Notes

RFQ observability 要覆盖业务漏斗和风险指标，不只是 HTTP 状态码。

## Summary

Metrics Service 让 RFQ 系统具备生产运行能力，是故障恢复、风险监控和 PnL 归因的基础。

## References

- Prometheus
- ClickHouse analytics
- Observability for trading systems
