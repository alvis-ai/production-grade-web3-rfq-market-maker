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
| `AUTHENTICATION_REQUIRED` | 401 | `x-api-key` 缺失、格式错误、摘要不匹配或已过期 | 使用有效且未过期的 `keyId.secret` 凭证重试 |
| `AUTHORIZATION_DENIED` | 403 | API key 缺少当前操作要求的 scope | 申请正确 scope，不要复用高权限运维 key |
| `UNSUPPORTED_CHAIN` | 400 | chainId 不在支持范围 | 切换网络 |
| `UNSUPPORTED_TOKEN` | 400 | token 不在 whitelist | 更换资产 |
| `AMOUNT_TOO_SMALL` | 400 | amount 小于系统最小交易量 | 提高交易数量 |
| `AMOUNT_TOO_LARGE` | 400 | amount 超过单笔最大交易量 | 降低交易数量 |
| `MARKET_DATA_UNAVAILABLE` | 503 | 市场数据不可用、过期、明显来自未来或快照字段无效 | 稍后重试 |
| `ROUTING_UNAVAILABLE` | 503 | Routing Engine 无法选择报价路径 | 稍后重试 |
| `PRICING_UNAVAILABLE` | 503 | Pricing Engine 无法生成报价 | 稍后重试 |
| `RISK_REJECTED` | 409 | 风控策略、活动 quote 累计敞口或 Treasury tokenOut 可用余额拒绝签名 | 降低数量或稍后重试 |
| `SIGNER_UNAVAILABLE` | 503 | Signer Service 不可用 | 稍后重试 |
| `INVALID_SIGNATURE` | 409 | quote signature 与后端签发归档不一致、无法恢复到 trusted signer，或不是链上可接受的 canonical low-s ECDSA 签名 | 重新询价并提交后端返回的签名 |
| `QUOTE_STORE_UNAVAILABLE` | 503 | quote repository 或持久化审计存储不可用 | 稍后重试，若已拿到 signed quote 则先查询 quote 状态 |
| `QUOTE_NOT_FOUND` | 404 | quoteId 不存在 | 重新询价 |
| `QUOTE_EXPIRED` | 409 | quote 已过期 | 重新询价 |
| `QUOTE_ALREADY_USED` | 409 | quote nonce 已使用 | 重新询价 |
| `QUOTE_FAILED` | 409 | quote 已进入失败终态，不能再次提交 | 重新询价 |
| `IDEMPOTENCY_KEY_CONFLICT` | 409 | 当前 principal 已用同一 `Idempotency-Key` 提交过不同的 quote payload | 为新的逻辑询价生成新 key；仅原请求的网络重试复用旧 key |
| `IDEMPOTENCY_REQUEST_IN_PROGRESS` | 409 | 同一 principal 的相同 quote 请求仍由另一个 API 副本处理 | 短暂退避后使用相同 key 和完全相同 payload 重试 |
| `QUOTE_PAUSED` | 503 | 全局或该 `chainId + token pair` 运维熔断已暂停创建新的 signed quote；已签发 quote 的查询、提交和结算链路不受该开关阻断 | 不要循环重试 `/quote`；读取对应控制状态并等待运维恢复后重新询价 |
| `QUOTE_CONTROL_CONFLICT` | 409 | 全局或 pair 管理更新使用的 `expectedVersion` 已过期，另一个操作员或副本已更新状态 | 重新读取同一全局或 pair 控制，复核状态后使用新 version 重试 |
| `QUOTE_CONTROL_UNAVAILABLE` | 503 | 共享 quote-control 存储不可读取或不可更新，系统无法证明报价开关处于 enabled | 保持 fail-closed，不绕过共享状态；恢复 PostgreSQL 后重新读取状态 |
| `TOXIC_FLOW_SCORE_CONFLICT` | 409 | analyzer 或操作员提交的 `expectedVersion` 已落后于同一 chain/user 的最新 score | 重新读取 score，复核新样本窗口后再基于最新 version 更新 |
| `TOXIC_FLOW_SCORE_UNAVAILABLE` | 503 | 动态 toxic-flow score 存储不可读取或不可更新 | 保持 fail-closed，不回退到进程内静态 score；恢复 PostgreSQL 后重试 |
| `HEDGE_NOT_FOUND` | 404 | hedgeOrderId 不存在或已不在当前执行存储中 | 查询 submit 响应返回的 hedgeOrderId，必要时重新提交 |
| `HEDGE_STORE_UNAVAILABLE` | 503 | hedge execution store 或 hedge intent 查询依赖不可用 | 稍后重试，必要时通过 submit 响应和执行日志核对 hedge 状态 |
| `SETTLEMENT_EVENT_NOT_FOUND` | 404 | settlementEventId 不存在或当前执行存储尚未消费该事件 | 查询 submit 响应返回的 settlementEventId，或等待索引器消费链上事件 |
| `SETTLEMENT_EVENT_STORE_UNAVAILABLE` | 503 | settlement event store 或索引器状态查询依赖不可用 | 稍后重试，必要时通过链上交易和日志索引核对 settlement 状态 |
| `PNL_STORE_UNAVAILABLE` | 503 | PnL store 或归因查询依赖不可用 | 稍后重试，必要时从 settlement event 和执行日志重建 PnL |
| `SETTLEMENT_UNAVAILABLE` | 503 | settlement verifier、链 RPC 或结算依赖不可用，尚未判定 quote 是否可结算 | 稍后重试同一 signed quote，过期后重新询价 |
| `SETTLEMENT_REVERTED` | 409 | settlement verification 或链上结算拒绝该 quote | 查看交易状态并重新询价 |
| `SUBMIT_RESERVATION_UNAVAILABLE` | 503 | quote 级提交租约存储不可用，无法排除其他 API 副本正在处理同一 quote | 不绕过租约；等待 PostgreSQL 恢复后重试同一 signed quote |
| `RATE_LIMITED` | 429 | 请求频率过高 | 降低请求频率 |
| `RATE_LIMIT_UNAVAILABLE` | 503 | 分布式限流存储不可用 | 不绕过限流，等待 Redis 恢复后重试 |
| `INTERNAL_ERROR` | 500 | 未分类内部错误 | 使用 traceId 联系维护者 |

