export const quoteSnapshotPnlModelDescription =
  "Gross settlement PnL in tokenOut base units versus the persisted quote-time mid price, excluding fees, gas, and hedge execution";

export function createTestPnlValuationProvider(overrides = {}) {
  return {
    resolve(input) {
      return {
        snapshotId: input.snapshotId,
        midPrice: "1",
        tokenInDecimals: 18,
        tokenOutDecimals: 18,
        observedAt: "2026-07-11T00:00:00.000Z",
        ...overrides,
      };
    },
  };
}

export function pnlInput(quoteId, quote, overrides = {}) {
  return {
    quoteId,
    settlementEventId: `se_${quoteId}`,
    snapshotId: `snapshot_${quoteId}`,
    realizedAt: "2026-07-11T00:00:01.000Z",
    quote,
    ...overrides,
  };
}
