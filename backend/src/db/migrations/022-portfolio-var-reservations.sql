BEGIN;

ALTER TABLE quote_exposure_reservations
  ADD COLUMN IF NOT EXISTS token_in TEXT,
  ADD COLUMN IF NOT EXISTS amount_in NUMERIC(78, 0),
  ADD COLUMN IF NOT EXISTS var_evaluation JSONB;

UPDATE quote_exposure_reservations AS exposure
SET token_in = lower(quote.token_in),
    amount_in = quote.amount_in
FROM quotes AS quote
WHERE quote.id = exposure.quote_id
  AND (exposure.token_in IS NULL OR exposure.amount_in IS NULL);

DELETE FROM quote_exposure_reservations
WHERE token_in IS NULL OR amount_in IS NULL;

ALTER TABLE quote_exposure_reservations
  ALTER COLUMN token_in SET NOT NULL,
  ALTER COLUMN amount_in SET NOT NULL,
  DROP CONSTRAINT IF EXISTS chk_quote_exposure_input,
  ADD CONSTRAINT chk_quote_exposure_input CHECK (
    token_in ~ '^0x[0-9a-f]{40}$' AND amount_in > 0 AND token_in <> token_out
  ),
  DROP CONSTRAINT IF EXISTS chk_quote_exposure_var_evaluation,
  ADD CONSTRAINT chk_quote_exposure_var_evaluation CHECK (
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
  );

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
        'PORTFOLIO_VAR_LIMIT_EXCEEDED',
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
