# ADR-0033: Atomically Admit Exposure And Issuance

## Status

Accepted

## Context

ADR-0032 reduced Redis issuance preparation and authorization to one cumulative `authorized` mutation, but an approved quote still executed exposure CAS and issuance admission as two serial Redis round trips. The measured clean local Compose baseline was p50 11.95 ms and p99 16.51 ms, with exposure and authorization persistence averaging 1.44 ms each. This remained above the p50 target of 10 ms even though route, pricing and risk computation were already process-local.

Exposure cannot be moved after authorization: the isolated signer treats durable authorization as permission to access the signing key, so authorization without exact reserved capacity is unsafe. Issuance cannot be made asynchronous: a process crash after returning a signature must leave independently recoverable request, route, risk and idempotency evidence. The removable boundary is therefore the network round trip between the two durable mutations, not either invariant.

The previous defaults used different Redis Cluster hash tags, `{quote-exposure}` and `{quote-issuance}`. Redis Cluster cannot execute one script across those slots. A coordinated key-family migration is required.

## Decision

Use one Redis Lua transaction for an approved quote's exposure reservation and cumulative issuance admission. The production defaults become:

- exposure prefix: `rfq:{quote-state}:exposure`;
- issuance prefix: `rfq:{quote-state}:issuance`; and
- signer audit stream: `rfq:{quote-state}:signer-audit-events:v1`.

The transaction runs both preflight phases before admitting new quote state. Exposure preflight performs expiration cleanup, generation comparison, exact decimal-string user/pair/Treasury checks and backlog validation. Issuance preflight validates existing quote identity, preparation and authorization hashes, idempotency ownership, cumulative payload shape and backlog. Only after both pass does the script apply exposure first and issuance second, then return compact exposure and risk-decision evidence.

Identical retries may observe either or both records and return duplicate evidence without new events. Exposure policy rejection returns without an issuance write; the gateway then uses the existing direct admission path to persist the rejected risk decision for audit. An issuance conflict returns before a new exposure write. An unexpected apply-time failure after exposure application remains conservative: the signer has no accepted new authorization response and the deadline-bound exposure is retained for cleanup/reconciliation.

The joint store is optional and is installed only when both production runtimes expose concrete Redis stores with the same normalized Redis authority, Cluster hash tag, AOF policy, replica acknowledgement count and acknowledgement timeout. Any mismatch fails startup. PostgreSQL and custom stores retain the existing separate capability path.

The gateway may overlap the isolated signer request with the final Redis admission command only when all three capabilities are present: joint admission, atomic signer finalization and `durable_authorization_wait_v1`. The signer may validate the authenticated envelope and compute its EIP-712 digest while admission is in flight, but it cannot access Local/KMS key material until an exact cumulative `authorized` record is read from Redis. `RFQ_SIGNER_AUTHORIZATION_WAIT_MS` bounds this race window to 0-100 ms and is 10 ms in the reviewed manifests. Only a missing key is retried at 1 ms intervals; malformed, rejected or conflicting state fails immediately.

The overlap starts after exposure policy evaluation and immediately before the combined Redis command. If the gateway loses or cannot parse the admission response after starting the signer, it performs atomic finalization recovery before deciding whether exposure can be released. A recovered or independently verified signer response is returned, proven absence permits release, and ambiguous recovery retains deadline-bound exposure for reconciliation. The signer server also reuses the validated EIP-712 digest for Local/KMS signing instead of hashing the same typed quote twice; gateway signature recovery and finalization-hash verification remain mandatory.

## Consequences

### Positive

- The approved quote path removes one serial Redis network round trip while preserving exact exposure and pre-sign authorization.
- Exposure and issuance either admit together or fail before new quote state for all expected conflicts and policy rejections.
- One `WAIT` covers the combined mutation under the shared durability policy.
- Concurrent identical retries create one exposure event and one cumulative `authorized` issuance event.
- PostgreSQL remains an asynchronous query/audit projection and is never queried by quote admission.
- Signer validation, EIP-712 digest calculation and transport now overlap the combined Redis mutation without allowing pre-authorization key access.

### Negative

- Exposure, issuance and signer audit keys now share a Cluster slot, increasing the traffic concentrated on that slot.
- Production rollout requires a new reviewed key epoch; old prefixes cannot be renamed in place or mixed with new gateways.
- The combined Lua script is larger and has a wider correctness surface than either standalone script.
- Exposure rejections still require a second, error-path issuance mutation to persist rejection evidence.
- Missing authorizations can generate a small bounded number of Redis `GET` retries; the internal endpoint must remain authenticated and capacity-limited.
- A catastrophic Redis apply-time error after exposure writes may leave conservative capacity until explicit release or deadline cleanup.

### Mitigation

The standalone scripts are composed from the same preflight/apply fragments used by the combined script. Unit tests preserve standalone evidence parsing, validate joint success/rejection/malformed results, require release on malformed reserved evidence, and reject authority, hash-tag or durability mismatch. A real Redis integration test races eight identical admissions, proves one event per ledger, proves exposure rejection writes neither ledger, and proves an issuance conflict writes no exposure.

Authorization-wait tests prove that a delayed missing record becomes signable, a permanently missing record times out, and a conflicting record performs exactly one read. Quote orchestration tests prove signing starts at the commit boundary, ambiguous admission replies recover committed responses, and exposure is released only when recovery proves no signer commit. The final rebuilt local Compose dependency stack with 10 warmups and 100 serial measured HTTP requests produced zero errors, p50 8.87 ms, p99 16.39 ms and 105.16 requests/s under a strict 9.99 ms p50 gate.

Rollout pauses quote admission, drains both old Streams, deploys compatible signer and gateway binaries, bootstraps empty `{quote-state}` prefixes under reviewed epochs, verifies AOF and replicas, then enables traffic with one canary. Rollback also pauses admission and returns all components to the old epoch together; mixed key families are prohibited.

## Alternatives Considered

- Keep two serial Redis scripts: correct but retains the measured removable latency.
- Run both scripts concurrently: rejected because authorization could commit when exposure rejects or conflicts.
- Write issuance before exposure: rejected because it can authorize signer key access without reserved capacity.
- Remove replica acknowledgement or AOF: rejected because lower latency cannot replace durable pre-response authorization and audit.
- Use PostgreSQL transactions across both ledgers: rejected because PostgreSQL is not on the production quote path and cannot meet the target latency.
- Use Redis `MULTI` from the gateway: rejected because exact conditional checks, expiration cleanup and cumulative evidence need server-side logic and one deterministic result.
