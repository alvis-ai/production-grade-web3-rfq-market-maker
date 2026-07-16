BEGIN;

ALTER TABLE quotes
  ADD COLUMN route_id TEXT,
  ADD COLUMN route_venue TEXT,
  ADD COLUMN route_expected_liquidity_usd NUMERIC(78, 0),
  ADD COLUMN route_decided_at TIMESTAMPTZ;

ALTER TABLE quotes
  ADD CONSTRAINT chk_quotes_route_id_safe CHECK (
    route_id IS NULL
    OR (
      btrim(route_id) <> ''
      AND char_length(route_id) <= 128
      AND route_id ~ '^[A-Za-z0-9_:-]+$'
    )
  ),
  ADD CONSTRAINT chk_quotes_route_venue CHECK (
    route_venue IS NULL OR route_venue = 'internal_inventory'
  ),
  ADD CONSTRAINT chk_quotes_route_decision_atomic CHECK (
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
  );

CREATE INDEX idx_quotes_route_id ON quotes (route_id)
  WHERE route_id IS NOT NULL;

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

CREATE TRIGGER trg_quotes_enforce_route_immutability
BEFORE UPDATE OF route_id, route_venue, route_expected_liquidity_usd, route_decided_at ON quotes
FOR EACH ROW
EXECUTE FUNCTION enforce_quote_route_decision_immutability();

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

CREATE TRIGGER trg_quotes_routing_analytics_insert
AFTER INSERT ON quotes
FOR EACH ROW
WHEN (NEW.route_id IS NOT NULL)
EXECUTE FUNCTION enqueue_quote_routing_analytics_event();

CREATE TRIGGER trg_quotes_routing_analytics_update
AFTER UPDATE ON quotes
FOR EACH ROW
WHEN (OLD.route_id IS NULL AND NEW.route_id IS NOT NULL)
EXECUTE FUNCTION enqueue_quote_routing_analytics_event();

COMMIT;