## Design Rules

- 对外错误码保持稳定，不直接暴露内部 policy threshold。
- 所有错误响应必须包含 `traceId`，并且 `ErrorResponse` 是闭合 schema，只允许 `code`、`message` 和 `traceId` 三个字段。
- 风控拒绝应记录内部 `reasonCode` 和 `policyVersion`，但对外只返回通用说明。
- Treasury 余额不足使用内部 `TREASURY_LIQUIDITY_INSUFFICIENT`；RPC/合约读取异常使用 `RISK_ENGINE_UNAVAILABLE`。两者对外仍保持闭合的 `RISK_REJECTED`，不得暴露资金阈值或 custody 地址细节。
- Portfolio VaR 超限使用内部 `PORTFOLIO_VAR_LIMIT_EXCEEDED`；估值 snapshot、inventory 或 reservation 状态不可用则使用 `RISK_ENGINE_UNAVAILABLE`。公共响应不得暴露 VaR budget、position、volatility 或 snapshot 细节。
- Portfolio delta chain/token asset、portfolio gross 或 signed net hard limit 超限统一使用内部 `PORTFOLIO_DELTA_LIMIT_EXCEEDED`；任一层 soft limit 只产生审计证据和监控指标，不改变公共成功响应。公共响应不得暴露 delta limit、position 或 snapshot 细节。
- Gamma-like guardrail 在投影库存、USD 名义金额和波动率的分段组合乘数达到审核阈值时使用内部 `GAMMA_GUARDRAIL_TRIGGERED`；投影库存缺失或证据格式异常使用 `RISK_ENGINE_UNAVAILABLE`。公共响应不得暴露 utilization、bucket、regime、multiplier 或阈值。
- USD-reference token 的专用 token/USD feed 超过脱锚阈值时使用内部 `USD_REFERENCE_DEPEG`；feed 缺失、陈旧、超前、元数据不匹配、sequencer 异常或 RPC 不可用时使用 `RISK_ENGINE_UNAVAILABLE`。两者对外仍为 `RISK_REJECTED`，不得返回 oracle 地址、answer 或阈值。
- UTC 日内、按 chain/USD-reference token 隔离的已实现 hedge-net PnL 达到审核限额时使用内部 `DAILY_LOSS_LIMIT_EXCEEDED`；PostgreSQL 证据不可读或格式异常时使用 `RISK_ENGINE_UNAVAILABLE`。公共响应不得暴露当前亏损或限额数值。
- `RATE_LIMITED` 响应必须返回 HTTP 429，并带 `Retry-After` header。
- 依赖不可用使用 503，业务状态冲突使用 409。
- 框架级解析错误也必须映射为结构化 `ErrorResponse`，包括 malformed JSON、body too large 和 unsupported content type。
- 请求 validator 必须按 OpenAPI schema 校验 required fields、unknown fields 和 JSON primitive 类型，不能用 `Number()` 或 `String()` 把字符串数字、布尔值、数字形式的 uint 字段或 boxed `String` 直接调用输入隐式转换后继续处理。
- 所有 `PositiveUIntString` 字段必须使用 canonical decimal form：匹配 `^[1-9][0-9]*$`，不接受 `0`、负数、小数、科学计数法、十六进制或带前导零的字符串。
- CORS preflight origin 不在 `RFQ_CORS_ALLOWED_ORIGINS` 时返回结构化 `INVALID_REQUEST` 和 HTTP 403，且不返回 `access-control-allow-origin`。`RFQ_CORS_ALLOWED_ORIGINS` 只接受 HTTP(S) URL origin；path、query、fragment、credentials 和 wildcard 会在启动期被拒绝。
- 未匹配路由或不支持的方法必须返回结构化 `INVALID_REQUEST` 和 HTTP 404，不能返回 Fastify 默认错误对象。
- 非本地环境必须配置 `RFQ_API_KEY_CONFIG_JSON`。服务端只保存 `SHA-256(secret)`，使用常量时间摘要比较，并对 unknown key id 执行同样的摘要路径。认证失败统一返回 `AUTHENTICATION_REQUIRED`，不区分 key 是否存在、是否过期或 secret 是否错误。
- Scope 固定为 `quote:write`、`submit:write`、`status:read`、`pnl:read`、`admin:read` 和 `admin:write`；普通交易 key 不得拥有 admin scope，读写运维权限也应分离。`/health`、`/ready`、`/metrics` 以及 CORS preflight 不要求 API key。
- 资源所有权绑定稳定 `principalId` 而不是 `keyId`。同一机构轮换 key 后仍可访问；跨 principal 的 quote、settlement 和 hedge 查询统一返回对应 404，submit 按 principal 查找已签名报价，`/pnl` 只聚合当前 principal 的成交，避免 IDOR 和资源枚举。
- `/pnl` 的 `limit`、`cursor` 或未知 query 参数不符合闭集契约时返回 `INVALID_REQUEST`/400。Cursor 仅编码稳定快照与 keyset 位置，不能作为认证、授权或跨 principal 访问凭据；篡改后即使仍可解码，查询也必须重新应用当前 principal 条件。

