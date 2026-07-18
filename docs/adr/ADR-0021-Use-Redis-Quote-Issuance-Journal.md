# ADR-0021: Use Redis Quote Issuance Journal

## Status

Accepted

## Context

ADR-0020 reduced default quote issuance from eight PostgreSQL operations to an idempotency claim plus three fused statements. The real dependency-stack benchmark improved, but a successful quote still crossed PostgreSQL four times before returning. At concurrency one it reported p50 21.83 ms and p99 33.39 ms; at concurrency five it reported p50 36.66 ms and p99 49.72 ms. The p50 objective below 10 ms remained structurally incompatible with synchronous database issuance.

Moving the writes after the response without a durable authority was not acceptable. Idempotency ownership, nonce uniqueness, risk authorization evidence, signed-response replay, crash recovery, status visibility, exposure foreign-key ordering and audit backpressure all need explicit semantics before PostgreSQL can leave the response path.

## Decision

Use a hash-tagged Redis/Valkey keyspace as the production hot authority for quote idempotency and cumulative issuance state. Lua transitions atomically validate exact payload hashes, advance `prepared -> authorized -> finalized` or `failed`, update principal-scoped idempotency state, enforce nonce uniqueness, append a schema-versioned Stream event and reject admission at a bounded backlog. Replays succeed only when the complete immutable payload matches. Preparation may overlap the independent Redis exposure calculation, but authorization still waits for both operations and signing still waits for durable authorization.

Each Stream event carries cumulative quote and idempotency state. A consumer group projects events into PostgreSQL under a quote- or idempotency-scoped advisory transaction lock. Migration `038-quote-issuance-journal.sql` adds append-only `quote_issuance_journal_events` and ordered `quote_issuance_projection_versions`. The projector applies only missing stages, rejects epoch changes or lifecycle regression, records stale/duplicate events, marks the projected stage in Redis, then acknowledges and deletes the Stream entry. A later cumulative event can recover a missing earlier event without weakening exact replay checks.

Exposure and issuance use independent Streams, so the exposure projector waits for the quote's `prepared` projection marker before inserting its foreign-key child. This is an asynchronous audit ordering barrier and is not part of the quote response latency. The mirror acknowledgement script returns the remaining Stream length so backlog gauges converge to zero without another Redis round trip.

`GET /quote/:id` reads Redis hot status only while PostgreSQL is behind; after projection it falls back to the canonical PostgreSQL lifecycle so settlement updates are not masked by stale hot issuance state. `POST /submit` waits for the matching signed quote's `finalized` projection before entering the PostgreSQL post-trade transaction. A bounded projection timeout fails closed instead of producing an immediate not-found or foreign-key race.

Production requires `rediss://`, healthy AOF persistence, at least one successful `WAIT` replica acknowledgement, an explicitly bootstrapped ledger epoch, bounded hot-state/idempotency TTLs and a finite maximum backlog. It must not fall back automatically to PostgreSQL because two simultaneous issuance authorities can sign conflicting nonces or idempotency responses. PostgreSQL remains the long-lived audit, query and post-trade authority; it is no longer queried by the successful production quote issuance response path.

## Consequences

### Positive

- Idempotency, prepare, authorize and finalize no longer issue synchronous PostgreSQL queries on the production quote response path.
- Exact cross-replica ownership, nonce uniqueness, risk-before-signing and signed-response replay remain atomic.
- PostgreSQL outages are absorbed up to a reviewed Stream backlog instead of immediately adding request latency; reaching the bound stops new issuance.
- Ordered cumulative projection handles consumer crashes, stale claims, duplicate delivery and exposure foreign-key ordering.
- Hot quote status and submit projection barriers make the temporary Redis/PostgreSQL consistency window explicit.

### Negative

- Redis is now an issuance authority, not a disposable cache; complete cluster loss is a signing incident.
- Three sequential issuance mutations and remote signing still add network latency even though PostgreSQL is absent.
- The projector creates write amplification in PostgreSQL and needs capacity independent of API replicas.
- Dynamic toxic-flow and daily-loss evidence were remaining synchronous PostgreSQL boundaries at acceptance time; ADR-0022 subsequently moves them into versioned process-local snapshots.
- The measured p50 remains above 10 ms; this ADR does not declare the high-frequency quote SLO satisfied.

### Mitigation

Focused tests cover runtime durability policy, preparation/exposure overlap, failed-preparation release, cumulative projection, duplicate delivery and retained events after PostgreSQL failure. A real Redis/PostgreSQL integration finalizes a quote while PostgreSQL is unavailable to the response path, then starts the mirror and requires the signed quote, approved risk, succeeded idempotency response, three audit events, final projection marker and zero backlog to converge.

The final rebuilt dependency-stack diagnostic used 10 warmups and 100 measured requests. At concurrency one it reported p50 19.30 ms, p99 42.19 ms, 48.00 requests/second and zero errors; signing averaged 7.65 ms while idempotency plus the three issuance stages averaged 0.95 ms, 1.30 ms, 1.38 ms and 1.65 ms. A concurrency-five run with the exposure projection barrier reported p50 35.91 ms and p99 54.94 ms, but eight base-risk requests failed closed and the run therefore did not pass. Both Stream backlogs drained to zero with zero mirror errors. ADR-0022 subsequently replaces request-time dynamic risk reads with versioned hot state; signer plus issuance round trips remain, and durability settings must not be weakened to improve benchmark numbers.

## Alternatives Considered

- Keep fused PostgreSQL issuance: rejected because four synchronous database queries still dominate a sub-10-ms p50 budget.
- Return before any durable mutation: rejected because a crash can lose idempotency ownership, authorization evidence or the only signed response.
- Use Redis only as a cache in front of PostgreSQL: rejected because the synchronous database authority would remain on the response path.
- Send independent non-cumulative events: rejected because a lost or poison earlier event could permanently block reconstruction of later state.
- Remove the exposure foreign key: rejected because it hides cross-stream ordering bugs and weakens audit integrity.
- Automatically fall back to PostgreSQL: rejected because mixed authorities can create conflicting issuance decisions during a partition.
