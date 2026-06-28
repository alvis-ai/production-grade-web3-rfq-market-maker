# API Errors

本文件定义 RFQ API 的错误码方向。错误响应必须对用户可理解、对运维可聚合，同时避免泄露敏感风控阈值。

## Error Shape

```json
{
  "code": "RISK_REJECTED",
  "message": "Quote rejected by risk policy",
  "traceId": "tr_abc123"
}
```

## Error Codes

| Code | HTTP Status | Description | User Action |
| --- | ---: | --- | --- |
| `INVALID_REQUEST` | 400 | 请求字段缺失、地址格式错误或 amount 无效 | 修正请求参数 |
| `UNSUPPORTED_CHAIN` | 400 | chainId 不在支持范围 | 切换网络 |
| `UNSUPPORTED_TOKEN` | 400 | token 不在 whitelist | 更换资产 |
| `AMOUNT_TOO_SMALL` | 400 | amount 小于系统最小交易量 | 提高交易数量 |
| `AMOUNT_TOO_LARGE` | 400 | amount 超过单笔最大交易量 | 降低交易数量 |
| `MARKET_DATA_UNAVAILABLE` | 503 | 市场数据不可用或过期 | 稍后重试 |
| `ROUTING_UNAVAILABLE` | 503 | Routing Engine 无法选择报价路径 | 稍后重试 |
| `PRICING_UNAVAILABLE` | 503 | Pricing Engine 无法生成报价 | 稍后重试 |
| `RISK_REJECTED` | 409 | 风控策略拒绝签名 | 降低数量或稍后重试 |
| `SIGNER_UNAVAILABLE` | 503 | Signer Service 不可用 | 稍后重试 |
| `INVALID_SIGNATURE` | 409 | quote signature 无法恢复到 trusted signer | 重新询价并提交后端返回的签名 |
| `QUOTE_STORE_UNAVAILABLE` | 503 | quote repository 或持久化审计存储不可用 | 稍后重试，若已拿到 signed quote 则先查询 quote 状态 |
| `QUOTE_NOT_FOUND` | 404 | quoteId 不存在 | 重新询价 |
| `QUOTE_EXPIRED` | 409 | quote 已过期 | 重新询价 |
| `QUOTE_ALREADY_USED` | 409 | quote nonce 已使用 | 重新询价 |
| `QUOTE_FAILED` | 409 | quote 已进入失败终态，不能再次提交 | 重新询价 |
| `HEDGE_NOT_FOUND` | 404 | hedgeOrderId 不存在或已不在当前执行存储中 | 查询 submit 响应返回的 hedgeOrderId，必要时重新提交 |
| `HEDGE_STORE_UNAVAILABLE` | 503 | hedge execution store 或 hedge intent 查询依赖不可用 | 稍后重试，必要时通过 submit 响应和执行日志核对 hedge 状态 |
| `SETTLEMENT_EVENT_NOT_FOUND` | 404 | settlementEventId 不存在或当前执行存储尚未消费该事件 | 查询 submit 响应返回的 settlementEventId，或等待索引器消费链上事件 |
| `SETTLEMENT_UNAVAILABLE` | 503 | settlement verifier、链 RPC 或结算依赖不可用，尚未判定 quote 是否可结算 | 稍后重试同一 signed quote，过期后重新询价 |
| `SETTLEMENT_REVERTED` | 409 | settlement verification 或链上结算拒绝该 quote | 查看交易状态并重新询价 |
| `RATE_LIMITED` | 429 | 请求频率过高 | 降低请求频率 |
| `INTERNAL_ERROR` | 500 | 未分类内部错误 | 使用 traceId 联系维护者 |

## Design Rules

- 对外错误码保持稳定，不直接暴露内部 policy threshold。
- 所有错误响应必须包含 `traceId`。
- 风控拒绝应记录内部 `reasonCode` 和 `policyVersion`，但对外只返回通用说明。
- `RATE_LIMITED` 响应必须返回 HTTP 429，并带 `Retry-After` header。
- 依赖不可用使用 503，业务状态冲突使用 409。
