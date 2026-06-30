# Key Management

Signer key management is a critical security domain for RFQ systems. A trusted signer can authorize settlement, so signer capability must be isolated from normal business logic.

## Principles

- The signer must only sign typed RFQ quotes.
- The signer must only sign quotes approved by Risk Engine.
- Signing requests must include quoteId, snapshotId, riskPolicyVersion and traceId.
- Private keys must not be stored in application source code or `.env` committed to git.
- `.env.example` contains a public Anvil development key only; it must never be reused outside local development.
- Key rotation must be possible without redeploying all services.

## Recommended Production Model

```mermaid
flowchart LR
  QuoteService --> RiskEngine
  RiskEngine --> SigningPolicy
  SigningPolicy --> SignerService
  SignerService --> KMS[KMS / HSM]
  KMS --> SignerService
```

## Controls

- KMS/HSM key with restricted signing policy.
- Network isolation for Signer Service.
- mTLS or service identity between Quote Service and Signer Service.
- Per-token and per-chain notional limits.
- Audit logs for every signing request and response.
- Emergency signer removal from `RFQSettlement`.

## Rotation Procedure

1. Open a change record with the current signer address, proposed signer address, affected chains and rollback owner.
2. Configure Signer Service with the new key in staging and verify that the derived address matches the planned `newSigner`.
3. Run a canary signing check that includes `quoteId`, `snapshotId`, `riskPolicyVersion` and traceId, then verify the EIP-712 digest against the SDK and contract domain.
4. Stop issuing new quotes from the old signer by failing closed at the Signer Service or routing layer.
5. Wait for old quotes to expire. Wait at least `RFQ_QUOTE_TTL_SECONDS` plus clock-skew buffer so all old signed quotes are no longer executable.
6. Call `RFQSettlement.setTrustedSigner(newSigner)` through the owner-controlled admin path and record the transaction hash.
7. Run a post-rotation quote canary with the new signer and a negative canary using the old signer, confirming the old signature is rejected.
8. Archive signer audit logs for both keys, including the change record, KMS/HSM key version, operator identity and contract transaction hash.
9. Keep the old key disabled but recoverable until the incident or maintenance window is closed; destroy it only after audit sign-off.

## Incident Response

If signer compromise is suspected:

1. Pause settlement if blast radius is unclear.
2. Replace compromised signer with a clean signer using `RFQSettlement.setTrustedSigner`.
3. Stop Signer Service.
4. Invalidate in-flight quotes by waiting out TTL.
5. Reconcile settlement events and inventory.
6. Publish incident report and mitigation.
