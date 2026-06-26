# ADR-0002: Use EIP-712 For Quotes

## Status

Accepted

## Context

RFQ 系统的核心不变量是 quote 与 execution 一致。做市商在链下完成市场数据读取、定价、风控和签名，用户随后把 quote 提交到链上合约结算。链上合约必须能够判断：这笔交易是否确实由 trusted signer 授权，quote 字段是否未被篡改，签名是否只适用于当前 chain 和 verifying contract。

如果只签名一个不透明 hash，用户、钱包和审计者很难理解签名语义，也更容易出现跨链、跨合约或跨版本重放风险。

## Decision

使用 EIP-712 typed structured data 作为 RFQ quote 的签名标准。

EIP-712 domain 固定包含：

- `name`: `RFQSettlement`
- `version`: `1`
- `chainId`
- `verifyingContract`

Quote typed data 固定包含：

- `user`
- `tokenIn`
- `tokenOut`
- `amountIn`
- `amountOut`
- `minAmountOut`
- `nonce`
- `deadline`
- `chainId`

## Consequences

### Positive

- 签名语义结构化，便于钱包展示和审计。
- domain separator 降低跨链和跨合约重放风险。
- 合约验证逻辑与 SDK typed data helper 可以共享字段定义。
- Quote 字段被密码学绑定，任何字段变化都会导致签名失效。

### Negative

- EIP-712 实现比简单 `eth_sign` 更复杂。
- 前端、SDK、后端 signer 和合约必须严格保持类型一致。
- domain version 变更需要明确迁移策略。

### Mitigation

- 在 SDK 中维护唯一的 `quoteTypes` 定义。
- 合约测试覆盖错误 chainId、错误 verifyingContract、错误 signer 和字段篡改。
- ADR 和 OpenAPI 同步记录 Quote 字段。
- 任何 EIP-712 version 变更都必须新增 ADR 或变更记录。

## Alternatives Considered

### Raw Hash Signing

实现简单，但可读性差，钱包展示不友好，容易产生签名语义误解。

### EIP-191 Personal Sign

兼容性较好，但不适合复杂结构化交易授权，也不适合作为生产级 RFQ quote 的长期标准。

### EIP-712 Typed Data

结构清晰、合约验证成熟、生态支持广泛，因此被接受。
