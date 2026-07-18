BEGIN;

ALTER TABLE quote_exposure_reservations
  ADD COLUMN IF NOT EXISTS ledger_expires_at TIMESTAMPTZ;

UPDATE quote_exposure_reservations
SET ledger_expires_at = expires_at
WHERE ledger_expires_at IS NULL;

ALTER TABLE quote_exposure_reservations
  ALTER COLUMN ledger_expires_at SET NOT NULL,
  DROP CONSTRAINT IF EXISTS chk_quote_exposure_ledger_expiry,
  ADD CONSTRAINT chk_quote_exposure_ledger_expiry CHECK (
    ledger_expires_at >= expires_at
    AND ledger_expires_at <= expires_at + interval '5 minutes'
  );

CREATE INDEX IF NOT EXISTS idx_quote_exposure_ledger_expiry
  ON quote_exposure_reservations (ledger_expires_at);

CREATE TABLE IF NOT EXISTS quote_exposure_ledger_events (
  source_stream_id VARCHAR(128) PRIMARY KEY,
  operation TEXT NOT NULL,
  quote_id TEXT NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  chain_id BIGINT NOT NULL,
  payload JSONB NOT NULL,
  mirrored_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_quote_exposure_ledger_source CHECK (
    source_stream_id ~ '^[A-Za-z][A-Za-z0-9_-]{0,63}:[0-9]+-[0-9]+$'
  ),
  CONSTRAINT chk_quote_exposure_ledger_operation CHECK (
    operation IN ('reserve', 'release')
  ),
  CONSTRAINT chk_quote_exposure_ledger_chain CHECK (
    chain_id BETWEEN 1 AND 9007199254740991
  ),
  CONSTRAINT chk_quote_exposure_ledger_payload CHECK (
    jsonb_typeof(payload) = 'object'
    AND payload ?& ARRAY[
      'schemaVersion',
      'quoteId',
      'chainId',
      'user',
      'tokenLow',
      'tokenHigh',
      'tokenIn',
      'amountIn',
      'tokenOut',
      'amountOut',
      'notionalUsdE18',
      'deadline',
      'ledgerExpiresAt'
    ]
    AND (payload->>'schemaVersion') = '1'
    AND payload->>'quoteId' = quote_id
    AND (payload->>'chainId')::bigint = chain_id
  )
);

CREATE INDEX IF NOT EXISTS idx_quote_exposure_ledger_events_quote
  ON quote_exposure_ledger_events (quote_id, source_stream_id);
CREATE INDEX IF NOT EXISTS idx_quote_exposure_ledger_events_mirrored
  ON quote_exposure_ledger_events (mirrored_at, source_stream_id);

CREATE TABLE IF NOT EXISTS quote_exposure_ledger_projection_versions (
  quote_id TEXT PRIMARY KEY REFERENCES quotes(id) ON DELETE CASCADE,
  source_epoch VARCHAR(64) NOT NULL,
  stream_milliseconds NUMERIC(20, 0) NOT NULL,
  stream_sequence NUMERIC(20, 0) NOT NULL,
  operation TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_quote_exposure_projection_epoch CHECK (
    source_epoch ~ '^[A-Za-z][A-Za-z0-9_-]{0,63}$'
  ),
  CONSTRAINT chk_quote_exposure_projection_position CHECK (
    stream_milliseconds >= 0 AND stream_sequence >= 0
  ),
  CONSTRAINT chk_quote_exposure_projection_operation CHECK (
    operation IN ('reserve', 'release')
  )
);

COMMIT;
