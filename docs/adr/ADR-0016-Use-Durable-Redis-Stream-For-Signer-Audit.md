# ADR-0016: Use a Durable Redis Stream for Signer Audit Admission

## Status

Accepted

## Context

The isolated signer must not return an EIP-712 signature before durable audit admission. A synchronous PostgreSQL insert preserved that invariant, but the real dependency-stack benchmark attributed roughly 10 ms on average to the complete remote signing stage even at concurrency one. That consumes the entire p50 quote budget before quote lifecycle persistence and exposure reservation are counted. An in-memory queue would be fast but could lose the only independent evidence that a signature was issued.

Redis is already an operational dependency, but an ordinary cache write is not a durable audit boundary. The signer needs bounded admission, replay, duplicate suppression, replica acknowledgement, disk persistence, poison-event retention, and an idempotent PostgreSQL mirror. A Redis rebuild must also be distinguishable from the previous stream generation because Redis entry ids alone are not globally unique across destructive restores.

## Decision

Support `RFQ_SIGNER_AUDIT_BACKEND=redis-stream` as the preferred signer audit path. Before returning a successful signature, the signer executes one atomic Lua admission that rejects a full stream, appends a schema-versioned integrity-checked event, and records a bounded deduplication key. Production requires `rediss://`, healthy AOF persistence, and at least one `WAIT` replica acknowledgement. Failure of admission or replica acknowledgement remains fail closed.

A background consumer group in each signer process mirrors events to PostgreSQL. It validates the payload hash and complete audit envelope, inserts `source_stream_id = <stream-epoch>:<redis-entry-id>` under a unique constraint, then atomically acknowledges and deletes the stream entry. A crash before PostgreSQL commit leaves the event pending. A crash after commit but before acknowledgement replays the same source id and is handled by `ON CONFLICT DO NOTHING`. Malformed events remain pending and eventually fill the bounded stream rather than being discarded.

`RFQ_SIGNER_AUDIT_STREAM_EPOCH` identifies one Redis stream generation. It is mandatory in production and must change only when operators intentionally rebuild the stream from empty state. The signer exports append, duplicate, backlog, replica-ack failure, mirror insertion/replay, and mirror-error metrics. PostgreSQL remains the long-term audit system of record; Redis is the replicated write-ahead admission ledger, not the historical query store.

## Consequences

### Positive

- The synchronous signer path replaces a PostgreSQL transaction with a bounded Redis append while retaining a durable pre-response boundary.
- Multiple signer replicas share one consumer group and can reclaim stale pending entries.
- PostgreSQL outages can be absorbed up to the reviewed backlog limit without losing audit evidence.
- Stream replay is idempotent and observable.

### Negative

- The signer now depends on Redis persistence, replication, stream capacity, and consumer health in addition to KMS and PostgreSQL.
- `WAIT` and AOF still add latency, so this change alone does not prove the end-to-end quote SLO.
- Operators must rotate the stream epoch after a destructive Redis rebuild and must not trim unmirrored entries.

### Mitigation

- Fail readiness and new audit admission when AOF is unhealthy or the stream reaches its maximum backlog.
- Require TLS and replica acknowledgements outside local environments.
- Alert on backlog, replica acknowledgement failures, and mirror errors before admission reaches the hard limit.
- Keep direct PostgreSQL audit mode as an operational rollback path.

**Local dependency-stack verification**

On 2026-07-17, the rebuilt Compose stack used Redis AOF with `appendfsync always`, PostgreSQL migration `036`, the isolated local EIP-712 signer, and the real HTTP API. All 110 warmup and measured signer events were mirrored with 110 distinct `compose_v1:<redis-entry-id>` source ids; stream length, pending count, consumer lag, audit errors, and mirror errors returned to zero.

The default 100-request, concurrency-5 benchmark still failed the quote SLO at p50 61.65 ms and p99 100.5 ms. Its average signing stage was 9.91 ms, while the PostgreSQL exposure reservation averaged 34.14 ms under chain-wide portfolio lock contention. A separate 50-request serial diagnostic reported p50 29.6 ms, signing 10.19 ms, and exposure reservation 8.16 ms. These results validate recovery and audit semantics, not the latency target; the current production-shaped quote path is not yet a p50-below-10-ms system.

## Alternatives Considered

- Best-effort in-memory batching: rejected because a signer crash could lose successful-signature evidence.
- Synchronous PostgreSQL insert: retained as a rollback mode, but rejected as the preferred low-latency path because it directly amplifies request tail latency and pool contention.
- Kafka-only audit: rejected for this boundary because the signer already depends on Redis, while adding a second broker protocol to the isolated workload increases credentials and egress surface.
- Redis list without consumer groups or replica acknowledgement: rejected because it lacks stale-claim recovery, bounded duplicate handling, and explicit durability evidence.
