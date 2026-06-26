# Risk State Machine

本图描述 quote 在风险系统中的状态变化。

```mermaid
stateDiagram-v2
  [*] --> Received
  Received --> InputRejected: invalid token, chain, amount, or user
  Received --> MarketChecked: market snapshot valid
  MarketChecked --> PricingChecked: pricing result valid
  PricingChecked --> InventoryChecked: inventory within soft limits
  InventoryChecked --> ToxicFlowChecked: flow is acceptable
  ToxicFlowChecked --> Approved: all checks pass
  InputRejected --> Rejected
  MarketChecked --> Rejected: stale market or no liquidity
  PricingChecked --> Rejected: price outside guardrail
  InventoryChecked --> Rejected: hard exposure limit
  ToxicFlowChecked --> Rejected: toxic flow threshold
  Approved --> Signed
  Rejected --> [*]
  Signed --> [*]
```

## Risk Outputs

- `decision`: `approved` or `rejected`
- `reasonCode`: stable internal reason
- `policyVersion`: risk policy version used for audit
- `maxNotionalUsd`: policy limit at decision time
- `inventoryExposureBefore`: exposure before quote signing
