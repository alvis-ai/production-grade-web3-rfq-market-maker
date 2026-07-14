# Chapter 06: Toxic Flow

## Abstract

Toxic flow 指对做市商具有系统性不利选择的交易流。RFQ 系统如果只根据价格和库存判断，可能被延迟优势、信息优势或策略性询价捕获。Risk Engine 需要识别异常流量，并通过拒绝、扩大 spread、缩短 TTL 或降低限额缓解。

## Learning Objectives

- 理解 toxic flow 的含义。
- 识别 RFQ 场景中的不利选择。
- 定义成交后价格漂移指标。
- 设计 toxic flow 的响应策略。

## Background

做市商面对的不只是市场风险，还有交易对手选择风险。如果某些请求总是在价格即将不利变化前成交，做市商会持续亏损。RFQ 中，短 TTL 和签名前风控可以降低但不能消除这种风险。

## Problem Statement

系统需要在不歧视正常用户的前提下识别异常流量，避免被高信息优势流量持续套利。

## Requirements

### Functional Requirements

- 跟踪成交后短窗口价格漂移。
- 跟踪用户或渠道的 reject/settle/PnL 特征。
- 支持 toxic score。
- 根据 toxic score 调整 spread、TTL 或限额。

### Non-Functional Requirements

- 不泄露 toxic scoring 细节。
- 评分必须可审计。
- 响应策略必须可解释。

## Existing Solutions

传统做市系统使用 counterparty scoring、last look、spread adjustment 和 flow segmentation。Web3 RFQ 需要在更开放的钱包地址环境中采用类似思想，但要避免不可解释黑盒。

## Trade-Off Analysis

严格 toxic flow 控制能减少损失，但可能误伤正常用户。第一版应使用保守信号和人工可解释规则。

## System Design

```mermaid
flowchart LR
  Trades[Settled Trades]
  Drift[Post-trade Price Drift]
  UserStats[User / Channel Stats]
  Score[Toxic Flow Score]
  Policy[Risk Policy]
  Action[Spread, Limit, Reject]

  Trades --> Drift
  Drift --> Score
  UserStats --> Score
  Score --> Policy
  Policy --> Action
```

## Architecture Diagram

Toxic Flow Analyzer 可以异步计算评分，Risk Engine 在实时路径读取最近评分。

## Sequence Diagram

```mermaid
sequenceDiagram
  autonumber
  participant CH as ClickHouse
  participant T as Toxic Flow Analyzer
  participant S as PostgreSQL Score Store
  participant R as Risk Engine
  participant Q as Quote Service

  CH->>T: settled trades and price drift
  T->>S: CAS publish score and audit version
  Q->>R: validated request, pricing and inventory
  R->>S: getScore(chainId, user)
  S-->>R: current score or null
  R-->>Q: approved or stable rejection
```

## State Machine

```mermaid
stateDiagram-v2
  [*] --> NormalFlow
  NormalFlow --> Watchlist
  Watchlist --> Restricted
  Restricted --> Rejected
  Watchlist --> NormalFlow
  Restricted --> Watchlist
```

## Data Model

当前 `ToxicFlowScoreState` 以 `(chainId, normalized user)` 为键，包含 `scoreBps`、`postTradeDriftBps`、`sampleSize`、`windowSeconds`、`policyVersion`、`observedAt`、单调 `version`、`updatedBy` 和 `updatedAt`。`toxic_flow_scores` 保存最新版本，`toxic_flow_score_audit` 保存每个成功 CAS 版本；原始 settled trade 和 markout 证据仍应保留在操作库/分析库，不能用派生 score 反向替代事实。

## API Design

Toxic flow 不通过交易 API 暴露。受保护的 `GET/PUT /admin/toxic-flow/scores/:chainId/:user` 只供 analyzer 和运维控制面读取或以 `expectedVersion` 发布 score；公共 quote 响应仍只返回 `RISK_REJECTED`。Risk Decision 记录内部 reason code，并把 score version 组合到 `policyVersion` 的 `:tf<version>` 后缀中以便回放。

## Engineering Decisions

- 第一版使用规则评分，不使用黑盒模型。
- toxic score 可扩大 spread 或降低 limit。
- 严重 toxic flow 可拒绝签名。
- 当前默认 `TokenLimitRiskEngine` 与保留的 `BasicRiskEngine` 都支持 restricted user 和 per-user `toxicFlowScores`；分数超过 `maxToxicScoreBps` 时返回 `TOXIC_FLOW_SCORE_EXCEEDED`，restricted user 返回 `TOXIC_FLOW_RESTRICTED_USER`。
- 默认运行时在 `TokenLimitRiskEngine` 外层装配 `DynamicToxicFlowRiskEngine`。基础 chain、token、market、inventory 和静态策略先执行并可短路拒绝；基础批准后才读取共享动态 score。未知用户继续使用基础决定，样本量低于 `RFQ_TOXIC_FLOW_MIN_SAMPLE_SIZE` 的新 score 只参与版本审计而不触发强拒绝。
- 已知 score 必须满足 `RFQ_TOXIC_FLOW_MAX_SCORE_AGE_MS` 和 `RFQ_TOXIC_FLOW_MAX_FUTURE_SKEW_MS`。过期、来自过远未来、畸形或存储不可读都视为 `RISK_ENGINE_UNAVAILABLE` 并阻断 signer；生产多副本不得回退到 pod-local score。
- 注入自定义 `RiskEngine` 表示调用方接管完整策略，因此默认动态 wrapper 不会再次叠加；自定义实现必须自行提供等价的 freshness、审计与 fail-closed 保证。

## Failure Scenarios

- 分析任务延迟：仅在上一版本仍处于 freshness 窗口时继续使用；过期后 fail closed。
- 样本不足：不做强拒绝。
- scoring 或 score store 异常：已知用户拒绝签名并记录 `RISK_ENGINE_UNAVAILABLE`，不静默降级为无 score。

## Security Considerations

不能暴露具体评分规则，否则容易被规避。读取使用独立 `admin:read` key，analyzer 写入使用最小权限的 `admin:write` key；普通 quote、submit、浏览器和分析查询凭证不得拥有这些 scope。指标不带 user、chain、score 或 actor label，具体证据从审计表查询。

## Performance Considerations

实时 Risk Engine 只读取评分缓存，不扫描历史成交。

## Testing Strategy

测试价格漂移、样本不足、watchlist、restricted、reject 和 score cache stale。

## Interview Notes

Toxic flow 是专业做市系统与普通 API 的重要区别。要强调它是风险信号，不是单一拒绝理由。

## Summary

Toxic flow 控制帮助系统识别不利选择流量，并通过 spread、TTL、limit 和 reject 管理风险。

## References

- Adverse selection
- Post-trade markout
- Flow toxicity
