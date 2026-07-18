# ADR-0017: Use Redis for Quote Exposure Admission

## Status

Accepted

## Context

The production-shaped `POST /quote` path serializes exposure admission through PostgreSQL advisory locks. The reservation transaction also reads current inventory, active reservations, and valuation snapshots before it writes the accepted reservation. A 100-request, concurrency-5 dependency-stack benchmark attributed 34.14 ms on average to this stage and reported p50 61.65 ms and p99 100.5 ms. This exceeds the complete quote-path objective before remote signing is considered.

Moving only arithmetic into process memory is unsafe. Every API replica must see one atomic user, pair, treasury-output, portfolio VaR, and portfolio delta admission decision. Expired quotes must restore capacity, retries must return the original evidence, a crashed replica must not retain an unbounded lock, and an accepted reservation must survive process failure. Inventory and valuation inputs must also be versioned and fresh; an unversioned pod-local cache can understate exposure after settlement or reorg processing.

PostgreSQL remains necessary for long-term quote, risk, settlement, and audit queries, but it must not act as the synchronous aggregate query engine for each quote. The hot path therefore needs a replicated state ledger with explicit durability and recovery semantics rather than a best-effort cache.

## Decision

Use a hash-tagged Redis or Valkey keyspace as the cross-replica quote exposure admission ledger. One bounded chain-scoped lease serializes a read-evaluate-commit cycle. Redis stores exact decimal-string aggregates for user notional, pair notional, output-token reservations, and directional token deltas. Lua scripts perform expiration cleanup, exact integer limit checks, idempotent conflict detection, aggregate mutation, and stream append atomically. The scripts never use floating-point arithmetic for token or USD quantities.

Portfolio VaR and delta arithmetic consume an immutable hot-state snapshot containing canonical inventory and valuation observations plus the Redis reservation deltas. The snapshot is refreshed outside request handling, carries a monotonic source version and observation time, and is rejected when it exceeds the reviewed freshness bound. A reservation remains counted for an additional bounded synchronization grace after its signed quote deadline so an inventory refresh cannot briefly omit both the expiring reservation and a just-settled inventory change.

An accepted mutation appends a schema-versioned Redis Stream event in the same script. A consumer group validates and mirrors that event to PostgreSQL before it acknowledges and deletes the entry. The PostgreSQL projection is idempotent by `<ledger-epoch>:<stream-id>` and preserves an append-only event record in addition to the active-reservation projection. Stream backlog exhaustion, lease loss, stale hot state, Redis AOF failure, insufficient replica acknowledgements, malformed state, or mirror health failure all block new signing.

Production requires TLS, healthy AOF persistence, at least one `WAIT` replica acknowledgement, an explicit ledger epoch, a bounded backlog, and a non-zero synchronization grace. Redis is the authorization source for active quote exposure; PostgreSQL is the durable query and recovery projection. A destructive loss of every Redis replica is a risk incident. Automatic recovery may only import a verified PostgreSQL projection while quote admission is stopped; operators must reconcile signer audit events and signed quotes before changing the ledger epoch and resuming.

The initial rollout keeps the PostgreSQL implementation as an explicit rollback backend. It must not silently fall back from Redis to PostgreSQL during an incident because mixed admission authorities can oversubscribe limits.

## Consequences

### Positive

- Quote admission no longer scans or locks PostgreSQL tables in the request path.
- Exact cross-replica limits, idempotency, expiration, and portfolio reservation deltas remain atomic.
- Inventory and valuation reads move to a versioned immutable hot-state view instead of per-request database queries.
- PostgreSQL is removed from the individual exposure admission round trip; a detected mirror failure blocks new reservations before backlog becomes an unbounded unaudited liability.
- Stage metrics can separately attribute lease wait, state evaluation, Redis commit, replication acknowledgement, and mirror lag.

### Negative

- Redis becomes an authorization dependency whose persistence, replication, lease timing, and memory capacity require production operation.
- The chain-scoped lease can still serialize a hot chain; the lease duration and state-evaluation cost must remain below the quote tail budget.
- Background state refresh introduces a bounded consistency delay and requires a synchronization grace on reservation expiry.
- A complete Redis-cluster data loss cannot be treated as an ordinary cache miss.
- The transition adds a stream mirror, recovery procedure, schema migration, metrics, alerts, and deployment configuration.

### Mitigation

- Keep the lease fail closed, use random owner tokens, verify ownership in every script, and cap retries by the request budget.
- Reject stale or regressed portfolio snapshots and retain reservations through the reviewed refresh grace.
- Require AOF and replica acknowledgements, alert before stream or pending-entry capacity is exhausted, and retain poison events.
- Run two-replica concurrency tests for every limit, crash tests around commit and acknowledgement, and recovery tests from PostgreSQL projection.
- Benchmark the real dependency stack after rollout; this ADR removes one known bottleneck but does not declare the end-to-end p50 objective achieved.

**Implementation validation.**

Migration `037-quote-exposure-ledger.sql` adds the bounded ledger expiry, append-only event table and per-quote projection position. `RefreshingInventoryView` and `HotMarketSnapshotStore` keep VaR reads in immutable process memory. The gateway starts those views, the Redis ledger and the PostgreSQL mirror before readiness, and keeps canonical settlement writes on `PostgresInventoryService`. The mirror probes PostgreSQL on a bounded cleanup interval, marks its process-local health gate failed after any consume, persist, acknowledgement or cleanup error, blocks subsequent reserves, and still permits risk-reducing releases.

`quote-exposure-ledger-bootstrap.mjs` requires explicit confirmation, healthy AOF and a completely empty hash-tagged prefix before it writes the reviewed epoch. `quote-exposure-redis-integration-check.mjs` verifies exact arithmetic beyond IEEE-754, replay, limits and release. `quote-exposure-ledger-integration-check.mjs` uses real Redis and PostgreSQL to verify reserve projection, release deletion and two retained audit events.

The initial post-rollout local dependency-stack benchmark used 10 warmups and 100 measured `POST /quote` requests with no errors. At concurrency one it reported p50 28.86 ms, p99 40.84 ms and 33.35 requests/second; exposure reservation averaged 3.85 ms while remote signing averaged 10.29 ms. At concurrency five it reported p50 65.20 ms, p99 126.76 ms and 70.52 requests/second; exposure reservation averaged 18.14 ms and signing averaged 14.36 ms. The cumulative lease histogram placed 224 of 230 acquisitions within 25 ms and 229 within 50 ms. This rollout materially removed the former PostgreSQL exposure cost, but it did not meet p50 below 10 ms or p99 below 50 ms under concurrency. Subsequent Treasury hot-state and PostgreSQL round-trip work is recorded in ADR-0018; durability settings were not weakened to make either benchmark pass.

## Alternatives Considered

- Keep PostgreSQL advisory locks and add indexes: rejected because the transaction still performs multiple network queries and serializes the hottest chain.
- Use independent process-local maps: rejected because API replicas could each admit a quote below their local limit while exceeding the global limit.
- Cache only user and pair totals in Redis while computing VaR from PostgreSQL: rejected because the chain-wide database reads and lock remain on the critical path.
- Optimistically sign and persist exposure later: rejected because a crash or concurrent replica could create unreserved signed liability.
- Use floating-point Redis sorted-set scores for notional accounting: rejected because token and USD limits require exact integer semantics beyond IEEE-754 precision.
- Fall back automatically to PostgreSQL when Redis fails: rejected because simultaneous or partitioned authorities can admit conflicting reservations.
