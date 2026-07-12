# Chapter 05: Signer Service

## Abstract

Signer Service 是高安全边界服务。它只负责对经过 Risk Service 批准的 Quote 进行 EIP-712 签名，不负责定价、不负责风控、不接受任意 payload signing。Signer 的安全性直接影响 RFQSettlement 的资金安全。

## Learning Objectives

- 明确 Signer Service 的职责和禁止事项。
- 理解 KMS/HSM 和密钥轮换。
- 定义签名请求上下文。
- 设计 signer unavailable 和 signer compromise 的处理。

## Background

Signed quote 是链上结算授权。Signer 如果被滥用，攻击者可以构造恶意 quote。因此 signer 必须独立部署、最小权限、强审计。

## Problem Statement

如果普通业务服务直接持有私钥，任何业务漏洞都可能升级为资金事故。需要独立 Signer Service。

## Requirements

### Functional Requirements

- 接收 approved quote。
- 构造 EIP-712 typed data。
- 使用 KMS/HSM 或安全私钥签名。
- 返回 signature。
- 记录 signing audit log。

### Non-Functional Requirements

- 不接受任意消息签名。
- 只允许可信服务调用。
- 支持 key rotation。
- 签名失败必须可观测，且 quote API 必须返回稳定的 `SIGNER_UNAVAILABLE`。
- readiness 必须验证 signer 具备签名和验签能力，失败时 `/ready` 返回 degraded，避免不可签名实例继续接收 quote 流量。

## Existing Solutions

本地私钥适合开发，不适合生产。当前后端为开发环境提供 `LocalEIP712SignerService`，为生产独立进程提供 AWS KMS `ECC_SECG_P256K1` signer，并允许通过 `external` mode 注入其他 HSM 实现。代码库不保留 placeholder signer 或 deterministic fake signature 实现；生产部署不会把 Ethereum private key 挂载进 API Pod。

## Trade-Off Analysis

KMS 增加集成复杂度和延迟，但显著降低密钥泄露风险。生产系统必须接受该成本。

## System Design

```mermaid
flowchart LR
  Quote[Approved Quote]
  Policy[Signing Policy]
  Signer[Signer Service]
  KMS[KMS or HSM]
  Audit[Audit Log]
  Signature[Signature]

  Quote --> Policy
  Policy --> Signer
  Signer --> KMS
  KMS --> Signature
  Signer --> Audit
```

## Architecture Diagram

Signer Service 不暴露公网，只接受 Quote Service 或 Risk-approved internal request。

## Sequence Diagram

```mermaid
sequenceDiagram
  autonumber
  participant Q as Quote Service
  participant S as Signer Service
  participant K as KMS
  participant A as Audit Store

  Q->>S: signQuote(approved quote context)
  S->>S: validate signing policy
  S->>K: sign digest
  K-->>S: signature
  S->>A: write audit log
  S-->>Q: signature
```

## State Machine

```mermaid
stateDiagram-v2
  [*] --> RequestReceived
  RequestReceived --> PolicyChecked
  PolicyChecked --> Signed
  PolicyChecked --> Rejected
  Signed --> Audited
  Audited --> Returned
```

## Data Model

`SigningRequest` includes quote, quoteId, snapshotId, riskDecisionId, policyVersion, traceId. `SigningAudit` records signer address, digest, timestamp and result.

## API Design

Internal interface:

```ts
signQuote(input: SignQuoteInput): Promise<`0x${string}`>
```

## Engineering Decisions

