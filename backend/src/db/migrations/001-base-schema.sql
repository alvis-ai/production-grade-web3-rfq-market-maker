CREATE TABLE IF NOT EXISTS quotes (
  id TEXT PRIMARY KEY,
  chain_id BIGINT NOT NULL,
  user_address TEXT NOT NULL,
  token_in TEXT NOT NULL,
  token_out TEXT NOT NULL,
  amount_in NUMERIC(78, 0) NOT NULL,
  slippage_bps INTEGER NOT NULL,
  amount_out NUMERIC(78, 0),
  min_amount_out NUMERIC(78, 0),
  nonce NUMERIC(78, 0),
  deadline BIGINT,
  snapshot_id TEXT NOT NULL,
  pricing_version TEXT,
  spread_bps INTEGER,
  size_impact_bps INTEGER,
  inventory_skew_bps INTEGER,
  risk_policy_version TEXT,
  status TEXT NOT NULL,
  signature TEXT,
  reject_code TEXT,
  tx_hash TEXT,
  settlement_event_id TEXT,
  hedge_order_id TEXT,
  pnl_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_quotes_id_safe CHECK (
    btrim(id) <> ''
    AND char_length(id) <= 128
    AND id ~ '^[A-Za-z0-9_:-]+$'
  ),
  CONSTRAINT chk_quotes_status CHECK (
    status IN ('requested', 'rejected', 'signed', 'expired', 'submitted', 'settled', 'failed')
  ),
  CONSTRAINT chk_quotes_chain_id_safe CHECK (chain_id BETWEEN 1 AND 9007199254740991),
  CONSTRAINT chk_quotes_slippage_bps CHECK (slippage_bps BETWEEN 0 AND 10000),
  CONSTRAINT chk_quotes_pricing_bps CHECK (
    (spread_bps IS NULL OR spread_bps BETWEEN 0 AND 10000)
    AND (size_impact_bps IS NULL OR size_impact_bps BETWEEN 0 AND 10000)
    AND (inventory_skew_bps IS NULL OR inventory_skew_bps BETWEEN -10000 AND 10000)
  ),
  CONSTRAINT chk_quotes_amounts_non_negative CHECK (
    amount_in > 0
    AND (amount_out IS NULL OR amount_out > 0)
    AND (min_amount_out IS NULL OR min_amount_out > 0)
    AND (amount_out IS NULL OR min_amount_out IS NULL OR amount_out >= min_amount_out)
    AND (nonce IS NULL OR nonce > 0)
    AND (deadline IS NULL OR deadline BETWEEN 1 AND 9007199254740991)
  ),
  CONSTRAINT chk_quotes_addresses_hex CHECK (
    user_address ~ '^0x[0-9a-fA-F]{40}$'
    AND token_in ~ '^0x[0-9a-fA-F]{40}$'
    AND token_out ~ '^0x[0-9a-fA-F]{40}$'
  ),
  CONSTRAINT chk_quotes_distinct_tokens CHECK (lower(token_in) <> lower(token_out)),
  CONSTRAINT chk_quotes_metadata_non_empty CHECK (
    (pricing_version IS NULL OR btrim(pricing_version) <> '')
    AND (risk_policy_version IS NULL OR btrim(risk_policy_version) <> '')
    AND (reject_code IS NULL OR btrim(reject_code) <> '')
  ),
  CONSTRAINT chk_quotes_signature_and_tx_hash_hex CHECK (
    (
      signature IS NULL
      OR (
        signature ~ '^0x[0-9a-fA-F]{130}$'
        AND lower(substring(signature from 67 for 64)) <= '7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0'
        AND lower(substring(signature from 131 for 2)) IN ('1b', '1c')
      )
    )
    AND (tx_hash IS NULL OR tx_hash ~ '^0x[0-9a-fA-F]{64}$')
  ),
  CONSTRAINT chk_quotes_status_payload_consistency CHECK (
    (
      status IN ('requested', 'rejected', 'signed', 'expired', 'failed')
      AND tx_hash IS NULL
      AND settlement_event_id IS NULL
      AND hedge_order_id IS NULL
      AND pnl_id IS NULL
    )
    OR (
      status IN ('submitted', 'settled')
      AND tx_hash IS NOT NULL
      AND settlement_event_id IS NOT NULL
    )
  ),
  CONSTRAINT chk_quotes_signed_payload_atomic CHECK (
    (
      amount_out IS NULL
      AND min_amount_out IS NULL
      AND nonce IS NULL
      AND deadline IS NULL
      AND pricing_version IS NULL
      AND spread_bps IS NULL
      AND size_impact_bps IS NULL
      AND inventory_skew_bps IS NULL
      AND signature IS NULL
    )
    OR (
      amount_out IS NOT NULL
      AND min_amount_out IS NOT NULL
      AND nonce IS NOT NULL
      AND deadline IS NOT NULL
      AND pricing_version IS NOT NULL
      AND spread_bps IS NOT NULL
      AND size_impact_bps IS NOT NULL
      AND inventory_skew_bps IS NOT NULL
      AND signature IS NOT NULL
    )
  ),
  CONSTRAINT chk_quotes_unfilled_payload_consistency CHECK (
    status NOT IN ('requested', 'rejected')
    OR (
      amount_out IS NULL
      AND min_amount_out IS NULL
      AND nonce IS NULL
      AND deadline IS NULL
      AND pricing_version IS NULL
      AND spread_bps IS NULL
      AND size_impact_bps IS NULL
      AND inventory_skew_bps IS NULL
      AND signature IS NULL
    )
  ),
  CONSTRAINT chk_quotes_signed_payload_consistency CHECK (
    status NOT IN ('signed', 'expired', 'submitted', 'settled')
    OR (
      amount_out IS NOT NULL
      AND min_amount_out IS NOT NULL
      AND nonce IS NOT NULL
      AND deadline IS NOT NULL
      AND pricing_version IS NOT NULL
      AND spread_bps IS NOT NULL
      AND size_impact_bps IS NOT NULL
      AND inventory_skew_bps IS NOT NULL
      AND risk_policy_version IS NOT NULL
      AND signature IS NOT NULL
    )
  ),
  CONSTRAINT chk_quotes_rejection_payload_consistency CHECK (
    (
      status IN ('rejected', 'failed')
      AND reject_code IS NOT NULL
    )
    OR (
      status NOT IN ('rejected', 'failed')
      AND reject_code IS NULL
    )
  )
);

