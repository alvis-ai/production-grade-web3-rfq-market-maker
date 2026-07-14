# Audit Checklist

## Smart Contract

- [x] EIP-712 domain includes name, version, chainId and verifyingContract.
- [x] Quote struct fields match SDK and backend signer exactly.
- [x] `submitQuote` rejects expired quotes.
- [x] `submitQuote` rejects reused nonce.
- [x] `submitQuote` rejects untrusted signer.
- [x] `submitQuote` rejects unsupported tokenIn or tokenOut.
- [x] `submitQuote` uses SafeERC20 for transfers.
- [x] State updates are ordered safely around external calls.
- [x] ReentrancyGuard protects settlement.
- [x] Pausable can stop settlement during incident response.
- [x] AccessControl protects signer and token whitelist updates.
- [x] DEFAULT_ADMIN_ROLE cannot be orphaned by revoking the last admin.
- [x] Events contain enough data for idempotent indexing.

## Backend

- [x] `/quote` validates address format and amount strings.
- [x] Risk Engine runs before Signer Service.
- [x] Default token authorization and raw-unit limits are keyed by both chainId and token address.
- [x] Startup cross-checks risk-policy tokens against the trusted token registry and active market pairs.
- [x] Signer Service cannot be called directly from public API.
- [x] Signer verification rejects non-canonical high-s ECDSA signatures before submit settlement.
- [x] Non-local standalone runtime requires AWS KMS and rejects raw signer private keys.
- [x] KMS signatures are strictly DER-decoded and accepted only when recovery matches the configured trusted signer.
- [x] Quote persistence includes snapshotId and riskPolicyVersion.
- [x] Rejected quotes are logged without returning signatures.
- [x] Rate limits protect public trading endpoints.
- [x] Non-local business routes require scoped API keys whose plaintext secrets are never stored server-side.
- [x] API key verification uses constant-time digest comparison, generic 401 responses, expiry, and fixed route scopes.
- [x] Quote ownership is immutable and principal-scoped across quote status, submit, settlement, hedge, and PnL; mismatches use anti-enumeration 404 responses.
- [x] Production `/submit` uses a PostgreSQL quote-scoped lease with server-time expiry and owner-token release across API replicas.
- [x] Submit reservation acquisition failures fail closed and active contention is rejected before settlement verification.
- [x] All errors include traceId.
- [x] Public API responses include no-store cache control and baseline browser security headers.
- [x] Browser access is restricted by a CORS origin allowlist.
- [x] Browser bundles never receive institutional API secrets; production browser access requires a trusted backend-for-frontend or another approved session boundary.
- [x] Sensitive thresholds are not exposed to users.

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
- [x] Emergency pause procedure is documented.
- [x] Alerts exist for signer failures, risk reject spikes, event lag and hedge failures.
- [x] Dashboards cover quote latency, settlement failures and inventory exposure.
- [x] Alerts and runbooks cover submit reservation persistence errors and contention spikes.
