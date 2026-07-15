# ADR-0012: Use API HPA And Workload Disruption Budgets

## Status

Accepted

## Context

The API, internal frontend, and five post-trade workers run as replicated Kubernetes Deployments, but fixed replica counts alone do not express how the system should react to API demand or voluntary node disruption. A node drain could evict multiple replicas of one component at once, while an API traffic spike could exhaust the fixed capacity even though the application is stateless and already exposes readiness probes and CPU requests.

CPU utilization is a defensible first autoscaling signal for the synchronous API because request processing consumes CPU and every replica serves the same routes. It is not a defensible signal for polling workers: hedge, analytics, reconciliation, settlement-indexer, and toxic-flow throughput is governed by durable backlog, external dependency latency, leases, and venue or chain limits. A worker can have low CPU while its queue is critically delayed.

## Decision

Run an `autoscaling/v2` HorizontalPodAutoscaler for the API only. It keeps at least two replicas, permits up to ten, targets 70 percent average CPU utilization relative to the configured CPU request, allows prompt scale-up, and applies a 300-second scale-down stabilization window with a 25-percent-per-minute reduction limit. Metrics Server or an equivalent `metrics.k8s.io` provider is a cluster prerequisite.

Create a `policy/v1` PodDisruptionBudget for the API, internal frontend, and every enabled worker. Each budget selects exactly one Deployment component, permits at most one unavailable replica, and uses `AlwaysAllow` for unhealthy Pod eviction so a permanently unready Pod cannot deadlock node maintenance. Default Helm values keep every workload at two replicas or more; operators must not reduce a protected workload to one replica and claim high availability.

Apply two hard `topologySpreadConstraints` to every Deployment. Both use `maxSkew=1`, `minDomains=2`, and `whenUnsatisfiable=DoNotSchedule`; one uses `kubernetes.io/hostname` and the other uses `topology.kubernetes.io/zone`. Every selector is identical to its owning Deployment selector. Production therefore requires Kubernetes 1.31 or newer and at least two eligible nodes in two correctly labeled zones. If that prerequisite is unavailable, Helm rejects the cluster version or the second replica remains Pending instead of creating a false high-availability state in one failure domain.

Do not add CPU-based worker HPAs. Worker replica counts remain explicit until queue-age or queue-depth metrics are available through a reviewed custom metrics adapter. Those future HPAs must preserve lease and external-rate-limit constraints and receive a separate decision update.

## Consequences

### Positive

- API capacity can respond to sustained traffic without manual replica changes.
- Scale-down is deliberately slower than scale-up, reducing quote-capacity oscillation and KMS connection churn.
- Eviction-aware maintenance cannot voluntarily remove more than one healthy replica of a component at a time.
- PDB selectors and HPA targets are explicit in both raw manifests and Helm-rendered resources.
- The minimum two replicas of every component are forced onto distinct nodes and zones, so one node or zone failure cannot remove both planned replicas.
- Worker scaling does not pretend that CPU utilization represents durable backlog pressure.

### Negative

- The API HPA depends on a functioning resource metrics pipeline and correct CPU requests.
- PDBs do not constrain direct Pod or Deployment deletion, and topology spreading cannot prevent correlated regional, control-plane, or dependency failure.
- `AlwaysAllow` can evict an unhealthy Pod even when the healthy replica count is already below the normal budget.
- Fixed worker replica counts still require operator action when durable backlog grows.
- A cluster with fewer than two eligible nodes or zones, missing standard topology labels, or insufficient cross-zone capacity cannot schedule all replicas.

### Mitigation

Alert on HPA maximum saturation, missing metrics, unschedulable Pods, unavailable replicas, worker queue age, lease conflicts, and dependency latency. Verify standard zone and hostname labels plus spare capacity before rollout, keep at least two replicas for every enabled workload, use the Eviction API for maintenance, and preserve graceful shutdown. Validate that Helm renders one API HPA, one PDB per enabled workload, and both exact topology selectors in every Deployment. Add worker autoscaling only after custom backlog metrics and external capacity limits are tested under load.

## Alternatives Considered

- Keep fixed replica counts and no PDBs: rejected because traffic response and voluntary disruption behavior remain implicit and manual.
- Apply CPU HPAs to every worker: rejected because polling CPU is not correlated with queue age and can scale in the wrong direction during dependency incidents.
- Use one PDB selector for all application Pods: rejected because an eviction of one component could consume the shared budget and leave another component unprotected.
- Set `minAvailable` equal to the full replica count: rejected because routine node drains would deadlock whenever no additional replica already existed.
- Rely on Kubernetes default `ScheduleAnyway` spreading: rejected because it optimizes placement but still permits all replicas to occupy one node or zone.
- Require node spreading but only prefer zone spreading: rejected because a two-replica production deployment could still lose both replicas in one zone failure.
- Autoscale workers from durable backlog custom metrics: preferred future direction, deferred until a production metrics adapter and per-worker scaling policy are implemented and load-tested.
