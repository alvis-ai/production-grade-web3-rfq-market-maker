CREATE TABLE signer_audit_events (
  id BIGSERIAL PRIMARY KEY,
  quote_id VARCHAR(128) NOT NULL,
  snapshot_id VARCHAR(128) NOT NULL,
  quote_digest BYTEA NOT NULL,
  signature_hash BYTEA,
  signer_address CHAR(42) NOT NULL,
  settlement_address CHAR(42) NOT NULL,
  chain_id BIGINT NOT NULL,
  deadline BIGINT NOT NULL,
  outcome VARCHAR(32) NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT chk_signer_audit_quote_id CHECK (quote_id ~ '^[A-Za-z0-9_:-]{1,128}$'),
  CONSTRAINT chk_signer_audit_snapshot_id CHECK (snapshot_id ~ '^[A-Za-z0-9_:-]{1,128}$'),
  CONSTRAINT chk_signer_audit_quote_digest CHECK (octet_length(quote_digest) = 32),
  CONSTRAINT chk_signer_audit_signature_hash CHECK (
    (outcome = 'success' AND octet_length(signature_hash) = 32)
    OR (outcome = 'signer_error' AND signature_hash IS NULL)
  ),
  CONSTRAINT chk_signer_audit_signer_address CHECK (
    signer_address ~ '^0x[0-9a-f]{40}$'
    AND signer_address <> '0x0000000000000000000000000000000000000000'
  ),
  CONSTRAINT chk_signer_audit_settlement_address CHECK (
    settlement_address ~ '^0x[0-9a-f]{40}$'
    AND settlement_address <> '0x0000000000000000000000000000000000000000'
  ),
  CONSTRAINT chk_signer_audit_chain_id CHECK (chain_id BETWEEN 1 AND 9007199254740991),
  CONSTRAINT chk_signer_audit_deadline CHECK (deadline BETWEEN 1 AND 9007199254740991),
  CONSTRAINT chk_signer_audit_outcome CHECK (outcome IN ('success', 'signer_error'))
);

CREATE INDEX idx_signer_audit_quote
  ON signer_audit_events (quote_id, occurred_at DESC, id DESC);

CREATE INDEX idx_signer_audit_recorded
  ON signer_audit_events (recorded_at DESC, id DESC);
