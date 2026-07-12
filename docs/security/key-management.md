# Key Management

Signer key management is a critical security domain for RFQ systems. A trusted signer can authorize settlement, so signer capability must be isolated from normal business logic.

## Principles

- The signer must only sign typed RFQ quotes.
- The signer must only sign quotes approved by Risk Engine.
- Quote audit records must retain quoteId, snapshotId and riskPolicyVersion, while request logs retain traceId. AWS KMS receives only the EIP-712 Quote digest that the settlement contract can verify.
- Production API processes and Kubernetes Secrets must not contain the Ethereum private key.
- `.env.example` contains a public Anvil development key only; it must never be reused outside local development.
- Key rotation must be possible without redeploying all services.

## Recommended Production Model

```mermaid
flowchart LR
  QuoteService --> RiskEngine
  RiskEngine --> SigningPolicy
  SigningPolicy --> SignerRuntime
  SignerRuntime --> KMS[AWS KMS ECC_SECG_P256K1]
  KMS --> SignerRuntime
```

## Controls

- `RFQ_SIGNER_MODE=aws-kms` for standalone non-local runtime; local private-key mode is rejected.
- Workload identity with `kms:Sign` restricted to one asymmetric signing key; no static AWS credentials.
- Explicit `RFQ_TRUSTED_SIGNER_ADDRESS` independent from KMS output.
- Strict DER parsing, low-s normalization and address recovery before returning a signature.
- Per-token and per-chain notional limits.
- Audit logs for every signing request and response.
- Emergency signer removal from `RFQSettlement`.

## Rotation Procedure

1. Open a change record with the current signer address, proposed signer address, affected chains and rollback owner.
2. Configure Signer Service with the new key in staging and verify that the derived address matches the planned `newSigner`.
3. Run a canary through the normal quote path, verify its `quoteId`, `snapshotId`, `riskPolicyVersion` audit record and trace log, then verify the EIP-712 digest against the SDK and contract domain.
4. Stop issuing new quotes from the old signer by failing closed at the Signer Service or routing layer.
5. Wait for old quotes to expire. Wait at least `RFQ_QUOTE_TTL_SECONDS` plus clock-skew buffer so all old signed quotes are no longer executable.
6. Call `RFQSettlement.setTrustedSigner(newSigner)` through an account with `SIGNER_ADMIN_ROLE` and record the transaction hash.
7. Run a post-rotation quote canary with the new signer and a negative canary using the old signer, confirming the old signature is rejected.
8. Archive signer audit logs for both keys, including the change record, KMS key id, operator identity and contract transaction hash.
9. Keep the old key disabled but recoverable until the incident or maintenance window is closed; destroy it only after audit sign-off.

The runtime uses AWS KMS `MessageType=DIGEST` with `ECDSA_SHA_256`; the key spec must be `ECC_SECG_P256K1` and key usage must be `SIGN_VERIFY`. Rotation changes both the KMS key id and `RFQ_TRUSTED_SIGNER_ADDRESS`, but they must not be rolled out until the corresponding `RFQSettlement` trusted signer transition is confirmed.

## Incident Response

If signer compromise is suspected:

1. Pause settlement if blast radius is unclear.
2. Replace compromised signer with a clean signer using `RFQSettlement.setTrustedSigner` from a `SIGNER_ADMIN_ROLE` account.
3. Stop Signer Service.
4. Invalidate in-flight quotes by waiting out TTL.
5. Reconcile settlement events and inventory.
6. Publish incident report and mitigation.