CREATE INDEX IF NOT EXISTS idx_quotes_user_created_at ON quotes (user_address, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_quotes_status_created_at ON quotes (status, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_quotes_chain_user_nonce ON quotes (chain_id, user_address, nonce)
  WHERE nonce IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_quotes_snapshot_id ON quotes (snapshot_id)
  WHERE snapshot_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_quotes_settlement_event_id ON quotes (settlement_event_id)
  WHERE settlement_event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_quotes_hedge_order_id ON quotes (hedge_order_id)
  WHERE hedge_order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_quotes_pnl_id ON quotes (pnl_id)
  WHERE pnl_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS market_snapshots (
  id TEXT PRIMARY KEY,
  chain_id BIGINT NOT NULL,
  token_in TEXT NOT NULL,
  token_out TEXT NOT NULL,
  mid_price NUMERIC(38, 18) NOT NULL,
  bid_price NUMERIC(38, 18),
  ask_price NUMERIC(38, 18),
  liquidity_usd NUMERIC(78, 0) NOT NULL,
  volatility_bps INTEGER NOT NULL,
  source TEXT NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_market_snapshots_id_safe CHECK (
    btrim(id) <> ''
    AND char_length(id) <= 128
    AND id ~ '^[A-Za-z0-9_:-]+$'
  ),
  CONSTRAINT chk_market_snapshots_prices CHECK (
    mid_price > 0
    AND (bid_price IS NULL OR bid_price > 0)
    AND (ask_price IS NULL OR ask_price > 0)
    AND (bid_price IS NULL OR bid_price <= mid_price)
    AND (ask_price IS NULL OR mid_price <= ask_price)
    AND (bid_price IS NULL OR ask_price IS NULL OR bid_price <= ask_price)
    AND liquidity_usd > 0
    AND volatility_bps BETWEEN 0 AND 10000
  ),
  CONSTRAINT chk_market_snapshots_source_non_empty CHECK (btrim(source) <> ''),
  CONSTRAINT chk_market_snapshots_chain_id_safe CHECK (chain_id BETWEEN 1 AND 9007199254740991),
  CONSTRAINT chk_market_snapshots_addresses_hex CHECK (
    token_in ~ '^0x[0-9a-fA-F]{40}$'
    AND token_out ~ '^0x[0-9a-fA-F]{40}$'
  ),
  CONSTRAINT chk_market_snapshots_distinct_tokens CHECK (lower(token_in) <> lower(token_out))
);

CREATE INDEX IF NOT EXISTS idx_market_snapshots_pair_observed_at ON market_snapshots (
  chain_id,
  token_in,
  token_out,
  observed_at DESC
);

CREATE TABLE IF NOT EXISTS risk_decisions (
  id TEXT PRIMARY KEY,
  quote_id TEXT NOT NULL REFERENCES quotes(id),
  decision TEXT NOT NULL,
  reason_code TEXT,
  policy_version TEXT NOT NULL,
  max_notional_usd NUMERIC(38, 8),
  inventory_exposure_before NUMERIC(78, 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_risk_decisions_id_safe CHECK (
    btrim(id) <> ''
    AND char_length(id) <= 128
    AND id ~ '^[A-Za-z0-9_:-]+$'
  ),
  CONSTRAINT chk_risk_decisions_status CHECK (decision IN ('approved', 'rejected')),
  CONSTRAINT chk_risk_decisions_policy_version_non_empty CHECK (btrim(policy_version) <> ''),
  CONSTRAINT chk_risk_decisions_reason_code_consistency CHECK (
    (
      decision = 'approved'
      AND reason_code IS NULL
    )
    OR (
      decision = 'rejected'
      AND reason_code IS NOT NULL
      AND reason_code IN (
        'CHAIN_NOT_ENABLED',
        'TOKEN_NOT_ALLOWED',
        'AMOUNT_IN_LIMIT_EXCEEDED',
        'AMOUNT_OUT_TOO_SMALL',
        'SLIPPAGE_TOO_WIDE',
        'QUOTED_SPREAD_TOO_WIDE',
        'TOXIC_FLOW_RESTRICTED_USER',
        'TOXIC_FLOW_SCORE_EXCEEDED',
        'TOKEN_IN_INVENTORY_LIMIT_EXCEEDED',
        'TOKEN_OUT_INVENTORY_LIMIT_EXCEEDED',
        'RISK_ENGINE_UNAVAILABLE'
      )
      AND btrim(reason_code) <> ''
    )
  ),
  CONSTRAINT chk_risk_decisions_limits CHECK (
    (max_notional_usd IS NULL OR max_notional_usd >= 0)
    AND (inventory_exposure_before IS NULL OR inventory_exposure_before >= 0)
  )
);

CREATE INDEX IF NOT EXISTS idx_risk_decisions_quote_id ON risk_decisions (quote_id);

CREATE TABLE IF NOT EXISTS settlement_events (
  id TEXT PRIMARY KEY,
  quote_id TEXT NOT NULL REFERENCES quotes(id),
  chain_id BIGINT NOT NULL,
  tx_hash TEXT NOT NULL,
  quote_hash TEXT NOT NULL,
  log_index BIGINT NOT NULL,
  block_number BIGINT NOT NULL,
  user_address TEXT NOT NULL,
  token_in TEXT NOT NULL,
  token_out TEXT NOT NULL,
  amount_in NUMERIC(78, 0) NOT NULL,
  amount_out NUMERIC(78, 0) NOT NULL,
  nonce NUMERIC(78, 0) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_settlement_events_id_safe CHECK (
    btrim(id) <> ''
    AND char_length(id) <= 128
    AND id ~ '^[A-Za-z0-9_:-]+$'
  ),
  CONSTRAINT chk_settlement_events_chain_id_safe CHECK (chain_id BETWEEN 1 AND 9007199254740991),
  CONSTRAINT chk_settlement_events_hashes CHECK (
    tx_hash ~ '^0x[0-9a-fA-F]{64}$'
    AND quote_hash ~ '^0x[0-9a-fA-F]{64}$'
  ),
  CONSTRAINT chk_settlement_events_addresses_hex CHECK (
    user_address ~ '^0x[0-9a-fA-F]{40}$'
    AND token_in ~ '^0x[0-9a-fA-F]{40}$'
    AND token_out ~ '^0x[0-9a-fA-F]{40}$'
  ),
  CONSTRAINT chk_settlement_events_distinct_tokens CHECK (lower(token_in) <> lower(token_out)),
  CONSTRAINT chk_settlement_events_amounts_positive CHECK (
    amount_in > 0
    AND amount_out > 0
    AND nonce > 0
    AND log_index BETWEEN 0 AND 9007199254740991
    AND block_number BETWEEN 0 AND 9007199254740991
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_settlement_events_chain_tx_log ON settlement_events (chain_id, tx_hash, log_index);
CREATE UNIQUE INDEX IF NOT EXISTS uq_settlement_events_quote_id ON settlement_events (quote_id);
CREATE INDEX IF NOT EXISTS idx_settlement_events_chain_quote_hash ON settlement_events (chain_id, quote_hash);

CREATE TABLE IF NOT EXISTS inventory_positions (
  id TEXT PRIMARY KEY,
  chain_id BIGINT NOT NULL,
  token_address TEXT NOT NULL,
  balance NUMERIC(78, 0) NOT NULL,
  target_balance NUMERIC(78, 0),
  max_exposure NUMERIC(78, 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_inventory_positions_id_safe CHECK (
    btrim(id) <> ''
    AND char_length(id) <= 128
    AND id ~ '^[A-Za-z0-9_:-]+$'
  ),
  CONSTRAINT chk_inventory_positions_chain_id_safe CHECK (chain_id BETWEEN 1 AND 9007199254740991),
  CONSTRAINT chk_inventory_positions_token_hex CHECK (token_address ~ '^0x[0-9a-fA-F]{40}$'),
  CONSTRAINT chk_inventory_positions_limits CHECK (
    (target_balance IS NULL OR target_balance >= 0)
    AND (max_exposure IS NULL OR max_exposure >= 0)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_inventory_positions_chain_token ON inventory_positions (chain_id, token_address);

CREATE TABLE IF NOT EXISTS hedge_orders (
  id TEXT PRIMARY KEY,
  settlement_event_id TEXT NOT NULL REFERENCES settlement_events(id),
  quote_id TEXT NOT NULL REFERENCES quotes(id),
  chain_id BIGINT NOT NULL,
  token_address TEXT NOT NULL,
  side TEXT NOT NULL,
  amount NUMERIC(78, 0) NOT NULL,
  venue TEXT NOT NULL,
  status TEXT NOT NULL,
  reason TEXT NOT NULL,
  external_order_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_hedge_orders_id_safe CHECK (
    btrim(id) <> ''
    AND char_length(id) <= 128
    AND id ~ '^[A-Za-z0-9_:-]+$'
  ),
  CONSTRAINT chk_hedge_orders_chain_id_safe CHECK (chain_id BETWEEN 1 AND 9007199254740991),
  CONSTRAINT chk_hedge_orders_side CHECK (side IN ('buy', 'sell')),
  CONSTRAINT chk_hedge_orders_status CHECK (status IN ('queued', 'filled', 'failed')),
  CONSTRAINT chk_hedge_orders_reason CHECK (reason IN ('inventory_rebalance', 'risk_reduction')),
  CONSTRAINT chk_hedge_orders_venue_non_empty CHECK (btrim(venue) <> ''),
  CONSTRAINT chk_hedge_orders_external_order_id_non_empty CHECK (
    external_order_id IS NULL OR btrim(external_order_id) <> ''
  ),
  CONSTRAINT chk_hedge_orders_token_hex CHECK (token_address ~ '^0x[0-9a-fA-F]{40}$'),
  CONSTRAINT chk_hedge_orders_amount_positive CHECK (amount > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_hedge_orders_settlement_event ON hedge_orders (settlement_event_id);

CREATE TABLE IF NOT EXISTS pnl_records (
  id TEXT PRIMARY KEY,
  quote_id TEXT NOT NULL REFERENCES quotes(id),
  chain_id BIGINT NOT NULL,
  user_address TEXT NOT NULL,
  token_in TEXT NOT NULL,
  token_out TEXT NOT NULL,
  amount_in NUMERIC(78, 0) NOT NULL,
  amount_out NUMERIC(78, 0) NOT NULL,
  min_amount_out NUMERIC(78, 0) NOT NULL,
  nonce NUMERIC(78, 0) NOT NULL,
  deadline BIGINT NOT NULL,
  gross_pnl_token_out NUMERIC(78, 0) NOT NULL,
  gross_pnl_bps BIGINT NOT NULL,
  model TEXT NOT NULL,
  model_description TEXT NOT NULL,
  realized_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_pnl_records_id_safe CHECK (
    btrim(id) <> ''
    AND char_length(id) <= 128
    AND id ~ '^[A-Za-z0-9_:-]+$'
  ),
  CONSTRAINT chk_pnl_records_model CHECK (model IN ('simulated_mid_price_v1')),
  CONSTRAINT chk_pnl_records_model_description CHECK (
    model_description = 'Simulated same-decimal quote attribution where grossPnlTokenOut equals amountIn minus amountOut and is not cross-token accounting PnL'
  ),
  CONSTRAINT chk_pnl_records_chain_id_safe CHECK (chain_id BETWEEN 1 AND 9007199254740991),
  CONSTRAINT chk_pnl_records_addresses_hex CHECK (
    user_address ~ '^0x[0-9a-fA-F]{40}$'
    AND token_in ~ '^0x[0-9a-fA-F]{40}$'
    AND token_out ~ '^0x[0-9a-fA-F]{40}$'
  ),
  CONSTRAINT chk_pnl_records_distinct_tokens CHECK (lower(token_in) <> lower(token_out)),
  CONSTRAINT chk_pnl_records_amounts_positive CHECK (
    amount_in > 0
    AND amount_out > 0
    AND min_amount_out > 0
    AND amount_out >= min_amount_out
    AND nonce > 0
    AND deadline BETWEEN 1 AND 9007199254740991
  ),
  CONSTRAINT chk_pnl_records_gross_pnl_bps_safe CHECK (
    gross_pnl_bps BETWEEN -9007199254740991 AND 9007199254740991
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_pnl_records_quote_model ON pnl_records (quote_id, model);
CREATE INDEX IF NOT EXISTS idx_pnl_records_realized_at ON pnl_records (realized_at DESC);
CREATE INDEX IF NOT EXISTS idx_pnl_records_chain_pair_realized_at ON pnl_records (
  chain_id,
  token_in,
  token_out,
  realized_at DESC
);

-- Add foreign keys from quotes to reference tables
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_quotes_snapshot_id'
  ) THEN
    ALTER TABLE quotes ADD CONSTRAINT fk_quotes_snapshot_id
      FOREIGN KEY (snapshot_id) REFERENCES market_snapshots(id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_quotes_settlement_event_id'
  ) THEN
    ALTER TABLE quotes ADD CONSTRAINT fk_quotes_settlement_event_id
      FOREIGN KEY (settlement_event_id) REFERENCES settlement_events(id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_quotes_hedge_order_id'
  ) THEN
    ALTER TABLE quotes ADD CONSTRAINT fk_quotes_hedge_order_id
      FOREIGN KEY (hedge_order_id) REFERENCES hedge_orders(id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_quotes_pnl_id'
  ) THEN
    ALTER TABLE quotes ADD CONSTRAINT fk_quotes_pnl_id
      FOREIGN KEY (pnl_id) REFERENCES pnl_records(id);
  END IF;
END;
$$;

-- Triggers and function
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_quotes_set_updated_at ON quotes;
CREATE TRIGGER trg_quotes_set_updated_at
BEFORE UPDATE ON quotes
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_inventory_positions_set_updated_at ON inventory_positions;
CREATE TRIGGER trg_inventory_positions_set_updated_at
BEFORE UPDATE ON inventory_positions
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_hedge_orders_set_updated_at ON hedge_orders;
CREATE TRIGGER trg_hedge_orders_set_updated_at
BEFORE UPDATE ON hedge_orders
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();
