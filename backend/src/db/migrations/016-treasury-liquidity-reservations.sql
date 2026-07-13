BEGIN;

ALTER TABLE quote_exposure_reservations
  ADD COLUMN IF NOT EXISTS token_out TEXT,
  ADD COLUMN IF NOT EXISTS amount_out NUMERIC(78, 0),
  ADD COLUMN IF NOT EXISTS settlement_address TEXT,
  ADD COLUMN IF NOT EXISTS treasury_address TEXT,
  ADD COLUMN IF NOT EXISTS treasury_available_balance NUMERIC(78, 0),
  ADD COLUMN IF NOT EXISTS treasury_block_number NUMERIC(78, 0);

UPDATE quote_exposure_reservations AS exposure
SET token_out = lower(quote.token_out),
    amount_out = quote.amount_out
FROM quotes AS quote
WHERE quote.id = exposure.quote_id
  AND quote.amount_out IS NOT NULL
  AND (exposure.token_out IS NULL OR exposure.amount_out IS NULL);

DELETE FROM quote_exposure_reservations
WHERE token_out IS NULL OR amount_out IS NULL;

ALTER TABLE quote_exposure_reservations
  ALTER COLUMN token_out SET NOT NULL,
  ALTER COLUMN amount_out SET NOT NULL;

ALTER TABLE quote_exposure_reservations
  DROP CONSTRAINT IF EXISTS chk_quote_exposure_output,
  ADD CONSTRAINT chk_quote_exposure_output CHECK (
    token_out ~ '^0x[0-9a-f]{40}$' AND amount_out > 0
  ),
  DROP CONSTRAINT IF EXISTS chk_quote_exposure_treasury_evidence,
  ADD CONSTRAINT chk_quote_exposure_treasury_evidence CHECK (
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
  );

CREATE INDEX IF NOT EXISTS idx_quote_exposure_output_active
  ON quote_exposure_reservations (chain_id, token_out, expires_at);

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
        'TREASURY_LIQUIDITY_INSUFFICIENT',
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
