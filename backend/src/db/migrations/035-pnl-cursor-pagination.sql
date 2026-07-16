BEGIN;

CREATE INDEX idx_pnl_records_page
  ON pnl_records (realized_at DESC, id DESC)
  INCLUDE (created_at, quote_id);

CREATE INDEX idx_quotes_principal_id
  ON quotes (principal_id, id);

CREATE OR REPLACE FUNCTION enforce_pnl_created_at_immutability()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.created_at IS DISTINCT FROM NEW.created_at THEN
    RAISE EXCEPTION 'PnL record % created_at is immutable', OLD.id
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public;

CREATE TRIGGER trg_pnl_records_created_at_immutable
BEFORE UPDATE OF created_at ON pnl_records
FOR EACH ROW
EXECUTE FUNCTION enforce_pnl_created_at_immutability();

COMMIT;
