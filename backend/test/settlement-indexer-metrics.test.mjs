import assert from "node:assert/strict";
import test from "node:test";
import { SettlementIndexerMetrics } from "../dist/modules/indexer/settlement-indexer.metrics.js";

test("settlement indexer metrics expose bounded chain, outcome, and error labels", () => {
  const metrics = new SettlementIndexerMetrics([1]);
  metrics.recordCursor(1, 105, 110);
  metrics.recordRange(1);
  metrics.recordEvent(1, "applied");
  metrics.recordEvent(1, "duplicate");
  metrics.recordReorg(1, 5, 2);
  metrics.recordError(1, "DEEP_REORG");

  const output = metrics.renderPrometheus([
    { chainId: 1, nextBlock: 105, updatedAt: "2026-07-12T00:00:00.000Z" },
  ], Date.parse("2026-07-12T00:00:10.000Z"));
  assert.match(output, /rfq_settlement_indexer_ranges_total\{chain_id="1"\} 1/);
  assert.match(output, /rfq_settlement_indexer_events_total\{chain_id="1",outcome="applied"\} 1/);
  assert.match(output, /rfq_settlement_indexer_events_total\{chain_id="1",outcome="duplicate"\} 1/);
  assert.match(output, /rfq_settlement_indexer_errors_total\{chain_id="1",code="DEEP_REORG"\} 1/);
  assert.match(output, /rfq_settlement_indexer_reorgs_total\{chain_id="1"\} 1/);
  assert.match(output, /rfq_settlement_indexer_reorg_removed_events_total\{chain_id="1"\} 2/);
  assert.match(output, /rfq_settlement_indexer_lag_blocks\{chain_id="1"\} 6/);
  assert.match(output, /rfq_settlement_indexer_cursor_update_age_seconds\{chain_id="1"\} 10/);
});

test("settlement indexer metrics reject unbounded labels and malformed stats", () => {
  assert.throws(() => new SettlementIndexerMetrics([]), /non-empty unique/);
  assert.throws(() => new SettlementIndexerMetrics([1, 1]), /non-empty unique/);
  const metrics = new SettlementIndexerMetrics([1]);
  assert.throws(() => metrics.recordEvent(1, "unknown"), /outcome/);
  assert.throws(() => metrics.recordError(1, "UNKNOWN"), /error code/);
  assert.throws(() => metrics.recordCursor(2, 0, 0), /not configured/);
  assert.throws(
    () => metrics.renderPrometheus([{ chainId: 2, nextBlock: 1, updatedAt: "2026-07-12T00:00:00.000Z" }]),
    /unknown or duplicate/,
  );
});
