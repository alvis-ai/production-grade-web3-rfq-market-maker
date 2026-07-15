CREATE TABLE quote_idempotency_requests (
  principal_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  state TEXT NOT NULL,
  owner_token TEXT,
  lease_expires_at TIMESTAMPTZ,
  quote_id TEXT,
  response JSONB,
  error_code TEXT,
  error_message TEXT,
  error_status_code INTEGER,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (principal_id, idempotency_key),
  CONSTRAINT chk_quote_idempotency_principal CHECK (
    char_length(principal_id) BETWEEN 1 AND 128
    AND principal_id ~ '^[A-Za-z0-9_:-]+$'
  ),
  CONSTRAINT chk_quote_idempotency_key CHECK (
    char_length(idempotency_key) BETWEEN 16 AND 128
    AND idempotency_key ~ '^[A-Za-z0-9._:-]+$'
  ),
  CONSTRAINT chk_quote_idempotency_request_hash CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT chk_quote_idempotency_quote_id CHECK (
    quote_id IS NULL
    OR (char_length(quote_id) BETWEEN 1 AND 128 AND quote_id ~ '^[A-Za-z0-9_:-]+$')
  ),
  CONSTRAINT chk_quote_idempotency_state CHECK (state IN ('processing', 'succeeded', 'failed')),
  CONSTRAINT chk_quote_idempotency_lease CHECK (
    lease_expires_at IS NULL OR lease_expires_at > created_at
  ),
  CONSTRAINT chk_quote_idempotency_payload CHECK (
    (
      state = 'processing'
      AND owner_token IS NOT NULL
      AND lease_expires_at IS NOT NULL
      AND response IS NULL
      AND error_code IS NULL
      AND error_message IS NULL
      AND error_status_code IS NULL
      AND completed_at IS NULL
    )
    OR (
      state = 'succeeded'
      AND owner_token IS NULL
      AND lease_expires_at IS NULL
      AND quote_id IS NOT NULL
      AND response IS NOT NULL
      AND jsonb_typeof(response) = 'object'
      AND error_code IS NULL
      AND error_message IS NULL
      AND error_status_code IS NULL
      AND completed_at IS NOT NULL
    )
    OR (
      state = 'failed'
      AND owner_token IS NULL
      AND lease_expires_at IS NULL
      AND response IS NULL
      AND error_code IS NOT NULL
      AND error_message IS NOT NULL
      AND error_status_code BETWEEN 400 AND 599
      AND completed_at IS NOT NULL
    )
  ),
  CONSTRAINT chk_quote_idempotency_owner CHECK (
    owner_token IS NULL
    OR (
      char_length(owner_token) BETWEEN 1 AND 128
      AND owner_token ~ '^[A-Za-z0-9_:-]+$'
    )
  ),
  CONSTRAINT chk_quote_idempotency_error CHECK (
    error_code IS NULL
    OR (
      char_length(error_code) BETWEEN 1 AND 64
      AND error_code ~ '^[A-Z0-9_]+$'
      AND char_length(error_message) BETWEEN 1 AND 256
    )
  )
);

CREATE INDEX idx_quote_idempotency_processing_lease
  ON quote_idempotency_requests (lease_expires_at)
  WHERE state = 'processing';

CREATE INDEX idx_quote_idempotency_quote_id
  ON quote_idempotency_requests (quote_id)
  WHERE quote_id IS NOT NULL;

CREATE TRIGGER trg_quote_idempotency_requests_set_updated_at
BEFORE UPDATE ON quote_idempotency_requests
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();