## Rate Limit Policy

The gateway uses a 60 second rate limit window keyed by authenticated API key id whenever authentication is active, so clients behind one NAT do not consume each other's quota. Anonymous local development falls back to the direct client IP. `x-forwarded-for` is ignored unless `RFQ_TRUST_PROXY=true`; only enable that setting behind a trusted proxy or ingress that strips spoofed forwarding headers and writes the canonical client address. When proxy trust is enabled, forwarded client identities longer than 128 characters or outside `[A-Za-z0-9_.:-]` are rejected as `INVALID_REQUEST`/400 before rate-limit buckets are written. Local development uses process memory; every non-local `NODE_ENV` requires the Redis backend. A Lua script atomically reserves a bounded permit batch without crossing the fixed-window global limit; the process consumes that conservative lease from a bounded monotonic-TTL cache. A crash or cache eviction can waste unused permits but cannot reissue them, and `x-ratelimit-remaining` reports the conservative local lease remainder rather than an exact cross-replica value. Redis failure is fail-closed as `RATE_LIMIT_UNAVAILABLE`/503 and also degrades `/ready.components.rateLimitStore`.

Before settlement verification, `/submit` atomically acquires a quote-scoped reservation. PostgreSQL deployments share this lease across replicas; local development uses process memory. Active contention remains `QUOTE_ALREADY_USED`/409, while reservation persistence failures return `SUBMIT_RESERVATION_UNAVAILABLE`/503 and degrade `/ready.components.execution`. Release requires the same random owner token, and expired rows can only be replaced using PostgreSQL server time.

| Endpoint Class | Routes | Default Limit | Error Contract |
| --- | --- | ---: | --- |
| `quote` | `POST /quote` | 120 requests / 60 seconds | HTTP 429, `RATE_LIMITED`, `Retry-After` |
| `submit` | `POST /submit` | 60 requests / 60 seconds | HTTP 429, `RATE_LIMITED`, `Retry-After` |
| `status` | quote、settlement、hedge、PnL 状态查询及全局/pair quote-control 管理接口 | 300 requests / 60 seconds | HTTP 429, `RATE_LIMITED`, `Retry-After` |
