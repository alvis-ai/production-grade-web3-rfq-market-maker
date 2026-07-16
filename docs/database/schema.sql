CREATE TABLE quotes (
  id TEXT PRIMARY KEY,
  principal_id TEXT NOT NULL,
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
  route_id TEXT,
  route_venue TEXT,
  route_expected_liquidity_usd NUMERIC(78, 0),
  route_decided_at TIMESTAMPTZ,
  pricing_version TEXT,
  spread_bps INTEGER,
  size_impact_bps INTEGER,
  market_spread_bps INTEGER,
  inventory_skew_bps INTEGER,
  volatility_premium_bps INTEGER,
  hedge_cost_bps INTEGER,
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
  CONSTRAINT chk_quotes_principal_id_safe CHECK (
    btrim(principal_id) <> ''
    AND char_length(principal_id) <= 128
    AND principal_id ~ '^[A-Za-z0-9_:-]+$'
  ),
  CONSTRAINT chk_quotes_status CHECK (
    status IN ('requested', 'rejected', 'signed', 'expired', 'submitted', 'settled', 'failed')
  ),
  CONSTRAINT chk_quotes_chain_id_safe CHECK (chain_id BETWEEN 1 AND 9007199254740991),
  CONSTRAINT chk_quotes_slippage_bps CHECK (slippage_bps BETWEEN 0 AND 10000),
  CONSTRAINT chk_quotes_pricing_bps CHECK (
    (spread_bps IS NULL OR spread_bps BETWEEN 0 AND 10000)
    AND (size_impact_bps IS NULL OR size_impact_bps BETWEEN 0 AND 10000)
    AND (market_spread_bps IS NULL OR market_spread_bps BETWEEN 0 AND 10000)
    AND (inventory_skew_bps IS NULL OR inventory_skew_bps BETWEEN -10000 AND 10000)
    AND (volatility_premium_bps IS NULL OR volatility_premium_bps BETWEEN 0 AND 10000)
    AND (hedge_cost_bps IS NULL OR hedge_cost_bps BETWEEN 0 AND 10000)
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
  CONSTRAINT chk_quotes_route_id_safe CHECK (
    route_id IS NULL
    OR (
      btrim(route_id) <> ''
      AND char_length(route_id) <= 128
      AND route_id ~ '^[A-Za-z0-9_:-]+$'
    )
  ),
  CONSTRAINT chk_quotes_route_venue CHECK (
    route_venue IS NULL OR route_venue = 'internal_inventory'
  ),
  CONSTRAINT chk_quotes_route_decision_atomic CHECK (
    (
      route_id IS NULL
      AND route_venue IS NULL
      AND route_expected_liquidity_usd IS NULL
      AND route_decided_at IS NULL
    )
    OR (
      route_id IS NOT NULL
      AND route_venue IS NOT NULL
      AND route_expected_liquidity_usd > 0
      AND route_decided_at IS NOT NULL
    )
  ),
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
      AND market_spread_bps IS NULL
      AND inventory_skew_bps IS NULL
      AND volatility_premium_bps IS NULL
      AND hedge_cost_bps IS NULL
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
      AND market_spread_bps IS NOT NULL
      AND inventory_skew_bps IS NOT NULL
      AND volatility_premium_bps IS NOT NULL
      AND hedge_cost_bps IS NOT NULL
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
      AND market_spread_bps IS NULL
      AND inventory_skew_bps IS NULL
      AND volatility_premium_bps IS NULL
      AND hedge_cost_bps IS NULL
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
      AND market_spread_bps IS NOT NULL
      AND inventory_skew_bps IS NOT NULL
      AND volatility_premium_bps IS NOT NULL
      AND hedge_cost_bps IS NOT NULL
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

CREATE INDEX idx_quotes_user_created_at ON quotes (user_address, created_at DESC);
CREATE INDEX idx_quotes_principal_created_at ON quotes (principal_id, created_at DESC);
CREATE INDEX idx_quotes_status_created_at ON quotes (status, created_at DESC);
CREATE UNIQUE INDEX uq_quotes_chain_user_nonce ON quotes (chain_id, user_address, nonce)
  WHERE nonce IS NOT NULL;
CREATE INDEX idx_quotes_snapshot_id ON quotes (snapshot_id)
  WHERE snapshot_id IS NOT NULL;
CREATE INDEX idx_quotes_route_id ON quotes (route_id)
  WHERE route_id IS NOT NULL;
CREATE INDEX idx_quotes_settlement_event_id ON quotes (settlement_event_id)
  WHERE settlement_event_id IS NOT NULL;
CREATE INDEX idx_quotes_hedge_order_id ON quotes (hedge_order_id)
  WHERE hedge_order_id IS NOT NULL;
CREATE INDEX idx_quotes_pnl_id ON quotes (pnl_id)
  WHERE pnl_id IS NOT NULL;

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

CREATE TABLE quote_exposure_reservations (
  quote_id TEXT PRIMARY KEY REFERENCES quotes(id) ON DELETE CASCADE,
  chain_id BIGINT NOT NULL,
  user_address TEXT NOT NULL,
  token_low TEXT NOT NULL,
  token_high TEXT NOT NULL,
  token_in TEXT NOT NULL,
  amount_in NUMERIC(78, 0) NOT NULL,
  token_out TEXT NOT NULL,
  amount_out NUMERIC(78, 0) NOT NULL,
  notional_usd_e18 NUMERIC(96, 0) NOT NULL,
  settlement_address TEXT,
  treasury_address TEXT,
  treasury_available_balance NUMERIC(78, 0),
  treasury_block_number NUMERIC(78, 0),
  var_evaluation JSONB,
  delta_evaluation JSONB,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_quote_exposure_chain_id CHECK (chain_id BETWEEN 1 AND 9007199254740991),
  CONSTRAINT chk_quote_exposure_addresses CHECK (
    user_address ~ '^0x[0-9a-f]{40}$'
    AND token_low ~ '^0x[0-9a-f]{40}$'
    AND token_high ~ '^0x[0-9a-f]{40}$'
    AND token_low < token_high
  ),
  CONSTRAINT chk_quote_exposure_notional CHECK (notional_usd_e18 > 0),
  CONSTRAINT chk_quote_exposure_output CHECK (
    token_out ~ '^0x[0-9a-f]{40}$' AND amount_out > 0
  ),
  CONSTRAINT chk_quote_exposure_input CHECK (
    token_in ~ '^0x[0-9a-f]{40}$' AND amount_in > 0 AND token_in <> token_out
  ),
  CONSTRAINT chk_quote_exposure_var_evaluation CHECK (
    var_evaluation IS NULL
    OR (
      jsonb_typeof(var_evaluation) = 'object'
      AND var_evaluation ?& ARRAY[
        'modelVersion',
        'horizonSeconds',
        'preTradeVarUsdE18',
        'postTradeVarUsdE18',
        'varLimitUsdE18',
        'preTradeComponents',
        'postTradeComponents'
      ]
      AND (var_evaluation - ARRAY[
        'modelVersion',
        'horizonSeconds',
        'preTradeVarUsdE18',
        'postTradeVarUsdE18',
        'varLimitUsdE18',
        'preTradeComponents',
        'postTradeComponents'
      ]) = '{}'::jsonb
      AND jsonb_typeof(var_evaluation->'preTradeComponents') = 'array'
      AND jsonb_typeof(var_evaluation->'postTradeComponents') = 'array'
    )
  ),
  CONSTRAINT chk_quote_exposure_delta_evaluation CHECK (
    delta_evaluation IS NULL
    OR (
      jsonb_typeof(delta_evaluation) = 'object'
      AND delta_evaluation ?& ARRAY[
        'modelVersion',
        'preTradeGrossDeltaUsdE18',
        'postTradeGrossDeltaUsdE18',
        'preTradeNetDeltaUsdE18',
        'postTradeNetDeltaUsdE18',
        'softGrossLimitUsdE18',
        'hardGrossLimitUsdE18',
        'softNetLimitUsdE18',
        'hardNetLimitUsdE18',
        'softLimitBreached',
        'preTradeComponents',
        'postTradeComponents'
      ]
      AND (delta_evaluation - ARRAY[
        'modelVersion',
        'preTradeGrossDeltaUsdE18',
        'postTradeGrossDeltaUsdE18',
        'preTradeNetDeltaUsdE18',
        'postTradeNetDeltaUsdE18',
        'softGrossLimitUsdE18',
        'hardGrossLimitUsdE18',
        'softNetLimitUsdE18',
        'hardNetLimitUsdE18',
        'softLimitBreached',
        'preTradeComponents',
        'postTradeComponents'
      ]) = '{}'::jsonb
      AND jsonb_typeof(delta_evaluation->'softLimitBreached') = 'boolean'
      AND jsonb_typeof(delta_evaluation->'preTradeComponents') = 'array'
      AND jsonb_typeof(delta_evaluation->'postTradeComponents') = 'array'
    )
  ),
  CONSTRAINT chk_quote_exposure_treasury_evidence CHECK (
    (
      settlement_address IS NULL
      AND treasury_address IS NULL
      AND treasury_available_balance IS NULL
      AND treasury_block_number IS NULL
    )
    OR (
      settlement_address IS NOT NULL
      AND treasury_address IS NOT NULL
      AND treasury_available_balance IS NOT NULL
      AND treasury_block_number IS NOT NULL
      AND settlement_address ~ '^0x[0-9a-f]{40}$'
      AND treasury_address ~ '^0x[0-9a-f]{40}$'
      AND treasury_available_balance >= 0
      AND treasury_block_number >= 0
    )
  )
);

CREATE INDEX idx_quote_exposure_user_active
  ON quote_exposure_reservations (chain_id, user_address, expires_at);
CREATE INDEX idx_quote_exposure_pair_active
  ON quote_exposure_reservations (chain_id, token_low, token_high, expires_at);
CREATE INDEX idx_quote_exposure_expiry
  ON quote_exposure_reservations (expires_at);
CREATE INDEX idx_quote_exposure_output_active
  ON quote_exposure_reservations (chain_id, token_out, expires_at);

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
    char_length(principal_id) BETWEEN 1 AND 128 AND principal_id ~ '^[A-Za-z0-9_:-]+$'
  ),
  CONSTRAINT chk_quote_idempotency_key CHECK (
    char_length(idempotency_key) BETWEEN 16 AND 128 AND idempotency_key ~ '^[A-Za-z0-9._:-]+$'
  ),
  CONSTRAINT chk_quote_idempotency_request_hash CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT chk_quote_idempotency_quote_id CHECK (
    quote_id IS NULL OR (char_length(quote_id) BETWEEN 1 AND 128 AND quote_id ~ '^[A-Za-z0-9_:-]+$')
  ),
  CONSTRAINT chk_quote_idempotency_state CHECK (state IN ('processing', 'succeeded', 'failed')),
  CONSTRAINT chk_quote_idempotency_lease CHECK (
    lease_expires_at IS NULL OR lease_expires_at > created_at
  ),
  CONSTRAINT chk_quote_idempotency_payload CHECK (
    (state = 'processing' AND owner_token IS NOT NULL AND lease_expires_at IS NOT NULL
      AND response IS NULL AND error_code IS NULL AND error_message IS NULL
      AND error_status_code IS NULL AND completed_at IS NULL)
    OR (state = 'succeeded' AND owner_token IS NULL AND lease_expires_at IS NULL
      AND quote_id IS NOT NULL AND response IS NOT NULL AND jsonb_typeof(response) = 'object'
      AND error_code IS NULL AND error_message IS NULL AND error_status_code IS NULL
      AND completed_at IS NOT NULL)
    OR (state = 'failed' AND owner_token IS NULL AND lease_expires_at IS NULL
      AND response IS NULL AND error_code IS NOT NULL AND error_message IS NOT NULL
      AND error_status_code BETWEEN 400 AND 599 AND completed_at IS NOT NULL)
  ),
  CONSTRAINT chk_quote_idempotency_owner CHECK (
    owner_token IS NULL OR (char_length(owner_token) BETWEEN 1 AND 128 AND owner_token ~ '^[A-Za-z0-9_:-]+$')
  ),
  CONSTRAINT chk_quote_idempotency_error CHECK (
    error_code IS NULL OR (char_length(error_code) BETWEEN 1 AND 64
      AND error_code ~ '^[A-Z0-9_]+$' AND char_length(error_message) BETWEEN 1 AND 256)
  )
);

