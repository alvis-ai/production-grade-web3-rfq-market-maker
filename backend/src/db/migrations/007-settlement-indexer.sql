CREATE TABLE settlement_indexer_cursors (
  chain_id BIGINT PRIMARY KEY,
  settlement_address TEXT NOT NULL,
  start_block BIGINT NOT NULL,
  next_block BIGINT NOT NULL,
  revision BIGINT NOT NULL DEFAULT 0,
  lease_owner TEXT,
  lease_expires_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_settlement_indexer_cursor_chain CHECK (
    chain_id BETWEEN 1 AND 9007199254740991
  ),
  CONSTRAINT chk_settlement_indexer_cursor_address CHECK (
    settlement_address ~ '^0x[0-9a-fA-F]{40}$'
    AND settlement_address <> '0x0000000000000000000000000000000000000000'
  ),
  CONSTRAINT chk_settlement_indexer_cursor_blocks CHECK (
    start_block BETWEEN 0 AND 9007199254740991
    AND next_block BETWEEN start_block AND 9007199254740991
    AND revision BETWEEN 0 AND 9007199254740991
  ),
  CONSTRAINT chk_settlement_indexer_cursor_lease CHECK (
    (lease_owner IS NULL AND lease_expires_at IS NULL)
    OR (
      lease_owner IS NOT NULL
      AND lease_expires_at IS NOT NULL
      AND btrim(lease_owner) <> ''
      AND char_length(lease_owner) <= 128
      AND lease_owner ~ '^[A-Za-z0-9_:-]+$'
    )
  )
);

CREATE TABLE settlement_indexer_checkpoints (
  chain_id BIGINT NOT NULL REFERENCES settlement_indexer_cursors(chain_id) ON DELETE CASCADE,
  block_number BIGINT NOT NULL,
  block_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (chain_id, block_number),
  CONSTRAINT chk_settlement_indexer_checkpoint_block CHECK (
    block_number BETWEEN 0 AND 9007199254740991
  ),
  CONSTRAINT chk_settlement_indexer_checkpoint_hash CHECK (
    block_hash ~ '^0x[0-9a-fA-F]{64}$'
  )
);

CREATE INDEX idx_settlement_indexer_checkpoints_recent
  ON settlement_indexer_checkpoints (chain_id, block_number DESC);

CREATE INDEX idx_settlement_events_canonical_chain_block
  ON settlement_events (chain_id, block_number, log_index)
  WHERE canonical = TRUE;
