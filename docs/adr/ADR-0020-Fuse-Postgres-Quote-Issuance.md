# ADR-0020: Fuse PostgreSQL Quote Issuance

## Status

Accepted

## Context

The default PostgreSQL quote path persisted a market snapshot, idempotency binding, requested quote, route decision, risk decision, signed quote and idempotency response through separate repository calls. A successful idempotent quote therefore crossed the PostgreSQL boundary eight times. After ADR-0019 reduced exposure admission to two Redis commands, synchronous lifecycle persistence and remote signing became the dominant measured costs.

An initial two-query design attempted to write snapshot, quote, route and risk authorization only after Redis exposure admission. This created a correctness race: the exposure Stream mirror could process a reservation before the parent `quotes` row existed, violate the PostgreSQL foreign key, and degrade the health-gated exposure store. Removing the foreign key, disabling mirror health gating or acknowledging the failed event would hide audit loss and was rejected.

The isolated signer also recovered every locally or KMS-generated signature a second time in the signer HTTP handler even when the signer implementation had already established the signature identity. The API still independently verifies every remote signer response and settlement verification remains unchanged.

## Decision

Use an explicit three-stage `QuoteIssuanceStore` for the default PostgreSQL composition:

1. `prepare` atomically writes or exactly replays the market snapshot, requested quote, route decision and idempotency quote binding. It completes before Redis exposure admission, so every exposure event has an existing parent quote.
2. `authorize` atomically updates the prepared quote with the approved or rejected policy and inserts the matching immutable risk decision. Signer access remains blocked until this durable authorization succeeds and returns exact evidence.
3. `finalize` atomically writes the signed payload and completes the idempotency response.

Each stage uses one data-modifying CTE statement with exact identity and payload comparisons. Scalar consistency guards force statement rollback when any required CTE or idempotency transition does not affect exactly one row. Replays are accepted only when all immutable fields match. Custom repositories retain the existing per-repository path; the fused store is enabled only when the gateway owns the complete default PostgreSQL repository set.

The Quote Service order is fixed as `market/routing/pricing -> base risk -> prepare -> Treasury/indexer/exposure -> authorize -> signer -> finalize`. Preparation failure occurs before exposure. Authorization or signer failure releases a completed exposure reservation best effort; deadline expiry remains the final risk-reducing boundary.

Signer implementations may expose the literal capability `signaturesSelfVerified: true` only when signing itself guarantees the returned identity: KMS signing performs recovery against the configured trusted address, the remote adapter verifies its response, and the local account signs through the bound private-key account. The isolated signer skips its duplicate recovery only for that exact capability. Unmarked adapters still require recovery, invalid capability values fail startup, and the API-side remote signer continues independent EIP-712 recovery.

## Consequences

### Positive

- The common idempotent PostgreSQL path uses four queries: idempotency acquire plus prepare, authorize and finalize, instead of eight repository operations.
- The parent quote is committed before Redis exposure events can be mirrored, preserving the exposure foreign key and fail-closed mirror health gate.
- Risk evidence remains durable before signing, while signed payload and idempotency completion remain atomic.
- Duplicate signer recovery is removed from the isolated service only when the signer implementation has already established identity.
- Stage metrics separate `quote_preparation_persistence`, `authorization_persistence` and `issuance_persistence` from the legacy persistence labels.

### Negative

- Three PostgreSQL writes remain sequential authorization boundaries on every successful quote.
- Data-modifying CTEs are more coupled to the schema and require exact replay tests.
- The capability marker relies on reviewed signer implementations; adding it to an adapter that does not validate its own output would weaken the isolated service check, although API recovery still protects the public quote response.
- This change does not make PostgreSQL asynchronous and does not meet the p50 latency objective.

### Mitigation

Unit tests prove preparation precedes exposure, failed preparation cannot reserve exposure or call the signer, malformed authorization blocks signing, exact cross-quote bundles fail before SQL, and every fused stage uses one query. The full backend suite passes 965 tests. A rebuilt Compose stack with real HTTP, PostgreSQL, Redis and isolated signer produced 227 signed quotes, 227 matching exposure mirror writes, zero quote errors, zero mirror errors and no orphan risk or exposure rows.

With 10 warmups and 100 measured requests at concurrency one, the final stack reported p50 21.83 ms, p99 33.39 ms, 45.00 requests/second and zero errors. Average stages were 1.75 ms preparation, 2.73 ms exposure, 1.36 ms authorization, 7.18 ms signing and 1.83 ms finalization. At concurrency five it reported p50 36.66 ms, p99 49.72 ms, 133.48 requests/second and zero errors, improving the ADR-0019 final p50 range of 41.40-45.00 ms and p99 range of 54.47-59.65 ms. The p99 objective passed in this diagnostic run, but p50 below 10 ms did not; the overall SLO remains unmet.

The next latency architecture must replace synchronous PostgreSQL issuance and idempotency transitions with a replicated Redis/Valkey durable issuance journal plus exact hot quote state, then mirror ordered events to PostgreSQL. That design must specify signer authorization evidence, status-read consistency, replay ownership, backpressure, poison-event handling and recovery before any database write is removed from the response path.

## Alternatives Considered

- Keep eight repository operations: rejected because network round trips dominate the arithmetic path.
- Write authorization only after exposure: rejected because the exposure mirror can beat the parent quote insert.
- Drop the exposure foreign key or mirror health gate: rejected because it converts an ordering bug into silent audit loss or unsafe continued admission.
- Prepare and authorize before exposure: rejected because an approved durable risk decision would not include the final shared exposure admission result.
- Move PostgreSQL writes after the response immediately: deferred until a replicated issuance journal and reconciliation protocol make the pre-sign authorization evidence and crash semantics explicit.
- Trust every signer adapter and remove recovery globally: rejected because custom or malformed adapters must remain fail closed.
