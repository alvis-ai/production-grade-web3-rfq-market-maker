# ADR-0030: Fuse Signer Audit And Quote Finalization

## Status

Accepted

## Context

The zero-error concurrency-one dependency-stack baseline reached p50 13.37 ms and p99 31.71 ms. The isolated signer spent about 1.94 ms on durable audit admission while the gateway later paid another Redis round trip to finalize the same quote, complete idempotency, index the nonce and append the issuance event. The Redis Lua CPU time was tens of microseconds; process scheduling and serialized network boundaries dominated.

Removing either durability boundary would be incorrect. A returned signature must have durable signer evidence, and a quote must not be executable while idempotency, nonce and issuance state remain ambiguous. A quote-id-only risk decision is also insufficient for an independent signer because a compromised gateway could reuse the approved id with different output, deadline or pricing fields.

## Decision

When `RFQ_SIGNER_ATOMIC_QUOTE_COMMIT=true`, the Redis issuance authorization stores a deterministic SHA-256 commitment over the exact unsigned EIP-712 quote, quote/snapshot identity, principal, pricing decomposition, policy version and optional idempotency reservation. The isolated signer reads this hot state and verifies the complete commitment before invoking KMS/HSM. The API bearer token and signer envelope limits remain additional controls; neither substitutes for persisted authorization.

After signing and local identity verification, one Redis Lua transaction performs all successful terminal mutations:

1. Revalidates the ledger epoch, approved decision and exact signing-authorization commitment.
2. Writes the finalized signed quote and response.
3. Completes the owned idempotency reservation and writes the nonce index.
4. Appends the cumulative quote-issuance event.
5. Appends deduplicated signer audit evidence.

All keys use one Redis Cluster hash tag. Healthy AOF, bounded issuance/audit backlog and configured `WAIT` replica acknowledgements remain required before success is returned. The signer responds with the signature and a finalization hash. `RemoteSignerService` independently recovers the EIP-712 signer and recomputes that hash before returning the signature to Quote Service.

If the signer HTTP result is lost after Redis committed, Quote Service reads the finalized hot response and independently verifies its identity, economics and signature. It releases reserved exposure only when Redis proves no finalization exists. An unavailable or malformed recovery result is ambiguous, so exposure remains conservatively reserved until deadline/reconciliation.

`rfq_signer_service_stage_latency_seconds{stage}` now includes `authorization`, and `audit` includes the combined terminal commit. `rfq_signer_atomic_quote_commits_total{result}` distinguishes accepted, duplicate and invalid-state outcomes. Gateway `issuance_persistence` has no successful samples in atomic mode because terminal issuance is owned by the signer.

The rebuilt Compose dependency stack was measured with 10 warmups and 100 serial samples after the real Redis/PostgreSQL integration check passed. It returned zero errors at 73.21 requests/second with p50 12.96 ms and p99 21.13 ms, compared with the pre-change p50 13.37 ms and p99 31.71 ms baseline. Signing averaged 5.19 ms, exposure 2.40 ms, preparation 1.38 ms, authorization 1.37 ms and idempotency 1.00 ms; successful gateway `issuance_persistence` samples were eliminated as designed. The observed p99 target passed, but p50 remained above 10 ms, so this decision is not evidence that the complete high-frequency target has been achieved.

An experiment that sent the signer request before the gateway received authorization persistence acknowledgement was rejected and reverted. Although the signer still failed closed, the HTTP request frequently raced the Redis authorization write and required extra reads: signing rose to 6.52 ms, p50 to 13.10 ms and p99 to 53.23 ms. Future work must fuse state transitions atomically instead of creating cross-connection polling races.

## Consequences

### Positive

- One Redis transaction replaces separate signer-audit and gateway-finalization round trips.
- Durable audit, idempotency, nonce and quote state cannot disagree after a successful commit.
- KMS/HSM is not invoked until the signer independently verifies the exact persisted authorization.
- Lost HTTP responses have deterministic recovery without prematurely releasing exposure.
- The API still has no KMS credential and still verifies signer identity independently.

### Negative

- The signer Redis credential now needs narrowly scoped access to issuance quote/epoch/event/idempotency/nonce keys and the signer-audit stream in one hash slot.
- Signer and gateway capability changes require a coordinated rollout; an atomic signer intentionally rejects a legacy request without commit context.
- The signer authorization read adds one Redis command before KMS/HSM access.
- The combined Lua script has a larger state contract and must remain compatible with the PostgreSQL projectors.

### Mitigation

Pause new quote admission for the capability switch. First deploy compatible binaries with atomic mode disabled, drain both old streams, verify the issuance epoch, then enable the signer with a new signer-audit stream epoch and enable all gateways in the same reviewed window. Resume only after signer `/ready` advertises `atomic_quote_commit_v1`, one canary produces one finalized issuance event and one mirrored signer audit row, and backlog returns to zero. Rollback requires another quote pause and draining the atomic streams before disabling both sides.

The signer Redis ACL must permit only the exact hash-tagged key families and commands used by `GET`, `EVAL`, `PING`, `INFO`, `XLEN`, `WAIT` and shutdown; it must not gain API database or migration privileges. Real Redis/PostgreSQL integration tests validate authorization tamper rejection, one-transaction finalization, replay, both mirrors and source-epoch uniqueness.

## Alternatives Considered

- Return the signature before audit or finalization: rejected because an executable quote could escape without durable evidence or terminal state.
- Keep both Redis mutations: correct but preserves an avoidable serialized round trip.
- Move signing into the API: rejected because it collapses workload identity and key isolation.
- Trust only the gateway bearer token and quote id: rejected because it does not bind the exact economics approved by risk.
- Release exposure whenever signer transport fails: rejected because transport failure can occur after the atomic commit.
- Overlap an unacknowledged authorization write with the signer request: rejected because measured Redis read/write races increased latency and tail risk without removing a durable boundary.
