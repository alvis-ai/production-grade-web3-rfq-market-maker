# ADR-0032: Atomically Admit Redis Quote Issuance

## Status

Accepted

## Context

The production quote path previously used one Redis transaction to persist `prepared` state and bind idempotency, then reserved exposure, then used a second Redis transaction to persist risk authorization. This preserved the required order but paid two AOF-backed issuance mutations and projected three cumulative events (`prepared`, `authorized`, `finalized`) for every successful quote.

ADR-0031 showed that SHA-cached scripts removed avoidable script transport without improving p50. The next removable boundary was the separate preparation transaction. Preparation contains snapshot, request and route evidence, but none of that state authorizes key access. It can therefore remain process-local until risk evaluation and exposure admission have completed.

Exposure and issuance remain different authorities and currently use different Redis Cluster hash tags. Combining them in one script would require an exposure-ledger key migration, a larger exact-decimal CAS transaction and a coordinated production epoch change. That is outside this decision.

## Decision

Add an optional `QuoteIssuanceStore.admit()` capability. The Redis implementation invokes one hash-tagged Lua transaction after exposure reservation. The transaction:

- writes one cumulative `authorized` quote record containing snapshot, request, route and risk evidence;
- binds the principal-scoped idempotency owner to the quote;
- stores the exact signer authorization commitment when the decision is approved;
- appends one `authorized` issuance event; and
- returns the compact persisted risk-decision evidence required by the gateway.

The logical authorization hash excludes generated persistence timestamps. It covers the risk input and optional signer commitment, so concurrent retries with the same business input are idempotent even when they execute in different milliseconds. Conflicting policy or signer evidence fails closed.

The gateway calls `admit()` only after an approved exposure reservation, or directly for an already rejected base-risk decision that did not reserve exposure. Admission failure releases a completed exposure reservation best effort and blocks the signer. The existing `prepare()` plus `authorize()` path remains for PostgreSQL, custom stores and rollback compatibility.

The PostgreSQL projector consumes cumulative events. An `authorized` event can create the missing snapshot, requested quote and route before applying the risk decision, so no separate `prepared` event is required. Projection barriers treat `authorized` as newer than `prepared`.

## Consequences

### Positive

- Successful production quotes use two issuance events instead of three.
- The synchronous gateway removes one AOF-backed Redis mutation and one response parse.
- Preparation and authorization become one fail-closed state transition; partial prepared quotes are no longer created by the production Redis path.
- Concurrent identical admission retries create one event and return the same authorization record.
- Existing exposure, signer authorization, atomic signer finalization, nonce and PostgreSQL audit invariants remain intact.

### Negative

- Exposure reservation and issuance admission are still serial Redis transactions.
- An admission failure after exposure requires best-effort release; the deadline-bound reservation remains conservative if release also fails.
- `authorization_persistence` now measures combined preparation and authorization in the Redis path, while `quote_preparation_persistence` remains relevant only to compatibility stores.
- Mixed-version rollout must preserve the cumulative-event projector before gateways start omitting `prepared` events.

### Mitigation

Unit tests preserve both capability paths, require admission after exposure, block signing on malformed evidence and release exposure on admission failure. The real Redis/PostgreSQL test races eight identical admissions, requires one `authorized` event, rejects changed policy evidence, atomically finalizes through the isolated signer, projects exactly two issuance events and one signer-audit event, and verifies exact replay.

After rebuilding the Compose backend and signer, an independent window of 10 warmups and 100 serial HTTP quotes returned zero errors, p50 11.95 ms, p99 16.51 ms and 80.83 requests/second. The preceding SHA-cached baseline was p50 13.00 ms, p99 18.55 ms and 75.15 requests/second. Admission averaged 1.44 ms, exposure 1.44 ms, idempotency 1.12 ms and signing 5.07 ms. This is a measurable p50 improvement, but the p50 target below 10 ms is still not met.

## Alternatives Considered

- Keep separate preparation and authorization transactions: correct, but retains an avoidable serial Redis boundary and event.
- Start preparation concurrently with exposure: the previous behavior hides some latency but still performs both mutations and leaves partial prepared state when exposure fails.
- Atomically combine exposure and issuance immediately: potentially faster, but rejected for this change because the ledgers use different hash slots and the exposure CAS has a larger migration and correctness surface.
- Persist preparation after signing: rejected because the signer must verify durable exact authorization before key access.
- Remove signer authorization or durable finalization: rejected because latency does not justify weakening the key boundary, replay protection or pre-response audit.
