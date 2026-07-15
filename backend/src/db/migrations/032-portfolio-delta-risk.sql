BEGIN;

ALTER TABLE quote_exposure_reservations
  ADD COLUMN IF NOT EXISTS delta_evaluation JSONB,
  DROP CONSTRAINT IF EXISTS chk_quote_exposure_delta_evaluation,
  ADD CONSTRAINT chk_quote_exposure_delta_evaluation CHECK (
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
        'PORTFOLIO_DELTA_LIMIT_EXCEEDED',
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
  );

COMMIT;
