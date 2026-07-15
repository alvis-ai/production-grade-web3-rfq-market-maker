ALTER TABLE hedge_orders
  ADD COLUMN risk_failure_at TIMESTAMPTZ;

UPDATE hedge_orders
SET risk_failure_at = updated_at
WHERE status = 'failed';

CREATE OR REPLACE FUNCTION set_hedge_risk_failure_at()
RETURNS trigger AS $$
BEGIN
  IF NEW.status <> 'failed' THEN
    NEW.risk_failure_at = NULL;
  ELSE
    IF TG_OP = 'UPDATE' THEN
      IF OLD.status = 'failed' THEN
        NEW.risk_failure_at = OLD.risk_failure_at;
      ELSE
        NEW.risk_failure_at = now();
      END IF;
    ELSE
      NEW.risk_failure_at = now();
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql
SET search_path = pg_catalog, public;

CREATE TRIGGER trg_hedge_orders_set_risk_failure_at
BEFORE INSERT OR UPDATE OF status, risk_failure_at ON hedge_orders
FOR EACH ROW
EXECUTE FUNCTION set_hedge_risk_failure_at();

ALTER TABLE hedge_orders
  ADD CONSTRAINT chk_hedge_orders_risk_failure_time CHECK (
    (status = 'failed' AND risk_failure_at IS NOT NULL)
    OR (status <> 'failed' AND risk_failure_at IS NULL)
  );

CREATE INDEX idx_hedge_orders_recent_failed_risk
  ON hedge_orders (chain_id, lower(token_address), risk_failure_at DESC)
  WHERE status = 'failed';
