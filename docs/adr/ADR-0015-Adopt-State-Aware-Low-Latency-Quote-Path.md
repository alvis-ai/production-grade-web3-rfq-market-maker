# ADR-0015: Adopt a State-Aware Low-Latency Quote Path

## Status

Accepted

## Context

`POST /quote` must return a risk-authorized EIP-712 signed quote while market state is still valid. The latency objective is p50 below 10 ms and p99 below 50 ms under a declared production load profile. Querying PostgreSQL, RPC providers, CEX REST APIs, or a remote signer for every arithmetic input makes that objective structurally unreliable. Caching an entire signed quote is also unsafe because user, nonce, deadline, inventory, route, risk reservation, and signer evidence have different validity and ownership rules.

The repository already streams or polls market sources into process-local snapshots, computes the internal-inventory route and formula price in memory, supports Redis-backed distributed controls, persists audit evidence to PostgreSQL, and exports API latency histograms. It does not yet provide a distributed precomputed graph router or a database-free production signing path. ADR-0017 moved exposure/VaR admission to Redis plus immutable hot state, ADR-0018 moved default Treasury RPC reads into a versioned background-refreshed view, ADR-0019 fused the initial lease protocol, ADR-0023 replaced reserve leasing with generation CAS, and ADR-0020 fused default PostgreSQL issuance into ordered prepare/authorize/finalize statements. Quote creation still performs synchronous Redis issuance/exposure authorization and remote signing. A local in-memory benchmark therefore cannot prove the production SLO.

## Decision

Adopt a three-tier state model and keep the quote arithmetic path state-aware:

1. The real-time tier owns immutable market snapshots, executable CEX depth, gas inputs, inventory views, route candidates, and exact short-TTL pricing results in process memory. WebSocket streams or bounded pull loops update this state. Expensive route candidates are recomputed when state changes, not discovered through database queries on every request. Redis or Valkey distributes versioned hot state and coordinates replicas, but an individual arithmetic lookup should not require a network cache round trip when a validated local version is available.
2. The hot durable tier uses PostgreSQL for principals, API keys, policy/configuration, idempotency, quote lifecycle, risk decisions, exposure audit projection, and settlement ownership. ADR-0017 makes a replicated Redis/Valkey ledger the production authorization source for active quote exposure and mirrors its atomic stream to PostgreSQL. Remaining synchronous lifecycle and risk audit records are still authorization and recovery boundaries, not market-data query inputs.
3. The cold tier uses ClickHouse and retained PostgreSQL audit records for quote history, replay, latency analysis, markout, PnL attribution, and capacity planning. Cold analytics must not be consulted by the synchronous quote calculation.

Wrap only the default deterministic formula pricing engine with a bounded process-local cache. The key includes every request, snapshot, route, inventory-skew, and hedge-cost field consumed by that engine. Entries default to 100 ms TTL and 10,000 items, use LRU eviction, coalesce concurrent identical calculations, and return defensive copies. Failures are never cached. Full quote responses, signatures, nonces, deadlines, risk decisions, exposure reservations, and signer results are never cached. A custom pricing engine is not cached unless its owner makes that policy explicit.

Expose total quote latency and fixed-cardinality dependency-stage latency. The bounded stages cover idempotency, market data, legacy snapshot/quote/risk persistence, fused quote preparation/authorization/finalization, routing, pricing inputs, pricing, inventory projection, risk, treasury liquidity, indexer guard, exposure reservation, and signing. Alert when total p99 exceeds 50 ms or any dependency stage p99 exceeds 25 ms for a sustained window. Metrics failures must not change quote availability.

Use a warm, concurrent local benchmark as a regression gate: 10 warmup requests, 100 measured requests, concurrency 5, p50 at most 10 ms, p99 at most 50 ms, and zero HTTP errors by default. Record throughput and p50/p95/p99/max. A separate external HTTP benchmark applies the same default SLO to a running dependency stack, validates non-loopback HTTPS and optional API-key configuration, and correlates the measured window with pricing-cache and bounded stage-histogram deltas. Production acceptance additionally requires staged tests with real PostgreSQL, Redis, RPC, remote signer, TLS, representative pair/amount distribution, and increasing concurrency. Each result must state its workload and dependency mode; disabling SLO enforcement produces a diagnostic profile, not a pass.

REST remains the supported request interface. A WebSocket quote stream may be added later for repeated subscriptions, but it must invoke the same validation, state-version, risk reservation, signing, and audit boundaries rather than creating a weaker parallel path.

## Consequences

### Positive

- Market-data and formula-pricing work is removed from repeated database queries and duplicate concurrent calculations.
- Fixed stage metrics distinguish event-loop queueing from a slow database, RPC, risk guard, or signer.
- Cache correctness is tied to exact consumed state rather than a broad pair-only key.
- Durable authorization and recovery invariants are preserved while optimization proceeds incrementally.

### Negative

- Process-local caches are duplicated across replicas and may have lower hit rates when traffic is widely distributed.
- Exact keys and short TTLs intentionally limit hit ratio when snapshots, inventory, routes, or users change.
- Synchronous PostgreSQL, Redis lease contention, indexer evidence, and remote signing can still prevent the production p50 target even when arithmetic and Treasury lookup are in memory.
- Dependency observation and cache bookkeeping add a small amount of CPU and allocation to each process.

### Mitigation

Track pricing hit/miss rates, exposure lock/backlog/mirror health, Treasury generation freshness, stage p99, event-loop saturation, replica concurrency, and signer throughput together. Prefetch and version market/route state, use sticky routing only when it does not weaken availability, and scale API replicas before queueing dominates p50. Keep TTL below the shortest source-state validity window. ADR-0017 supplies the reviewed exposure ledger and ADR-0018 supplies the Treasury hot view; any proposal to remove the remaining synchronous quote lifecycle, risk audit, indexer, Redis admission, or signer boundary must still specify atomic ownership, crash recovery, replay, reconciliation, and fail-closed production fault tests.

## Alternatives Considered

- Query PostgreSQL or Redis for every quote input: rejected because network storage latency and tail amplification would dominate a millisecond arithmetic path.
- Cache complete signed quote responses by pair and amount: rejected because identity, nonce, deadline, risk, inventory, reservation, and signature evidence cannot be safely shared or reused.
- Move all persistence after the HTTP response immediately: rejected because the current database records are authorization and recovery boundaries; asynchronous audit is unsafe without a durable reservation ledger and WAL/outbox design.
- Declare the SLO satisfied from a serial local benchmark: rejected because it omits queueing, network, PostgreSQL, Redis, RPC, KMS, TLS, and representative production contention.
- Introduce a WebSocket-only fast path with reduced checks: rejected because transport choice must not change quote correctness or risk policy.
