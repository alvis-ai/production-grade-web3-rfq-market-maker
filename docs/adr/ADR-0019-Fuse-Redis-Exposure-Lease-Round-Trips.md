# ADR-0019: Fuse Redis Exposure Lease Round Trips

## Status

Accepted

## Context

ADR-0017 made Redis/Valkey the production authorization source for active quote exposure, but the initial implementation used separate network commands to acquire a chain lease, read state, commit the reservation, read Stream backlog and release the lease. A successful quote therefore required five Redis round trips when replica acknowledgement was disabled, and more under contention because waiters polled the lease. The post-ADR-0018 dependency-stack benchmark attributed 12.84 ms on average to exposure reservation at concurrency five.

The lease cannot simply be removed. Portfolio VaR and Delta are evaluated in process memory from a consistent Redis token-delta snapshot, while user, pair and Treasury limits must be checked atomically against the commit. Another replica must not mutate the chain between that snapshot and commit. A crashed or rejected request must also lose ownership within a bounded time, and accepted mutations must still reach the Redis Stream and required replicas before signing.

## Decision

Keep the bounded chain-scoped owner-token lease, but fuse its network boundaries.

The first Lua command conditionally acquires the lease, cleans a bounded batch of expired reservations, returns an existing idempotent reservation when present, and returns the complete token-delta plus Stream-backlog state needed for in-memory VaR/Delta evaluation. When an existing reservation is found, the same script conditionally unlocks before returning; its write sequence is then the current connection's replication barrier for `WAIT`. Only a large expired backlog uses continuation reads under the same lease.

The second Lua command verifies lease ownership, rechecks deadline, backlog, user, pair and Treasury limits with exact decimal-string arithmetic, writes the reservation and aggregates, increments the chain version, appends the Stream event, and deletes the lease only when the owner token still matches. Every normal success, duplicate, rejection and bounded error returns backlog directly, eliminating a separate `XLEN` call. Release mutations similarly return backlog and conditionally unlock in the same script.

Script transport errors, malformed responses and local VaR/Delta rejection retain the explicit owner-checked unlock fallback. The lease TTL remains the crash boundary. Production replica `WAIT` remains after the mutation and before the store reports success; idempotent replay also performs `WAIT`, so a prior acknowledgement failure cannot be bypassed by reading the existing primary record.

## Consequences

### Positive

- A common successful reserve uses two Redis command round trips instead of five.
- The lease is released inside the atomic commit before replica waiting, reducing hot-chain blocking.
- Backlog observation no longer adds a request-path network query.
- Existing exact arithmetic, cross-replica serialization, Stream audit, AOF policy and PostgreSQL mirror semantics remain unchanged.
- A duplicate reservation cannot turn an earlier failed replica acknowledgement into a signable result.

### Negative

- The fused Lua scripts are larger and couple lease, cleanup, state-read and mutation protocol versions.
- A chain lease still serializes in-memory VaR/Delta evaluation; very hot chains can continue to queue.
- EVAL still transmits and parses the script body on each command; script loading/EVALSHA remains a future optimization.
- This change does not remove synchronous PostgreSQL quote lifecycle writes or remote signing. ADR-0020 subsequently fuses lifecycle writes into three ordered issuance stages and removes only capability-proven duplicate signer recovery.

### Mitigation

Unit tests assert the exact common-path command sequence, no independent `XLEN`, duplicate replica acknowledgement and owner-checked cleanup after malformed fused state. The real Redis integration uses two independent store clients racing one Treasury balance and requires exactly one acceptance, exact integers beyond IEEE-754, replay, release and the expected Stream length. The Redis/PostgreSQL integration verifies ordered reserve/release projection and append-only audit.

The clean-window local dependency-stack benchmark used real HTTP, PostgreSQL, Redis and the isolated signer with 10 warmups and 100 measured requests. The final concurrency-one image reported p50 21.40 ms, p99 39.56 ms, 44.77 requests/second and 2.29 ms average exposure reservation, compared with the pre-change p50 28.74 ms, p99 38.23 ms, 34.41 requests/second and 3.92 ms exposure. Two concurrency-five runs on the final protocol reported p50 41.40-45.00 ms, p99 54.47-59.65 ms, 108.79-119.47 requests/second and 5.54-6.23 ms exposure, compared with the pre-change p50 45.04 ms, p99 63.49 ms, 106.25 requests/second and 12.84 ms exposure. All measured requests succeeded. Exposure improvement is repeatable, while total latency still shows signer/database jitter, fails the p50 below 10 ms objective and misses p99 below 50 ms under concurrency five. Signing and synchronous lifecycle/risk persistence are now the primary measured costs.

## Alternatives Considered

- Keep five independent Redis commands: rejected because network round trips, not arithmetic, dominated the exposure stage.
- Remove the chain lease and trust the final user/pair checks: rejected because process-local VaR/Delta could commit from stale token deltas.
- Use optimistic chain-version retries immediately: deferred because high contention can create repeated read/evaluate/commit work and starvation; the fused lease reaches two common-path round trips with simpler bounded ownership.
- Move VaR/Delta arithmetic into Lua: rejected because pricing/valuation evidence is richer than the Redis aggregate protocol and would duplicate reviewed TypeScript models in another language.
- Skip replica acknowledgement on idempotent replay: rejected because a primary-only write after a failed `WAIT` must not become signable on retry.
