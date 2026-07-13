CREATE TABLE quote_submit_reservations (
  quote_id TEXT PRIMARY KEY REFERENCES quotes(id) ON DELETE CASCADE,
  owner_token TEXT NOT NULL,
  acquired_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT chk_quote_submit_reservations_owner CHECK (
    btrim(owner_token) <> ''
    AND char_length(owner_token) <= 128
    AND owner_token ~ '^[A-Za-z0-9_:-]+$'
  ),
  CONSTRAINT chk_quote_submit_reservations_expiry CHECK (expires_at > acquired_at)
);

CREATE INDEX idx_quote_submit_reservations_expiry
  ON quote_submit_reservations (expires_at);
