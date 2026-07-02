# Chapter 07: Hedge Service

## Abstract

Hedge Service 负责成交后风险再平衡。RFQSettlement 确认成交后，Inventory Service 计算 exposure delta。如果库存偏离目标，Hedge Service 选择 venue 和 route，提交对冲订单，并把结果反馈到库存、PnL 和后续风险。当前参考实现会在 `/submit` 模拟结算后立即创建 hedge intent，用于验证 post-trade path。

## Learning Objectives

- 理解 hedge 是 post-trade path。
- 定义 hedge intent、hedge order 和 hedge result。
- 说明对冲失败如何影响后续报价。
- 设计 hedge latency 和 hedge cost 指标。

## Background

做市系统的目标不是每笔成交后都立即完全对冲，而是在风险预算内管理库存。有些 exposure 可以保留，有些需要快速对冲。

## Problem Statement

如果成交后不对冲，库存可能持续偏离目标。如果对冲失败不反馈风险，后续 quote 可能继续放大风险。当前后端实现把 hedge intent 创建失败视为 post-trade 风险事件，而不是 settlement 失败：`/submit` 仍返回 accepted、保留 settlement event、更新 inventory 和 PnL，但不返回 `hedgeOrderId`，记录 `rfq_hedge_intent_errors_total{reason="HEDGE_INTENT_FAILED"}`，并在同一 `chainId/token` 上累积 quote risk penalty，让后续报价更保守。

## Requirements

### Functional Requirements

- 接收 inventory delta。
- 判断是否需要 hedge。
- 选择 hedge venue。
- 提交 hedge order。
- 记录 hedge cost、status 和 latency。
- 反馈给 Inventory 和 Risk。
- hedge intent 创建失败时保留 settlement 结果，并输出稳定 reasonCode。
- hedge intent 创建失败后，为同一输出 token 累积有上限的 quote risk penalty。

### Non-Functional Requirements

- hedge 操作必须幂等。
- external venue credential 必须隔离。
- hedge failure 必须告警。
- hedge 不阻塞链上 settlement；第一阶段 skeleton 中 hedge intent 只表示已进入异步队列。
- hedge failure metric 必须区分于 submit error metric，避免把 post-trade 风险事件误报为 settlement 回滚。

## Existing Solutions

简单系统不做对冲，只记录库存。专业做市系统会根据风险预算和市场条件动态对冲。

## Trade-Off Analysis

快速对冲降低方向性风险，但可能增加交易成本。延迟对冲降低成本，但增加市场风险。Hedge Service 应支持策略配置。

## System Design

```mermaid
flowchart LR
  Inventory[Inventory Delta]
  Policy[Hedge Policy]
  Routing[Routing Engine]
  Venue[Hedge Venue]
  Result[Hedge Result]
  Metrics[Metrics and PnL]

  Inventory --> Policy
  Policy --> Routing
  Routing --> Venue
  Venue --> Result
  Result --> Metrics
```

## Architecture Diagram

Hedge Service 属于异步 post-trade path，通过 event bus 与 Inventory Service 通信。

## Sequence Diagram

```mermaid
sequenceDiagram
  autonumber
  participant I as Inventory Service
  participant H as Hedge Service
  participant R as Routing Engine
  participant V as Venue

  I->>H: hedge intent
  H->>R: select route
  R-->>H: venue and size
  H->>V: submit order
  V-->>H: fill or reject
  H-->>I: hedge result
```

## State Machine

```mermaid
stateDiagram-v2
  [*] --> IntentCreated
  IntentCreated --> RouteSelected
  RouteSelected --> Submitted
  Submitted --> Filled
  Submitted --> Rejected
  Submitted --> PartiallyFilled
  Rejected --> Failed
  Filled --> Completed
```

## Data Model

`HedgeOrder` includes `id`, `settlementEventId`, `token`, `side`, `amount`, `venue`, `status`, `externalOrderId`, `costBps`, `createdAt`, `updatedAt`.

## API Design

Hedge Service uses internal event APIs. It does not expose public user API.

## Engineering Decisions

