# ADR-0010: Use Exact Hedge Evidence For Net PnL

## Status

Accepted

## Context

`quote_snapshot_edge_v1` measures the edge embedded in a signed quote against its immutable quote-time market snapshot. It deliberately cannot answer whether the maker earned money after the inventory hedge because execution price, venue fees and step-size residual are unknown at settlement time. The hedge pipeline now persists cumulative base/quote execution and exact `myTrades` fills, including each commission quantity and asset. Summing BNB, base-token and quote-token fees, applying a configured fee rate, or valuing old rows without their original route would create unauditable PnL.

## Decision

Keep `quote_snapshot_edge_v1` unchanged and add an independent `hedge_fill_net_v1` model. Before any venue submission, persist `venue-assets-v1` metadata containing CEX base/quote symbols, the on-chain quote token and both decimals. The route quote token must equal the signed quote's hedge reference leg and must be a whitelisted USD-reference token.

After exact fills reconcile, calculate net execution PnL in the venue quote asset using 18-decimal fixed-point integers. Quote-asset commission is charged directly. Base-asset commission is valued from that fill's exact quote/base ratio. The original amount below one venue step is marked at aggregate execution VWAP; residual asset value is rounded down and residual replacement cost is rounded up. The result and fee completion commit in one transaction. A non-zero third-asset commission produces `UNVALUED_COMMISSION_ASSET`; a terminal partial hedge produces `PARTIAL_HEDGE_UNCLOSED` until the remaining exposure is closed; a pre-migration route produces `LEGACY_ROUTE_ACCOUNTING_UNAVAILABLE`. Only complete rows enter grouped net totals. Wallet-paid settlement gas is outside maker PnL.

## Consequences

### Positive

- Net execution PnL is replayable from immutable route and fill evidence.
- Pending, failed, legacy and cross-asset fee states cannot masquerade as zero.
- Gross quote edge remains comparable across historical model versions.
- Principal-scoped `/pnl` aggregates never sum unrelated chains, tokens or venue assets.

### Negative

- Hedge routes require more reviewed metadata and a USD-reference quote token.
- BNB or another third-asset fee delays complete net valuation until a separate conversion model exists.
- Existing hedges cannot be backfilled when route identity was not persisted.
- The model measures hedge execution economics, not later inventory markout or relayer gas.

### Mitigation

Validate route decimals and reference legs at worker startup and job claim, persist metadata before external submission, reconcile every venue fill idempotently, and alert on fee backlog or unavailable accounting states. Add any third-asset conversion or relayer gas model as a separately versioned decision with timestamped market evidence; never mutate `hedge_fill_net_v1` semantics.

## Alternatives Considered

- Extend `quote_snapshot_edge_v1`: rejected because it would silently change an existing historical model.
- Apply configured fee rates: rejected because actual fees vary by fill, tier and fee asset.
- Treat third-asset fees as zero: rejected because it systematically overstates PnL.
- Backfill old routes from current configuration: rejected because current configuration does not prove the route used historically.
