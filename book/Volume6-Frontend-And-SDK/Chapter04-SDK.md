# Chapter 04: SDK

## Abstract

TypeScript SDK 是集成方使用 RFQ 系统的稳定接口。它封装 API client、类型定义、EIP-712 typed data helper 和 submit helper。SDK 的目标是减少字段不一致、签名结构错误和 amount 精度问题。

## Learning Objectives

- 定义 SDK 的模块边界。
- 说明 SDK 与 OpenAPI、合约和后端类型的关系。
- 设计 EIP-712 helper。
- 明确 SDK 不应隐藏的错误。

## Background

集成方如果直接拼 HTTP 和 EIP-712 typed data，很容易在字段顺序、chainId、amount 字符串和 verifyingContract 上出错。SDK 提供统一实现。

## Problem Statement

RFQ quote 的字段必须在后端、SDK、前端和合约之间一致。没有 SDK 时，每个集成方都会重复实现高风险逻辑。

## Requirements

### Functional Requirements

- 导出 `QuoteRequest`、`Quote`、`QuoteResponse` 类型。
- 提供 `RFQClient.quote()`。
- 提供 `buildRFQDomain()`。
- 提供 `buildQuoteTypedData()`。
- 提供 `buildSubmitQuoteArgs()` 和 `buildSubmitQuoteWriteRequest()`。

### Non-Functional Requirements

- amount 字段使用 string。
- 类型与 OpenAPI 保持一致。
- EIP-712 types 与合约字段一致。
- SDK 不吞掉 API error code。
- HTTP connection、response streaming 和 decode 必须共享一个有界截止时间。
- JSON 与 metrics body 必须在 decode 前执行流式字节上限。

## Existing Solutions

很多项目只提供 REST API，集成方自行实现 typed data。生产 RFQ 应提供 SDK 降低集成错误。

## Trade-Off Analysis

SDK 增加维护成本，但能显著提升集成可靠性。字段变更必须同步发布 SDK 版本。

## System Design

```mermaid
flowchart LR
  Types[types.ts]
  Client[client.ts]
  Transport[client-transport.ts]
  EIP712[eip712.ts]
  App[Frontend or Integrator]
  API[RFQ API]
  Contract[RFQSettlement]

  App --> Client
  Client --> Transport
  Transport --> API
  App --> EIP712
  EIP712 --> Contract
  Types --> Client
  Types --> EIP712
```

## Architecture Diagram

SDK 是跨 frontend 和 external integrator 的共享包。它不包含私钥签名能力，只构造 typed data 和 API 请求。

## Sequence Diagram

```mermaid
sequenceDiagram
  autonumber
  participant App
  participant SDK
  participant API
  participant Contract

  App->>SDK: quote(request)
  SDK->>API: POST /quote
  API-->>SDK: QuoteResponse
  App->>SDK: buildQuoteTypedData
  SDK-->>App: typed data for wallet or verification
  App->>Contract: submitQuote
```

## State Machine

```mermaid
stateDiagram-v2
  [*] --> RequestBuilt
  RequestBuilt --> QuoteFetched
  QuoteFetched --> TypedDataBuilt
  TypedDataBuilt --> ReadyToSubmit
  RequestBuilt --> APIError
```

## Data Model

SDK types include `Address = 0x${string}` and `UIntString = string`。Quote mirrors Solidity struct fields.

## API Design

Public SDK interface:

```ts
const client = new RFQClient(baseUrl);
const clientWithCustomFetch = new RFQClient(baseUrl, { fetch: customFetch });
const clientWithTransportBudget = new RFQClient(baseUrl, {
  requestTimeoutMs: 15_000,
  maxResponseBytes: 8 * 1_024 * 1_024,
});
const quote = await client.quote(request);
const typedData = buildQuoteTypedData(quoteLikeStruct, verifyingContract);
const submitArgs = buildSubmitQuoteArgs(quoteLikeStruct, signature);
const submitRequest = buildSubmitQuoteWriteRequest({
  settlementAddress,
  quote: quoteLikeStruct,
  signature,
});
const allowanceRequest = buildErc20AllowanceReadRequest({ token, owner, spender: settlementAddress });
const approvalRequest = buildErc20ApprovalWriteRequest({ token, spender: settlementAddress, amount });
const treasuryArgs = buildTreasuryTransferArgs({ token, to, amount });
const firstPnlPage = await client.pnl({ limit: 50 });
const nextPnlPage = firstPnlPage.page.nextCursor
  ? await client.pnl({ limit: firstPnlPage.page.limit, cursor: firstPnlPage.page.nextCursor })
  : undefined;
```

