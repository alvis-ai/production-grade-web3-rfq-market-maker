# ADR-0018: Use Versioned Hot Treasury State

## Status

Accepted

## Context

Treasury output capacity is a pre-sign risk invariant: every API replica must reject a quote when existing reservations plus the candidate `amountOut` exceed the actual custody balance. The first receipt-confirmed implementation queried `eth_chainId`, `RFQSettlement.treasury()` and `tokenOut.balanceOf(treasury)` during each `/quote`. This preserved correctness but put RPC network latency and availability directly on the quote critical path.

The production objective is p50 below 10 ms and p99 below 50 ms. A request-time RPC cannot reliably fit that budget across providers, regions and transient retries. Removing the read without a bounded replacement is unsafe: a process-local balance with no generation, target coverage or expiry rule can remain valid-looking after a partial refresh, chain mismatch, settlement outflow or updater failure.

At the same time, PostgreSQL quote idempotency and lifecycle writes added avoidable network round trips. Independent preparation work inside Quote Service was also serialized even when no correctness dependency required that order.

## Decision

The default receipt-confirmed gateway wraps the on-chain `TreasuryLiquidityProvider` in `RefreshingTreasuryLiquidityView`.

- Startup synchronously warms every deduplicated `(chainId, token)` target derived from both sides of all managed pairs. Readiness is not reached without a complete first generation.
- A bounded background pull refresh loads all targets concurrently. Each source result must match its requested chain/token and contain canonical settlement, Treasury, uint256 balance and block evidence.
- A new immutable generation is published only after every target validates. A partial or failed refresh never mutates the visible generation.
- `getLiquidity()` performs only a process-memory lookup and returns a defensive copy. Missing targets, incomplete coverage, future clock state or age above `RFQ_TREASURY_LIQUIDITY_MAX_AGE_MS` fail closed.
- `RFQ_TREASURY_LIQUIDITY_REFRESH_INTERVAL_MS` defaults to 100 ms. Maximum age defaults to 1000 ms, must cover at least two refresh intervals and remains a reviewed deployment value.
- `RFQ_QUOTE_EXPOSURE_EXPIRY_GRACE_SECONDS` must be strictly longer than the Treasury maximum age, preventing an expiring reservation and a not-yet-refreshed custody balance from both disappearing during the same consistency window.
- The fresh observed balance and block enter the existing Redis/Valkey chain lease and exact-integer Lua commit. Redis remains the cross-replica admission authority; PostgreSQL remains the durable audit/query projection.
- An explicitly injected custom Treasury provider keeps ownership of its own lifecycle and consistency contract and is not silently wrapped. The standard production composition always uses the versioned hot view.

Quote Service starts market-snapshot persistence and idempotency quote binding concurrently, and evaluates inventory skew plus both hedge-risk penalties concurrently after route persistence. PostgreSQL idempotency acquisition uses a one-statement insert on the uncontended path and starts a locking transaction only after conflict. The requested-to-signed common path uses one identity-bound compare-and-set upsert; only a CAS miss performs a diagnostic replay read, while the database unique nonce constraint remains authoritative.

## Consequences

### Positive

- Treasury RPC is removed from the individual quote request path without weakening the pre-sign balance gate.
- Every request observes one complete generation; it cannot combine old and new target entries from a partial refresh.
- A failed updater has a bounded stale-while-error window and then blocks signing automatically.
- Common quote persistence performs fewer PostgreSQL round trips, and independent work overlaps.
- Existing `treasury_liquidity` stage timing now measures an in-memory read and validation rather than provider network latency.

### Negative

- Treasury capacity may conservatively lag the chain by up to the configured freshness window.
- Every API replica performs background RPC reads, so target count, refresh interval and provider capacity must be reviewed together.
- Process-local generations are not a global cache. Redis still serializes admission, and each pod must independently remain fresh before serving traffic.
- The quote path still contains synchronous audit persistence, durable remote signing and a chain-scoped Redis lease; this ADR alone cannot meet the complete latency objective.

### Mitigation

Focused tests prove startup warmup, no source call during request reads, defensive copies, all-target atomic publication, failed-refresh retention followed by stale rejection, mismatched source evidence rejection, target deduplication and the expiry-grace bound. Quote Service gate tests prove that snapshot persistence overlaps idempotency binding and that inventory/hedge pricing inputs overlap. PostgreSQL repository tests assert the one-query common paths and conflict-only fallbacks.

The local dependency-stack benchmark used real HTTP, PostgreSQL, Redis and the isolated signer with 10 warmups and 100 measured requests. At concurrency one it reported p50 28.74 ms, p99 38.23 ms and 34.41 requests/second. At concurrency five, the first run reported p50 51.93 ms, p99 68.97 ms and 95.79 requests/second; a clean-window repeat reported p50 45.04 ms, p99 63.49 ms and 106.25 requests/second with no errors. In the repeat, exposure reservation averaged 12.84 ms and signing averaged 11.43 ms.

The Compose benchmark does not configure `RFQ_RECEIPT_CONFIG_JSON`, so it does not exercise Treasury RPC or the new hot view; that behavior is established by focused tests and deployment validation, not inferred from these latency numbers. The measured system still fails p50 below 10 ms and p99 below 50 ms. The next work must target durable signer latency, Redis chain-lease contention and remaining synchronous lifecycle/risk persistence without weakening durability.

## Alternatives Considered

- Query Treasury RPC on every quote: rejected because external network latency and availability sit directly inside the SLO.
- Cache each token independently and publish immediately: rejected because requests could observe a partial refresh with inconsistent target coverage.
- Serve stale state indefinitely after refresh failure: rejected because capacity can be overstated after custody outflow or settlement.
- Read the latest Treasury balance from PostgreSQL: rejected because it moves an aggregate database query back onto the request path and cannot prove current custody state.
- Remove Treasury admission and rely on settlement revert: rejected because signed quotes are maker liabilities and expected reverts waste user gas and expose capacity races.
