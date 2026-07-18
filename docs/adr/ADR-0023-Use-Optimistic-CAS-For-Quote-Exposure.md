# ADR-0023: Use Optimistic CAS For Quote Exposure

## Status

Accepted

## Context

ADR-0019 reduced a successful Redis quote-exposure reservation from five commands to two fused commands, but retained a chain-scoped owner lease across process-local portfolio VaR and Delta evaluation. The lease protected correctness across API replicas, yet it serialized every reservation for one chain. The post-ADR-0022 dependency-stack benchmark attributed 9.35 ms average latency to exposure at concurrency five, with quote p50 32.51 ms and p99 76.24 ms.

The evaluation cannot simply run against an unlocked snapshot and commit unconditionally. Another reservation or release can change token deltas, portfolio VaR/Delta, exact user/pair totals or Treasury capacity between the read and write. The commit must either prove that it evaluated the current generation or repeat the evaluation. User, pair and Treasury limits must still use exact decimal-string arithmetic inside Redis, and accepted mutations must still append the audit Stream event before signing.

## Decision

Reserve operations use optimistic chain-generation compare-and-set:

1. One Lua read atomically cleans a bounded expired batch and returns any idempotent record, Stream backlog, chain generation and all requested token deltas.
2. The API evaluates portfolio VaR and Delta in process memory from that immutable snapshot.
3. One Lua commit first returns an existing idempotent record when present, then compares the stored chain generation with the evaluated generation.
4. A matching generation permits the existing exact user, pair and Treasury checks, aggregate mutation, generation increment and Stream append in one atomic script.
5. A generation conflict returns no mutation. The API yields, rereads the complete state and reevaluates until the existing `RFQ_QUOTE_EXPOSURE_LOCK_ACQUIRE_TIMEOUT_MS` budget expires. Exhaustion fails closed as `version_retry_timeout`.

Every reserve, release and expired-record cleanup increments the same chain generation. Redis script atomicity prevents a release or cleanup from interleaving inside either read or commit. Release retains the owner-token lease because it does not hold process-local evaluation state and its existing bounded crash recovery remains correct.

Prometheus increments `rfq_quote_exposure_ledger_version_conflicts_total` for every failed generation comparison. The stable `rfq_quote_exposure_ledger_lock_wait_seconds` name is retained for dashboard compatibility, but its semantics are now complete coordination time after contention, covering reserve CAS retries and release-lease waiting. Failure labels distinguish reserve `version_retry_timeout` from release `lock_timeout`.

## Consequences

### Positive

- Uncontended reserve still uses two Redis round trips and no distributed lease acquisition.
- Separate API replicas can evaluate the same chain concurrently; only the atomic commit is serialized by Redis.
- A stale VaR/Delta result cannot commit because every state mutation changes the compared generation.
- Existing exact arithmetic, idempotency, backlog bounds, AOF policy, replica acknowledgement and PostgreSQL projection remain unchanged.
- Conflict rate and retry time are observable without high-cardinality labels.

### Negative

- Contended requests can repeat Redis reads and in-memory VaR/Delta work.
- Optimistic retries can create a thundering-herd pattern on a very hot chain and may exhaust the bounded budget.
- Release and reserve now use different coordination mechanisms, increasing protocol complexity.
- The stable lock-wait metric name no longer literally describes reserve behavior.
- This change does not remove the remote signer or three serial quote-issuance journal stages, so it cannot by itself meet p50 below 10 ms.

### Mitigation

Unit tests require the two-round-trip common path, idempotent replay, generation-conflict reread/recompute, bounded failure classification and malformed-state fail closed behavior. The real Redis integration retains exact values beyond IEEE-754, concurrent Treasury admission, replay, release and Stream-length assertions. Operators alert when conflicts exceed four per successful reserve or coordination p99 exceeds 25 ms; mitigation reduces admitted hot-chain concurrency rather than widening the generation check or running a second authority.

The rebuilt local dependency stack used real HTTP, PostgreSQL, Redis and the isolated signer service with 10 warmups and 100 measured requests. The final image at concurrency one returned zero errors, p50 14.96 ms and p99 22.78 ms, with 1.87 ms average exposure. Three clean concurrency-five runs, each preceded by successful readiness, returned zero errors with p50 25.81-28.01 ms, p99 41.74-46.83 ms and exposure 8.15-8.77 ms. The final run resolved 79 generation conflicts without retry exhaustion. The ADR-0022 baseline was p50 32.51 ms, p99 76.24 ms and exposure 9.35 ms. The improvement is repeatable and the measured p99 now passes 50 ms, but p50 still fails 10 ms. The next optimization must reduce serial quote-issuance and signer boundaries without weakening admission or audit durability.

## Alternatives Considered

- Keep the fused chain lease: rejected because it makes every in-memory evaluation a distributed critical section and produced worse measured contention.
- Commit an unlocked evaluation without a generation check: rejected because concurrent reservations can exceed portfolio and Treasury limits.
- Move the complete VaR/Delta model into Lua: rejected because it would duplicate reviewed TypeScript valuation logic and requires exact arithmetic richer than Redis Lua numbers.
- Use only process-local per-chain queues: rejected because they cannot coordinate multiple API replicas.
- Retry indefinitely: rejected because quote latency and executable TTL require a bounded fail-closed result.
- Remove Redis durability or replica acknowledgement: rejected because lower latency cannot justify duplicate nonces, lost audit evidence or oversubscribed exposure.
