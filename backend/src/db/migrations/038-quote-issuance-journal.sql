BEGIN;

CREATE TABLE IF NOT EXISTS quote_issuance_journal_events (
  source_stream_id VARCHAR(128) PRIMARY KEY,
  event_type TEXT NOT NULL,
  quote_id TEXT REFERENCES quotes(id) ON DELETE CASCADE,
  principal_id TEXT,
  payload JSONB NOT NULL,
  mirrored_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_quote_issuance_journal_source CHECK (
    source_stream_id ~ '^[A-Za-z][A-Za-z0-9_-]{0,63}:[0-9]+-[0-9]+$'
  ),
  CONSTRAINT chk_quote_issuance_journal_event_type CHECK (
    event_type IN ('prepared', 'authorized', 'finalized', 'failed')
  ),
  CONSTRAINT chk_quote_issuance_journal_principal CHECK (
    principal_id IS NULL
    OR (
      char_length(principal_id) BETWEEN 1 AND 128
      AND principal_id ~ '^[A-Za-z0-9_:-]+$'
    )
  ),
  CONSTRAINT chk_quote_issuance_journal_identity CHECK (
    quote_id IS NOT NULL OR principal_id IS NOT NULL
  ),
  CONSTRAINT chk_quote_issuance_journal_payload CHECK (
    jsonb_typeof(payload) = 'object'
    AND payload ?& ARRAY['schemaVersion', 'eventType', 'occurredAtMs']
    AND (payload->>'schemaVersion') = '1'
    AND payload->>'eventType' = event_type
  )
);

CREATE INDEX IF NOT EXISTS idx_quote_issuance_journal_quote
  ON quote_issuance_journal_events (quote_id, source_stream_id)
  WHERE quote_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_quote_issuance_journal_principal
  ON quote_issuance_journal_events (principal_id, mirrored_at DESC)
  WHERE principal_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS quote_issuance_projection_versions (
  quote_id TEXT PRIMARY KEY REFERENCES quotes(id) ON DELETE CASCADE,
  source_epoch VARCHAR(64) NOT NULL,
  stream_milliseconds NUMERIC(20, 0) NOT NULL,
  stream_sequence NUMERIC(20, 0) NOT NULL,
  event_type TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_quote_issuance_projection_epoch CHECK (
    source_epoch ~ '^[A-Za-z][A-Za-z0-9_-]{0,63}$'
  ),
  CONSTRAINT chk_quote_issuance_projection_position CHECK (
    stream_milliseconds >= 0 AND stream_sequence >= 0
  ),
  CONSTRAINT chk_quote_issuance_projection_event_type CHECK (
    event_type IN ('prepared', 'authorized', 'finalized', 'failed')
  )
);

COMMIT;
