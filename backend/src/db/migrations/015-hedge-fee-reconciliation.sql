ALTER TABLE hedge_orders
  ADD COLUMN venue_order_id TEXT,
  ADD COLUMN fee_reconciliation_status TEXT,
  ADD COLUMN fee_attempt_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN fee_next_attempt_at TIMESTAMPTZ,
  ADD COLUMN fee_lease_owner TEXT,
  ADD COLUMN fee_lease_expires_at TIMESTAMPTZ,
  ADD COLUMN fee_last_error_code TEXT,
  ADD COLUMN fee_reconciled_at TIMESTAMPTZ;

-- Existing CEX fills can be recovered through symbol + client order id before querying myTrades.
UPDATE hedge_orders
SET fee_reconciliation_status = 'pending',
    fee_next_attempt_at = now()
WHERE venue = 'binance'
  AND venue_symbol IS NOT NULL
  AND client_order_id IS NOT NULL
  AND filled_amount IS NOT NULL;

ALTER TABLE hedge_orders
  ADD CONSTRAINT chk_hedge_orders_venue_order_id CHECK (
    venue_order_id IS NULL
    OR (
      char_length(venue_order_id) BETWEEN 1 AND 16
      AND venue_order_id ~ '^[1-9][0-9]*$'
      AND venue_order_id::NUMERIC <= 9007199254740991
    )
  ),
  ADD CONSTRAINT chk_hedge_orders_fee_attempt_count CHECK (
    fee_attempt_count BETWEEN 0 AND 1000000
  ),
  ADD CONSTRAINT chk_hedge_orders_fee_last_error CHECK (
    fee_last_error_code IS NULL
    OR (
      char_length(fee_last_error_code) BETWEEN 1 AND 128
      AND fee_last_error_code ~ '^[A-Z0-9_:-]+$'
    )
  ),
  ADD CONSTRAINT chk_hedge_orders_fee_reconciliation CHECK (
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
  );

CREATE INDEX idx_hedge_orders_fee_reconciliation_claim
  ON hedge_orders (fee_next_attempt_at, created_at, id)
  WHERE fee_reconciliation_status = 'pending';

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
  CONSTRAINT chk_hedge_execution_fills_venue CHECK (
    venue = 'binance'
  ),
  CONSTRAINT chk_hedge_execution_fills_symbol CHECK (
    char_length(venue_symbol) BETWEEN 3 AND 32
    AND venue_symbol ~ '^[A-Z0-9._-]+$'
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

CREATE TRIGGER trg_hedge_execution_fills_analytics_insert
AFTER INSERT ON hedge_execution_fills
FOR EACH ROW
EXECUTE FUNCTION enqueue_hedge_execution_fill_analytics_event();

CREATE OR REPLACE FUNCTION enqueue_hedge_analytics_event_v3()
RETURNS TRIGGER AS $$
DECLARE
  source_row hedge_orders%ROWTYPE;
BEGIN
  source_row := NEW;
  INSERT INTO public.analytics_outbox (
    topic, event_key, event_type, schema_version, aggregate_type, aggregate_id, payload
  ) VALUES (
    'rfq.analytics.v1', source_row.id, 'hedge.lifecycle.v3', 3, 'hedge', source_row.id,
    jsonb_build_object(
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
    )
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public;

DROP TRIGGER trg_hedge_orders_analytics_insert ON hedge_orders;
DROP TRIGGER trg_hedge_orders_analytics_update ON hedge_orders;

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