`PnlSummary.totalTrades`、`totals` 和 `hedgeNet` counters/totals 表示同一 `page.asOf` 创建时间上限内的机构全局汇总；`trades` 与 `hedgeNet.records` 只表示当前页，按 `realizedAt DESC, pnlId DESC` 一一对齐。`asOf` 排除后续插入与回填，但 reorg 删除会立即修正结果。SDK 将 cursor 当作 opaque string，不从中推导授权或业务状态；服务端仍以 API key 对应的 principal 过滤所有查询。

## Engineering Decisions

- `client.ts` remains the endpoint orchestration boundary: it owns endpoint selection, headers and response-specific sequencing, while delegating transport and protocol validation. `client-transport.ts` owns fetch、AbortController、完整响应 deadline、流式 byte cap 与取消；`client-request.ts` owns construction, credentials, request envelopes and path identifiers; `client-trading-responses.ts` owns quote, submit, lifecycle, hedge and settlement payloads; `client-accounting-responses.ts` owns gross and hedge-net PnL consistency; `client-pnl-page.ts` owns bounded page metadata and newest-first ordering; `client-response-validation.ts` owns closed response fields, primitive guards, trace correlation, health/readiness and API errors. `client-error.ts` keeps the public error contract independent of those concerns.
- `make sdk-composition-check` enforces bounded module sizes and verifies that response and request validators do not migrate back into the HTTP client. Public imports continue through `client.ts` and `index.ts`, so the refactor does not change consumer APIs.
- SDK uses string amounts.
- SDK owns EIP-712 helper.
- SDK exports `erc20Abi`, `rfqSettlementAbi`, `treasuryAbi`, `buildErc20AllowanceReadRequest`, `buildErc20ApprovalWriteRequest`, `buildSubmitQuoteArgs`, `buildSubmitQuoteWriteRequest`, `hashSettlementQuote` and `buildTreasuryTransferArgs` so viem/wagmi consumers use the same allowance, approval, settlement tuple, quote-hash reconciliation, public state, role and custom-error surface as the repository tests.
- ERC-20 helpers validate closed own token/owner/spender/amount fields and return typed `allowance` or `approve` requests. Policy remains with the caller: the frontend uses an exact quote amount and handles non-zero-to-non-zero compatibility through a confirmed reset transaction.
- `buildSubmitQuoteWriteRequest()` returns `{ address, abi, functionName: "submitQuote", args }` after validating the settlement contract address, quote fields and signature, which keeps frontend and external integrators from manually duplicating contract-call wiring. The write request input, treasury transfer input and quote payloads must provide closed required own fields before SDK helpers build calldata, typed data or quote hashes.
- `buildSubmitQuoteArgs()` rejects non-canonical high-s ECDSA signatures and invalid `v` values before returning contract call arguments, matching backend and `RFQSettlement` signature rules.
- SDK helper functions reject non-object, inherited-field and unknown-field quote / write-request / treasury-transfer inputs before field-level validation, so JavaScript consumers get stable validation errors instead of ambiguous property access exceptions.
- SDK status helpers reject unsafe `quoteId`, `hedgeOrderId` and `settlementEventId` values before issuing HTTP requests: identifiers must be non-empty, 128 characters or fewer, and limited to letters, numbers, underscore, colon and hyphen. This prevents malformed `/quote/`, `/hedges/` or `/settlements/` calls from being mistaken for backend availability problems.
- SDK successful response validators require closed own response fields before type validation, and apply the same safe identifier rule to public status pointers such as `quoteId`, `snapshotId`, `settlementEventId`, `hedgeOrderId` and `pnlId`, so malformed gateway, custom fetch or proxy payloads cannot be accepted as usable resource links.
- `RFQClient` rejects non-string, empty, relative or non-`http(s)` base URLs at construction time, and also rejects credentials, wildcard hosts, query strings and fragments while preserving safe path prefixes such as `/rfq`. Integration configuration errors fail before any quote, submit or status request leaves the process. JavaScript callers must receive stable `RFQClientError` failures instead of native `.trim()` exceptions.
- `RFQClient` can receive an injected `fetch` implementation and validates that dependency at construction time, so server-side runtimes, tests and constrained execution environments do not rely on an implicit global transport. Client options are closed to own optional `fetch` / `traceId` / `apiKey` / `requestTimeoutMs` / `maxResponseBytes` fields; unknown or prototype-backed options fail before transport, trace or credential dependencies are captured. Custom fetch implementations must accept and honor the supplied `AbortSignal` so timeout rejection also releases their own socket or stream resources.
- `requestTimeoutMs` defaults to 15000 and accepts only safe integers from 100 through 120000. The timer begins before fetch and remains active through status handling、body streaming、UTF-8 decode and JSON parse; headers alone never complete the operation. The byte cap then bounds the input consumed by synchronous schema validation. Timeout aborts the shared signal and returns a stable status-0 `RFQClientError` without exposing native transport details. Node clients keep this deadline referenced, so a connection-only script cannot exit before receiving its timeout result.
- `maxResponseBytes` defaults to 8 MiB and accepts only safe integers from 1 KiB through 16 MiB. JSON success/error bodies and text metrics responses use the same streaming reader. Canonical `Content-Length` above the limit is canceled before application parsing; missing or understated length still cannot bypass the accumulated byte counter. Oversized、invalid-length、invalid UTF-8 and interrupted bodies are canceled, and JSON is parsed only after the bounded stream completes. `client.ts` and response validators do not call `response.json()` or `response.text()` directly.
- `RFQClient` can receive a static or dynamic `traceId` option and sends it as `x-trace-id` on every request after validating the runtime value is a primitive string in the same `tr_`-prefixed, 128-character bounded format accepted by the backend gateway. Inherited `traceId` options fail before dependency capture. Boxed `String` trace ids fail before header construction.
- `apiKey` accepts either a static `keyId.secret` credential or a provider function for zero-downtime rotation. The SDK validates each dynamic value immediately before a protected request and deliberately omits credentials from `/health`, `/ready` and `/metrics`; browser applications must obtain access through a trusted BFF or session boundary instead of embedding institutional keys in `VITE_*` variables.
- `RFQClient.getQuote()`, `getHedge()` and `getSettlement()` reject dynamic path identifiers unless the runtime value is a primitive string, non-empty, 128 characters or fewer, and limited to letters, numbers, underscore, colon or hyphen; boxed `String` identifiers fail before `encodeURIComponent()` or fetch.
- `RFQClientError` preserves request correlation even when an upstream response is non-standard: structured RFQ errors must be closed own-field `ErrorResponse` objects containing only `code`, `message` and `traceId`, then keep safe `ErrorResponse.traceId` values. The client falls back to safe `x-trace-id` response headers for unknown error bodies, non-closed or prototype-pollution-shaped error bodies, malformed JSON or malformed successful response fields. Unsafe response trace ids that do not match `tr_[A-Za-z0-9._:-]+` or exceed 128 characters are ignored instead of being exposed to SDK callers.
- `RFQClientError.retryAfterSeconds` is populated only from canonical positive decimal `Retry-After` delay-seconds values that fit in a JavaScript safe integer; zero, leading-zero, decimal, exponent, HTTP-date and oversized values are ignored.
- `RFQClient.quote()` validates outgoing quote requests locally, including closed request fields, chain id, addresses, distinct token pair, canonical positive amount string without leading zeros and slippage bounds, before sending HTTP.
- `RFQClient.quote()` validates successful quote payloads field by field, including safe `quoteId`/`snapshotId`, canonical positive uint `amountOut`/`minAmountOut`/`nonce` strings without leading zeros, `amountOut >= minAmountOut`, positive `deadline`, and canonical low-s EIP-712 signature.
- SDK successful response validators require integer fields such as `deadline`, `chainId`, `blockNumber`, `logIndex`, `totalTrades` and `grossPnlBps` to be JSON number primitives in the JavaScript safe integer range. Stringified numbers and wrapper objects are rejected instead of being coerced with `Number(...)`.
- `RFQClient.submit()` validates outgoing submit payloads locally with closed top-level own `quote` / `signature` fields and the same settlement helper used for contract calls, so unknown submit fields, inherited or missing required fields, malformed quote fields or non-canonical signatures fail before an HTTP request is sent.
- SDK EIP-712 and settlement helpers reject non-string address, signature and uint-like values before regex validation. JavaScript callers cannot pass numbers or `String` wrapper objects and rely on implicit `RegExp.test()` coercion before signing or building contract calldata.
- `RFQClient.submit()` validates successful submit payloads field by field, including `accepted` status, optional 32-byte `txHash`, and safe settlement/hedge/PnL pointers when present.
- `RFQClient.getQuote()` validates successful quote status payloads field by field, including required `quoteId`/`status`, optional safe `snapshotId`, positive `deadline`, 32-byte `txHash`, safe settlement/hedge/PnL pointers, non-empty error pointers, and lifecycle payload consistency between status and settlement pointers.
- `RFQClient.getSettlement()` validates successful settlement payloads field by field, including event/quote identifiers, positive chain id, 32-byte transaction and quote hashes, non-negative block/log ordinals, user/token addresses, distinct token pair, positive amount strings, and canonical UTC ISO `observedAt` timestamp generated with `Date.prototype.toISOString()`.
- `RFQClient.getHedge()` validates successful hedge payloads field by field, including safe identifiers, positive chain id, token address, side/reason enums, positive uint amount/optional filledAmount strings, stable optional failureCode, and canonical UTC ISO timestamps generated with `Date.prototype.toISOString()`.
- `RFQClient.pnl()` validates successful PnL payloads field by field, including settlement/snapshot safe identifiers、token addresses、positive uint amount strings、canonical signed gross PnL strings without leading zeros or negative zero、token decimals、quote-time mid price and canonical UTC timestamps. It independently recomputes `fairAmountOut`、`grossPnlTokenOut` and `grossPnlBps`, requires the exact `quote_snapshot_edge_v1` boundary, and verifies every `(chainId, tokenOut)` total. The nested `hedgeNet` contract requires exactly one `pending`、`complete` or `unavailable` record per gross trade; status-specific fields are closed, third-asset fee reasons carry a unique sorted asset list, and completed `(chainId, valuationToken, valuationAsset)` decimal totals are independently recomputed rather than summing unrelated assets or treating unavailable rows as zero.
- `RFQClient.health()` and `RFQClient.ready()` require closed own top-level response fields matching OpenAPI. `ready()` also validates readiness payloads against the fixed backend component set: marketData, marketSnapshotStore, routing, pricing, risk, signer, quoteRepository, riskDecisionStore, inventory, execution, settlementEventStore, pnl and metrics. Missing or unknown readiness components are rejected instead of being treated as valid routability state.
- SDK exposes API errors instead of flattening everything to generic Error in production.

