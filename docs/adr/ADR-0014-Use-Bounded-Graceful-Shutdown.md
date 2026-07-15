# ADR-0014: Use Bounded Graceful Shutdown

## Status

Accepted

## Context

The RFQ API and five durable workers stop accepting new work on `SIGTERM` or `SIGINT`, then close HTTP listeners, finish the active iteration, disconnect external clients, and release PostgreSQL resources. Those operations can wait indefinitely when a client, socket, RPC, Kafka broker, ClickHouse endpoint, venue, or database is unavailable. Kubernetes eventually sends `SIGKILL`, but an unobserved kill provides no application-level failure code and can interrupt quote responses, settlement indexing, hedge reconciliation, or analytics acknowledgement at an arbitrary point.

Kubernetes currently allows 30 seconds for Pod termination. A five-second `preStop` delay is required before the signal so EndpointSlice and ingress changes can propagate. The application therefore cannot consume the full grace period and still leave kubelet a reliable safety margin.

## Decision

Use one shared bounded-shutdown controller for the API, hedge worker, analytics worker, reconciliation worker, settlement indexer, and toxic-flow analyzer. `RFQ_SHUTDOWN_TIMEOUT_MS` defaults to and is deployed as 20,000 ms, accepts only base-10 integers from 1,000 through 120,000, and reads only an own environment field.

The first termination signal starts the deadline before invoking the component stop callback. API shutdown stops Fastify immediately; workers stop claiming or polling for new work and let the current bounded operation return before closing health servers and dependencies. Successful cleanup clears the deadline and removes both signal listeners. A second signal means an operator or supervisor requires immediate termination, so the process logs bounded metadata and exits with code 1. Deadline expiry does the same with `PROCESS_SHUTDOWN_TIMEOUT`; raw errors, request data, credentials, and task identifiers are not logged.

API resource cleanup uses one explicit dependency-ordered chain instead of relying on Fastify's reverse `onClose` hook order. It first clears market-data timers and awaits the single in-flight price refresh or snapshot persistence cycle, then closes Redis/KMS resources, and closes the owned PostgreSQL pool last. A cleanup failure is retained as the shutdown result but does not prevent later resources from being released.

Every backend Kubernetes Deployment uses `terminationGracePeriodSeconds=30` and a five-second `preStop` sleep. The reviewed budget is therefore five seconds for endpoint removal, twenty seconds for application cleanup, and five seconds of kubelet margin. Helm schema validates each scalar and a template helper rejects any combination where shutdown timeout plus `preStop` plus the five-second margin exceeds the termination grace period. Compose applies the same application deadline without Kubernetes `preStop`.

## Consequences

### Positive

- A stuck dependency cannot keep a terminating process alive until an unexplained kubelet kill.
- API and worker entrypoints share signal, repeated-signal, deadline, logging, and exit semantics.
- Rollout timing is an enforceable deployment invariant rather than an operator convention.
- Durable leases, idempotency records, external client ids, and replayable queues remain the recovery boundary after forced exit.

### Negative

- A legitimate operation that exceeds twenty seconds can be interrupted and retried or reconciled.
- Process exit on deadline does not run additional JavaScript cleanup and can lose buffered non-durable telemetry.
- Extending an external request timeout may also require a reviewed shutdown and Kubernetes budget change.

### Mitigation

Keep every external operation bounded below the application deadline where practical. Persist intent and idempotency evidence before external side effects, query external state before retry, and use lease expiry plus reconciliation after forced exit. Alert on non-zero Pod termination and search structured logs for `PROCESS_SHUTDOWN_TIMEOUT` or `PROCESS_SHUTDOWN_FORCED`. Exercise one normal drain and one deliberately blocked drain in staging before production rollout.

## Alternatives Considered

- Rely only on Kubernetes `terminationGracePeriodSeconds`: rejected because kubelet `SIGKILL` has no application-level diagnosis and provides no second-signal behavior outside Kubernetes.
- Wait indefinitely for all cleanup: rejected because rolling updates and node drains can stall while traffic capacity and disruption budgets remain occupied.
- Exit immediately on the first signal: rejected because it unnecessarily interrupts in-flight HTTP requests and recoverable worker operations.
- Give each process a separate timeout and signal implementation: rejected because drift would make rollout behavior depend on which entrypoint happens to run.
- Increase the Kubernetes grace period without an application deadline: rejected because it delays the same uncontrolled failure rather than bounding it.
