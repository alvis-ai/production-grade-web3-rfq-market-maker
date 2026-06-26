# ADR-0001: Use RFQ Instead Of Pure AMM

## Status

Accepted

## Context

本项目要构建的是生产级 Web3 RFQ / Prop AMM 做市系统。系统需要支持专业做市商在多资产、多链、多流动性来源和严格风险约束下对外提供报价，并最终通过链上合约完成确定性结算。

纯 AMM 的优点是透明、无需许可、链上可组合性强，但它将价格发现、库存管理和执行全部压缩到链上曲线中。对于专业做市场景，这会带来几个明显问题：

- 大额交易会直接受到曲线深度限制，Price Impact 难以被做市商主动控制。
- 做市商不能在签名报价前完整纳入外部市场数据、内部库存、风险限额和对冲成本。
- 链上交易暴露在公开 mempool 中，容易受到 sandwich、backrun、抢跑和有毒流量影响。
- 报价与执行之间缺少可审计的链下快照，难以解释成交时的风险状态。
- 多链、多 venue、多资产路由下，单一 AMM 池无法表达完整的做市策略。

RFQ 模型将询价、定价、风控和签名放在链下完成，再让链上合约只验证签名、时效、nonce、资产和最小成交条件。这种拆分更符合专业做市系统的职责边界。

## Decision

Use RFQ + Prop AMM as the core trading model.

系统将采用 RFQ 作为用户交互和链上结算入口，采用 Prop AMM 作为链下报价引擎的一部分。Prop AMM 不等同于链上恒定乘积池，而是由做市方控制的定价模型。它可以结合市场中间价、库存偏斜、交易尺寸、波动率、风险限额、对冲成本和流动性路由，生成短生命周期的 EIP-712 签名报价。

链上合约 `RFQSettlement` 的职责保持最小化：

- 验证 EIP-712 typed data signature。
- 验证 trusted signer。
- 验证 nonce 未使用。
- 验证 deadline 未过期。
- 验证 token whitelist。
- 验证 `minAmountOut` 和 quote 字段。
- 使用 SafeERC20 完成确定性转账。
- 通过事件暴露成交状态。

复杂逻辑，例如实时定价、风险评分、库存限额、对冲策略、路由选择、异常流量识别和 PnL 归因，保留在链下服务中。

## Consequences

### Positive

- 报价可以在签名前纳入完整风险上下文，避免在库存不足、风险超限或市场异常时继续成交。
- Signed Quote 提供明确的执行承诺，链上合约可以验证用户提交内容是否与做市商授权一致。
- TTL 和 nonce 能降低报价过期、重放攻击和市场状态漂移风险。
- 做市商可以使用更复杂的 Prop AMM 定价模型，而不需要把所有策略公开到链上。
- 合约更小、更确定、更容易审计，主要负责授权验证和资产结算。
- 系统可以在文档、指标和日志中还原每笔 quote 的 market snapshot、risk decision 和 execution result。

### Negative

- RFQ 引入链下服务依赖，可用性不再只取决于链上合约。
- 用户需要信任做市商签名服务的在线能力和报价质量。
- 报价服务、签名服务和风控服务成为高价值攻击面。
- 短 TTL 会提高用户在网络拥堵或钱包交互延迟下的失败率。
- 如果链下状态和链上执行事件同步不可靠，库存和 PnL 可能短时间不一致。

### Mitigation

- 使用短生命周期 quote、nonce replay protection 和 deadline expiry 控制执行窗口。
- 将签名密钥隔离到 Signer Service 或 HSM / KMS 管理，并限制可签名 token、chain 和 notional。
- 所有 quote 决策记录 `quoteId`、`snapshotId`、risk result、pricing inputs 和 signer identity。
- 合约只接受 trusted signer，并通过 Pausable 和 AccessControl 支持紧急暂停。
- 对 `/quote`、`/submit`、risk reject、settlement event、inventory update 和 hedge result 建立指标与告警。
- 对链上事件做幂等消费，库存更新使用事件驱动和可重放日志。

## Alternatives Considered

### Pure AMM

Pure AMM 提供最强的链上透明性和可组合性，但难以满足专业做市对库存控制、风险前置、动态 spread、对冲成本和大额成交质量的要求。它适合公开流动性池，不适合作为本项目唯一交易模型。

### Order Book

Order Book 对专业交易者友好，价格层级清晰，也适合中心化交易所。但在链上环境中，高频挂单、撤单和撮合成本高，订单状态管理复杂，并且容易受到 gas、mempool 和最终性影响。完全链上 order book 与本项目“链下复杂逻辑、链上最小结算”的原则不匹配。

### DEX Aggregator

DEX Aggregator 可以整合多个公开流动性来源，改善普通 swap 的成交路径。但 aggregator 主要做路径搜索和交易拆分，并不天然提供做市商私有库存管理、签名前风控、短 TTL 承诺报价和内部对冲闭环。

### RFQ + Prop AMM

RFQ + Prop AMM 将询价、定价、风控、签名和结算分层。它牺牲了一部分完全链上透明性，换取更强的专业报价能力、风险控制能力和执行一致性。该方案最符合本项目目标，因此被接受。