CREATE INDEX idx_quote_idempotency_processing_lease
  ON quote_idempotency_requests (lease_expires_at)
  WHERE state = 'processing';
CREATE INDEX idx_quote_idempotency_quote_id
  ON quote_idempotency_requests (quote_id)
  WHERE quote_id IS NOT NULL;

CREATE TABLE market_snapshots (
  id TEXT PRIMARY KEY,
  chain_id BIGINT NOT NULL,
  token_in TEXT NOT NULL,
  token_out TEXT NOT NULL,
  mid_price NUMERIC(38, 18) NOT NULL,
  bid_price NUMERIC(38, 18),
  ask_price NUMERIC(38, 18),
  liquidity_usd NUMERIC(78, 0) NOT NULL,
  market_spread_bps INTEGER NOT NULL,
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
  CONSTRAINT chk_market_snapshots_market_spread_bps CHECK (market_spread_bps BETWEEN 0 AND 10000),
  CONSTRAINT chk_market_snapshots_source_non_empty CHECK (btrim(source) <> ''),
  CONSTRAINT chk_market_snapshots_chain_id_safe CHECK (chain_id BETWEEN 1 AND 9007199254740991),
  CONSTRAINT chk_market_snapshots_addresses_hex CHECK (
    token_in ~ '^0x[0-9a-fA-F]{40}$'
    AND token_out ~ '^0x[0-9a-fA-F]{40}$'
  ),
  CONSTRAINT chk_market_snapshots_distinct_tokens CHECK (lower(token_in) <> lower(token_out))
);

