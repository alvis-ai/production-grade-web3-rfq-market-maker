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
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
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
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE risk_decisions (
  id TEXT PRIMARY KEY,
  quote_id TEXT NOT NULL REFERENCES quotes(id),
  decision TEXT NOT NULL,
  reason_code TEXT,
  policy_version TEXT NOT NULL,
  max_notional_usd NUMERIC(38, 8),
  inventory_exposure_before NUMERIC(78, 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_risk_decisions_quote_id ON risk_decisions (quote_id);

CREATE TABLE settlement_events (
  id TEXT PRIMARY KEY,
  quote_id TEXT NOT NULL REFERENCES quotes(id),
  chain_id BIGINT NOT NULL,
  tx_hash TEXT NOT NULL,
  log_index INTEGER NOT NULL,
  block_number BIGINT NOT NULL,
  user_address TEXT NOT NULL,
  token_in TEXT NOT NULL,
  token_out TEXT NOT NULL,
  amount_in NUMERIC(78, 0) NOT NULL,
  amount_out NUMERIC(78, 0) NOT NULL,
  nonce NUMERIC(78, 0) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (chain_id, tx_hash, log_index)
);

CREATE TABLE inventory_positions (
  id TEXT PRIMARY KEY,
  chain_id BIGINT NOT NULL,
  token_address TEXT NOT NULL,
  balance NUMERIC(78, 0) NOT NULL,
  target_balance NUMERIC(78, 0),
  max_exposure NUMERIC(78, 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (chain_id, token_address)
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
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
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
  UNIQUE (quote_id, model)
);

CREATE INDEX idx_pnl_records_realized_at ON pnl_records (realized_at DESC);
CREATE INDEX idx_pnl_records_chain_pair_realized_at ON pnl_records (
  chain_id,
  token_in,
  token_out,
  realized_at DESC
);
