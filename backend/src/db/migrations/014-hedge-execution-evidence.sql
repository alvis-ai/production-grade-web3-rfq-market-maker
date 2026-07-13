ALTER TABLE hedge_orders
  ADD COLUMN execution_evidence_version TEXT,
  ADD COLUMN executed_quote_quantity NUMERIC(78, 18);

ALTER TABLE hedge_orders
  DROP CONSTRAINT chk_hedge_orders_venue_non_empty,
  ADD CONSTRAINT chk_hedge_orders_venue_non_empty CHECK (
    char_length(btrim(venue)) BETWEEN 1 AND 128
  );

-- Historical fills contain only base-asset quantity. Preserve that limitation explicitly.
UPDATE hedge_orders
SET execution_evidence_version = 'base-only-v1'
WHERE filled_amount IS NOT NULL;

ALTER TABLE hedge_orders
  ADD CONSTRAINT chk_hedge_orders_execution_evidence CHECK (
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
  );

CREATE OR REPLACE FUNCTION enqueue_hedge_analytics_event_v2()
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
    'status', source_row.status,
    'reason', source_row.reason,
    'submissionAttemptedAt', source_row.submission_attempted_at,
    'filledAmount', CASE WHEN source_row.filled_amount IS NULL THEN NULL ELSE source_row.filled_amount::text END,
    'executionEvidenceVersion', source_row.execution_evidence_version,
    'executedQuoteQuantity', CASE
      WHEN source_row.executed_quote_quantity IS NULL THEN NULL
      ELSE source_row.executed_quote_quantity::text
    END,
    'lastErrorCode', source_row.last_error_code,
    'createdAt', source_row.created_at,
    'updatedAt', source_row.updated_at
  );

  INSERT INTO public.analytics_outbox (
    topic, event_key, event_type, schema_version, aggregate_type, aggregate_id, payload
  ) VALUES (
    'rfq.analytics.v1', source_row.id, 'hedge.lifecycle.v2', 2, 'hedge', source_row.id, event_payload
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
EXECUTE FUNCTION enqueue_hedge_analytics_event_v2();

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
  OR OLD.execution_evidence_version IS DISTINCT FROM NEW.execution_evidence_version
  OR OLD.executed_quote_quantity IS DISTINCT FROM NEW.executed_quote_quantity
  OR OLD.status IS DISTINCT FROM NEW.status
  OR OLD.last_error_code IS DISTINCT FROM NEW.last_error_code
)
EXECUTE FUNCTION enqueue_hedge_analytics_event_v2();
