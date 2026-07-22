# ADR-0026: Use Process-Local Exposure Generation

## Status

Accepted

## Context

ADR-0023 protects portfolio VaR and Delta admission with a Redis chain-generation CAS. An uncontended reservation still reads the complete versioned token-delta state, evaluates in memory, and commits with a second Redis command. The dependency-stack baseline attributed 1.84 ms on average to exposure at concurrency one. Redis remains the authorization source; a process-local projection may remove the read only when stale state cannot commit.

## Decision

`RedisQuoteExposureStore` retains the most recently validated immutable token-delta generation per chain. After warm-up, a reservation evaluates against that local generation and sends the existing exact CAS commit directly.

The commit Lua script first performs bounded deadline cleanup using Redis server time and then compares the submitted generation. Every reservation, release, or expiration changes the generation. A stale local projection therefore returns a conflict without mutation, rereads the complete Redis state, reevaluates, and retries inside the existing bounded deadline. A locally computed VaR or Delta rejection also rereads once before returning, so stale high exposure cannot create a cache-only rejection. Release invalidates the local generation.

Redis still enforces exact user, pair and Treasury totals, backlog bounds, Stream append, AOF policy and replica acknowledgement. The local generation is an optimization, never a fallback authority.

Reservations originating in one process are serialized per chain before they submit the CAS. Each successful local mutation advances the cached generation before the next same-chain request evaluates. This removes conflicts that are provably local; another replica, release or expiration can still cause a Redis generation conflict and the same bounded reread path.

## Consequences

### Positive

- Warm single-replica admission uses one Redis command instead of a read plus commit.
- Cross-replica writes and expiration are safe because generation mismatch fails closed and forces reevaluation.
- Same-process concurrency no longer submits several known-stale generations for one chain.

### Negative

- A cold process and a conflict retain the two-command path.
- One process serializes same-chain commits, so a very hot chain remains bounded by Redis commit throughput; cross-replica contention can still create CAS retries.

### Mitigation

Before local serialization, the current dependency stack measured concurrency-five exposure at 8.65 ms average, quote p50/p99 at 21.23/51.83 ms and zero errors. With the same-chain queue, exposure fell to 4.94 ms, p99 fell to 46.67 ms, throughput rose from 197.08 to 204.22 requests/second and errors remained zero. Quote p50 was still 22.39 ms, so the queue is a tail-latency and contention improvement, not evidence that the complete SLO passed.

## Alternatives Considered

- Trust the local projection without CAS: rejected because replicas could oversubscribe portfolio or Treasury limits.
- Subscribe to a second in-process authority: rejected because stream lag creates an ambiguous authorization source.
- Return a rejection from cached state without rereading: rejected because another replica may already have released exposure.
- Move exact VaR and Delta arithmetic into Lua: rejected for the reasons recorded in ADR-0023.
