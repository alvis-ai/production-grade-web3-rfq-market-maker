ALTER TABLE hedge_orders
  ADD COLUMN execution_max_order_age_ms BIGINT,
  ADD COLUMN cancel_requested_at TIMESTAMPTZ;

ALTER TABLE hedge_orders
  ADD CONSTRAINT chk_hedge_orders_execution_expiry CHECK (
    (
      execution_max_order_age_ms IS NULL
      AND cancel_requested_at IS NULL
    )
    OR (
      execution_policy_version = 'bounded-limit-v1'
      AND execution_order_type = 'LIMIT'
      AND execution_time_in_force = 'GTC'
      AND execution_max_order_age_ms BETWEEN 1000 AND 3600000
      AND (cancel_requested_at IS NULL OR submission_attempted_at IS NOT NULL)
    )
  );

CREATE INDEX idx_hedge_orders_cancel_requested
  ON hedge_orders (cancel_requested_at, next_attempt_at, id)
  WHERE status = 'queued' AND cancel_requested_at IS NOT NULL;
