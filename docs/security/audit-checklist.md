# Audit Checklist

## Smart Contract

- [x] EIP-712 domain includes name, version, chainId and verifyingContract.
- [x] Quote struct fields match SDK and backend signer exactly.
- [x] `submitQuote` rejects expired quotes.
- [x] `submitQuote` rejects reused nonce.
- [x] `submitQuote` rejects untrusted signer.
- [x] `submitQuote` rejects unsupported tokenIn or tokenOut.
- [x] `submitQuote` uses SafeERC20 for transfers.
- [x] `submitQuote` verifies exact user/Treasury balance deltas and rejects fee-on-transfer or rebasing settlement drift.
- [x] State updates are ordered safely around external calls.
- [x] ReentrancyGuard protects settlement.
- [x] Pausable can stop settlement during incident response.
- [x] AccessControl protects signer and token whitelist updates.
- [x] Treasury, Settlement and newly whitelisted token configuration rejects EOAs, and Treasury rotation requires the candidate Treasury to point back to the active Settlement.
- [x] Trusted signer authorization is capped at five entries, cannot remove the primary or final signer, and emits an event for every membership change.
- [x] DEFAULT_ADMIN_ROLE cannot be orphaned by revoking the last admin.
- [x] A Settlement owner without DEFAULT_ADMIN_ROLE cannot transfer ownership to restore administrative roles.
- [x] Deployment atomically wires Settlement and Treasury, validates postconditions, transfers both ownership boundaries to an explicit final admin, and leaves the factory without roles.
- [x] Events contain enough data for idempotent indexing.

## Backend

- [x] `/quote` validates address format and amount strings.
- [x] Risk Engine runs before Signer Service.
- [x] Non-local static market data requires a non-empty mandatory live CEX source set and cannot sign from demonstration prices alone.
- [x] CEX reference sources validate price without inflating executable liquidity; every published pair retains an accepted Binance hedge source bound to the API and worker shared route table.
- [x] CEX hedge submissions use a persisted tick-aligned `LIMIT GTC` boundary derived from immutable quote economics and reviewed route slippage; the adapter contains no unbounded `MARKET` submit path.
- [x] New CEX hedge orders persist a bounded maximum lifetime; PostgreSQL authorizes and records cancellation before the external call, and ambiguous cancel results remain query-first under the original client id.
- [x] Default token authorization and raw-unit limits are keyed by both chainId and token address.
- [x] Startup cross-checks risk-policy tokens against the trusted token registry and active market pairs.
- [x] Signer Service cannot be called directly from public API.
- [x] Signer verification rejects non-canonical high-s ECDSA signatures before submit settlement.
- [x] Non-local standalone runtime requires AWS KMS and rejects raw signer private keys.
- [x] KMS signatures are strictly DER-decoded and accepted only when recovery matches the configured trusted signer.
- [x] Settlement verification accepts one primary plus at most four validated overlap signers and snapshots that trust policy at startup.
- [x] Quote persistence includes snapshotId and riskPolicyVersion.
- [x] Rejected quotes are logged without returning signatures.
- [x] Rate limits protect public trading endpoints.
- [x] Non-local business routes require scoped API keys whose plaintext secrets are never stored server-side.
- [x] API key verification uses constant-time digest comparison, generic 401 responses, expiry, and fixed route scopes.
- [x] Quote ownership is immutable and principal-scoped across quote status, submit, settlement, hedge, and PnL; mismatches use anti-enumeration 404 responses.
- [x] Production `/submit` uses a PostgreSQL quote-scoped lease with server-time expiry and owner-token release across API replicas.
- [x] Production `/quote` requires a principal-scoped idempotency key, fingerprints the payload, binds quote identity before persistence, and replays only the exact signed response.
- [x] Quote idempotency conflicts, active ownership, and storage outages fail closed without issuing another nonce or signature.
- [x] Submit reservation acquisition failures fail closed and active contention is rejected before settlement verification.
- [x] All errors include traceId.
- [x] API and worker logs are structured, level-controlled, trace-correlated where applicable, and redact credentials, signatures, private keys, cookies and request headers.
- [x] API and worker pods have ingress-and-egress NetworkPolicies with explicit ingress-controller and monitoring namespace selectors plus workload-specific egress ports.
- [x] API, migration and worker containers run as UID/GID 1000 with RuntimeDefault seccomp, no privilege escalation, no Linux capabilities, read-only root filesystems and bounded `/tmp` storage.
- [x] Every workload disables the default Kubernetes API ServiceAccount token; the API uses only the separate audience-scoped IRSA projection for KMS signing.
- [x] Non-local API, worker and migration processes require hostname-verified PostgreSQL TLS; Redis requires `rediss://`, while analytics requires Kafka TLS/SASL and ClickHouse HTTPS.
- [x] Public API responses include no-store cache control and baseline browser security headers.
- [x] Browser access is restricted by a CORS origin allowlist.
- [x] Browser bundles never receive institutional API secrets; production browser access requires a trusted backend-for-frontend or another approved session boundary.
- [x] The internal frontend BFF injects its dedicated key from a read-only Secret, proxies only six reviewed route/method pairs, and rejects health, readiness, metrics, admin, and unknown API paths.
- [x] Frontend Ingress requires TLS and a non-public source-CIDR allowlist; frontend/API NetworkPolicies permit only ingress-to-frontend and frontend-to-API traffic.
- [x] Sensitive thresholds are not exposed to users.
- [x] Receipt-confirmed E2E broadcasts `submitQuote` on Anvil and verifies calldata, receipt, event, balances, nonce, inventory, hedge and PnL.

## Data and Events

- [x] Settlement events use `(chainId, txHash, logIndex)` idempotency.
- [x] Indexer handles chain reorgs.
- [x] Independent confirmed-log indexing recovers settlements when the wallet callback is lost.
- [x] Indexer cursor advance is lease/revision/next-block guarded and occurs only after event application.
- [x] Deep reorgs and unknown signed quotes fail closed without skipping economic evidence.
- [x] Inventory updates are replayable.
- [x] Hedge actions are linked to settlement events.
- [x] ClickHouse analytics do not become operational source of truth.
- [x] Transactional outbox events commit with operational state and preserve 78-digit amounts as strings.
- [x] Kafka offsets commit only after ClickHouse insertion and duplicate event ids remain query-idempotent.
- [x] Analytics credentials are isolated from API, signer and hedge venue credentials.

## Operations

- [x] Signer key rotation is documented.
- [x] Signer rotation uses two backend rollouts, waits through TTL and settlement-observation buffers, and explicitly retires the old signer on chain and in backend configuration.
- [x] Emergency pause procedure is documented.
- [x] Alerts exist for signer failures, risk reject spikes, event lag and hedge failures.
- [x] Dashboards cover quote latency, settlement failures and inventory exposure.
- [x] Alerts and runbooks cover submit reservation persistence errors and contention spikes.
- [x] Production HTTPS egress is narrowed from port-level NetworkPolicy access to approved KMS, CEX, Chainlink, RPC and analytics destinations through an egress gateway, CNI FQDN policy or provider firewall.
