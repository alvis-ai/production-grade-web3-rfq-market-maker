# ADR-0006: Use An Independent Settlement Indexer

## Status

Accepted

## Context

Users execute signed quotes from their own wallets because `RFQSettlement.submitQuote` requires `msg.sender == quote.user`. The browser normally sends the resulting transaction hash to `POST /submit`, where the API independently verifies transaction, receipt, calldata, and `QuoteSettled` evidence before applying off-chain state.

A browser callback is not durable delivery. The wallet can close, lose network connectivity, or succeed on-chain while the API request times out. In that case the contract has transferred assets and consumed the nonce, but an API-only ingestion model leaves inventory, hedge intent, quote status, and PnL stale. Existing post-trade reconciliation cannot discover the missing trade because it starts from settlement events already stored in PostgreSQL.

## Decision

Run a separate settlement-indexer process for every production chain.

The indexer reads only configured `RFQSettlement` addresses and only blocks behind a configured confirmation depth. It resolves each event to the complete signed quote by `(chainId, user, nonce)`, recomputes the EIP-712 struct hash, compares all emitted fields, and reuses the same idempotent settlement-event store as `POST /submit`.

PostgreSQL stores one leased cursor per chain plus range-end block-hash checkpoints. Cursor commits require lease owner, revision, and expected next block to match. A cursor advances only after every log in the range is verified and applied. Replayed ranges compare already-canonical event references with current confirmed logs, covering a crash after event commit but before cursor commit.

When a checkpoint hash changes, the indexer searches backward within `reorgLookbackBlocks`, marks orphaned settlement events non-canonical in reverse chain order, and only then rolls the cursor back. The existing inventory rebuild and post-trade reconciliation mechanisms converge quote, hedge, and PnL state. If no common ancestor exists inside the configured window, the chain fails closed with `DEEP_REORG`.

## Consequences

### Positive

- On-chain settlement discovery no longer depends on browser delivery.
- API receipt ingestion and background indexing converge through one idempotency key: `(chainId, txHash, logIndex)`.
- Multiple worker replicas can provide failover without racing cursor progress.
- Block-hash evidence gives reorg handling an explicit, auditable boundary.
- Unknown or contradictory economic evidence blocks progress instead of being silently skipped.

### Negative

- Each production chain requires a trusted RPC endpoint, deployment start block, confirmation policy, and additional database writes.
- An unknown quote can stop later ranges for that chain until audit data is restored.
- Deep reorg recovery remains an operator-controlled procedure.
- Single-provider RPC correctness is still a trust assumption; high-value deployments should compare providers operationally.

### Mitigation

- Keep RPC configuration in an indexer-only Secret and restrict egress to approved providers.
- Alert on process availability, confirmed-block lag, bounded error codes, and deep reorgs.
- Retain signed quote records for at least the maximum settlement and dispute horizon.
- Choose `startBlock` from the contract deployment record and validate configuration changes through review.
- Use independent RPC evidence before any manual cursor or checkpoint recovery.

## Alternatives Considered

### Browser Callback Only

Rejected because HTTP delivery after wallet execution is not durable and cannot be retried by the backend without already knowing the transaction hash.

### Backend Transaction Relay

Rejected because the current contract requires the quote user as `msg.sender`. A backend relay would change custody and trust assumptions or require an explicit forwarding/account-abstraction design.

### Third-Party Webhook Only

Rejected as the sole source because webhook delivery and provider filtering remain external trust dependencies. A webhook may later wake the indexer, but the durable cursor and RPC verification remain authoritative.

### Independent Confirmed-Log Indexer

Accepted because it preserves wallet execution, discovers missed callbacks, reuses existing idempotent settlement logic, and provides explicit reorg recovery.
