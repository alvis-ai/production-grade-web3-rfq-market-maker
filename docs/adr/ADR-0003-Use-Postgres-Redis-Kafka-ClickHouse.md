# ADR-0003: Use Postgres Redis Kafka ClickHouse

## Status

Accepted

## Context

RFQ 做市系统同时包含操作型状态、低延迟缓存、事件流和分析查询。单一数据库很难同时满足 quote 状态、实时限流、链上事件消费、库存更新、指标分析和 PnL 归因。

## Decision

采用 PostgreSQL、Redis、Kafka / Redpanda 和 ClickHouse 的组合：

- PostgreSQL 保存 quote、risk decision、settlement event、inventory position 和 hedge order 的操作型状态。
- Redis 保存短期 market snapshot cache、quote cache、rate limit 和轻量分布式锁。
- Kafka / Redpanda 承载 settlement、inventory、hedge 和 analytics 事件流。
- ClickHouse 保存高吞吐分析事件，用于 quote funnel、成交质量、风险拒绝、PnL 和延迟分析。

## Consequences

### Positive

- 操作状态和分析状态分离，避免分析查询拖慢实时路径。
- 事件流支持幂等消费、重放和服务解耦。
- Redis 降低实时 quote 路径延迟。
- ClickHouse 适合高吞吐时间序列和宽表分析。

### Negative

- 基础设施复杂度提高。
- 数据一致性需要通过事件 ID、offset 和幂等键保证。
- 本地开发环境需要更多服务。

### Mitigation

- Docker Compose 提供本地依赖。
- settlement event 使用 `(chain_id, tx_hash, log_index)` 唯一键。
- 所有消费者实现幂等写入。
- PostgreSQL 是操作型状态来源，ClickHouse 是分析副本。
- PostgreSQL trigger 使用 transactional outbox 与业务写入原子生成版本化事件；publisher 使用 `FOR UPDATE SKIP LOCKED` lease，不在请求线程直接双写 Kafka。
- Redpanda 投递采用 at-least-once。稳定 `event_id` 和 ClickHouse `ReplacingMergeTree` 处理 broker acknowledgement 与 outbox 状态更新之间的崩溃重复，Kafka offset 仅在 ClickHouse insert 成功后提交。

## Alternatives Considered

### Only PostgreSQL

实现简单，但高频事件分析和实时缓存能力不足。

### Only Redis

低延迟，但不适合作为权威状态和长期审计存储。

### Managed Data Warehouse Only

适合分析，不适合实时 quote 和结算状态机。

### Postgres + Redis + Kafka / Redpanda + ClickHouse

职责清晰，适合生产级 RFQ 系统，因此被接受。
