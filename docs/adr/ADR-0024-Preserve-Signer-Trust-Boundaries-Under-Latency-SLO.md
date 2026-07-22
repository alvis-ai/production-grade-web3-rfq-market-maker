# ADR-0024: Preserve Signer Trust Boundaries Under Latency SLO

## Status

Accepted

## Context

ADR-0023 reduced quote-exposure contention enough for three clean concurrency-five dependency-stack runs to meet p99 below 50 ms with zero errors, but the best measured p50 remained 25.81 ms. A fresh concurrency-one run returned p50 14.88 ms and p99 19.44 ms with zero errors. Its average serial stages were 0.61 ms idempotency, 1.93 ms exposure, 0.87 ms authorization, 6.41 ms gateway signing and 1.12 ms finalization. These essential stages already total about 10.94 ms before API parsing, response serialization and scheduling.

The gateway signing stage includes more than secp256k1 arithmetic. The API sends an independently authorized envelope to an isolated signer, the signer validates it, computes the EIP-712 digest, signs with the configured identity, admits durable audit evidence, and returns the signature. The API then independently recovers the signer before finalizing the quote. This separation prevents a compromised API dependency, signer transport, or malformed signer response from silently substituting a different signing identity.

The isolated signer now exports fixed stage histograms. Across 110 calls in the same concurrency-one image, average validation was 0.046 ms, digest 0.272 ms, signature 0.881 ms and durable audit admission 1.096 ms. The measured internal total was about 2.30 ms, leaving roughly 4.1 ms in HTTP/JSON transport and gateway recovery verification. Removing digest work alone cannot close the p50 gap.

## Decision

Keep all current signer trust and durability boundaries while exposing their costs separately:

1. The signer continues to validate the complete authorization envelope before signing.
2. Production key access remains isolated from the API process and only the signer may call KMS/HSM.
3. Durable audit admission remains before a successful signature response.
4. The gateway continues to recover and compare the EIP-712 signer before quote finalization.
5. `rfq_signer_service_stage_latency_seconds{stage}` uses `validation|digest|authorization|signature|audit` and covers both success and failure paths. ADR-0030 adds the persisted authorization read and folds successful terminal quote commit into `audit` without weakening the original trust boundaries.
6. Grafana and Prometheus compare signer-internal stage latency with gateway `signing` latency. Operators alert when any signer stage p95 exceeds 25 ms.
7. The system does not declare p50 below 10 ms satisfied. A future transport or protocol change must include a production load profile, atomic ownership, crash recovery, replay, key-isolation and fail-closed tests before replacing any serial boundary.

The next reviewed candidates are a lower-overhead authenticated local transport between co-scheduled gateway and signer workloads, or a protocol that overlaps work without returning a signature before durable audit admission. Any candidate must preserve independent gateway verification and cannot place KMS credentials in the API.

## Consequences

### Positive

- Latency attribution distinguishes signer computation and audit from transport and gateway verification.
- Alerts identify KMS/HSM saturation separately from Redis audit persistence.
- Existing key isolation, authorization binding, durable audit and signer-identity checks remain intact.
- Benchmark claims remain honest: the measured p99 passes, while p50 still fails.

### Negative

- The current process and network topology retains about 4.1 ms outside signer-internal stages.
- The serial quote path has a measured lower bound above the p50 target before ordinary API overhead.
- A meaningful next improvement requires deployment and protocol design, not only local arithmetic optimization.

### Mitigation

Track gateway signing p95, signer stage p95, event-loop saturation, signer errors and audit backlog in the same time window. Benchmark any transport candidate with real TLS or equivalent workload authentication, real Redis durability, remote-key latency and concurrency before adoption. Preserve the existing HTTP protocol as a rollback path until the replacement passes compatibility, security and failure-injection tests.

## Alternatives Considered

- Remove gateway signature recovery: rejected because it removes the API's independent proof that the response came from the configured trusted signer and still does not recover enough latency to satisfy the full p50 budget.
- Return the signature before audit admission: rejected because a successful executable quote could exist without durable signer evidence after a crash.
- Move the production key into the API process: rejected because it collapses workload identity, network policy and credential-isolation controls.
- Add an arbitrary precomputed-digest signing method: rejected because the measured digest cost is only 0.272 ms, the serial lower bound would remain above target, and the broader raw-digest interface increases misuse risk.
- Declare success from the current p99 result: rejected because the stated acceptance target requires both p50 below 10 ms and p99 below 50 ms under a declared workload.
