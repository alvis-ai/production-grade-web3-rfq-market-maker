# ADR-0031: Use SHA-Cached Redis Scripts

## Status

Accepted

## Context

The quote issuance, exposure admission and atomic signer commit stores execute reviewed Lua transactions on every successful quote. The exposure transaction includes exact decimal-string arithmetic and is substantially larger than the other scripts. ADR-0019 identified sending the complete script through `EVAL` on every command as a possible future optimization, but the production path had not measured whether script transport or durable Redis mutation dominated latency.

Redis state also crosses gateway and signer processes. Idempotency acquisition uses Redis server time, while later issuance mutations previously copied each process's wall clock into `updatedAtMs`. Small host-clock differences and Redis Lua cjson number normalization could therefore produce a cumulative quote record whose update time preceded its prepare time. The parser correctly rejected that state, but the mutation protocol should prevent it.

## Decision

Compile each reviewed issuance, exposure and atomic signer Lua source to its Redis SHA1 at process startup. Steady-state execution uses `EVALSHA`. Only an exact Redis `NOSCRIPT` error falls back to `EVAL`, which both executes and loads the same source. Other Redis errors remain authoritative and fail closed. Eval-only test doubles and custom clients remain supported so protocol tests continue to inspect the exact source and arguments.

Keep the helper bounded and independent of store semantics. It validates the key count, computes SHA1 with Node's cryptographic implementation, and does not retry transport, authorization, replica, AOF or malformed-response failures.

Every issuance mutation that rewrites an existing idempotency or quote record sets its update time to `max(candidateTime, current.updatedAtMs)`. Stream events use that same monotonic value. The signer atomic commit applies the same rule. Deadlines and lease expiry are unchanged; this only prevents audit time from moving backward across hosts or cjson encode/decode cycles.

## Consequences

### Positive

- Steady-state requests send a 40-character SHA1 instead of multi-kilobyte Lua source while retaining the exact reviewed transaction.
- Redis script-cache loss is recovered without weakening error handling or adding a permanent preload dependency.
- Quote and idempotency audit timestamps cannot regress across gateway and signer clocks.
- Existing AOF, replica acknowledgement, hash-slot, exposure CAS, authorization commitment and PostgreSQL projection semantics are unchanged.

### Negative

- The first execution after Redis script-cache loss pays a failed `EVALSHA` round trip followed by `EVAL`.
- SHA-cached execution adds a small shared abstraction and does not reduce the number of durable Redis state transitions.
- A Redis SHA1 identifies script content; it is not an authorization signature or replacement for the quote commitment hashes.

### Mitigation

Unit tests require steady-state `EVALSHA`, exact `NOSCRIPT` fallback, non-`NOSCRIPT` failure propagation, eval-only compatibility and invalid key-count rejection. Real Redis tests retain exact-integer exposure, Treasury atomicity, idempotent replay, three issuance events, one signer audit event and PostgreSQL projection.

The rebuilt dependency stack used 10 warmups and 100 serial requests with zero errors. It returned p50 13.00 ms, p99 18.55 ms and 75.15 requests/second, compared with the immediately preceding p50 12.96 ms, p99 21.13 ms and 73.21 requests/second window. Exposure averaged 2.21 ms instead of 2.40 ms, while authorization remained 1.38 ms and signing remained 5.23 ms. The isolated signer averaged 0.65 ms for authorization and 2.08 ms for atomic audit/finalization. The result removes avoidable script transport and improves this tail window, but it is not evidence of a p50 improvement or completion of the high-frequency target. Further work must reduce durable state-transition count.

## Alternatives Considered

- Continue sending every script through `EVAL`: correct, but wastes bandwidth and repeated command parsing for no semantic benefit.
- Preload scripts and fail readiness when the cache is empty: rejected because Redis can flush its script cache after readiness; exact `NOSCRIPT` recovery is still required.
- Fall back to `EVAL` for any Redis error: rejected because READONLY, transport, timeout and authorization failures must not be converted into retries with ambiguous mutation state.
- Relax timestamp validation: rejected because non-monotonic cumulative audit records hide clock and protocol faults instead of preventing them.
- Treat SHA-cached scripts as the p50 solution: rejected by the measured result; AOF-backed admission and signer transactions still dominate.
