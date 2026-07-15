# ADR-0009: Use Cilium FQDN Policies For Egress

## Status

Accepted

## Context

The API and post-trade workers call external services whose IP addresses can change: AWS STS/KMS, Binance, Coinbase, chain RPC providers, PostgreSQL, Redis, Kafka, and ClickHouse. Kubernetes `NetworkPolicy` can restrict destination ports but cannot express DNS names. A rule that permits TCP 443 to every address therefore allows a compromised pod to exfiltrate data to any HTTPS endpoint. It also hides configuration drift: the API uses Binance WebSocket port 9443 and production Redis uses 6380, while the old port-only policy allowed 443 and 6379.

Production policy must bind each workload to the exact destinations it owns without allowing a broad Kubernetes rule to bypass the hostname restriction. DNS lookups must remain observable to the policy engine, and a missing policy engine must fail closed rather than silently restore unrestricted egress.

## Decision

Production Kubernetes deployments require Cilium and one `CiliumNetworkPolicy` per workload. Every external dependency is represented by an exact `toFQDNs.matchName` and TCP port pair. DNS access is limited to the configured cluster DNS endpoints and passes through Cilium DNS rules. Wildcard destination names, unrestricted CIDRs, and generic public HTTPS rules are not used.

The ordinary Kubernetes `NetworkPolicy` remains responsible for ingress isolation and declares `egress: []`. Cilium policies are the only egress allow rules, so additive policy semantics cannot turn a port-level Kubernetes rule into a bypass. The EKS reference sets `eks.amazonaws.com/sts-regional-endpoints: "true"` and allows the matching regional STS endpoint because IRSA must exchange its projected token before KMS signing. Helm requires network policy and FQDN egress to be enabled, validates non-empty endpoint lists and canonical hostnames, and renders separate API, hedge, analytics, reconciliation, settlement-indexer, and toxic-flow policies. Runtime URLs, Secrets, and FQDN endpoint lists are reviewed and deployed as one change.

## Consequences

### Positive

- A compromised workload cannot reach an arbitrary external host merely because it listens on an approved port.
- API, venue, RPC, analytics, database, and cache destinations are independently auditable by workload.
- Binance market-data port 9443 and production Redis port 6380 are represented explicitly instead of relying on inaccurate generic rules.
- Clusters without the Cilium CRD cannot successfully apply the full deployment, while the Kubernetes policy remains fail-closed.

### Negative

- Production clusters must install and operate Cilium DNS-aware policy enforcement.
- Endpoint hostname or port changes require a coordinated policy rollout before application configuration changes.
- DNS proxy or policy regressions can remove otherwise healthy workloads from readiness.
- Exact names do not automatically cover provider-specific aliases or newly introduced regional endpoints.

### Mitigation

Validate rendered policies in CI, compare every configured URL with the per-workload allowlist, and run positive dependency probes plus a negative unapproved-host probe in staging. Apply expanded policy before changing a dependency hostname, then remove the old name only after all replicas use the new endpoint. Monitor Cilium policy verdicts and DNS proxy health, and roll back the application and policy together when readiness fails.

## Alternatives Considered

- Port-only Kubernetes `NetworkPolicy`: portable, but cannot distinguish an approved HTTPS service from an attacker-controlled one.
- Static CIDR allowlists: supported by standard policy, but provider IP rotation makes them brittle and operationally unsafe.
- Central HTTP egress proxy: offers strong logging and policy, but adds proxy availability, TLS, and application-routing complexity not required by the reference deployment.
- Cloud-provider firewall only: useful as defense in depth, but often applies at node or subnet granularity and does not preserve per-workload ownership.
