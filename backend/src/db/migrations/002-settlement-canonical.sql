ALTER TABLE settlement_events
  ADD COLUMN canonical BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN removed_at TIMESTAMPTZ;

ALTER TABLE settlement_events
  ADD CONSTRAINT chk_settlement_events_canonical_state CHECK (
    (canonical = TRUE AND removed_at IS NULL)
    OR (canonical = FALSE AND removed_at IS NOT NULL)
  );

CREATE INDEX idx_settlement_events_canonical_block
  ON settlement_events (block_number, log_index)
  WHERE canonical = TRUE;
