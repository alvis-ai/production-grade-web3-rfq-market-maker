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
| `INVALID_REQUEST` | 400 / 403 / 404 / 413 / 415 | 请求字段缺失、JSON 格式错误、CORS origin 不在 allowlist、未知路由或方法、body 超限、content type 错误、地址格式错误或 amount 无效 | 修正请求参数 |
| `UNSUPPORTED_CHAIN` | 400 | chainId 不在支持范围 | 切换网络 |
| `UNSUPPORTED_TOKEN` | 400 | token 不在 whitelist | 更换资产 |
| `AMOUNT_TOO_SMALL` | 400 | amount 小于系统最小交易量 | 提高交易数量 |
| `AMOUNT_TOO_LARGE` | 400 | amount 超过单笔最大交易量 | 降低交易数量 |
| `MARKET_DATA_UNAVAILABLE` | 503 | 市场数据不可用、过期、明显来自未来或快照字段无效 | 稍后重试 |
| `ROUTING_UNAVAILABLE` | 503 | Routing Engine 无法选择报价路径 | 稍后重试 |
| `PRICING_UNAVAILABLE` | 503 | Pricing Engine 无法生成报价 | 稍后重试 |
| `RISK_REJECTED` | 409 | 风控策略拒绝签名 | 降低数量或稍后重试 |
| `SIGNER_UNAVAILABLE` | 503 | Signer Service 不可用 | 稍后重试 |
| `INVALID_SIGNATURE` | 409 | quote signature 无法恢复到 trusted signer，或不是链上可接受的 canonical low-s ECDSA 签名 | 重新询价并提交后端返回的签名 |
| `QUOTE_STORE_UNAVAILABLE` | 503 | quote repository 或持久化审计存储不可用 | 稍后重试，若已拿到 signed quote 则先查询 quote 状态 |
| `QUOTE_NOT_FOUND` | 404 | quoteId 不存在 | 重新询价 |
| `QUOTE_EXPIRED` | 409 | quote 已过期 | 重新询价 |
| `QUOTE_ALREADY_USED` | 409 | quote nonce 已使用 | 重新询价 |
| `QUOTE_FAILED` | 409 | quote 已进入失败终态，不能再次提交 | 重新询价 |
| `HEDGE_NOT_FOUND` | 404 | hedgeOrderId 不存在或已不在当前执行存储中 | 查询 submit 响应返回的 hedgeOrderId，必要时重新提交 |
| `HEDGE_STORE_UNAVAILABLE` | 503 | hedge execution store 或 hedge intent 查询依赖不可用 | 稍后重试，必要时通过 submit 响应和执行日志核对 hedge 状态 |
| `SETTLEMENT_EVENT_NOT_FOUND` | 404 | settlementEventId 不存在或当前执行存储尚未消费该事件 | 查询 submit 响应返回的 settlementEventId，或等待索引器消费链上事件 |
| `SETTLEMENT_EVENT_STORE_UNAVAILABLE` | 503 | settlement event store 或索引器状态查询依赖不可用 | 稍后重试，必要时通过链上交易和日志索引核对 settlement 状态 |
| `PNL_STORE_UNAVAILABLE` | 503 | PnL store 或归因查询依赖不可用 | 稍后重试，必要时从 settlement event 和执行日志重建 PnL |
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
- 框架级解析错误也必须映射为结构化 `ErrorResponse`，包括 malformed JSON、body too large 和 unsupported content type。
- 请求 validator 必须按 OpenAPI schema 校验 JSON primitive 类型，不能用 `Number()` 或 `String()` 把字符串数字、布尔值或数字形式的 uint 字段隐式转换后继续处理。
- 所有 `PositiveUIntString` 字段必须使用 canonical decimal form：匹配 `^[1-9][0-9]*$`，不接受 `0`、负数、小数、科学计数法、十六进制或带前导零的字符串。
- CORS preflight origin 不在 `RFQ_CORS_ALLOWED_ORIGINS` 时返回结构化 `INVALID_REQUEST` 和 HTTP 403，且不返回 `access-control-allow-origin`。`RFQ_CORS_ALLOWED_ORIGINS` 只接受 HTTP(S) URL origin；path、query、fragment、credentials 和 wildcard 会在启动期被拒绝。
- 未匹配路由或不支持的方法必须返回结构化 `INVALID_REQUEST` 和 HTTP 404，不能返回 Fastify 默认错误对象。

## Rate Limit Policy

The current gateway uses a 60 second rate limit window keyed by the direct client IP by default. `x-forwarded-for` is ignored unless `RFQ_TRUST_PROXY=true`; only enable that setting behind a trusted proxy or ingress that strips spoofed forwarding headers and writes the canonical client address. When proxy trust is enabled, forwarded client identities longer than 128 characters or outside `[A-Za-z0-9_.:-]` are rejected as `INVALID_REQUEST`/400 before rate-limit buckets are written. Production deployments should replace the in-memory store with Redis or another shared limiter, but the public HTTP contract must stay stable.

| Endpoint Class | Routes | Default Limit | Error Contract |
| --- | --- | ---: | --- |
| `quote` | `POST /quote` | 120 requests / 60 seconds | HTTP 429, `RATE_LIMITED`, `Retry-After` |
| `submit` | `POST /submit` | 60 requests / 60 seconds | HTTP 429, `RATE_LIMITED`, `Retry-After` |
| `status` | `GET /quote/:quoteId`, `GET /settlements/:settlementEventId`, `GET /hedges/:hedgeOrderId`, `GET /pnl` | 300 requests / 60 seconds | HTTP 429, `RATE_LIMITED`, `Retry-After` |
