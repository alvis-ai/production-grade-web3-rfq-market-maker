# System Design Interview Questions

## 1. 画出完整 RFQ 系统架构。

考察点：Client、API、Market Data、Pricing、Risk、Signer、Contract、Inventory、Hedge、Metrics。

## 2. 如何保证 quote 与 execution 一致？

考察点：EIP-712、nonce、deadline、chainId、verifyingContract。

## 3. RFQ + Prop AMM 相比纯 AMM 的核心收益是什么？

考察点：风控前置、库存感知、短生命周期承诺、合约最小化。

## 4. 如何设计高可用 Signer Service？

考察点：KMS、限额、隔离、监控、轮换。

## 5. 如何在多链环境中避免重放？

考察点：domain separator、chainId、合约地址和 nonce scope。

## 6. 如何设计事件驱动库存系统？

考察点：Indexer、幂等、重放、reorg、position projection。

## 7. 如何将 hedge 失败反馈到后续报价？

考察点：库存状态、spread 扩大、risk limit 收紧、告警。

## 8. 如何支持新 token 上线？

考察点：token whitelist、decimals、流动性、安全审查、参数配置。

## 9. 如何做灰度发布新的 pricing model？

考察点：pricingVersion、流量分组、PnL 对比和回滚。

## 10. 如何设计系统级 SLO？

考察点：quote latency、availability、settlement success、event lag。

## 11. 如何处理高波动市场？

考察点：短 TTL、扩大 spread、降低 notional、暂停交易对。

## 12. 如何做端到端测试？

考察点：quote、sign、submit、settle、index、inventory、hedge、metrics。

## 13. 如何避免分析系统影响实时路径？

考察点：事件流、ClickHouse 异步写入、PostgreSQL 分工。

## 14. 如何设计 Runbook？

考察点：signer incident、market data incident、chain incident、hedge incident。

## 15. 如何解释这个项目的生产级特征？

考察点：文档、ADR、测试、观测、权限、故障恢复和部署。
