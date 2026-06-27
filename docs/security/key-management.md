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

1. Configure Signer Service with the new key and verify its address.
2. Deploy Signer Service config using the new key.
3. Stop issuing quotes from the old key.
4. Wait for old quotes to expire.
5. Call `RFQSettlement.setTrustedSigner(newSigner)`.
6. Archive audit logs for both keys.

## Incident Response

If signer compromise is suspected:

1. Pause settlement if blast radius is unclear.
2. Replace compromised signer with a clean signer using `RFQSettlement.setTrustedSigner`.
3. Stop Signer Service.
4. Invalidate in-flight quotes by waiting out TTL.
5. Reconcile settlement events and inventory.
6. Publish incident report and mitigation.
