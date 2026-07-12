CREATE TABLE pnl_records_legacy_simulated_v1 (
  LIKE pnl_records INCLUDING DEFAULTS
);

ALTER TABLE pnl_records_legacy_simulated_v1
  ADD COLUMN archived_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN archive_reason TEXT NOT NULL DEFAULT 'replaced_by_quote_snapshot_edge_v1';

INSERT INTO pnl_records_legacy_simulated_v1 (
  id, quote_id, chain_id, user_address, token_in, token_out,
  amount_in, amount_out, min_amount_out, nonce, deadline,
  gross_pnl_token_out, gross_pnl_bps, model, model_description, realized_at, created_at
)
SELECT
  id, quote_id, chain_id, user_address, token_in, token_out,
  amount_in, amount_out, min_amount_out, nonce, deadline,
  gross_pnl_token_out, gross_pnl_bps, model, model_description, realized_at, created_at
FROM pnl_records;

UPDATE quotes
SET pnl_id = NULL
WHERE pnl_id IS NOT NULL;

DELETE FROM pnl_records;

ALTER TABLE pnl_records
  DROP CONSTRAINT chk_pnl_records_model,
  DROP CONSTRAINT chk_pnl_records_model_description,
  ADD COLUMN settlement_event_id TEXT NOT NULL REFERENCES settlement_events(id),
  ADD COLUMN snapshot_id TEXT NOT NULL REFERENCES market_snapshots(id),
  ADD COLUMN mid_price NUMERIC(38, 18) NOT NULL,
  ADD COLUMN token_in_decimals SMALLINT NOT NULL,
  ADD COLUMN token_out_decimals SMALLINT NOT NULL,
  ADD COLUMN fair_amount_out NUMERIC(78, 0) NOT NULL,
  ADD COLUMN valuation_observed_at TIMESTAMPTZ NOT NULL,
  ADD CONSTRAINT chk_pnl_records_model CHECK (model IN ('quote_snapshot_edge_v1')),
  ADD CONSTRAINT chk_pnl_records_model_description CHECK (
    model_description = 'Gross settlement PnL in tokenOut base units versus the persisted quote-time mid price, excluding fees, gas, and hedge execution'
  ),
  ADD CONSTRAINT chk_pnl_records_reference_ids_safe CHECK (
    btrim(settlement_event_id) <> ''
    AND char_length(settlement_event_id) <= 128
    AND settlement_event_id ~ '^[A-Za-z0-9_:-]+$'
    AND btrim(snapshot_id) <> ''
    AND char_length(snapshot_id) <= 128
    AND snapshot_id ~ '^[A-Za-z0-9_:-]+$'
  ),
  ADD CONSTRAINT chk_pnl_records_valuation CHECK (
    mid_price > 0
    AND token_in_decimals BETWEEN 0 AND 36
    AND token_out_decimals BETWEEN 0 AND 36
    AND fair_amount_out > 0
  );

CREATE UNIQUE INDEX uq_pnl_records_settlement_model
  ON pnl_records (settlement_event_id, model);
CREATE INDEX idx_pnl_records_snapshot_id ON pnl_records (snapshot_id);

DROP TRIGGER trg_pnl_records_analytics_insert ON pnl_records;
DROP TRIGGER trg_pnl_records_analytics_delete ON pnl_records;

CREATE OR REPLACE FUNCTION enqueue_pnl_snapshot_analytics_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  source_row RECORD;
  event_payload JSONB;
BEGIN
  IF TG_OP = 'DELETE' THEN
    source_row := OLD;
  ELSE
    source_row := NEW;
  END IF;

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

  INSERT INTO public.analytics_outbox (
    topic, event_key, event_type, schema_version, aggregate_type, aggregate_id, payload
  ) VALUES (
    'rfq.analytics.v1', source_row.id, 'pnl.attribution.v2', 2, 'pnl', source_row.id, event_payload
  );

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_pnl_records_analytics_insert
AFTER INSERT ON pnl_records
FOR EACH ROW
EXECUTE FUNCTION enqueue_pnl_snapshot_analytics_event();

CREATE TRIGGER trg_pnl_records_analytics_delete
AFTER DELETE ON pnl_records
FOR EACH ROW
EXECUTE FUNCTION enqueue_pnl_snapshot_analytics_event();
