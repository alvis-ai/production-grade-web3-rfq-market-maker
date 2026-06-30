CREATE TABLE quotes (
  id TEXT PRIMARY KEY,
  chain_id BIGINT NOT NULL,
  user_address TEXT NOT NULL,
  token_in TEXT NOT NULL,
  token_out TEXT NOT NULL,
  amount_in NUMERIC(78, 0) NOT NULL,
  amount_out NUMERIC(78, 0),
  min_amount_out NUMERIC(78, 0),
  nonce NUMERIC(78, 0),
  deadline TIMESTAMPTZ,
  snapshot_id TEXT,
  pricing_version TEXT,
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
  CONSTRAINT chk_quotes_status CHECK (
    status IN ('requested', 'rejected', 'signed', 'expired', 'submitted', 'settled', 'failed')
  ),
  CONSTRAINT chk_quotes_amounts_non_negative CHECK (
    amount_in > 0
    AND (amount_out IS NULL OR amount_out >= 0)
    AND (min_amount_out IS NULL OR min_amount_out >= 0)
    AND (nonce IS NULL OR nonce >= 0)
  ),
  CONSTRAINT chk_quotes_addresses_hex CHECK (
    user_address ~ '^0x[0-9a-fA-F]{40}$'
    AND token_in ~ '^0x[0-9a-fA-F]{40}$'
    AND token_out ~ '^0x[0-9a-fA-F]{40}$'
  ),
  CONSTRAINT chk_quotes_signature_and_tx_hash_hex CHECK (
    (signature IS NULL OR signature ~ '^0x[0-9a-fA-F]{130}$')
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
  CONSTRAINT chk_quotes_signed_payload_consistency CHECK (
    status NOT IN ('signed', 'expired', 'submitted', 'settled')
    OR (
      amount_out IS NOT NULL
      AND min_amount_out IS NOT NULL
      AND nonce IS NOT NULL
      AND deadline IS NOT NULL
      AND pricing_version IS NOT NULL
      AND risk_policy_version IS NOT NULL
      AND signature IS NOT NULL
    )
  ),
  CONSTRAINT chk_quotes_rejection_payload_consistency CHECK (
    status NOT IN ('rejected', 'failed')
    OR reject_code IS NOT NULL
  )
);

CREATE INDEX idx_quotes_user_created_at ON quotes (user_address, created_at DESC);
CREATE INDEX idx_quotes_status_created_at ON quotes (status, created_at DESC);
CREATE UNIQUE INDEX uq_quotes_chain_user_nonce ON quotes (chain_id, user_address, nonce)
  WHERE nonce IS NOT NULL;

CREATE TABLE market_snapshots (
  id TEXT PRIMARY KEY,
  chain_id BIGINT NOT NULL,
  token_in TEXT NOT NULL,
  token_out TEXT NOT NULL,
  mid_price NUMERIC(38, 18) NOT NULL,
  bid_price NUMERIC(38, 18),
  ask_price NUMERIC(38, 18),
  liquidity_usd NUMERIC(38, 8),
  volatility_bps INTEGER,
  source TEXT NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_market_snapshots_prices CHECK (
    mid_price > 0
    AND (bid_price IS NULL OR bid_price > 0)
    AND (ask_price IS NULL OR ask_price > 0)
    AND (liquidity_usd IS NULL OR liquidity_usd >= 0)
    AND (volatility_bps IS NULL OR volatility_bps >= 0)
  ),
  CONSTRAINT chk_market_snapshots_addresses_hex CHECK (
    token_in ~ '^0x[0-9a-fA-F]{40}$'
    AND token_out ~ '^0x[0-9a-fA-F]{40}$'
  )
);

CREATE TABLE risk_decisions (
  id TEXT PRIMARY KEY,
  quote_id TEXT NOT NULL REFERENCES quotes(id),
  decision TEXT NOT NULL,
  reason_code TEXT,
  policy_version TEXT NOT NULL,
  max_notional_usd NUMERIC(38, 8),
  inventory_exposure_before NUMERIC(78, 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_risk_decisions_status CHECK (decision IN ('approved', 'rejected')),
  CONSTRAINT chk_risk_decisions_limits CHECK (
    (max_notional_usd IS NULL OR max_notional_usd >= 0)
    AND (inventory_exposure_before IS NULL OR inventory_exposure_before >= 0)
  )
);

CREATE INDEX idx_risk_decisions_quote_id ON risk_decisions (quote_id);

CREATE TABLE settlement_events (
  id TEXT PRIMARY KEY,
  quote_id TEXT NOT NULL REFERENCES quotes(id),
  chain_id BIGINT NOT NULL,
  tx_hash TEXT NOT NULL,
  quote_hash TEXT NOT NULL,
  log_index INTEGER NOT NULL,
  block_number BIGINT NOT NULL,
  user_address TEXT NOT NULL,
  token_in TEXT NOT NULL,
  token_out TEXT NOT NULL,
  amount_in NUMERIC(78, 0) NOT NULL,
  amount_out NUMERIC(78, 0) NOT NULL,
  nonce NUMERIC(78, 0) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (chain_id, tx_hash, log_index),
  CONSTRAINT chk_settlement_events_hashes CHECK (
    tx_hash ~ '^0x[0-9a-fA-F]{64}$'
    AND quote_hash ~ '^0x[0-9a-fA-F]{64}$'
  ),
  CONSTRAINT chk_settlement_events_addresses_hex CHECK (
    user_address ~ '^0x[0-9a-fA-F]{40}$'
    AND token_in ~ '^0x[0-9a-fA-F]{40}$'
    AND token_out ~ '^0x[0-9a-fA-F]{40}$'
  ),
  CONSTRAINT chk_settlement_events_amounts_positive CHECK (
    amount_in > 0
    AND amount_out > 0
    AND nonce >= 0
    AND log_index >= 0
    AND block_number >= 0
  )
);

CREATE UNIQUE INDEX uq_settlement_events_quote_id ON settlement_events (quote_id);

CREATE TABLE inventory_positions (
  id TEXT PRIMARY KEY,
  chain_id BIGINT NOT NULL,
  token_address TEXT NOT NULL,
  balance NUMERIC(78, 0) NOT NULL,
  target_balance NUMERIC(78, 0),
  max_exposure NUMERIC(78, 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (chain_id, token_address),
  CONSTRAINT chk_inventory_positions_token_hex CHECK (token_address ~ '^0x[0-9a-fA-F]{40}$'),
  CONSTRAINT chk_inventory_positions_limits CHECK (
    (target_balance IS NULL OR target_balance >= 0)
    AND (max_exposure IS NULL OR max_exposure >= 0)
  )
);

CREATE TABLE hedge_orders (
  id TEXT PRIMARY KEY,
  settlement_event_id TEXT NOT NULL REFERENCES settlement_events(id),
  chain_id BIGINT NOT NULL,
  token_address TEXT NOT NULL,
  side TEXT NOT NULL,
  amount NUMERIC(78, 0) NOT NULL,
  venue TEXT NOT NULL,
  status TEXT NOT NULL,
  external_order_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_hedge_orders_side CHECK (side IN ('buy', 'sell')),
  CONSTRAINT chk_hedge_orders_status CHECK (status IN ('queued')),
  CONSTRAINT chk_hedge_orders_token_hex CHECK (token_address ~ '^0x[0-9a-fA-F]{40}$'),
  CONSTRAINT chk_hedge_orders_amount_positive CHECK (amount > 0)
);

CREATE UNIQUE INDEX uq_hedge_orders_settlement_event ON hedge_orders (settlement_event_id);

CREATE TABLE pnl_records (
  id TEXT PRIMARY KEY,
  quote_id TEXT NOT NULL REFERENCES quotes(id),
  chain_id BIGINT NOT NULL,
  token_in TEXT NOT NULL,
  token_out TEXT NOT NULL,
  amount_in NUMERIC(78, 0) NOT NULL,
  amount_out NUMERIC(78, 0) NOT NULL,
  gross_pnl_token_out NUMERIC(78, 0) NOT NULL,
  gross_pnl_bps INTEGER NOT NULL,
  model TEXT NOT NULL,
  realized_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (quote_id, model),
  CONSTRAINT chk_pnl_records_model CHECK (model IN ('simulated_mid_price_v1')),
  CONSTRAINT chk_pnl_records_addresses_hex CHECK (
    token_in ~ '^0x[0-9a-fA-F]{40}$'
    AND token_out ~ '^0x[0-9a-fA-F]{40}$'
  ),
  CONSTRAINT chk_pnl_records_amounts_positive CHECK (
    amount_in > 0
    AND amount_out > 0
  )
);

CREATE INDEX idx_pnl_records_realized_at ON pnl_records (realized_at DESC);
CREATE INDEX idx_pnl_records_chain_pair_realized_at ON pnl_records (
  chain_id,
  token_in,
  token_out,
  realized_at DESC
);

ALTER TABLE quotes
  ADD CONSTRAINT fk_quotes_snapshot_id
  FOREIGN KEY (snapshot_id) REFERENCES market_snapshots(id);

ALTER TABLE quotes
  ADD CONSTRAINT fk_quotes_settlement_event_id
  FOREIGN KEY (settlement_event_id) REFERENCES settlement_events(id);

ALTER TABLE quotes
  ADD CONSTRAINT fk_quotes_hedge_order_id
  FOREIGN KEY (hedge_order_id) REFERENCES hedge_orders(id);

ALTER TABLE quotes
  ADD CONSTRAINT fk_quotes_pnl_id
  FOREIGN KEY (pnl_id) REFERENCES pnl_records(id);
