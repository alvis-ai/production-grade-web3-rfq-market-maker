# Backend Interview Questions

## 1. Quote Service 的核心职责是什么？

考察点：编排 market data、pricing、risk、signer 和持久化。

## 2. 为什么 Risk Engine 必须在 Signer Service 之前？

考察点：签名即授权，风控必须前置。

## 3. `/quote` 的 p99 延迟应该如何优化？

考察点：缓存、异步数据流、本地限额、避免重查询。

## 4. 如何设计 RFQ 的错误码？

考察点：稳定、可观测、不泄露敏感风控。

## 5. market snapshot 为什么需要 `snapshotId`？

考察点：回放、审计、争议处理和 PnL。

## 6. 如何保证 settlement event 消费幂等？

考察点：`chainId + txHash + logIndex` 唯一键。

## 7. Redis 在 RFQ 系统中承担什么职责？

考察点：短期缓存、限流、snapshot、quote cache。

## 8. PostgreSQL 和 ClickHouse 如何分工？

考察点：操作状态与分析状态分离。

## 9. Signer Service 如何隔离？

考察点：网络边界、KMS、service identity、审计。

## 10. 如何处理 Market Data Service 不可用？

考察点：拒绝、降级、扩大 spread、降低 limit。

## 11. 如何监控 hedge lag？

考察点：settlement time、hedge order time、venue ack time。

## 12. 如何做 quote funnel 分析？

考察点：requested、rejected、signed、submitted、settled。

## 13. 如何处理链重组？

考察点：确认数、回滚、重放、库存修正。

## 14. 如何设计 Risk Engine 的 policy version？

考察点：可审计、回放、灰度和回滚。

## 15. 为什么金额字段使用字符串？

考察点：JavaScript number 精度和链上 uint256。
