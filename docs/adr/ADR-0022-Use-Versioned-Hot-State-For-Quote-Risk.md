# ADR-0022: Use Versioned Hot State For Quote Risk

## Status

Accepted

## Context

ADR-0021 removed synchronous PostgreSQL quote issuance, but the default production quote path could still call PostgreSQL for global/pair quote control, dynamic toxic-flow scores, UTC-day realized-loss evidence, recent hedge-failure penalties and settlement-indexer cursors. Dedicated token/USD validation and managed-pair market data could also fall through to request-time RPC when caches were cold. Those boundaries made latency depend on database pool contention, RPC tail latency and external availability. They also made the p50 target below 10 ms structurally unlikely even when the pricing calculation itself was sub-millisecond.

PostgreSQL and chain RPC remain necessary. They are authoritative control, accounting and audit inputs, but they do not need to be query engines for every quote. The API needs a bounded way to consume their latest complete state without returning a quote from partial, missing or indefinitely stale evidence.

## Decision

The default gateway warms and continuously refreshes immutable process-local generations for:

- global and normalized pair quote-control state;
- bounded dynamic toxic-flow scores;
- configured UTC-day realized-loss evidence;
- recent hedge-failure pricing penalties;
- dedicated token/USD health evidence;
- settlement-indexer cursor plus RPC-head evidence.

Market-data pairs are also warmed before the server accepts traffic. A managed pair cache miss never falls through to the Chainlink provider on the quote request. Treasury and canonical inventory/valuation state retain their existing specialized hot views.

Every shared snapshot uses single-flight refresh, validates complete target coverage, and atomically replaces one generation only after the full load succeeds. Startup waits for the first complete generation. Request reads are process-local and fail closed when state is uninitialized, missing or older than `RFQ_HOT_STATE_MAX_AGE_MS`. The maximum age must cover at least two `RFQ_HOT_STATE_REFRESH_INTERVAL_MS` periods. An administrative compare-and-set update is still committed to PostgreSQL first, then merged into the current generation so a slower refresh cannot roll back a newer version.

Toxic-flow preload is capped by `RFQ_TOXIC_FLOW_HOT_STATE_MAX_ENTRIES`; refresh fails rather than silently truncating risk evidence. PostgreSQL remains the update and audit authority. Chain RPC and PostgreSQL are used by background loaders and readiness, not by default quote calculation. Redis/Valkey remains on the synchronous path for distributed rate limiting, quote exposure and quote issuance because those operations require cross-replica atomicity.

Prometheus exposes `rfq_hot_state_refreshes_total{state,outcome}` and `rfq_hot_state_last_success_unixtime_seconds{state}` with fixed state labels. Existing `rfq_quote_latency_seconds`, `rfq_quote_stage_latency_seconds` and signer histograms identify the remaining request-path budget. Refresh failures emit bounded transition logs, preserve the previous generation only until its freshness deadline, and then block signing.

## Consequences

### Positive

- Default quote pricing and risk evaluation no longer perform PostgreSQL or chain-RPC reads.
- Database pool and RPC tail latency no longer directly determine quote latency.
- Startup and stale-generation failures are explicit and fail closed before signing.
- One immutable generation prevents readers from observing partially refreshed multi-target state.
- Fixed-label metrics support freshness and failure alerts without user, token or pair cardinality.
- `gateway-application.ts` remains a bounded composition root; hot-state and risk construction live in dedicated runtime modules.

### Negative

- Each API replica holds its own generation and may differ from another replica by up to the configured refresh/freshness window.
- A large toxic-flow set consumes memory on every API replica; capacity must be reviewed before increasing the bound.
- PostgreSQL/RPC recovery does not immediately restore quoting if a complete refresh still fails validation.
- Administrative writes and background reads need version-aware merge semantics.
- This change does not remove remote signer latency or Redis/Valkey round trips and therefore does not by itself prove the p50/p99 SLO.

### Mitigation

Readiness checks the same fresh snapshots used by quotes. Tests require request reads to avoid source point queries, stale state to fail closed, complete startup coverage, single-flight refresh and preservation of newer compare-and-set writes. Alerts trigger on refresh failures and on last-success age beyond the operating window. Capacity planning treats the toxic-flow maximum and refresh query cost as explicit deployment inputs.

The rebuilt Compose dependency benchmark used 10 warmups and 100 measured quotes. At concurrency one it returned zero errors, p50 19.50 ms and p99 28.72 ms; signing averaged 7.45 ms, exposure 3.59 ms, and the idempotency plus three issuance stages totaled 5.86 ms. At concurrency five it returned zero errors, p50 32.51 ms and p99 76.24 ms; signing averaged 9.22 ms and exposure 9.35 ms. Risk remained 0.10-0.11 ms and market/pricing hot reads about 0.01 ms. The previous base-risk errors disappeared, but the p50/p99 SLO did not pass. The next optimization must reduce signer and Redis network serialization while retaining durable authorization, nonce and exposure semantics.

## Alternatives Considered

- Query PostgreSQL on every quote: rejected because pool contention and database tail latency remain in the critical path.
- Use Redis as a cache for every risk input: rejected for this phase because these datasets are bounded per replica, process-local reads are faster, and Redis would add another network dependency; Redis remains appropriate for cross-replica atomic state.
- Serve stale state during dependency outages: rejected because stale controls, accounting or oracle evidence can authorize unsafe quotes.
- Refresh each target independently: rejected because readers could combine evidence from partial generations and target coverage would be ambiguous.
- Silently truncate toxic-flow scores to fit memory: rejected because omitted high-risk principals would become an unsafe false negative.
- Remove distributed issuance/exposure durability for latency: rejected because duplicate nonces and oversubscribed risk are correctness failures, not acceptable performance tradeoffs.
