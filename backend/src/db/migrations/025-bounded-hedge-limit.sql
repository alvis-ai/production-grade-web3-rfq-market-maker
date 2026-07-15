ALTER TABLE hedge_orders
  ADD COLUMN venue_step_size_raw NUMERIC(78, 0),
  ADD COLUMN execution_order_type TEXT,
  ADD COLUMN execution_time_in_force TEXT,
  ADD COLUMN execution_limit_price NUMERIC(78, 18),
  ADD COLUMN execution_price_tick NUMERIC(78, 18),
  ADD COLUMN execution_max_slippage_bps INTEGER,
  ADD COLUMN execution_policy_version TEXT;

ALTER TABLE hedge_orders
  ADD CONSTRAINT chk_hedge_orders_execution_policy CHECK (
    (
      venue_step_size_raw IS NULL
      AND execution_order_type IS NULL
      AND execution_time_in_force IS NULL
      AND execution_limit_price IS NULL
      AND execution_price_tick IS NULL
      AND execution_max_slippage_bps IS NULL
      AND execution_policy_version IS NULL
    )
    OR (
      venue = 'binance'
      AND venue_symbol IS NOT NULL
      AND client_order_id IS NOT NULL
      AND venue_step_size_raw > 0
      AND execution_order_type = 'LIMIT'
      AND execution_time_in_force = 'GTC'
      AND execution_limit_price > 0
      AND execution_price_tick > 0
      AND mod(execution_limit_price, execution_price_tick) = 0
      AND execution_max_slippage_bps BETWEEN 0 AND 1000
      AND execution_policy_version = 'bounded-limit-v1'
    )
  );

CREATE INDEX idx_hedge_orders_execution_policy
  ON hedge_orders (execution_policy_version, status, created_at, id)
  WHERE execution_policy_version IS NOT NULL;
