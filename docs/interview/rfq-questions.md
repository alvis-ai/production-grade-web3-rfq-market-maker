# RFQ Interview Questions

以下问题用于高级 Web3 工程师、DeFi 系统架构师和智能合约工程师面试。问题覆盖 RFQ 模型、做市系统、风险控制、EIP-712、链上结算、观测性和生产故障处理。

## 1. RFQ 和 AMM 的核心区别是什么？

考察点：报价生成位置、执行承诺、链上状态、价格发现、可组合性和专业做市适配度。

## 2. 为什么专业做市系统通常需要链下风控？

考察点：库存、对冲、外部市场数据、限额、波动率、有毒流量和低延迟决策。

## 3. RFQ 系统中 quote 和 execution 的一致性如何保证？

考察点：EIP-712 签名、nonce、deadline、chainId、token、amount、minAmountOut 和合约验证。

## 4. Signed Quote 的 TTL 应该如何设计？

考察点：市场波动、用户钱包延迟、链拥堵、失败率、重放窗口和报价质量。

## 5. 为什么 RFQ 合约应该尽量保持最小化？

考察点：确定性、安全审计、gas 成本、链下复杂策略和故障隔离。

## 6. EIP-712 相比直接签 hash 有什么优势？

考察点：typed data、domain separator、防跨链重放、可读性和钱包展示。

## 7. RFQ 系统如何防止 nonce replay？

考察点：per-user nonce、global nonce、bitmap、mapping、状态更新顺序和事件审计。

## 8. trusted signer 失效或泄露时应该如何处理？

考察点：AccessControl、key rotation、pause、签名域隔离、限额、监控和审计。

## 9. 为什么风险检查必须发生在签名之前？

考察点：签名即授权、链上合约无法计算完整风险、库存和对冲前置。

## 10. 如何设计 RFQ 的 token whitelist？

考察点：资产风险、合约地址、decimals、fee-on-transfer、rebasing token 和治理流程。

## 11. RFQ 如何缓解 MEV 问题？

考察点：固定签名报价、minAmountOut、短 TTL、私有提交、mempool 暴露和结算原子性。

## 12. RFQ 是否完全消除 MEV？

考察点：不能完全消除，仍可能存在提交抢跑、对冲腿暴露、流动性路由和链上状态竞争。

## 13. Prop AMM 和链上 AMM 曲线有什么不同？

考察点：链下模型、库存偏斜、风险参数、外部价格、私有策略和签名输出。

## 14. Pricing Engine 应该输入哪些数据？

考察点：mid price、order book、pool liquidity、inventory、volatility、fees、hedge cost 和 latency。

## 15. Risk Engine 应该输出什么？

考察点：allow/reject、limits、reason code、policy version、risk score 和 audit data。

## 16. 如何处理 quote 已签名但链上执行时市场变化的问题？

考察点：TTL、minAmountOut、库存锁定、对冲策略、失败容忍和报价撤销限制。

## 17. RFQ 系统中的 `snapshotId` 有什么作用？

考察点：报价可解释性、争议排查、回放、PnL 归因和风控审计。

## 18. `/submit` 应该由后端提交还是用户直接提交链上交易？

考察点：UX、gas payer、信任模型、私有交易、失败处理和 custody 边界。

## 19. 如何设计 inventory update 的幂等性？

考察点：链上事件、transaction hash、log index、consumer offset、exactly-once 语义和重放。

## 20. 如何发现有毒流量？

考察点：成交后价格漂移、用户行为模式、venue latency、方向性 flow、reject policy 和 spread 调整。

## 21. 大额 RFQ 的 size impact 应该如何建模？

考察点：深度、外部 venue 成本、库存占用、对冲滑点、分段报价和最大成交限制。

## 22. RFQ 系统如何处理链重组？

考察点：confirmation depth、事件回滚、库存修正、幂等状态机和告警。

## 23. 为什么 ClickHouse 适合 RFQ 系统的分析侧？

考察点：高吞吐事件、时间序列、quote funnel、成交分析、PnL 归因和低成本查询。

## 24. Prometheus 指标应该覆盖哪些核心对象？

考察点：quote latency、reject rate、sign rate、submit success、settlement failure、inventory exposure 和 hedge lag。

## 25. 如何设计 RFQ 错误码？

考察点：用户可理解、风控不可泄露、可观测、可聚合和可运维。

## 26. 如何在面试中解释 RFQ + Prop AMM 的工程权衡？

考察点：牺牲一部分链上透明性，换取专业报价、风控前置、合约最小化和可运营性。

## 27. RFQ 系统中哪些状态必须上链，哪些状态应留在链下？

考察点：授权、结算、nonce、事件上链；市场数据、风险、库存细节、对冲和策略留链下。

## 28. 如何测试 RFQSettlement 合约？

考察点：签名验证、deadline、nonce replay、wrong signer、wrong chainId、token whitelist、reentrancy 和 pause。

## 29. 如何做 RFQ 系统的压测？

考察点：报价 QPS、p99 latency、Redis cache、Signer throughput、Risk Engine latency 和事件消费延迟。

## 30. 当 Signer Service 延迟升高时如何降级？

考察点：限流、熔断、临时扩大 spread、拒绝高风险资产、告警和签名队列监控。
