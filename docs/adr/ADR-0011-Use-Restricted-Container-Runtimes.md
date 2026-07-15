# ADR-0011: Use Restricted Container Runtimes

## Status

Accepted

## Context

The API, database migrator, and five post-trade workers process signer capability, institutional authorization, venue credentials, settlement evidence, and accounting data. Network isolation limits where a compromised process can connect, but a container that runs as root, retains Linux capabilities, or can modify its image filesystem has unnecessary options for persistence and privilege escalation. Automatically projected Kubernetes ServiceAccount tokens also create a credential that most workers do not use.

The API needs an audience-scoped OIDC token for AWS KMS signing through EKS IRSA, but it does not call the Kubernetes API and therefore does not need the default automatically mounted Kubernetes API token. All Node processes may need conventional temporary-file behavior, but they do not need to write application binaries or dependency directories. The static frontend must serve on an unprivileged port when Nginx runs without root.

## Decision

Build the backend runtime with the image's fixed `node` user and run the frontend Nginx process as its fixed `nginx` user on port `8080`. Every Kubernetes API and worker Pod runs with UID/GID `1000`, `runAsNonRoot=true`, `RuntimeDefault` seccomp, and an `fsGroup` of `1000`. Both migration init containers and application containers disable privilege escalation, use a read-only root filesystem, and drop all Linux capabilities. Each Pod receives only a bounded `16Mi` `/tmp` volume for runtime writes.

Every Pod sets `automountServiceAccountToken=false` because no application process calls the Kubernetes API. The API still uses a dedicated annotated ServiceAccount: the EKS webhook injects a separate audience-scoped IRSA token and the AWS SDK exchanges it for the KMS signing role. Helm values schema fixes these controls as production invariants, while raw manifests and repository checks carry the same policy.

## Consequences

### Positive

- A process exploit cannot rely on root identity, ambient capabilities, or writable application files for persistence.
- Application compromise does not automatically disclose a Kubernetes API credential.
- Runtime writes are confined to a small, explicit temporary volume.
- Docker Compose and Kubernetes exercise the same non-root backend image.

### Negative

- Dependencies that unexpectedly write outside `/tmp` fail at runtime instead of silently succeeding.
- The backend image UID/GID becomes part of the deployment contract.
- The API Pod still contains an audience-scoped IRSA credential, so its IAM role and KMS key policy remain security boundaries.
- Rootless Nginx uses internal port `8080`, so deployment port mappings must remain consistent.

### Mitigation

Build and run both images in CI, render Helm output, validate raw manifests, and exercise health endpoints under the final runtime users. Keep the KMS IAM role limited to `kms:Sign` on one reviewed key and keep the API egress policy limited to regional STS/KMS endpoints. Any future component that needs filesystem or workload-identity access must document the exact resource and update this ADR before weakening the shared policy.

## Alternatives Considered

- Run as root and depend on namespace isolation: rejected because namespace boundaries do not remove unnecessary in-container privilege.
- Use only `runAsNonRoot`: rejected because writable image files, ambient capabilities, and projected tokens remain available.
- Mount the default Kubernetes API token in the API Pod for IRSA: rejected because EKS injects the distinct audience-scoped IRSA projection and the application does not call the Kubernetes API.
- Give every workload a writable root filesystem for compatibility: rejected because only bounded temporary storage is currently required.
