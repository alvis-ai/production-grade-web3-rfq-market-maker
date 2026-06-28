# Audit Checklist

## Smart Contract

- [ ] EIP-712 domain includes name, version, chainId and verifyingContract.
- [ ] Quote struct fields match SDK and backend signer exactly.
- [ ] `submitQuote` rejects expired quotes.
- [ ] `submitQuote` rejects reused nonce.
- [ ] `submitQuote` rejects untrusted signer.
- [ ] `submitQuote` rejects unsupported tokenIn or tokenOut.
- [ ] `submitQuote` uses SafeERC20 for transfers.
- [ ] State updates are ordered safely around external calls.
- [ ] ReentrancyGuard protects settlement.
- [ ] Pausable can stop settlement during incident response.
- [ ] AccessControl protects signer and token whitelist updates.
- [ ] Events contain enough data for idempotent indexing.

## Backend

- [ ] `/quote` validates address format and amount strings.
- [ ] Risk Engine runs before Signer Service.
- [ ] Signer Service cannot be called directly from public API.
- [ ] Quote persistence includes snapshotId and riskPolicyVersion.
- [ ] Rejected quotes are logged without returning signatures.
- [x] Rate limits protect public trading endpoints.
- [x] All errors include traceId.
- [x] Public API responses include no-store cache control and baseline browser security headers.
- [x] Browser access is restricted by a CORS origin allowlist.
- [ ] Sensitive thresholds are not exposed to users.

## Data and Events

- [ ] Settlement events use `(chainId, txHash, logIndex)` idempotency.
- [ ] Indexer handles chain reorgs.
- [ ] Inventory updates are replayable.
- [ ] Hedge actions are linked to settlement events.
- [ ] ClickHouse analytics do not become operational source of truth.

## Operations

- [ ] Signer key rotation is documented.
- [ ] Emergency pause procedure is documented.
- [ ] Alerts exist for signer failures, risk reject spikes, event lag and hedge failures.
- [ ] Dashboards cover quote latency, settlement failures and inventory exposure.