CREATE INDEX idx_market_snapshots_pair_observed_at ON market_snapshots (
  chain_id,
  token_in,
  token_out,
  observed_at DESC
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
        'MARKET_LIQUIDITY_TOO_LOW',
        'MARKET_VOLATILITY_LIMIT_EXCEEDED',
        'AMOUNT_IN_LIMIT_EXCEEDED',
        'AMOUNT_OUT_TOO_SMALL',
        'QUOTE_NOTIONAL_LIMIT_EXCEEDED',
        'USER_OPEN_NOTIONAL_LIMIT_EXCEEDED',
        'PAIR_OPEN_NOTIONAL_LIMIT_EXCEEDED',
        'TREASURY_LIQUIDITY_INSUFFICIENT',
        'PORTFOLIO_VAR_LIMIT_EXCEEDED',
        'PORTFOLIO_DELTA_LIMIT_EXCEEDED',
        'GAMMA_GUARDRAIL_TRIGGERED',
        'DAILY_LOSS_LIMIT_EXCEEDED',
        'USD_REFERENCE_REQUIRED',
        'USD_REFERENCE_DEPEG',
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

CREATE INDEX idx_risk_decisions_quote_id ON risk_decisions (quote_id);

CREATE TABLE settlement_events (
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
  canonical BOOLEAN NOT NULL DEFAULT TRUE,
  removed_at TIMESTAMPTZ,
  settled_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (chain_id, tx_hash, log_index),
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
  ),
  CONSTRAINT chk_settlement_events_canonical_state CHECK (
    (canonical = TRUE AND removed_at IS NULL)
    OR (canonical = FALSE AND removed_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX uq_settlement_events_canonical_quote_id ON settlement_events (quote_id)
  WHERE canonical = TRUE;
CREATE INDEX idx_settlement_events_chain_quote_hash ON settlement_events (chain_id, quote_hash);
CREATE INDEX idx_settlement_events_canonical_block ON settlement_events (block_number, log_index)
  WHERE canonical = TRUE;

CREATE TABLE inventory_positions (
  id TEXT PRIMARY KEY,
  chain_id BIGINT NOT NULL,
  token_address TEXT NOT NULL,
  balance NUMERIC(78, 0) NOT NULL,
  target_balance NUMERIC(78, 0),
  max_exposure NUMERIC(78, 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (chain_id, token_address),
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

CREATE TABLE hedge_orders (
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
  venue_order_id TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  lease_owner TEXT,
  lease_expires_at TIMESTAMPTZ,
  venue_symbol TEXT,
  client_order_id TEXT,
  submission_attempted_at TIMESTAMPTZ,
  filled_amount NUMERIC(78, 0),
  execution_evidence_version TEXT,
  executed_quote_quantity NUMERIC(78, 18),
  fee_reconciliation_status TEXT,
  fee_attempt_count INTEGER NOT NULL DEFAULT 0,
  fee_next_attempt_at TIMESTAMPTZ,
  fee_lease_owner TEXT,
  fee_lease_expires_at TIMESTAMPTZ,
  fee_last_error_code TEXT,
  fee_reconciled_at TIMESTAMPTZ,
  route_accounting_version TEXT,
  venue_base_asset TEXT,
  venue_quote_asset TEXT,
  venue_quote_token_address CHAR(42),
  venue_base_decimals SMALLINT,
  venue_quote_decimals SMALLINT,
  venue_step_size_raw NUMERIC(78, 0),
  execution_order_type TEXT,
  execution_time_in_force TEXT,
  execution_limit_price NUMERIC(78, 18),
  execution_price_tick NUMERIC(78, 18),
  execution_max_slippage_bps INTEGER,
  execution_policy_version TEXT,
  execution_max_order_age_ms BIGINT,
  cancel_requested_at TIMESTAMPTZ,
  risk_failure_at TIMESTAMPTZ,
  hedge_net_pnl_model TEXT,
  hedge_net_pnl_model_description TEXT,
  hedge_net_pnl_status TEXT,
  hedge_settlement_reference_quantity NUMERIC(96, 18),
  hedge_residual_base_amount NUMERIC(78, 0),
  hedge_residual_quote_quantity NUMERIC(96, 18),
  hedge_commission_quote_quantity NUMERIC(96, 18),
  hedge_net_pnl_quote_quantity NUMERIC(96, 18),
  hedge_net_pnl_reason_code TEXT,
  hedge_unvalued_commission_assets JSONB,
  hedge_net_pnl_realized_at TIMESTAMPTZ,
  last_error_code TEXT,
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
  CONSTRAINT chk_hedge_orders_venue_non_empty CHECK (
    char_length(btrim(venue)) BETWEEN 1 AND 128
  ),
  CONSTRAINT chk_hedge_orders_external_order_id_non_empty CHECK (
    external_order_id IS NULL OR btrim(external_order_id) <> ''
  ),
  CONSTRAINT chk_hedge_orders_attempt_count CHECK (attempt_count BETWEEN 0 AND 1000000),
  CONSTRAINT chk_hedge_orders_venue_order_id CHECK (
    venue_order_id IS NULL
    OR (
      char_length(venue_order_id) BETWEEN 1 AND 16
      AND venue_order_id ~ '^[1-9][0-9]*$'
      AND venue_order_id::NUMERIC <= 9007199254740991
    )
  ),
  CONSTRAINT chk_hedge_orders_fee_attempt_count CHECK (fee_attempt_count BETWEEN 0 AND 1000000),
  CONSTRAINT chk_hedge_orders_fee_last_error CHECK (
    fee_last_error_code IS NULL
    OR (char_length(fee_last_error_code) BETWEEN 1 AND 128 AND fee_last_error_code ~ '^[A-Z0-9_:-]+$')
  ),
  CONSTRAINT chk_hedge_orders_lease_state CHECK (
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
  CONSTRAINT chk_hedge_orders_venue_symbol CHECK (
    venue_symbol IS NULL
    OR (char_length(venue_symbol) BETWEEN 3 AND 32 AND venue_symbol ~ '^[A-Z0-9._-]+$')
  ),
  CONSTRAINT chk_hedge_orders_client_order_id CHECK (
    client_order_id IS NULL
    OR (char_length(client_order_id) BETWEEN 1 AND 36 AND client_order_id ~ '^[A-Za-z0-9._-]+$')
  ),
  CONSTRAINT chk_hedge_orders_submission_attempt CHECK (
    submission_attempted_at IS NULL
    OR (venue <> 'internal' AND venue_symbol IS NOT NULL AND client_order_id IS NOT NULL)
  ),
  CONSTRAINT chk_hedge_orders_last_error_code CHECK (
    last_error_code IS NULL
    OR (char_length(last_error_code) BETWEEN 1 AND 128 AND last_error_code ~ '^[A-Z0-9_:-]+$')
  ),
  CONSTRAINT chk_hedge_orders_filled_amount CHECK (
    filled_amount IS NULL OR (filled_amount > 0 AND filled_amount <= amount)
  ),
  CONSTRAINT chk_hedge_orders_execution_evidence CHECK (
    (
      filled_amount IS NULL
      AND execution_evidence_version IS NULL
      AND executed_quote_quantity IS NULL
    )
    OR (
      filled_amount IS NOT NULL
      AND (
        (execution_evidence_version = 'base-only-v1' AND executed_quote_quantity IS NULL)
        OR (
          execution_evidence_version = 'base-and-quote-v2'
          AND executed_quote_quantity > 0
        )
      )
    )
  ),
  CONSTRAINT chk_hedge_orders_fee_reconciliation CHECK (
    (
      fee_reconciliation_status IS NULL
      AND fee_next_attempt_at IS NULL
      AND fee_lease_owner IS NULL
      AND fee_lease_expires_at IS NULL
      AND fee_last_error_code IS NULL
      AND fee_reconciled_at IS NULL
    )
    OR (
      fee_reconciliation_status = 'pending'
      AND venue = 'binance'
      AND venue_symbol IS NOT NULL
      AND client_order_id IS NOT NULL
      AND filled_amount IS NOT NULL
      AND fee_next_attempt_at IS NOT NULL
      AND fee_reconciled_at IS NULL
      AND (
        (fee_lease_owner IS NULL AND fee_lease_expires_at IS NULL)
        OR (
          fee_lease_owner IS NOT NULL
          AND fee_lease_expires_at IS NOT NULL
          AND char_length(fee_lease_owner) BETWEEN 1 AND 128
          AND fee_lease_owner ~ '^[A-Za-z0-9_:-]+$'
        )
      )
    )
    OR (
      fee_reconciliation_status = 'complete'
      AND venue = 'binance'
      AND venue_symbol IS NOT NULL
      AND client_order_id IS NOT NULL
      AND venue_order_id IS NOT NULL
      AND filled_amount IS NOT NULL
      AND execution_evidence_version = 'base-and-quote-v2'
      AND executed_quote_quantity IS NOT NULL
      AND fee_next_attempt_at IS NULL
      AND fee_lease_owner IS NULL
      AND fee_lease_expires_at IS NULL
      AND fee_last_error_code IS NULL
      AND fee_reconciled_at IS NOT NULL
    )
  ),
  CONSTRAINT chk_hedge_orders_execution_policy CHECK (
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
  ),
  CONSTRAINT chk_hedge_orders_execution_expiry CHECK (
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
  ),
  CONSTRAINT chk_hedge_orders_route_accounting CHECK (
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
  ),
  CONSTRAINT chk_hedge_orders_terminal_state CHECK (
    status = 'queued'
    OR (
      lease_owner IS NULL
      AND lease_expires_at IS NULL
      AND (status <> 'filled' OR (external_order_id IS NOT NULL AND filled_amount IS NOT NULL))
    )
  ),
  CONSTRAINT chk_hedge_orders_risk_failure_time CHECK (
    (status = 'failed' AND risk_failure_at IS NOT NULL)
    OR (status <> 'failed' AND risk_failure_at IS NULL)
  ),
  CONSTRAINT chk_hedge_orders_token_hex CHECK (token_address ~ '^0x[0-9a-fA-F]{40}$'),
  CONSTRAINT chk_hedge_orders_amount_positive CHECK (amount > 0)
);

CREATE UNIQUE INDEX uq_hedge_orders_settlement_event ON hedge_orders (settlement_event_id);
CREATE INDEX idx_hedge_orders_queued_claim
  ON hedge_orders (next_attempt_at, created_at, id)
  WHERE status = 'queued';
CREATE UNIQUE INDEX uq_hedge_orders_venue_client_order
  ON hedge_orders (venue, client_order_id)
  WHERE client_order_id IS NOT NULL;
CREATE INDEX idx_hedge_orders_fee_reconciliation_claim
  ON hedge_orders (fee_next_attempt_at, created_at, id)
  WHERE fee_reconciliation_status = 'pending';
CREATE INDEX idx_hedge_orders_net_pnl_status
  ON hedge_orders (hedge_net_pnl_status, hedge_net_pnl_realized_at, id)
  WHERE hedge_net_pnl_status IS NOT NULL;
CREATE INDEX idx_hedge_orders_execution_policy
  ON hedge_orders (execution_policy_version, status, created_at, id)
  WHERE execution_policy_version IS NOT NULL;
CREATE INDEX idx_hedge_orders_cancel_requested
  ON hedge_orders (cancel_requested_at, next_attempt_at, id)
  WHERE status = 'queued' AND cancel_requested_at IS NOT NULL;
CREATE INDEX idx_hedge_orders_recent_failed_risk
  ON hedge_orders (chain_id, lower(token_address), risk_failure_at DESC)
  WHERE status = 'failed';

CREATE TABLE hedge_execution_fills (
  hedge_order_id TEXT NOT NULL REFERENCES hedge_orders(id) ON DELETE CASCADE,
  venue TEXT NOT NULL,
  venue_symbol TEXT NOT NULL,
  venue_order_id TEXT NOT NULL,
  venue_trade_id TEXT NOT NULL,
  price NUMERIC(78, 18) NOT NULL,
  base_quantity NUMERIC(78, 36) NOT NULL,
  quote_quantity NUMERIC(78, 18) NOT NULL,
  commission_quantity NUMERIC(78, 36) NOT NULL,
  commission_asset TEXT NOT NULL,
  executed_at TIMESTAMPTZ NOT NULL,
  is_buyer BOOLEAN NOT NULL,
  is_maker BOOLEAN NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (hedge_order_id, venue_trade_id),
  CONSTRAINT chk_hedge_execution_fills_venue CHECK (venue = 'binance'),
  CONSTRAINT chk_hedge_execution_fills_symbol CHECK (
    char_length(venue_symbol) BETWEEN 3 AND 32 AND venue_symbol ~ '^[A-Z0-9._-]+$'
  ),
  CONSTRAINT chk_hedge_execution_fills_order_id CHECK (
    char_length(venue_order_id) BETWEEN 1 AND 16
    AND venue_order_id ~ '^[1-9][0-9]*$'
    AND venue_order_id::NUMERIC <= 9007199254740991
  ),
  CONSTRAINT chk_hedge_execution_fills_trade_id CHECK (
    char_length(venue_trade_id) BETWEEN 1 AND 16
    AND venue_trade_id ~ '^[1-9][0-9]*$'
    AND venue_trade_id::NUMERIC <= 9007199254740991
  ),
  CONSTRAINT chk_hedge_execution_fills_quantities CHECK (
    price > 0 AND base_quantity > 0 AND quote_quantity > 0 AND commission_quantity >= 0
  ),
  CONSTRAINT chk_hedge_execution_fills_commission_asset CHECK (
    char_length(commission_asset) BETWEEN 1 AND 64
    AND commission_asset !~ '[[:space:][:cntrl:]]'
  )
);

CREATE UNIQUE INDEX uq_hedge_execution_fills_venue_trade
  ON hedge_execution_fills (venue, venue_symbol, venue_trade_id);
CREATE INDEX idx_hedge_execution_fills_hedge_executed_at
  ON hedge_execution_fills (hedge_order_id, executed_at, venue_trade_id);

CREATE TABLE pnl_records (
  id TEXT PRIMARY KEY,
  quote_id TEXT NOT NULL REFERENCES quotes(id),
  settlement_event_id TEXT NOT NULL REFERENCES settlement_events(id),
  snapshot_id TEXT NOT NULL REFERENCES market_snapshots(id),
  chain_id BIGINT NOT NULL,
  user_address TEXT NOT NULL,
  token_in TEXT NOT NULL,
  token_out TEXT NOT NULL,
  amount_in NUMERIC(78, 0) NOT NULL,
  amount_out NUMERIC(78, 0) NOT NULL,
  min_amount_out NUMERIC(78, 0) NOT NULL,
  nonce NUMERIC(78, 0) NOT NULL,
  deadline BIGINT NOT NULL,
  mid_price NUMERIC(38, 18) NOT NULL,
  token_in_decimals SMALLINT NOT NULL,
  token_out_decimals SMALLINT NOT NULL,
  fair_amount_out NUMERIC(78, 0) NOT NULL,
  valuation_observed_at TIMESTAMPTZ NOT NULL,
  gross_pnl_token_out NUMERIC(78, 0) NOT NULL,
  gross_pnl_bps BIGINT NOT NULL,
  model TEXT NOT NULL,
  model_description TEXT NOT NULL,
  realized_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (quote_id, model),
  CONSTRAINT chk_pnl_records_id_safe CHECK (
    btrim(id) <> ''
    AND char_length(id) <= 128
    AND id ~ '^[A-Za-z0-9_:-]+$'
  ),
  CONSTRAINT chk_pnl_records_model CHECK (model IN ('quote_snapshot_edge_v1')),
  CONSTRAINT chk_pnl_records_model_description CHECK (
    model_description = 'Gross settlement PnL in tokenOut base units versus the persisted quote-time mid price, excluding fees, gas, and hedge execution'
  ),
  CONSTRAINT chk_pnl_records_chain_id_safe CHECK (chain_id BETWEEN 1 AND 9007199254740991),
  CONSTRAINT chk_pnl_records_addresses_hex CHECK (
    user_address ~ '^0x[0-9a-fA-F]{40}$'
    AND token_in ~ '^0x[0-9a-fA-F]{40}$'
    AND token_out ~ '^0x[0-9a-fA-F]{40}$'
  ),
  CONSTRAINT chk_pnl_records_distinct_tokens CHECK (lower(token_in) <> lower(token_out)),
  CONSTRAINT chk_pnl_records_reference_ids_safe CHECK (
    btrim(settlement_event_id) <> ''
    AND char_length(settlement_event_id) <= 128
    AND settlement_event_id ~ '^[A-Za-z0-9_:-]+$'
    AND btrim(snapshot_id) <> ''
    AND char_length(snapshot_id) <= 128
    AND snapshot_id ~ '^[A-Za-z0-9_:-]+$'
  ),
  CONSTRAINT chk_pnl_records_amounts_positive CHECK (
    amount_in > 0
    AND amount_out > 0
    AND min_amount_out > 0
    AND amount_out >= min_amount_out
    AND nonce > 0
    AND deadline BETWEEN 1 AND 9007199254740991
  ),
  CONSTRAINT chk_pnl_records_valuation CHECK (
    mid_price > 0
    AND token_in_decimals BETWEEN 0 AND 36
    AND token_out_decimals BETWEEN 0 AND 36
    AND fair_amount_out > 0
  ),
  CONSTRAINT chk_pnl_records_gross_pnl_bps_safe CHECK (
    gross_pnl_bps BETWEEN -9007199254740991 AND 9007199254740991
  )
);

CREATE INDEX idx_pnl_records_realized_at ON pnl_records (realized_at DESC);
CREATE INDEX idx_pnl_records_chain_pair_realized_at ON pnl_records (
  chain_id,
  token_in,
  token_out,
  realized_at DESC
);
CREATE UNIQUE INDEX uq_pnl_records_settlement_model
  ON pnl_records (settlement_event_id, model);
CREATE INDEX idx_pnl_records_snapshot_id ON pnl_records (snapshot_id);

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

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_quotes_set_updated_at
BEFORE UPDATE ON quotes
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_inventory_positions_set_updated_at
BEFORE UPDATE ON inventory_positions
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_hedge_orders_set_updated_at
BEFORE UPDATE ON hedge_orders
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE FUNCTION set_hedge_risk_failure_at()
RETURNS trigger AS $$
BEGIN
  IF NEW.status <> 'failed' THEN
    NEW.risk_failure_at = NULL;
  ELSE
    IF TG_OP = 'UPDATE' THEN
      IF OLD.status = 'failed' THEN
        NEW.risk_failure_at = OLD.risk_failure_at;
      ELSE
        NEW.risk_failure_at = now();
      END IF;
    ELSE
      NEW.risk_failure_at = now();
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql
SET search_path = pg_catalog, public;

CREATE TRIGGER trg_hedge_orders_set_risk_failure_at
BEFORE INSERT OR UPDATE OF status, risk_failure_at ON hedge_orders
FOR EACH ROW
EXECUTE FUNCTION set_hedge_risk_failure_at();

CREATE TRIGGER trg_quote_idempotency_requests_set_updated_at
BEFORE UPDATE ON quote_idempotency_requests
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TABLE analytics_outbox (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  topic TEXT NOT NULL,
  event_key TEXT NOT NULL,
  event_type TEXT NOT NULL,
  schema_version INTEGER NOT NULL DEFAULT 1,
  aggregate_type TEXT NOT NULL,
  aggregate_id TEXT NOT NULL,
  payload JSONB NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  lease_owner TEXT,
  lease_expires_at TIMESTAMPTZ,
  published_at TIMESTAMPTZ,
  last_error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_analytics_outbox_topic CHECK (
    char_length(topic) BETWEEN 1 AND 249
    AND topic ~ '^[A-Za-z0-9._-]+$'
  ),
  CONSTRAINT chk_analytics_outbox_event_key CHECK (
    char_length(event_key) BETWEEN 1 AND 128
    AND event_key ~ '^[A-Za-z0-9_:-]+$'
  ),
  CONSTRAINT chk_analytics_outbox_event_type CHECK (
    char_length(event_type) BETWEEN 1 AND 128
    AND event_type ~ '^[a-z][a-z0-9_.-]+$'
  ),
  CONSTRAINT chk_analytics_outbox_schema_version CHECK (schema_version BETWEEN 1 AND 1000000),
  CONSTRAINT chk_analytics_outbox_aggregate CHECK (
    char_length(aggregate_type) BETWEEN 1 AND 64
    AND aggregate_type ~ '^[a-z][a-z0-9_-]+$'
    AND char_length(aggregate_id) BETWEEN 1 AND 128
    AND aggregate_id ~ '^[A-Za-z0-9_:-]+$'
  ),
  CONSTRAINT chk_analytics_outbox_payload CHECK (jsonb_typeof(payload) = 'object'),
  CONSTRAINT chk_analytics_outbox_attempt_count CHECK (attempt_count BETWEEN 0 AND 1000000),
  CONSTRAINT chk_analytics_outbox_lease_state CHECK (
    (lease_owner IS NULL AND lease_expires_at IS NULL)
    OR (
      published_at IS NULL
      AND lease_owner IS NOT NULL
      AND lease_expires_at IS NOT NULL
      AND char_length(lease_owner) BETWEEN 1 AND 128
      AND lease_owner ~ '^[A-Za-z0-9_:-]+$'
    )
  ),
  CONSTRAINT chk_analytics_outbox_published_state CHECK (
    published_at IS NULL OR (lease_owner IS NULL AND lease_expires_at IS NULL)
  ),
  CONSTRAINT chk_analytics_outbox_last_error CHECK (
    last_error_code IS NULL
    OR (
      char_length(last_error_code) BETWEEN 1 AND 128
      AND last_error_code ~ '^[A-Z0-9_:-]+$'
    )
  )
);

CREATE INDEX idx_analytics_outbox_pending
  ON analytics_outbox (available_at, id)
  WHERE published_at IS NULL;

CREATE INDEX idx_analytics_outbox_published_at
  ON analytics_outbox (published_at)
  WHERE published_at IS NOT NULL;

CREATE OR REPLACE FUNCTION enqueue_rfq_analytics_event()
RETURNS trigger AS $$
DECLARE
  source_row RECORD;
  event_name TEXT;
  aggregate_name TEXT;
  aggregate_key TEXT;
  event_payload JSONB;
BEGIN
  IF TG_OP = 'DELETE' THEN
    source_row := OLD;
  ELSE
    source_row := NEW;
  END IF;

  CASE TG_TABLE_NAME
    WHEN 'quotes' THEN
      event_name := 'quote.lifecycle.v1';
      aggregate_name := 'quote';
      aggregate_key := source_row.id;
      event_payload := jsonb_build_object(
        'operation', lower(TG_OP),
        'quoteId', source_row.id,
        'chainId', source_row.chain_id,
        'user', lower(source_row.user_address),
        'tokenIn', lower(source_row.token_in),
        'tokenOut', lower(source_row.token_out),
        'amountIn', source_row.amount_in::text,
        'amountOut', CASE WHEN source_row.amount_out IS NULL THEN NULL ELSE source_row.amount_out::text END,
        'minAmountOut', CASE WHEN source_row.min_amount_out IS NULL THEN NULL ELSE source_row.min_amount_out::text END,
        'snapshotId', source_row.snapshot_id,
        'pricingVersion', source_row.pricing_version,
        'riskPolicyVersion', source_row.risk_policy_version,
        'spreadBps', source_row.spread_bps,
        'sizeImpactBps', source_row.size_impact_bps,
        'marketSpreadBps', source_row.market_spread_bps,
        'inventorySkewBps', source_row.inventory_skew_bps,
        'volatilityPremiumBps', source_row.volatility_premium_bps,
        'hedgeCostBps', source_row.hedge_cost_bps,
        'status', source_row.status,
        'rejectCode', source_row.reject_code,
        'txHash', lower(source_row.tx_hash),
        'settlementEventId', source_row.settlement_event_id,
        'hedgeOrderId', source_row.hedge_order_id,
        'pnlId', source_row.pnl_id,
        'createdAt', source_row.created_at,
        'updatedAt', source_row.updated_at
      );
    WHEN 'market_snapshots' THEN
      event_name := 'market.snapshot.v1';
      aggregate_name := 'market_snapshot';
      aggregate_key := source_row.id;
      event_payload := jsonb_build_object(
        'operation', lower(TG_OP),
        'snapshotId', source_row.id,
        'chainId', source_row.chain_id,
        'tokenIn', lower(source_row.token_in),
        'tokenOut', lower(source_row.token_out),
        'midPrice', source_row.mid_price::text,
        'bidPrice', CASE WHEN source_row.bid_price IS NULL THEN NULL ELSE source_row.bid_price::text END,
        'askPrice', CASE WHEN source_row.ask_price IS NULL THEN NULL ELSE source_row.ask_price::text END,
        'liquidityUsd', source_row.liquidity_usd::text,
        'marketSpreadBps', source_row.market_spread_bps,
        'volatilityBps', source_row.volatility_bps,
        'source', source_row.source,
        'observedAt', source_row.observed_at,
        'createdAt', source_row.created_at
      );
    WHEN 'risk_decisions' THEN
      event_name := 'risk.decision.v1';
      aggregate_name := 'quote';
      aggregate_key := source_row.quote_id;
      event_payload := jsonb_build_object(
        'operation', lower(TG_OP),
        'riskDecisionId', source_row.id,
        'quoteId', source_row.quote_id,
        'decision', source_row.decision,
        'reasonCode', source_row.reason_code,
        'policyVersion', source_row.policy_version,
        'maxNotionalUsd', CASE WHEN source_row.max_notional_usd IS NULL THEN NULL ELSE source_row.max_notional_usd::text END,
        'inventoryExposureBefore', CASE
          WHEN source_row.inventory_exposure_before IS NULL THEN NULL
          ELSE source_row.inventory_exposure_before::text
        END,
        'createdAt', source_row.created_at
      );
    WHEN 'settlement_events' THEN
      event_name := 'settlement.lifecycle.v1';
      aggregate_name := 'settlement';
      aggregate_key := source_row.id;
      event_payload := jsonb_build_object(
        'operation', lower(TG_OP),
        'settlementEventId', source_row.id,
        'quoteId', source_row.quote_id,
        'chainId', source_row.chain_id,
        'txHash', lower(source_row.tx_hash),
        'quoteHash', lower(source_row.quote_hash),
        'logIndex', source_row.log_index,
        'blockNumber', source_row.block_number,
        'user', lower(source_row.user_address),
        'tokenIn', lower(source_row.token_in),
        'tokenOut', lower(source_row.token_out),
        'amountIn', source_row.amount_in::text,
        'amountOut', source_row.amount_out::text,
        'nonce', source_row.nonce::text,
        'canonical', source_row.canonical,
        'removedAt', source_row.removed_at,
        'createdAt', source_row.created_at
      );
    WHEN 'inventory_positions' THEN
      event_name := 'inventory.position.v1';
      aggregate_name := 'inventory';
      aggregate_key := source_row.id;
      event_payload := jsonb_build_object(
        'operation', lower(TG_OP),
        'positionId', source_row.id,
        'chainId', source_row.chain_id,
        'token', lower(source_row.token_address),
        'balance', source_row.balance::text,
        'targetBalance', CASE WHEN source_row.target_balance IS NULL THEN NULL ELSE source_row.target_balance::text END,
        'maxExposure', CASE WHEN source_row.max_exposure IS NULL THEN NULL ELSE source_row.max_exposure::text END,
        'updatedAt', source_row.updated_at
      );
    WHEN 'hedge_orders' THEN
      event_name := 'hedge.lifecycle.v1';
      aggregate_name := 'hedge';
      aggregate_key := source_row.id;
      event_payload := jsonb_build_object(
        'operation', lower(TG_OP),
        'hedgeOrderId', source_row.id,
        'settlementEventId', source_row.settlement_event_id,
        'quoteId', source_row.quote_id,
        'chainId', source_row.chain_id,
        'token', lower(source_row.token_address),
        'side', source_row.side,
        'amount', source_row.amount::text,
        'venue', source_row.venue,
        'venueSymbol', source_row.venue_symbol,
        'clientOrderId', source_row.client_order_id,
        'externalOrderId', source_row.external_order_id,
        'status', source_row.status,
        'reason', source_row.reason,
        'submissionAttemptedAt', source_row.submission_attempted_at,
        'filledAmount', CASE WHEN source_row.filled_amount IS NULL THEN NULL ELSE source_row.filled_amount::text END,
        'lastErrorCode', source_row.last_error_code,
        'createdAt', source_row.created_at,
        'updatedAt', source_row.updated_at
      );
    WHEN 'pnl_records' THEN
      event_name := 'pnl.attribution.v2';
      aggregate_name := 'pnl';
      aggregate_key := source_row.id;
      event_payload := jsonb_build_object(
        'operation', lower(TG_OP),
        'pnlId', source_row.id,
        'quoteId', source_row.quote_id,
        'settlementEventId', source_row.settlement_event_id,
        'snapshotId', source_row.snapshot_id,
        'chainId', source_row.chain_id,
        'user', lower(source_row.user_address),
        'tokenIn', lower(source_row.token_in),
        'tokenOut', lower(source_row.token_out),
        'amountIn', source_row.amount_in::text,
        'amountOut', source_row.amount_out::text,
        'minAmountOut', source_row.min_amount_out::text,
        'nonce', source_row.nonce::text,
        'deadline', source_row.deadline,
        'midPrice', source_row.mid_price::text,
        'tokenInDecimals', source_row.token_in_decimals,
        'tokenOutDecimals', source_row.token_out_decimals,
        'fairAmountOut', source_row.fair_amount_out::text,
        'valuationObservedAt', source_row.valuation_observed_at,
        'grossPnlTokenOut', source_row.gross_pnl_token_out::text,
        'grossPnlBps', source_row.gross_pnl_bps,
        'model', source_row.model,
        'modelDescription', source_row.model_description,
        'realizedAt', source_row.realized_at,
        'createdAt', source_row.created_at
      );
    ELSE
      RAISE EXCEPTION 'Unsupported RFQ analytics trigger table: %', TG_TABLE_NAME;
  END CASE;

  INSERT INTO public.analytics_outbox (
    topic, event_key, event_type, schema_version, aggregate_type, aggregate_id, payload
  ) VALUES (
    'rfq.analytics.v1', aggregate_key, event_name,
    CASE WHEN event_name = 'pnl.attribution.v2' THEN 2 ELSE 1 END,
    aggregate_name, aggregate_key, event_payload
  );

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public;

CREATE OR REPLACE FUNCTION enqueue_quote_routing_analytics_event()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.analytics_outbox (
    topic, event_key, event_type, schema_version, aggregate_type, aggregate_id, payload
  ) VALUES (
    'rfq.analytics.v1',
    NEW.id,
    'quote.routing.v1',
    1,
    'quote',
    NEW.id,
    jsonb_build_object(
      'operation', lower(TG_OP),
      'quoteId', NEW.id,
      'chainId', NEW.chain_id,
      'tokenIn', lower(NEW.token_in),
      'tokenOut', lower(NEW.token_out),
      'snapshotId', NEW.snapshot_id,
      'routeId', NEW.route_id,
      'venue', NEW.route_venue,
      'expectedLiquidityUsd', NEW.route_expected_liquidity_usd::text,
      'decidedAt', NEW.route_decided_at
    )
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public;

CREATE OR REPLACE FUNCTION enforce_quote_route_decision_immutability()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.route_id IS NOT NULL AND (
    OLD.route_id IS DISTINCT FROM NEW.route_id
    OR OLD.route_venue IS DISTINCT FROM NEW.route_venue
    OR OLD.route_expected_liquidity_usd IS DISTINCT FROM NEW.route_expected_liquidity_usd
    OR OLD.route_decided_at IS DISTINCT FROM NEW.route_decided_at
  ) THEN
    RAISE EXCEPTION 'Quote % route decision is immutable', OLD.id
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public;

CREATE OR REPLACE FUNCTION enqueue_hedge_analytics_event_v3()
RETURNS TRIGGER AS $$
DECLARE
  source_row hedge_orders%ROWTYPE;
  event_payload JSONB;
BEGIN
  source_row := NEW;
  event_payload := jsonb_build_object(
    'operation', lower(TG_OP),
    'hedgeOrderId', source_row.id,
    'settlementEventId', source_row.settlement_event_id,
    'quoteId', source_row.quote_id,
    'chainId', source_row.chain_id,
    'token', lower(source_row.token_address),
    'side', source_row.side,
    'amount', source_row.amount::text,
    'venue', source_row.venue,
    'venueSymbol', source_row.venue_symbol,
    'clientOrderId', source_row.client_order_id,
    'externalOrderId', source_row.external_order_id,
    'venueOrderId', source_row.venue_order_id,
    'status', source_row.status,
    'reason', source_row.reason,
    'submissionAttemptedAt', source_row.submission_attempted_at,
    'filledAmount', CASE WHEN source_row.filled_amount IS NULL THEN NULL ELSE source_row.filled_amount::text END,
    'executionEvidenceVersion', source_row.execution_evidence_version,
    'executedQuoteQuantity', CASE
      WHEN source_row.executed_quote_quantity IS NULL THEN NULL
      ELSE source_row.executed_quote_quantity::text
    END,
    'feeReconciliationStatus', source_row.fee_reconciliation_status,
    'feeAttemptCount', source_row.fee_attempt_count,
    'feeLastErrorCode', source_row.fee_last_error_code,
    'feeReconciledAt', source_row.fee_reconciled_at,
    'lastErrorCode', source_row.last_error_code,
    'createdAt', source_row.created_at,
    'updatedAt', source_row.updated_at
  );

  INSERT INTO public.analytics_outbox (
    topic, event_key, event_type, schema_version, aggregate_type, aggregate_id, payload
  ) VALUES (
    'rfq.analytics.v1', source_row.id, 'hedge.lifecycle.v3', 3, 'hedge', source_row.id, event_payload
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public;

CREATE OR REPLACE FUNCTION enqueue_hedge_execution_fill_analytics_event()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.analytics_outbox (
    topic, event_key, event_type, schema_version, aggregate_type, aggregate_id, payload
  ) VALUES (
    'rfq.analytics.v1',
    NEW.hedge_order_id,
    'hedge.execution-fill.v1',
    1,
    'hedge',
    NEW.hedge_order_id,
    jsonb_build_object(
      'hedgeOrderId', NEW.hedge_order_id,
      'venue', NEW.venue,
      'venueSymbol', NEW.venue_symbol,
      'venueOrderId', NEW.venue_order_id,
      'venueTradeId', NEW.venue_trade_id,
      'price', NEW.price::text,
      'baseQuantity', NEW.base_quantity::text,
      'quoteQuantity', NEW.quote_quantity::text,
      'commissionQuantity', NEW.commission_quantity::text,
      'commissionAsset', NEW.commission_asset,
      'executedAt', NEW.executed_at,
      'isBuyer', NEW.is_buyer,
      'isMaker', NEW.is_maker
    )
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public;

CREATE TRIGGER trg_quotes_analytics_insert
AFTER INSERT ON quotes
FOR EACH ROW
EXECUTE FUNCTION enqueue_rfq_analytics_event();

CREATE TRIGGER trg_quotes_analytics_update
AFTER UPDATE ON quotes
FOR EACH ROW
WHEN (
  OLD.status IS DISTINCT FROM NEW.status
  OR OLD.amount_out IS DISTINCT FROM NEW.amount_out
  OR OLD.reject_code IS DISTINCT FROM NEW.reject_code
  OR OLD.tx_hash IS DISTINCT FROM NEW.tx_hash
  OR OLD.settlement_event_id IS DISTINCT FROM NEW.settlement_event_id
  OR OLD.hedge_order_id IS DISTINCT FROM NEW.hedge_order_id
  OR OLD.pnl_id IS DISTINCT FROM NEW.pnl_id
)
EXECUTE FUNCTION enqueue_rfq_analytics_event();

CREATE TRIGGER trg_quotes_routing_analytics_insert
AFTER INSERT ON quotes
FOR EACH ROW
WHEN (NEW.route_id IS NOT NULL)
EXECUTE FUNCTION enqueue_quote_routing_analytics_event();

CREATE TRIGGER trg_quotes_enforce_route_immutability
BEFORE UPDATE OF route_id, route_venue, route_expected_liquidity_usd, route_decided_at ON quotes
FOR EACH ROW
EXECUTE FUNCTION enforce_quote_route_decision_immutability();

CREATE TRIGGER trg_quotes_routing_analytics_update
AFTER UPDATE ON quotes
FOR EACH ROW
WHEN (OLD.route_id IS NULL AND NEW.route_id IS NOT NULL)
EXECUTE FUNCTION enqueue_quote_routing_analytics_event();

CREATE TRIGGER trg_market_snapshots_analytics_insert
AFTER INSERT ON market_snapshots
FOR EACH ROW
EXECUTE FUNCTION enqueue_rfq_analytics_event();

CREATE TRIGGER trg_market_snapshots_analytics_update
AFTER UPDATE ON market_snapshots
FOR EACH ROW
WHEN (
  OLD.mid_price IS DISTINCT FROM NEW.mid_price
  OR OLD.bid_price IS DISTINCT FROM NEW.bid_price
  OR OLD.ask_price IS DISTINCT FROM NEW.ask_price
  OR OLD.liquidity_usd IS DISTINCT FROM NEW.liquidity_usd
  OR OLD.market_spread_bps IS DISTINCT FROM NEW.market_spread_bps
  OR OLD.volatility_bps IS DISTINCT FROM NEW.volatility_bps
  OR OLD.observed_at IS DISTINCT FROM NEW.observed_at
)
EXECUTE FUNCTION enqueue_rfq_analytics_event();

CREATE TRIGGER trg_risk_decisions_analytics_insert
AFTER INSERT ON risk_decisions
FOR EACH ROW
EXECUTE FUNCTION enqueue_rfq_analytics_event();

CREATE TRIGGER trg_risk_decisions_analytics_update
AFTER UPDATE ON risk_decisions
FOR EACH ROW
WHEN (
  OLD.decision IS DISTINCT FROM NEW.decision
  OR OLD.reason_code IS DISTINCT FROM NEW.reason_code
  OR OLD.policy_version IS DISTINCT FROM NEW.policy_version
)
EXECUTE FUNCTION enqueue_rfq_analytics_event();

CREATE TRIGGER trg_settlement_events_analytics_insert
AFTER INSERT ON settlement_events
FOR EACH ROW
EXECUTE FUNCTION enqueue_rfq_analytics_event();

CREATE TRIGGER trg_settlement_events_analytics_update
AFTER UPDATE ON settlement_events
FOR EACH ROW
WHEN (
  OLD.canonical IS DISTINCT FROM NEW.canonical
  OR OLD.removed_at IS DISTINCT FROM NEW.removed_at
)
EXECUTE FUNCTION enqueue_rfq_analytics_event();

CREATE TRIGGER trg_inventory_positions_analytics_insert
AFTER INSERT ON inventory_positions
FOR EACH ROW
EXECUTE FUNCTION enqueue_rfq_analytics_event();

CREATE TRIGGER trg_inventory_positions_analytics_update
AFTER UPDATE ON inventory_positions
FOR EACH ROW
WHEN (
  OLD.balance IS DISTINCT FROM NEW.balance
  OR OLD.target_balance IS DISTINCT FROM NEW.target_balance
  OR OLD.max_exposure IS DISTINCT FROM NEW.max_exposure
)
EXECUTE FUNCTION enqueue_rfq_analytics_event();

CREATE TRIGGER trg_hedge_orders_analytics_insert
AFTER INSERT ON hedge_orders
FOR EACH ROW
EXECUTE FUNCTION enqueue_hedge_analytics_event_v3();

CREATE TRIGGER trg_hedge_orders_analytics_update
AFTER UPDATE ON hedge_orders
FOR EACH ROW
WHEN (
  OLD.venue IS DISTINCT FROM NEW.venue
  OR OLD.venue_symbol IS DISTINCT FROM NEW.venue_symbol
  OR OLD.client_order_id IS DISTINCT FROM NEW.client_order_id
  OR OLD.submission_attempted_at IS DISTINCT FROM NEW.submission_attempted_at
  OR OLD.external_order_id IS DISTINCT FROM NEW.external_order_id
  OR OLD.venue_order_id IS DISTINCT FROM NEW.venue_order_id
  OR OLD.filled_amount IS DISTINCT FROM NEW.filled_amount
  OR OLD.execution_evidence_version IS DISTINCT FROM NEW.execution_evidence_version
  OR OLD.executed_quote_quantity IS DISTINCT FROM NEW.executed_quote_quantity
  OR OLD.fee_reconciliation_status IS DISTINCT FROM NEW.fee_reconciliation_status
  OR OLD.fee_last_error_code IS DISTINCT FROM NEW.fee_last_error_code
  OR OLD.fee_reconciled_at IS DISTINCT FROM NEW.fee_reconciled_at
  OR OLD.status IS DISTINCT FROM NEW.status
  OR OLD.last_error_code IS DISTINCT FROM NEW.last_error_code
)
EXECUTE FUNCTION enqueue_hedge_analytics_event_v3();

CREATE TRIGGER trg_hedge_execution_fills_analytics_insert
AFTER INSERT ON hedge_execution_fills
FOR EACH ROW
EXECUTE FUNCTION enqueue_hedge_execution_fill_analytics_event();

CREATE TRIGGER trg_pnl_records_analytics_insert
AFTER INSERT ON pnl_records
FOR EACH ROW
EXECUTE FUNCTION enqueue_rfq_analytics_event();

CREATE TRIGGER trg_pnl_records_analytics_delete
AFTER DELETE ON pnl_records
FOR EACH ROW
EXECUTE FUNCTION enqueue_rfq_analytics_event();

CREATE TABLE post_trade_reconciliation_jobs (
  quote_id TEXT PRIMARY KEY REFERENCES quotes(id) ON DELETE CASCADE,
  desired_settlement_event_id TEXT REFERENCES settlement_events(id),
  desired_revision BIGINT NOT NULL DEFAULT 1,
  processed_revision BIGINT NOT NULL DEFAULT 0,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  lease_owner TEXT,
  lease_expires_at TIMESTAMPTZ,
  last_error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_post_trade_jobs_quote_id_safe CHECK (
    btrim(quote_id) <> ''
    AND char_length(quote_id) <= 128
    AND quote_id ~ '^[A-Za-z0-9_:-]+$'
  ),
  CONSTRAINT chk_post_trade_jobs_revisions CHECK (
    desired_revision BETWEEN 1 AND 9007199254740991
    AND processed_revision BETWEEN 0 AND desired_revision
  ),
  CONSTRAINT chk_post_trade_jobs_attempt_count CHECK (
    attempt_count BETWEEN 0 AND 2147483647
  ),
  CONSTRAINT chk_post_trade_jobs_lease_state CHECK (
    (lease_owner IS NULL AND lease_expires_at IS NULL)
    OR (
      lease_owner IS NOT NULL
      AND lease_expires_at IS NOT NULL
      AND btrim(lease_owner) <> ''
      AND char_length(lease_owner) <= 128
      AND lease_owner ~ '^[A-Za-z0-9_:-]+$'
    )
  ),
  CONSTRAINT chk_post_trade_jobs_last_error CHECK (
    last_error_code IS NULL
    OR (
      btrim(last_error_code) <> ''
      AND char_length(last_error_code) <= 128
      AND last_error_code ~ '^[A-Z0-9_:-]+$'
    )
  )
);

CREATE INDEX idx_post_trade_jobs_pending
  ON post_trade_reconciliation_jobs (next_attempt_at, requested_at, quote_id)
  WHERE processed_revision < desired_revision;

CREATE OR REPLACE FUNCTION enqueue_post_trade_reconciliation_job()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  canonical_event_id TEXT;
BEGIN
  SELECT settlement.id
  INTO canonical_event_id
  FROM public.settlement_events AS settlement
  WHERE settlement.quote_id = NEW.quote_id
    AND settlement.canonical = TRUE
  ORDER BY settlement.block_number DESC, settlement.log_index DESC, settlement.id DESC
  LIMIT 1;

  INSERT INTO public.post_trade_reconciliation_jobs (
    quote_id,
    desired_settlement_event_id,
    desired_revision,
    processed_revision,
    requested_at,
    next_attempt_at
  ) VALUES (
    NEW.quote_id,
    canonical_event_id,
    1,
    0,
    now(),
    now()
  )
  ON CONFLICT (quote_id) DO UPDATE SET
    desired_settlement_event_id = EXCLUDED.desired_settlement_event_id,
    desired_revision = post_trade_reconciliation_jobs.desired_revision + 1,
    attempt_count = 0,
    requested_at = now(),
    next_attempt_at = now(),
    last_error_code = NULL,
    updated_at = now()
  WHERE post_trade_reconciliation_jobs.desired_settlement_event_id
    IS DISTINCT FROM EXCLUDED.desired_settlement_event_id;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_settlement_events_post_trade_reconciliation
AFTER INSERT OR UPDATE OF canonical ON settlement_events
FOR EACH ROW
EXECUTE FUNCTION enqueue_post_trade_reconciliation_job();

CREATE TABLE settlement_indexer_cursors (
  chain_id BIGINT PRIMARY KEY,
  settlement_address TEXT NOT NULL,
  start_block BIGINT NOT NULL,
  next_block BIGINT NOT NULL,
  revision BIGINT NOT NULL DEFAULT 0,
  lease_owner TEXT,
  lease_expires_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_settlement_indexer_cursor_chain CHECK (
    chain_id BETWEEN 1 AND 9007199254740991
  ),
  CONSTRAINT chk_settlement_indexer_cursor_address CHECK (
    settlement_address ~ '^0x[0-9a-fA-F]{40}$'
    AND settlement_address <> '0x0000000000000000000000000000000000000000'
  ),
  CONSTRAINT chk_settlement_indexer_cursor_blocks CHECK (
    start_block BETWEEN 0 AND 9007199254740991
    AND next_block BETWEEN start_block AND 9007199254740991
    AND revision BETWEEN 0 AND 9007199254740991
  ),
  CONSTRAINT chk_settlement_indexer_cursor_lease CHECK (
    (lease_owner IS NULL AND lease_expires_at IS NULL)
    OR (
      lease_owner IS NOT NULL
      AND lease_expires_at IS NOT NULL
      AND btrim(lease_owner) <> ''
      AND char_length(lease_owner) <= 128
      AND lease_owner ~ '^[A-Za-z0-9_:-]+$'
    )
  )
);

CREATE TABLE settlement_indexer_checkpoints (
  chain_id BIGINT NOT NULL REFERENCES settlement_indexer_cursors(chain_id) ON DELETE CASCADE,
  block_number BIGINT NOT NULL,
  block_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (chain_id, block_number),
  CONSTRAINT chk_settlement_indexer_checkpoint_block CHECK (
    block_number BETWEEN 0 AND 9007199254740991
  ),
  CONSTRAINT chk_settlement_indexer_checkpoint_hash CHECK (
    block_hash ~ '^0x[0-9a-fA-F]{64}$'
  )
);

CREATE INDEX idx_settlement_indexer_checkpoints_recent
  ON settlement_indexer_checkpoints (chain_id, block_number DESC);

CREATE INDEX idx_settlement_events_canonical_chain_block
  ON settlement_events (chain_id, block_number, log_index)
  WHERE canonical = TRUE;

CREATE TABLE quote_control (
  singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton = TRUE),
  paused BOOLEAN NOT NULL DEFAULT FALSE,
  version BIGINT NOT NULL DEFAULT 0,
  reason VARCHAR(256),
  updated_by VARCHAR(256) NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_quote_control_version CHECK (version BETWEEN 0 AND 9007199254740991),
  CONSTRAINT chk_quote_control_reason CHECK (
    reason IS NULL OR (
      length(reason) BETWEEN 1 AND 256 AND reason = btrim(reason) AND reason !~ '[[:cntrl:]]'
    )
  ),
  CONSTRAINT chk_quote_control_paused_reason CHECK (paused = FALSE OR reason IS NOT NULL),
  CONSTRAINT chk_quote_control_updated_by CHECK (
    length(updated_by) BETWEEN 1 AND 256 AND updated_by ~ '^[A-Za-z0-9_:-]+$'
  )
);

CREATE TABLE quote_control_audit (
  version BIGINT PRIMARY KEY,
  paused BOOLEAN NOT NULL,
  reason VARCHAR(256),
  updated_by VARCHAR(256) NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT chk_quote_control_audit_version CHECK (version BETWEEN 0 AND 9007199254740991),
  CONSTRAINT chk_quote_control_audit_reason CHECK (
    reason IS NULL OR (
      length(reason) BETWEEN 1 AND 256 AND reason = btrim(reason) AND reason !~ '[[:cntrl:]]'
    )
  ),
  CONSTRAINT chk_quote_control_audit_paused_reason CHECK (paused = FALSE OR reason IS NOT NULL),
  CONSTRAINT chk_quote_control_audit_updated_by CHECK (
    length(updated_by) BETWEEN 1 AND 256 AND updated_by ~ '^[A-Za-z0-9_:-]+$'
  )
);

INSERT INTO quote_control (singleton, paused, version, reason, updated_by)
VALUES (TRUE, FALSE, 0, NULL, 'migration');

INSERT INTO quote_control_audit (version, paused, reason, updated_by, updated_at)
SELECT version, paused, reason, updated_by, updated_at
FROM quote_control;

CREATE TABLE quote_pair_control (
  chain_id BIGINT NOT NULL,
  token_low CHAR(42) NOT NULL,
  token_high CHAR(42) NOT NULL,
  paused BOOLEAN NOT NULL,
  version BIGINT NOT NULL,
  reason VARCHAR(256) NOT NULL,
  updated_by VARCHAR(256) NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (chain_id, token_low, token_high),
  CONSTRAINT chk_quote_pair_control_chain CHECK (chain_id BETWEEN 1 AND 9007199254740991),
  CONSTRAINT chk_quote_pair_control_token_low CHECK (token_low ~ '^0x[0-9a-f]{40}$'),
  CONSTRAINT chk_quote_pair_control_token_high CHECK (token_high ~ '^0x[0-9a-f]{40}$'),
  CONSTRAINT chk_quote_pair_control_order CHECK (token_low < token_high),
  CONSTRAINT chk_quote_pair_control_version CHECK (version BETWEEN 1 AND 9007199254740991),
  CONSTRAINT chk_quote_pair_control_reason CHECK (
    length(reason) BETWEEN 1 AND 256 AND reason = btrim(reason) AND reason !~ '[[:cntrl:]]'
  ),
  CONSTRAINT chk_quote_pair_control_updated_by CHECK (
    length(updated_by) BETWEEN 1 AND 256 AND updated_by ~ '^[A-Za-z0-9_:-]+$'
  )
);

CREATE TABLE quote_pair_control_audit (
  chain_id BIGINT NOT NULL,
  token_low CHAR(42) NOT NULL,
  token_high CHAR(42) NOT NULL,
  version BIGINT NOT NULL,
  paused BOOLEAN NOT NULL,
  reason VARCHAR(256) NOT NULL,
  updated_by VARCHAR(256) NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (chain_id, token_low, token_high, version),
  CONSTRAINT chk_quote_pair_control_audit_chain CHECK (chain_id BETWEEN 1 AND 9007199254740991),
  CONSTRAINT chk_quote_pair_control_audit_token_low CHECK (token_low ~ '^0x[0-9a-f]{40}$'),
  CONSTRAINT chk_quote_pair_control_audit_token_high CHECK (token_high ~ '^0x[0-9a-f]{40}$'),
  CONSTRAINT chk_quote_pair_control_audit_order CHECK (token_low < token_high),
  CONSTRAINT chk_quote_pair_control_audit_version CHECK (version BETWEEN 1 AND 9007199254740991),
  CONSTRAINT chk_quote_pair_control_audit_reason CHECK (
    length(reason) BETWEEN 1 AND 256 AND reason = btrim(reason) AND reason !~ '[[:cntrl:]]'
  ),
  CONSTRAINT chk_quote_pair_control_audit_updated_by CHECK (
    length(updated_by) BETWEEN 1 AND 256 AND updated_by ~ '^[A-Za-z0-9_:-]+$'
  )
);

CREATE INDEX idx_quote_pair_control_paused
  ON quote_pair_control (chain_id, token_low, token_high)
  WHERE paused = TRUE;

CREATE TABLE toxic_flow_scores (
  chain_id BIGINT NOT NULL,
  user_address CHAR(42) NOT NULL,
  score_bps INTEGER NOT NULL,
  post_trade_drift_bps INTEGER NOT NULL,
  sample_size BIGINT NOT NULL,
  window_seconds INTEGER NOT NULL,
  policy_version VARCHAR(128) NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL,
  version BIGINT NOT NULL,
  updated_by VARCHAR(256) NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (chain_id, user_address),
  CONSTRAINT chk_toxic_flow_scores_chain CHECK (chain_id BETWEEN 1 AND 9007199254740991),
  CONSTRAINT chk_toxic_flow_scores_user CHECK (user_address ~ '^0x[0-9a-f]{40}$'),
  CONSTRAINT chk_toxic_flow_scores_score CHECK (score_bps BETWEEN 0 AND 10000),
  CONSTRAINT chk_toxic_flow_scores_drift CHECK (post_trade_drift_bps BETWEEN -10000 AND 10000),
  CONSTRAINT chk_toxic_flow_scores_sample CHECK (sample_size BETWEEN 0 AND 9007199254740991),
  CONSTRAINT chk_toxic_flow_scores_empty_sample CHECK (
    sample_size > 0 OR (score_bps = 0 AND post_trade_drift_bps = 0)
  ),
  CONSTRAINT chk_toxic_flow_scores_window CHECK (window_seconds BETWEEN 1 AND 604800),
  CONSTRAINT chk_toxic_flow_scores_policy CHECK (
    length(policy_version) BETWEEN 1 AND 128 AND policy_version ~ '^[A-Za-z0-9_:-]+$'
  ),
  CONSTRAINT chk_toxic_flow_scores_version CHECK (version BETWEEN 1 AND 9007199254740991),
  CONSTRAINT chk_toxic_flow_scores_actor CHECK (
    length(updated_by) BETWEEN 1 AND 256 AND updated_by ~ '^[A-Za-z0-9_:-]+$'
  )
);

CREATE TABLE toxic_flow_score_audit (
  chain_id BIGINT NOT NULL,
  user_address CHAR(42) NOT NULL,
  version BIGINT NOT NULL,
  score_bps INTEGER NOT NULL,
  post_trade_drift_bps INTEGER NOT NULL,
  sample_size BIGINT NOT NULL,
  window_seconds INTEGER NOT NULL,
  policy_version VARCHAR(128) NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL,
  updated_by VARCHAR(256) NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (chain_id, user_address, version),
  CONSTRAINT chk_toxic_flow_score_audit_chain CHECK (chain_id BETWEEN 1 AND 9007199254740991),
  CONSTRAINT chk_toxic_flow_score_audit_user CHECK (user_address ~ '^0x[0-9a-f]{40}$'),
  CONSTRAINT chk_toxic_flow_score_audit_score CHECK (score_bps BETWEEN 0 AND 10000),
  CONSTRAINT chk_toxic_flow_score_audit_drift CHECK (post_trade_drift_bps BETWEEN -10000 AND 10000),
  CONSTRAINT chk_toxic_flow_score_audit_sample CHECK (sample_size BETWEEN 0 AND 9007199254740991),
  CONSTRAINT chk_toxic_flow_score_audit_empty_sample CHECK (
    sample_size > 0 OR (score_bps = 0 AND post_trade_drift_bps = 0)
  ),
  CONSTRAINT chk_toxic_flow_score_audit_window CHECK (window_seconds BETWEEN 1 AND 604800),
  CONSTRAINT chk_toxic_flow_score_audit_policy CHECK (
    length(policy_version) BETWEEN 1 AND 128 AND policy_version ~ '^[A-Za-z0-9_:-]+$'
  ),
  CONSTRAINT chk_toxic_flow_score_audit_version CHECK (version BETWEEN 1 AND 9007199254740991),
  CONSTRAINT chk_toxic_flow_score_audit_actor CHECK (
    length(updated_by) BETWEEN 1 AND 256 AND updated_by ~ '^[A-Za-z0-9_:-]+$'
  )
);

CREATE INDEX idx_toxic_flow_scores_observed_at
  ON toxic_flow_scores (observed_at);

CREATE TABLE toxic_flow_markout_jobs (
  settlement_event_id TEXT PRIMARY KEY REFERENCES settlement_events(id) ON DELETE CASCADE,
  desired_canonical BOOLEAN NOT NULL,
  desired_revision BIGINT NOT NULL DEFAULT 1,
  processed_revision BIGINT NOT NULL DEFAULT 0,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  settled_at TIMESTAMPTZ NOT NULL,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  lease_owner VARCHAR(128),
  lease_expires_at TIMESTAMPTZ,
  last_error_code VARCHAR(128),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_toxic_flow_markout_jobs_revisions CHECK (
    desired_revision BETWEEN 1 AND 9007199254740991
    AND processed_revision BETWEEN 0 AND desired_revision
  ),
  CONSTRAINT chk_toxic_flow_markout_jobs_attempt CHECK (attempt_count BETWEEN 0 AND 2147483647),
  CONSTRAINT chk_toxic_flow_markout_jobs_lease CHECK (
    (lease_owner IS NULL AND lease_expires_at IS NULL)
    OR (lease_owner ~ '^[A-Za-z0-9_:-]{1,128}$' AND lease_expires_at IS NOT NULL)
  ),
  CONSTRAINT chk_toxic_flow_markout_jobs_error CHECK (
    last_error_code IS NULL OR last_error_code ~ '^[A-Z0-9_:-]{1,128}$'
  )
);

CREATE INDEX idx_toxic_flow_markout_jobs_pending
  ON toxic_flow_markout_jobs (next_attempt_at, settled_at, settlement_event_id)
  WHERE processed_revision < desired_revision;

CREATE TABLE toxic_flow_markouts (
  settlement_event_id TEXT PRIMARY KEY REFERENCES settlement_events(id) ON DELETE CASCADE,
  quote_id TEXT NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  post_snapshot_id TEXT NOT NULL REFERENCES market_snapshots(id),
  chain_id BIGINT NOT NULL,
  user_address CHAR(42) NOT NULL,
  token_in CHAR(42) NOT NULL,
  token_out CHAR(42) NOT NULL,
  execution_price NUMERIC(38, 18) NOT NULL,
  post_mid_price NUMERIC(38, 18) NOT NULL,
  post_trade_drift_bps INTEGER NOT NULL,
  toxicity_score_bps INTEGER NOT NULL,
  horizon_seconds INTEGER NOT NULL,
  policy_version VARCHAR(128) NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL,
  canonical BOOLEAN NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_toxic_flow_markouts_chain CHECK (chain_id BETWEEN 1 AND 9007199254740991),
  CONSTRAINT chk_toxic_flow_markouts_addresses CHECK (
    user_address ~ '^0x[0-9a-f]{40}$' AND token_in ~ '^0x[0-9a-f]{40}$'
    AND token_out ~ '^0x[0-9a-f]{40}$' AND token_in <> token_out
  ),
  CONSTRAINT chk_toxic_flow_markouts_prices CHECK (execution_price > 0 AND post_mid_price > 0),
  CONSTRAINT chk_toxic_flow_markouts_bps CHECK (
    post_trade_drift_bps BETWEEN -10000 AND 10000 AND toxicity_score_bps BETWEEN 0 AND 10000
  ),
  CONSTRAINT chk_toxic_flow_markouts_horizon CHECK (horizon_seconds BETWEEN 1 AND 604800),
  CONSTRAINT chk_toxic_flow_markouts_policy CHECK (policy_version ~ '^[A-Za-z0-9_:-]{1,128}$')
);

CREATE INDEX idx_toxic_flow_markouts_user_window
  ON toxic_flow_markouts (chain_id, user_address, observed_at DESC)
  WHERE canonical = TRUE;

CREATE OR REPLACE FUNCTION enqueue_toxic_flow_markout_job()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.settled_at IS NULL THEN
    RETURN NEW;
  END IF;
  INSERT INTO public.toxic_flow_markout_jobs (
    settlement_event_id, desired_canonical, desired_revision, processed_revision,
    settled_at, next_attempt_at
  ) VALUES (NEW.id, NEW.canonical, 1, 0, NEW.settled_at, now())
  ON CONFLICT (settlement_event_id) DO UPDATE SET
    desired_canonical = EXCLUDED.desired_canonical,
    desired_revision = toxic_flow_markout_jobs.desired_revision + 1,
    attempt_count = 0,
    next_attempt_at = now(),
    last_error_code = NULL,
    updated_at = now()
  WHERE toxic_flow_markout_jobs.desired_canonical IS DISTINCT FROM EXCLUDED.desired_canonical;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_settlement_events_toxic_flow_markout
AFTER INSERT OR UPDATE OF canonical ON settlement_events
FOR EACH ROW
EXECUTE FUNCTION enqueue_toxic_flow_markout_job();

CREATE TABLE signer_audit_events (
  id BIGSERIAL PRIMARY KEY,
  quote_id VARCHAR(128) NOT NULL,
  snapshot_id VARCHAR(128) NOT NULL,
  context_version SMALLINT NOT NULL DEFAULT 1,
  risk_decision_id VARCHAR(128),
  risk_policy_version VARCHAR(128),
  trace_id VARCHAR(128),
  quote_digest BYTEA NOT NULL,
  signature_hash BYTEA,
  signer_address CHAR(42) NOT NULL,
  settlement_address CHAR(42) NOT NULL,
  chain_id BIGINT NOT NULL,
  deadline BIGINT NOT NULL,
  outcome VARCHAR(32) NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT chk_signer_audit_quote_id CHECK (quote_id ~ '^[A-Za-z0-9_:-]{1,128}$'),
  CONSTRAINT chk_signer_audit_snapshot_id CHECK (snapshot_id ~ '^[A-Za-z0-9_:-]{1,128}$'),
  CONSTRAINT chk_signer_audit_context_version CHECK (context_version IN (1, 2)),
  CONSTRAINT chk_signer_audit_risk_context CHECK (
    (context_version = 1
      AND risk_decision_id IS NULL
      AND risk_policy_version IS NULL
      AND trace_id IS NULL)
    OR
    (context_version = 2
      AND risk_decision_id IS NOT NULL
      AND risk_policy_version IS NOT NULL
      AND trace_id IS NOT NULL
      AND risk_decision_id = 'rd_' || quote_id
      AND risk_decision_id ~ '^[A-Za-z0-9_:-]{1,128}$'
      AND risk_policy_version ~ '^[A-Za-z0-9_.:-]{1,128}$'
      AND trace_id ~ '^tr_[A-Za-z0-9._:-]{1,125}$')
  ),
  CONSTRAINT chk_signer_audit_quote_digest CHECK (octet_length(quote_digest) = 32),
  CONSTRAINT chk_signer_audit_signature_hash CHECK (
    (outcome = 'success' AND octet_length(signature_hash) = 32)
    OR (outcome = 'signer_error' AND signature_hash IS NULL)
  ),
  CONSTRAINT chk_signer_audit_signer_address CHECK (
    signer_address ~ '^0x[0-9a-f]{40}$'
    AND signer_address <> '0x0000000000000000000000000000000000000000'
  ),
  CONSTRAINT chk_signer_audit_settlement_address CHECK (
    settlement_address ~ '^0x[0-9a-f]{40}$'
    AND settlement_address <> '0x0000000000000000000000000000000000000000'
  ),
  CONSTRAINT chk_signer_audit_chain_id CHECK (chain_id BETWEEN 1 AND 9007199254740991),
  CONSTRAINT chk_signer_audit_deadline CHECK (deadline BETWEEN 1 AND 9007199254740991),
  CONSTRAINT chk_signer_audit_outcome CHECK (outcome IN ('success', 'signer_error'))
);

CREATE INDEX idx_signer_audit_quote
  ON signer_audit_events (quote_id, occurred_at DESC, id DESC);

CREATE INDEX idx_signer_audit_recorded
  ON signer_audit_events (recorded_at DESC, id DESC);

CREATE INDEX idx_signer_audit_risk_decision
  ON signer_audit_events (risk_decision_id, occurred_at DESC, id DESC)
  WHERE risk_decision_id IS NOT NULL;

CREATE TABLE _migrations (
  version TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO _migrations (version, name) VALUES
  ('001', 'base-schema'),
  ('002', 'settlement-canonical'),
  ('003', 'hedge-worker-queue'),
  ('004', 'analytics-outbox'),
  ('005', 'post-trade-reconciliation'),
  ('006', 'quote-snapshot-pnl'),
  ('007', 'settlement-indexer'),
  ('008', 'submit-reservations'),
  ('009', 'risk-notional-reasons'),
  ('010', 'risk-market-regime-reasons'),
  ('011', 'open-quote-exposure'),
  ('012', 'pricing-attribution'),
  ('013', 'market-spread-attribution'),
  ('014', 'hedge-execution-evidence'),
  ('015', 'hedge-fee-reconciliation'),
  ('016', 'treasury-liquidity-reservations'),
  ('017', 'quote-principal-ownership'),
  ('018', 'quote-control'),
  ('019', 'pair-quote-control'),
  ('020', 'toxic-flow-scores'),
  ('021', 'toxic-flow-markouts'),
  ('022', 'portfolio-var-reservations'),
  ('023', 'quote-idempotency'),
  ('024', 'hedge-net-pnl'),
  ('025', 'bounded-hedge-limit'),
  ('026', 'hedge-order-expiry'),
  ('027', 'signer-audit'),
  ('028', 'signer-risk-context'),
  ('029', 'bounded-hedge-failure-risk'),
  ('030', 'usd-reference-depeg-risk'),
  ('031', 'daily-loss-risk'),
  ('032', 'portfolio-delta-risk'),
  ('033', 'gamma-guardrail-risk'),
  ('034', 'quote-route-attribution');
