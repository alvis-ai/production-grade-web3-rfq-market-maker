ALTER TABLE hedge_orders
  ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN lease_owner TEXT,
  ADD COLUMN lease_expires_at TIMESTAMPTZ,
  ADD COLUMN venue_symbol TEXT,
  ADD COLUMN client_order_id TEXT,
  ADD COLUMN submission_attempted_at TIMESTAMPTZ,
  ADD COLUMN filled_amount NUMERIC(78, 0),
  ADD COLUMN last_error_code TEXT;

ALTER TABLE hedge_orders
  ADD CONSTRAINT chk_hedge_orders_attempt_count CHECK (attempt_count BETWEEN 0 AND 1000000),
  ADD CONSTRAINT chk_hedge_orders_lease_state CHECK (
    (lease_owner IS NULL AND lease_expires_at IS NULL)
    OR (
      status = 'queued'
      AND lease_owner IS NOT NULL
      AND lease_expires_at IS NOT NULL
      AND btrim(lease_owner) <> ''
      AND char_length(lease_owner) <= 128
      AND lease_owner ~ '^[A-Za-z0-9_:-]+$'
    )
  ),
  ADD CONSTRAINT chk_hedge_orders_venue_symbol CHECK (
    venue_symbol IS NULL
    OR (char_length(venue_symbol) BETWEEN 3 AND 32 AND venue_symbol ~ '^[A-Z0-9._-]+$')
  ),
  ADD CONSTRAINT chk_hedge_orders_client_order_id CHECK (
    client_order_id IS NULL
    OR (char_length(client_order_id) BETWEEN 1 AND 36 AND client_order_id ~ '^[A-Za-z0-9._-]+$')
  ),
  ADD CONSTRAINT chk_hedge_orders_submission_attempt CHECK (
    submission_attempted_at IS NULL
    OR (venue <> 'internal' AND venue_symbol IS NOT NULL AND client_order_id IS NOT NULL)
  ),
  ADD CONSTRAINT chk_hedge_orders_last_error_code CHECK (
    last_error_code IS NULL
    OR (char_length(last_error_code) BETWEEN 1 AND 128 AND last_error_code ~ '^[A-Z0-9_:-]+$')
  ),
  ADD CONSTRAINT chk_hedge_orders_filled_amount CHECK (
    filled_amount IS NULL OR (filled_amount > 0 AND filled_amount <= amount)
  ),
  ADD CONSTRAINT chk_hedge_orders_terminal_state CHECK (
    status = 'queued'
    OR (
      lease_owner IS NULL
      AND lease_expires_at IS NULL
      AND (status <> 'filled' OR (external_order_id IS NOT NULL AND filled_amount IS NOT NULL))
    )
  );

CREATE INDEX idx_hedge_orders_queued_claim
  ON hedge_orders (next_attempt_at, created_at, id)
  WHERE status = 'queued';

CREATE UNIQUE INDEX uq_hedge_orders_venue_client_order
  ON hedge_orders (venue, client_order_id)
  WHERE client_order_id IS NOT NULL;