## Failure Scenarios

- API returns risk rejected：throw typed RFQ error。
- Invalid address：client-side validation error。
- Network failure：return a generic status-0 transport error without leaking the underlying URL、credential or proxy detail。
- API、BFF 或 proxy 只返回 headers 后停滞：shared deadline aborts the request and body reader。
- Response body exceeds the configured byte budget：cancel before full buffering or JSON decode and return `RFQClientError`。
- EIP-712 domain mismatch：consumer must provide correct verifyingContract。

## Security Considerations

SDK should not sign with private keys. Wallet or backend Signer is responsible for signing depending on flow. API、BFF 和 injected transport 都属于不可信响应边界；调用方不能依赖 `Content-Length` 作为唯一大小证明，也不能把 native network error 原文直接展示给用户。

## Performance Considerations

SDK should stay lightweight. It should not bundle frontend-only wallet libraries unless submit helper needs optional adapters. Streaming limits bound response memory before decode; consumers should keep the default 8 MiB budget unless an API response contract has a reviewed larger bound。

## Testing Strategy

测试 client quote request、API error parsing、typed data structure、domain builder、settlement tuple conversion、submit write request builder、Treasury tuple conversion、quote/submit/quote status/settlement/hedge/PnL response validation、PnL cursor/limit request validation 和 amount string handling。PnL 测试还要证明全局计数不小于页内计数、页内 trade/hedge identity 与顺序一致、`hasMore` 与 `nextCursor` 同步，以及单页覆盖全部记录时 totals 可由明细精确重算。Transport 故障注入还必须覆盖 connection stall、headers 后 body stall、AbortSignal、超大 JSON/text stream cancellation、声明超限的 `Content-Length`、配置上下界和底层错误脱敏。

## Interview Notes

SDK 的价值是统一协议边界，尤其是 EIP-712 和 amount 精度。

## Summary

SDK 将 RFQ 系统变成可集成产品，而不是只服务自家前端。它必须严格对齐 OpenAPI 和合约。

## References

- TypeScript SDK design
- EIP-712 typed data
- Viem
