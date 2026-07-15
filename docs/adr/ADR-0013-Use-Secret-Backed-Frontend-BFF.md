# ADR-0013: Use Secret Backed Frontend BFF

## Status

Accepted

## Context

Production RFQ routes require an institutional `keyId.secret` credential. A Vite application executes in an untrusted browser, so any credential compiled into `VITE_*`, returned by runtime configuration, or stored in browser storage is available to the user and to injected script. Direct browser calls therefore either fail production authentication or force disclosure of an institutional secret. The same static image must also be promotable across environments without rebuilding public API, settlement-address, or WalletConnect configuration.

The trading console is an internal institutional tool, not a public anonymous application. Its HTTP surface needs only quote creation, quote/settlement/hedge status, relay submission, and PnL. Backend health, readiness, metrics, administrative controls, and future routes must not become reachable merely because the frontend can reach the API Service.

## Decision

Deploy one frontend release per institution behind TLS and an ingress-controller source-CIDR allowlist. The frontend Nginx process is a minimal backend-for-frontend: browsers use same-origin `/api`, while Nginx injects that institution's API key from a Kubernetes Secret. The Secret contains an Nginx `proxy_set_header` fragment, is mounted read-only with group-readable mode for the fixed non-root process, and is never copied into the image, ConfigMap, DOM, JavaScript, response, log, or metric.

Proxy only the reviewed route and method pairs: `POST /quote`, `POST /submit`, `GET /quote/:id`, `GET /settlements/:id`, `GET /hedges/:id`, and `GET /pnl`. Identifiers use the backend's 1-128 character safe-identifier alphabet. Return 404 for every other `/api/` path, so `/health`, `/ready`, `/metrics`, `/admin/*`, and later backend additions remain inaccessible by default. NetworkPolicy allows ingress-controller-to-frontend and frontend-to-API traffic only; the API policy admits the exact frontend Pod selector.

Load public browser settings from `/runtime-config.js` before the application bundle. Kubernetes replaces that file through a ConfigMap and computes the API base URL from `window.location.origin + "/api"`. Settlement address and WalletConnect project id remain public but validated. The production default settlement address is empty, which disables wallet submission until an operator supplies the exact deployed contract address; the local public config retains its demonstration address. Build-time environment values remain only a local-development fallback, making the released image environment-independent.

Run two frontend replicas as UID/GID 101 with a read-only root filesystem, bounded 16Mi `/tmp`, no capabilities, no privilege escalation, no ServiceAccount token, hard node/zone topology spreading, and an independent PDB. Release validation injects the published frontend digest into Helm lint and render checks. API-key rotation requires updating the external Secret and rolling the frontend Deployment because Nginx reads the include at process start.

## Consequences

### Positive

- Institutional API credentials never cross the browser trust boundary.
- One immutable frontend digest can be promoted through environments with deployment-time public configuration.
- Exact route and method allowlisting prevents accidental publication of administrative and observability endpoints.
- Same-origin calls remove production CORS and browser credential-distribution complexity.
- Per-institution deployments preserve principal ownership and allow independent credential revocation.

### Negative

- Each institution needs an isolated frontend release, TLS hostname, reviewed source ranges, and API-key lifecycle.
- The Secret value is Nginx syntax rather than a bare credential, so provisioning must validate both credential format and directive syntax.
- Nginx must be restarted after key rotation; updating the Secret volume alone does not reload active worker configuration.
- Source CIDR controls are not user authentication and depend on correct ingress-controller client-IP handling.

### Mitigation

Provision the Secret through an external secret manager, render and syntax-test Nginx before rollout, verify TLS and source-range enforcement from allowed and denied networks, and perform a canary quote after every credential rotation. Keep the institution key scoped only to the six proxied operations and never grant admin scopes. Monitor Deployment readiness and backend authentication failures without key-identifying labels. Review any new frontend API route through an ADR or security change before adding a location block.

## Alternatives Considered

- Embed the API key in Vite build arguments or runtime JavaScript: rejected because browser users and injected scripts can recover it.
- Disable production API authentication for browser traffic: rejected because it removes institutional principal ownership and rate-limit identity.
- Proxy every `/api/*` path: rejected because health, metrics, admin, and future endpoints would be exposed implicitly.
- Use one public multi-tenant frontend with one shared institutional key: rejected because it collapses principal isolation and expands compromise impact.
- Add a full session-based application backend now: viable for a public multi-tenant product, but deferred because the current internal console needs only fixed-route credential injection and has no user identity provider.
- Compile environment-specific frontend images: rejected because promotion would rebuild artifacts after verification and create digest drift across environments.
