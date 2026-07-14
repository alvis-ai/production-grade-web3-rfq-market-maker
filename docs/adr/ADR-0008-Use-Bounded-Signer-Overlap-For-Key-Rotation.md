# ADR-0008: Use Bounded Signer Overlap For Key Rotation

## Status

Accepted

## Context

An RFQ quote remains executable until its signed deadline. Replacing one trusted signer address atomically invalidates every unexpired quote from the old signer, while changing backend replicas one at a time creates a mixed fleet in which old replicas reject new signatures and new replicas reject old signatures. Stopping quote issuance for the full TTL avoids that inconsistency but creates planned downtime and encourages operators to shorten or skip safety checks.

Signer overlap must remain explicit and bounded. An unbounded allowlist increases the impact of forgotten keys, and a mutable configuration array must not be able to change verifier trust after startup. The contract and backend also need compatible limits and an auditable retirement operation.

## Decision

`RFQSettlement` maintains an authorized signer mapping with one operational `trustedSigner` primary, a count, and `MAX_TRUSTED_SIGNERS = 5` as a hard maximum. `setTrustedSigner(newSigner)` authorizes the new signer and makes it primary without revoking the previous signer. `setTrustedSignerAuthorization(signer, false)` explicitly retires a non-primary signer; the contract rejects removal of the primary or final signer and emits `TrustedSignerAuthorizationUpdated` for every real membership change.

The backend signs only with `RFQ_TRUSTED_SIGNER_ADDRESS`, but `LocalSettlementVerifier` accepts that address plus at most four distinct non-zero addresses from `RFQ_TRUSTED_SIGNER_OVERLAP_ADDRESSES`. Runtime parsing rejects malformed, duplicate, empty, whitespace-padded, or oversized lists, and the verifier snapshots the validated policy at construction.

Rotation uses two backend rollouts. First, while the old key still signs, every replica is configured to verify both old and new signers. Second, signing moves to the new key while both remain accepted. The old signer is retired only after the last old quote's TTL, receipt-confirmation allowance, and indexer catch-up buffer have elapsed.

## Consequences

### Positive

- Old and new quotes remain verifiable throughout a rolling KMS rotation.
- The chain and backend share the same maximum trust-set size of five signers.
- Explicit authorization events and retirement transactions provide an auditable key lifecycle.
- Primary-signer and last-signer guards prevent accidental loss of all settlement capability.

### Negative

- During the bounded overlap window, compromise of either authorized key can produce executable quotes.
- Rotation requires two coordinated backend rollouts and on-chain administration.
- `setTrustedSigner` no longer revokes the old signer automatically, so an incomplete runbook leaves excess authority active.

### Mitigation

Keep quote TTL short, restrict `SIGNER_ADMIN_ROLE` to reviewed multisig operations, alert on signer-set changes, record the last old-key signing time, and require post-rotation reconciliation before retirement. Incident response skips the normal waiting period: pause settlement, authorize a clean signer, revoke the compromised non-primary signer immediately, and reconcile all affected quotes.

## Alternatives Considered

- Atomic single-address replacement: simple, but invalidates old unexpired quotes and breaks rolling deployments.
- Stop issuing quotes for one full TTL before rotation: preserves correctness but imposes planned downtime and still requires careful replica ordering.
- Unbounded signer allowlist: flexible, but makes stale authorization accumulation harder to detect and bound.
- Accept every signer returned by KMS or discover trust from signatures: removes explicit configuration but allows the signing provider to redefine the trust root.
