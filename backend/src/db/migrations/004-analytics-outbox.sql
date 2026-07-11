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
        'inventorySkewBps', source_row.inventory_skew_bps,
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
      event_name := 'pnl.attribution.v1';
      aggregate_name := 'pnl';
      aggregate_key := source_row.id;
      event_payload := jsonb_build_object(
        'operation', lower(TG_OP),
        'pnlId', source_row.id,
        'quoteId', source_row.quote_id,
        'chainId', source_row.chain_id,
        'user', lower(source_row.user_address),
        'tokenIn', lower(source_row.token_in),
        'tokenOut', lower(source_row.token_out),
        'amountIn', source_row.amount_in::text,
        'amountOut', source_row.amount_out::text,
        'minAmountOut', source_row.min_amount_out::text,
        'nonce', source_row.nonce::text,
        'deadline', source_row.deadline,
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
    'rfq.analytics.v1', aggregate_key, event_name, 1, aggregate_name, aggregate_key, event_payload
  );

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
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
EXECUTE FUNCTION enqueue_rfq_analytics_event();

CREATE TRIGGER trg_hedge_orders_analytics_update
AFTER UPDATE ON hedge_orders
FOR EACH ROW
WHEN (
  OLD.venue IS DISTINCT FROM NEW.venue
  OR OLD.venue_symbol IS DISTINCT FROM NEW.venue_symbol
  OR OLD.client_order_id IS DISTINCT FROM NEW.client_order_id
  OR OLD.submission_attempted_at IS DISTINCT FROM NEW.submission_attempted_at
  OR OLD.external_order_id IS DISTINCT FROM NEW.external_order_id
  OR OLD.filled_amount IS DISTINCT FROM NEW.filled_amount
  OR OLD.status IS DISTINCT FROM NEW.status
  OR OLD.last_error_code IS DISTINCT FROM NEW.last_error_code
)
EXECUTE FUNCTION enqueue_rfq_analytics_event();

CREATE TRIGGER trg_pnl_records_analytics_insert
AFTER INSERT ON pnl_records
FOR EACH ROW
EXECUTE FUNCTION enqueue_rfq_analytics_event();

CREATE TRIGGER trg_pnl_records_analytics_delete
AFTER DELETE ON pnl_records
FOR EACH ROW
EXECUTE FUNCTION enqueue_rfq_analytics_event();
