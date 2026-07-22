# ADR-0029: Use Conservative Redis Rate Permit Leases

## Status

Accepted

## Context

The Redis fixed-window limiter previously executed one Lua command for every API request. That preserves an exact global counter but adds a network round trip before every quote, even when one authenticated principal sends a normal burst through the same replica. Successful quote completion was also logged at `info`, making Docker stdout and log shipping compete with the next request while metrics already counted every outcome.

## Decision

Redis atomically reserves a bounded batch of permits instead of incrementing by one. The Lua script reads the fixed-window count and TTL, grants at most `min(requested, limit - current)`, increments by exactly that amount, and never grants above the configured global limit. A process consumes its reserved permits synchronously from a monotonic-TTL local lease. The local deadline is measured from before the Redis request, so transport latency shortens rather than extends the returned TTL and an old-window permit cannot leak into a new Redis window. Concurrent misses for one key share one allocation promise.

`RFQ_RATE_LIMIT_LOCAL_PERMIT_BATCH_SIZE` defaults to 8 and is bounded to 1-1024. `RFQ_RATE_LIMIT_MAX_LOCAL_BUCKETS` defaults to 10000 and is bounded to 1-1000000. Eviction or process death discards unused permits; Redis never reissues them before the window expires. This is deliberately conservative: availability can be lower after a crash, but the distributed limit cannot be exceeded. Redis failure still returns `RATE_LIMIT_UNAVAILABLE`, and readiness still probes Redis directly.

Successful `POST /quote` completion records are emitted at `debug`; failures and non-hot routes retain visible completion/error logs. Prometheus continues to count every request, response and error. The quote-stage histogram now includes `rate_limit` and `quote_control` so the optimized boundary remains measurable.

## Consequences

### Positive

- Common requests consume permits without a Redis round trip while the global fixed-window cap remains fail-closed.
- Local cache cardinality and batch size are explicit and bounded.
- High-volume success logs no longer contend with the next quote at the default `info` threshold.

### Negative

- `x-ratelimit-remaining` is a conservative local remainder, not an exact live global remainder across replicas.
- A crashed or evicted lease wastes its unused permits until the fixed window expires.
- Larger batches improve latency but can reduce fairness when many replicas first contend for a small limit.

### Mitigation

Real Redis checks proved a limit of 2 accepted exactly two requests, and two limiter instances sharing a limit of 10 accepted exactly ten and rejected the eleventh while Redis stored count 10. The final rebuilt dependency stack measured `rate_limit` at 0.16 ms average during a zero-error concurrency-one run. Complete quote p50/p99 remained 13.37/31.71 ms, so permit leasing removes a boundary cost but does not claim the end-to-end SLO is achieved.

## Alternatives Considered

- Keep one Redis increment per request: exact headers, but spends a network round trip on every quote.
- Use an independent in-memory limiter per replica: rejected because replicas can collectively exceed the reviewed global limit.
- Return unused permits to Redis: rejected because crash and retry races can reissue the same capacity.
- Reserve the complete window in one batch: rejected because the first replica could starve all peers.
