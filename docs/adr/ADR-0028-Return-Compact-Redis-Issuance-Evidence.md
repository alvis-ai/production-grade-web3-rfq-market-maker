# ADR-0028: Return Compact Redis Issuance Evidence

## Status

Accepted

## Context

Redis quote issuance stores and streams one cumulative record containing snapshot, request, route, risk authorization and signed response. The prepare, authorize and finalize Lua scripts also returned that complete record to the gateway after every mutation. The gateway reparsed the growing JSON object even though it only needed to prove that Redis committed the exact transition it requested.

## Decision

Mutation responses return the minimum independently checkable evidence:

- `prepare` returns the exact SHA-256 `preparationHash`.
- `authorize` returns the complete `RiskDecisionRecord`, which is validated against the requested quote and decision.
- `finalize` returns the exact SHA-256 `finalizationHash`.

Lua still decodes and validates the current cumulative record, checks immutable hashes and ownership, updates hot state, completes idempotency, enforces nonce uniqueness, and appends the full cumulative Stream event atomically. Duplicate transitions return the same compact evidence only after matching the stored hash. A malformed or conflicting response fails closed.

## Consequences

### Positive

- Redis sends less data and the gateway avoids repeated parsing of an increasingly large cumulative quote document.
- PostgreSQL projection, recovery and audit retain the complete event payload.

### Negative

- Compact responses are protocol contracts and require malformed-evidence tests in addition to the real Redis-to-PostgreSQL integration test.
- This change does not merge authorization with exposure or finalization with signer audit; those trust boundaries remain serial.

### Mitigation

The integration check proved three Redis events project to one signed quote, one approved risk decision and one succeeded idempotency response, with exact replay after projection. The rebuilt image was inspected for compact prepare/finalize returns and WASM recovery before measurement. The final clean concurrency-one window returned zero errors with p50 13.37 ms and p99 31.71 ms; two earlier windows were p50 14.09-14.35 ms and p99 19.46-24.84 ms. Compact evidence reduced response parsing but did not remove the serial exposure, authorization, signer-audit and finalization round trips, so the p50 objective remains unmet.

## Alternatives Considered

- Return no evidence: rejected because a malformed client or script response would be indistinguishable from success.
- Continue returning the full cumulative record: correct but adds network and JSON work to every quote.
- Split the Stream into partial non-cumulative events: rejected because it changes recovery semantics and makes projection gaps harder to repair.
- Combine exposure and issuance in one Lua script: rejected because their current Redis hash tags differ and a cross-slot script is not cluster-atomic.