- Signer 不做风险判断。
- Signer 验证 approved context。
- 本地开发使用 `RFQ_SIGNER_MODE=local`、`RFQ_SIGNER_PRIVATE_KEY` 和 `RFQ_SETTLEMENT_ADDRESS`。默认 Anvil key 只允许用于 unset `NODE_ENV`、`development` 或 `test`；任何非本地环境都拒绝 local mode 和原始私钥。
- 独立生产进程使用 `RFQ_SIGNER_MODE=aws-kms`。启动必须同时获得 `RFQ_AWS_KMS_KEY_ID`、`RFQ_AWS_KMS_REGION`、`RFQ_TRUSTED_SIGNER_ADDRESS` 和 `RFQ_SETTLEMENT_ADDRESS`；通过 `buildServer` 注入其他 HSM 实现时使用 `external` mode，并仍显式声明 trusted signer 与 verifying contract。
- `AwsKmsSignerProvider` 固定调用 `Sign` 的 `MessageType=DIGEST` 与 `SigningAlgorithm=ECDSA_SHA_256`，只发送本地计算的 32-byte EIP-712 digest。AWS SDK credential chain 使用 workload identity；API Pod 不挂载 AWS access key 或 Ethereum private key。
- `KmsSignerService` 对 DER sequence、short-form length、INTEGER tag、unsigned canonical padding、secp256k1 order 和 trailing bytes 做严格校验。KMS 返回 high-s 时转换为 low-s，再尝试 recovery id 27/28；只有恢复地址唯一匹配显式 `RFQ_TRUSTED_SIGNER_ADDRESS` 才返回签名，不允许从首个 KMS 响应自举信任地址。
- 当前后端使用 `ObservedSignerService` 包装 signer，记录 `rfq_signer_requests_total`、`rfq_signer_errors_total` 和 `rfq_signer_latency_seconds`，固定 `operation` label 为 `sign` 或 `verify`。
- `ObservedSignerService` validates inner signer and metrics dependency methods at construction. Missing `inner.signQuote`, `inner.verifyQuoteSignature`, `metricsService.recordSignerRequest`, `metricsService.recordSignerError` or `metricsService.recordSignerLatency` must fail before quote signing starts.
- `ObservedSignerService` rejects malformed dependency envelopes as non-array objects before reading signer or metrics methods, so a signer wrapper cannot start with array-shaped dependencies that later misclassify signer availability.
- `ObservedSignerService` validates inner signer results before returning them to Quote Service. `signQuote()` must return a canonical 65-byte low-s signature with normalized `v` accepted by `RFQSettlement`, and `verifyQuoteSignature()` must return a runtime boolean; malformed signer adapter output is mapped to `SIGNER_UNAVAILABLE` and records the corresponding signer error metric.
- `/ready` 使用固定 probe quote 执行 signer sign + verify 检查；探针签名不返回给用户，也不改变 quote repository 状态。
- Local signer validates malformed config, signing request and quote objects before field access, then requires local signer config fields, signing request fields and signed quote fields to be own fields before validating private key, settlement address, `quoteId` and `snapshotId` as primitive-string `SafeIdentifier` values with 1-128 characters matching `[A-Za-z0-9_:-]`, plus signed quote shape before producing any EIP-712 signature. Signed quote amount fields and nonce must be real strings in canonical decimal form without leading zeros, so the signer cannot create an EIP-712 artifact from a value encoding that `/quote`, routing, pricing, risk or settlement would reject. Direct signer callers cannot pass inherited object properties or boxed `String` wrappers and rely on JavaScript regex coercion before EIP-712 signing. Malformed verification inputs, including inherited quote fields, return `false` instead of leaking lower-level signing-library errors.
- Local signer verification rejects high-s ECDSA signatures and invalid `v` values before address recovery, matching `RFQSettlement` canonical signature rules so `/submit` cannot accept a signature that chain settlement would reject.
- Production code does not ship a placeholder signer; tests that need signer behavior inject a local cryptographic signer while retaining the same explicit signer identity boundary.
- `LocalEIP712SignerService` snapshots `LocalEIP712SignerConfig` at construction after validation. External callers must not be able to mutate the settlement address after construction and silently change the EIP-712 verifying contract.
- Production signer 使用 KMS/HSM，并保持同一 `signQuote` 接口；默认 AWS 实现关闭时会释放其 SDK client。
- Key rotation 写入 runbook。

## Failure Scenarios

- KMS unavailable：return `SIGNER_UNAVAILABLE`，记录 `rfq_signer_errors_total{operation="sign"}`。
- failed quote persistence unavailable after signer error：仍保留 `SIGNER_UNAVAILABLE` 作为 primary API error，避免状态存储故障掩盖 signer outage。
- signer readiness probe failed：`/ready` returns degraded before the instance is considered routable。
- configured KMS key 与 `RFQ_TRUSTED_SIGNER_ADDRESS` 不匹配：reject signing and fail readiness。
- malformed DER、non-canonical integer、out-of-range r/s 或 unexpected algorithm：return `SIGNER_UNAVAILABLE`，不尝试宽松解析。
- policy mismatch：reject signing。
- audit write failed：do not return signature。
- key compromise：pause settlement and rotate key。

## Security Considerations

Signer 是最高风险服务。需要网络隔离、服务身份、审计、限额和 emergency disable。

## Performance Considerations

KMS latency 进入 quote p99，需要监控 signer latency、signer error rate 和 queue depth。当前 reference implementation 已暴露 signer latency histogram，可用于 signer p95 alert。

## Testing Strategy

测试 typed data、wrong domain、wrong verifying contract、policy mismatch、KMS failure、错误 KMS key、high-s normalization、malformed DER corpus、AWS request parameters、readiness signer degraded、audit failure 和 rotation process。

## Interview Notes

Signer Service 的正确答案不是“后端用私钥签名”，而是“隔离签名能力并只签 approved quote”。

## Summary

Signer Service 把风险决策变成链上可验证授权，是 RFQ 系统的最高安全边界之一。

## References

- [EIP-712](https://eips.ethereum.org/EIPS/eip-712)
- [AWS KMS Sign](https://docs.aws.amazon.com/kms/latest/APIReference/API_Sign.html)
- [AWS KMS key specs](https://docs.aws.amazon.com/kms/latest/developerguide/symm-asymm-choose-key-spec.html)
- Key rotation
