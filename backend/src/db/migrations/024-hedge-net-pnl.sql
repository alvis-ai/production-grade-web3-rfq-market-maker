ALTER TABLE hedge_orders
  ADD COLUMN route_accounting_version TEXT,
  ADD COLUMN venue_base_asset TEXT,
  ADD COLUMN venue_quote_asset TEXT,
  ADD COLUMN venue_quote_token_address CHAR(42),
  ADD COLUMN venue_base_decimals SMALLINT,
  ADD COLUMN venue_quote_decimals SMALLINT,
  ADD COLUMN hedge_net_pnl_model TEXT,
  ADD COLUMN hedge_net_pnl_model_description TEXT,
  ADD COLUMN hedge_net_pnl_status TEXT,
  ADD COLUMN hedge_settlement_reference_quantity NUMERIC(96, 18),
  ADD COLUMN hedge_residual_base_amount NUMERIC(78, 0),
  ADD COLUMN hedge_residual_quote_quantity NUMERIC(96, 18),
  ADD COLUMN hedge_commission_quote_quantity NUMERIC(96, 18),
  ADD COLUMN hedge_net_pnl_quote_quantity NUMERIC(96, 18),
  ADD COLUMN hedge_net_pnl_reason_code TEXT,
  ADD COLUMN hedge_unvalued_commission_assets JSONB,
  ADD COLUMN hedge_net_pnl_realized_at TIMESTAMPTZ;

ALTER TABLE hedge_orders
  ADD CONSTRAINT chk_hedge_orders_route_accounting CHECK (
    (
      route_accounting_version IS NULL
      AND venue_base_asset IS NULL
      AND venue_quote_asset IS NULL
      AND venue_quote_token_address IS NULL
      AND venue_base_decimals IS NULL
      AND venue_quote_decimals IS NULL
      AND hedge_net_pnl_model IS NULL
      AND hedge_net_pnl_model_description IS NULL
      AND hedge_net_pnl_status IS NULL
      AND hedge_settlement_reference_quantity IS NULL
      AND hedge_residual_base_amount IS NULL
      AND hedge_residual_quote_quantity IS NULL
      AND hedge_commission_quote_quantity IS NULL
      AND hedge_net_pnl_quote_quantity IS NULL
      AND hedge_net_pnl_reason_code IS NULL
      AND hedge_unvalued_commission_assets IS NULL
      AND hedge_net_pnl_realized_at IS NULL
    )
    OR (
      route_accounting_version = 'venue-assets-v1'
      AND venue_base_asset ~ '^[A-Z0-9._-]{1,32}$'
      AND venue_quote_asset ~ '^[A-Z0-9._-]{1,32}$'
      AND venue_base_asset <> venue_quote_asset
      AND venue_quote_token_address ~ '^0x[0-9a-f]{40}$'
      AND venue_base_decimals BETWEEN 0 AND 36
      AND venue_quote_decimals BETWEEN 0 AND 18
      AND hedge_net_pnl_model = 'hedge_fill_net_v1'
      AND hedge_net_pnl_model_description =
        'Net hedge execution PnL in the route quote asset using exact fills, quote/base commissions, and conservatively marked sub-step residual; third-asset commissions are unavailable'
      AND (
        (
          hedge_net_pnl_status = 'pending'
          AND hedge_settlement_reference_quantity IS NULL
          AND hedge_residual_base_amount IS NULL
          AND hedge_residual_quote_quantity IS NULL
          AND hedge_commission_quote_quantity IS NULL
          AND hedge_net_pnl_quote_quantity IS NULL
          AND hedge_net_pnl_reason_code IS NULL
          AND hedge_unvalued_commission_assets IS NULL
          AND hedge_net_pnl_realized_at IS NULL
        )
        OR (
          hedge_net_pnl_status = 'complete'
          AND hedge_settlement_reference_quantity > 0
          AND hedge_residual_base_amount >= 0
          AND hedge_residual_quote_quantity >= 0
          AND hedge_commission_quote_quantity >= 0
          AND hedge_net_pnl_quote_quantity IS NOT NULL
          AND hedge_net_pnl_reason_code IS NULL
          AND hedge_unvalued_commission_assets IS NULL
          AND hedge_net_pnl_realized_at IS NOT NULL
        )
        OR (
          hedge_net_pnl_status = 'unavailable'
          AND hedge_settlement_reference_quantity IS NULL
          AND hedge_residual_base_amount IS NULL
          AND hedge_residual_quote_quantity IS NULL
          AND hedge_commission_quote_quantity IS NULL
          AND hedge_net_pnl_quote_quantity IS NULL
          AND hedge_net_pnl_reason_code IN (
            'UNVALUED_COMMISSION_ASSET', 'HEDGE_NOT_EXECUTED', 'PARTIAL_HEDGE_UNCLOSED'
          )
          AND jsonb_typeof(hedge_unvalued_commission_assets) = 'array'
          AND (
            (hedge_net_pnl_reason_code = 'UNVALUED_COMMISSION_ASSET'
              AND jsonb_array_length(hedge_unvalued_commission_assets) > 0)
            OR (hedge_net_pnl_reason_code IN ('HEDGE_NOT_EXECUTED', 'PARTIAL_HEDGE_UNCLOSED')
              AND jsonb_array_length(hedge_unvalued_commission_assets) = 0)
          )
          AND hedge_net_pnl_realized_at IS NOT NULL
        )
      )
    )
  );

CREATE INDEX idx_hedge_orders_net_pnl_status
  ON hedge_orders (hedge_net_pnl_status, hedge_net_pnl_realized_at, id)
  WHERE hedge_net_pnl_status IS NOT NULL;