- Hedge failure does not revert settlement; current backend records `HEDGE_INTENT_FAILED` and leaves `hedgeOrderId` absent from the accepted submit response.
- Hedge intent creation is idempotent by `settlementEventId`; retrying the same settlement returns the existing `hedgeOrderId` instead of creating a second hedge order.
- Hedge idempotency requires repeated `settlementEventId` input to match the stored hedge intent payload. A retry with a different quote id, token, side, amount or reason is a hedge intent conflict rather than a silent no-op. Persistent hedge rows store the required `quoteId` and `reason` from `HedgeIntentStatusResponse` so `/hedges/:id`, quote status hydration and reconciliation can join directly to both the triggering settlement event and original quote.
- Hedge Service returns defensive copies from create and status lookup operations. Direct callers must not be able to mutate queued hedge intent state by editing a returned record, because quote status hydration, `/hedges/:id` and reconciliation all depend on the stored intent.
- Hedge failure updates risk state through `recordHedgeFailure` and `quoteRiskPenaltyBps`; Quote Service reads that penalty and adds it to the pricing `inventorySkewBps` input.
- Hedge failure penalty config is validated at construction: `failurePenaltyBps` and `maxFailurePenaltyBps` must be positive safe integers, each must be at most 10000 bps, and `failurePenaltyBps` must not exceed `maxFailurePenaltyBps`. Invalid config fails fast before `/submit` can accept a settlement whose follow-up quote risk feedback would be nonsensical.
- `HedgeService` snapshots `HedgeServiceConfig` at construction after validation. External callers must not be able to mutate failure penalty increments or caps after construction and silently change follow-up quote risk feedback.
- Hedge intent and risk feedback inputs are validated before writing hedge state: `settlementEventId` and `quoteId` must be `SafeIdentifier` values with 1-128 characters matching `[A-Za-z0-9_:-]`, `chainId` must be a positive safe integer, `token` must be a runtime string and a 20-byte address, `amount` must be a canonical positive uint string without leading zeros, and `side` / `reason` must match the supported enum values. Direct service callers cannot pass `String` wrapper objects and rely on JavaScript `RegExp.test()` coercion before hedge state or risk pressure mutation.
- Hedge status lookups validate `hedgeOrderId` and `settlementEventId` as `SafeIdentifier` values before reading in-memory indexes, so internal callers cannot bypass the API gateway and query with blank, unsafe or overlong resource identifiers.
- Malformed hedge config, intent and risk feedback root payloads are rejected before field access or state mutation, so post-trade hedge failures cannot turn into unclassified `TypeError` paths or partial failure-pressure updates.
- Persistent hedge rows keep `externalOrderId` nullable while an intent is only queued internally, but any non-null external order reference must be non-empty so venue reconciliation can trace it.
- Hedge credentials isolated from Quote Service.

## Failure Scenarios

- Venue unavailable：retry or route elsewhere。
- Partial fill：update residual exposure。
- Hedge cost too high：risk limit tightened。
- Credential failure：alert and disable venue。
- Hedge intent creation failed：settlement remains accepted, inventory and PnL remain updated, metric `rfq_hedge_intent_errors_total` increments, and follow-up quote spread tightens through output-token quote risk penalty.
- Hedge status store unavailable：`GET /hedges/:id` returns `HEDGE_STORE_UNAVAILABLE` with traceId, so clients can retry status lookup instead of treating the hedge as missing.

## Security Considerations

External venue credentials must have least privilege. Withdrawal permissions should be disabled where possible.

## Performance Considerations

Hedge lag is key metric. The service should prioritize high exposure intents.

## Testing Strategy

测试 hedge skipped、route selected、venue reject、partial fill、idempotent retry、hedge intent creation failed does not rollback settlement、follow-up quote risk penalty、failure penalty config fail-fast、hedge status store unavailable 和 metrics emission。

## Interview Notes

Hedge 是成交后风险管理，不是链上结算的一部分。失败时通过风险和报价反馈控制损失。

## Summary

Hedge Service 让 RFQ 系统形成库存闭环，是从 demo 到专业做市系统的重要分界。

## References

- Hedge execution
- Inventory rebalancing
