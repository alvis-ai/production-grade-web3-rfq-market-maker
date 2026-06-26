# ADR-0004: Use Inventory-Based Pricing

## Status

Accepted

## Context

专业做市系统不能只根据外部 mid price 报价。如果做市商某个资产库存过高，继续用同样价格买入该资产会放大风险；如果库存过低，继续卖出会增加交割和对冲压力。报价必须反映库存偏离目标的成本。

## Decision

Pricing Engine 使用 inventory-based pricing。报价模型至少包含：

- market mid price
- base spread
- size impact
- volatility premium
- inventory skew
- hedge cost

库存偏离目标时，系统通过调整 bid / ask 影响用户成交方向，而不是等风险超限后才拒绝所有请求。Risk Engine 仍保留硬性限额，当库存、notional 或市场状态超过阈值时拒绝签名。

## Consequences

### Positive

- 报价主动引导库存回归目标。
- 做市商可以把库存风险内生到 spread。
- 风控不再只是二元 allow / reject，而是与定价联动。
- PnL 归因可以拆分为 spread、size impact、inventory skew 和 hedge cost。

### Negative

- 报价解释和测试更复杂。
- 参数错误可能导致报价过宽、过窄或方向错误。
- 用户可能感知到同一市场价格下报价随库存变化。

### Mitigation

- 输出 `pricingVersion` 和解释字段。
- 单元测试覆盖 inventory skew 方向和边界。
- 风控硬限额独立存在，避免定价模型错误无限放大风险。
- 通过 ClickHouse 分析库存偏斜对成交率和 PnL 的影响。

## Alternatives Considered

### Fixed Spread Pricing

实现简单，但不能响应库存和市场状态。

### Pure External Mid Price

成交率高但风险不可控。

### Inventory-Based Pricing

符合专业做市需求，因此被接受。
