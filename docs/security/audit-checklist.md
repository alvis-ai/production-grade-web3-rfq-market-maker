# Audit Checklist

## Smart Contract

- [x] EIP-712 domain includes name, version, chainId and verifyingContract.
- [x] Quote struct fields match SDK and backend signer exactly.
- [x] `submitQuote` rejects expired quotes.
- [x] `submitQuote` rejects reused nonce.
- [x] `submitQuote` rejects untrusted signer.
- [x] `submitQuote` rejects unsupported tokenIn or tokenOut.
- [ ] `submitQuote` uses SafeERC20 for transfers.
- [x] State updates are ordered safely around external calls.
- [x] ReentrancyGuard protects settlement.
- [x] Pausable can stop settlement during incident response.
- [ ] AccessControl protects signer and token whitelist updates.
- [x] Events contain enough data for idempotent indexing.

## Backend

- [x] `/quote` validates address format and amount strings.
- [x] Risk Engine runs before Signer Service.
- [x] Signer Service cannot be called directly from public API.
- [x] Quote persistence includes snapshotId and riskPolicyVersion.
- [x] Rejected quotes are logged without returning signatures.
- [x] Rate limits protect public trading endpoints.
- [x] All errors include traceId.
- [x] Public API responses include no-store cache control and baseline browser security headers.
- [x] Browser access is restricted by a CORS origin allowlist.
- [x] Sensitive thresholds are not exposed to users.

## Data and Events

- [x] Settlement events use `(chainId, txHash, logIndex)` idempotency.
- [ ] Indexer handles chain reorgs.
- [ ] Inventory updates are replayable.
- [x] Hedge actions are linked to settlement events.
- [ ] ClickHouse analytics do not become operational source of truth.

## Operations

- [x] Signer key rotation is documented.
- [x] Emergency pause procedure is documented.
- [x] Alerts exist for signer failures, risk reject spikes, event lag and hedge failures.
- [x] Dashboards cover quote latency, settlement failures and inventory exposure.
