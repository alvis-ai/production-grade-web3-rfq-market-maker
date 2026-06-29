# Chapter 05: Position Limits

## Abstract

Position limits 是 Risk Engine 最直接的硬约束。无论 Pricing Engine 给出多好的价格，只要 quote 执行后会超过 hard limit，Signer Service 就不能签名。限额系统把业务风险偏好转化为可执行规则。

## Learning Objectives

- 区分 soft limit 和 hard limit。
- 定义 token、pair、chain、user 和 portfolio 维度限额。
- 说明 position limit 与 pricing skew 的关系。
- 设计限额超出时的响应。

## Background

做市系统通常为每个资产设置最大库存、最大净敞口、最大单笔 notional 和最大日成交量。RFQ 系统必须在签名前检查这些限制，因为链上合约无法知道完整链下组合状态。

## Problem Statement

没有限额时，系统可能在异常流量或定价错误下持续签名。限额是防止单点模型错误扩散成资金事故的最后业务边界。

## Requirements

### Functional Requirements

- 支持 per-token limit。
- 支持 per-pair limit。
- 支持 per-chain limit。
- 支持 per-user 或 per-counterparty limit。
- 支持 global portfolio limit。

### Non-Functional Requirements

- 限额规则必须版本化。
- 限额变更必须审计。
- hard limit 必须强制拒绝。

## Existing Solutions

简单系统只限制单笔 amount。生产系统会多维度限额，并区分软硬阈值。

## Trade-Off Analysis

限额维度越多，配置越复杂，但能更精确地控制风险。第一版应覆盖 token、chain 和 notional 三个核心维度。

## System Design

```mermaid
flowchart LR
  Quote[Proposed Quote]
  Exposure[Post-trade Exposure]
  TokenLimit[Token Limit]
  ChainLimit[Chain Limit]
  UserLimit[User Limit]
  PortfolioLimit[Portfolio Limit]
  Decision[Decision]

  Quote --> Exposure
  Exposure --> TokenLimit
  Exposure --> ChainLimit
  Exposure --> UserLimit
  Exposure --> PortfolioLimit
  TokenLimit --> Decision
  ChainLimit --> Decision
  UserLimit --> Decision
  PortfolioLimit --> Decision
```

## Architecture Diagram

Limit Store 为 Risk Engine 提供版本化 policy。Quote Service 不直接读取限额。

## Sequence Diagram

```mermaid
sequenceDiagram
  autonumber
  participant R as Risk Engine
  participant L as Limit Store
  participant A as Audit Log

  R->>L: load active policy
  L-->>R: limits and policyVersion
  R->>R: compare post-trade exposure
  R->>A: record decision
```

## State Machine

```mermaid
stateDiagram-v2
  [*] --> PolicyLoaded
  PolicyLoaded --> LimitsChecked
  LimitsChecked --> WithinLimit
  LimitsChecked --> SoftLimitBreached
  LimitsChecked --> HardLimitBreached
  WithinLimit --> Approved
  SoftLimitBreached --> ApprovedWithControls
  HardLimitBreached --> Rejected
```

## Data Model

`RiskLimitPolicy` 包含 `policyVersion`、`chainId`、`tokenAddress`、`maxPosition`、`softPosition`、`maxNotionalUsd`、`maxUserNotionalUsd`、`maxQuotedSpreadBps`、`enabled`。当前后端 `BasicRiskPolicy` 已落地 `enabledChainIds`、`tokenAllowlist`、`maxAmountIn`、`minAmountOut`、`maxSlippageBps`、`maxQuotedSpreadBps` 和 `maxAbsoluteInventory`。Quote Service 会把本次 quote 的 projected tokenIn/tokenOut position 传给 Risk Engine；任一方向超过 hard limit 或 Pricing Engine 返回的最终 quoted spread 超过 policy 都会拒绝签名。后续再扩展为数据库驱动的多维限额。

## API Design

内部管理 API 后续可支持限额更新，但必须鉴权。公开 quote API 只返回风险拒绝。

## Engineering Decisions

- hard limit 拒绝签名。
- soft limit 可以触发更宽 spread 或更短 TTL。
- policyVersion 必须写入 risk decision。

## Failure Scenarios

- Limit Store 不可用：拒绝签名。
- policy 缺失：拒绝相关 token。
- limit 配置过低：成交率下降但资金安全优先。

## Security Considerations

限额变更是高权限操作，必须审计并尽量使用多签或审批流程。

## Performance Considerations

Active policy 应缓存，但缓存必须有版本和失效机制。

## Testing Strategy

测试 token limit、chain limit、user limit、portfolio limit、soft/hard 分支和 policy missing。

## Interview Notes

Position limit 是风险系统的硬闸门。不要用动态 spread 替代 hard limit。

## Summary

Position limits 把风险偏好转成可执行约束，是签名前风控的关键组成。

## References

- Risk limit policies
- Pre-trade risk checks
