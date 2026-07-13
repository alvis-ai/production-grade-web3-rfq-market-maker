BEGIN;

CREATE TABLE IF NOT EXISTS quote_exposure_reservations (
  quote_id TEXT PRIMARY KEY REFERENCES quotes(id) ON DELETE CASCADE,
  chain_id BIGINT NOT NULL,
  user_address TEXT NOT NULL,
  token_low TEXT NOT NULL,
  token_high TEXT NOT NULL,
  notional_usd_e18 NUMERIC(96, 0) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_quote_exposure_chain_id CHECK (chain_id BETWEEN 1 AND 9007199254740991),
  CONSTRAINT chk_quote_exposure_addresses CHECK (
    user_address ~ '^0x[0-9a-f]{40}$'
    AND token_low ~ '^0x[0-9a-f]{40}$'
    AND token_high ~ '^0x[0-9a-f]{40}$'
    AND token_low < token_high
  ),
  CONSTRAINT chk_quote_exposure_notional CHECK (notional_usd_e18 > 0)
);

CREATE INDEX IF NOT EXISTS idx_quote_exposure_user_active
  ON quote_exposure_reservations (chain_id, user_address, expires_at);
CREATE INDEX IF NOT EXISTS idx_quote_exposure_pair_active
  ON quote_exposure_reservations (chain_id, token_low, token_high, expires_at);
CREATE INDEX IF NOT EXISTS idx_quote_exposure_expiry
  ON quote_exposure_reservations (expires_at);

ALTER TABLE risk_decisions
  DROP CONSTRAINT IF EXISTS chk_risk_decisions_reason_code_consistency;

ALTER TABLE risk_decisions
  ADD CONSTRAINT chk_risk_decisions_reason_code_consistency CHECK (
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
        'USD_REFERENCE_REQUIRED',
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
  );

COMMIT;
