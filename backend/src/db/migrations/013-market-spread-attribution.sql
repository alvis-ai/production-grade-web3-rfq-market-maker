BEGIN;

ALTER TABLE market_snapshots
  ADD COLUMN market_spread_bps INTEGER;

-- Historical sources did not persist executable spread attribution.
UPDATE market_snapshots
SET market_spread_bps = 0;

ALTER TABLE market_snapshots
  ALTER COLUMN market_spread_bps SET NOT NULL,
  ADD CONSTRAINT chk_market_snapshots_market_spread_bps CHECK (
    market_spread_bps BETWEEN 0 AND 10000
  );

ALTER TABLE quotes
  ADD COLUMN market_spread_bps INTEGER;

-- Quotes signed before formula-v4 have no executable spread attribution to recover.
UPDATE quotes
SET market_spread_bps = 0
WHERE amount_out IS NOT NULL;

ALTER TABLE quotes
  DROP CONSTRAINT chk_quotes_pricing_bps,
  DROP CONSTRAINT chk_quotes_signed_payload_atomic,
  DROP CONSTRAINT chk_quotes_unfilled_payload_consistency,
  DROP CONSTRAINT chk_quotes_signed_payload_consistency;

ALTER TABLE quotes
  ADD CONSTRAINT chk_quotes_pricing_bps CHECK (
    (spread_bps IS NULL OR spread_bps BETWEEN 0 AND 10000)
    AND (size_impact_bps IS NULL OR size_impact_bps BETWEEN 0 AND 10000)
    AND (market_spread_bps IS NULL OR market_spread_bps BETWEEN 0 AND 10000)
    AND (inventory_skew_bps IS NULL OR inventory_skew_bps BETWEEN -10000 AND 10000)
    AND (volatility_premium_bps IS NULL OR volatility_premium_bps BETWEEN 0 AND 10000)
    AND (hedge_cost_bps IS NULL OR hedge_cost_bps BETWEEN 0 AND 10000)
  ),
  ADD CONSTRAINT chk_quotes_signed_payload_atomic CHECK (
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
  ADD CONSTRAINT chk_quotes_unfilled_payload_consistency CHECK (
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
  ADD CONSTRAINT chk_quotes_signed_payload_consistency CHECK (
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
  );

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

DROP TRIGGER trg_market_snapshots_analytics_update ON market_snapshots;

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

COMMIT;
