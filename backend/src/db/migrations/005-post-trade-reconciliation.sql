DROP INDEX IF EXISTS uq_settlement_events_quote_id;

CREATE UNIQUE INDEX uq_settlement_events_canonical_quote_id
  ON settlement_events (quote_id)
  WHERE canonical = TRUE;

CREATE TABLE post_trade_reconciliation_jobs (
  quote_id TEXT PRIMARY KEY REFERENCES quotes(id) ON DELETE CASCADE,
  desired_settlement_event_id TEXT REFERENCES settlement_events(id),
  desired_revision BIGINT NOT NULL DEFAULT 1,
  processed_revision BIGINT NOT NULL DEFAULT 0,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  lease_owner TEXT,
  lease_expires_at TIMESTAMPTZ,
  last_error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_post_trade_jobs_quote_id_safe CHECK (
    btrim(quote_id) <> ''
    AND char_length(quote_id) <= 128
    AND quote_id ~ '^[A-Za-z0-9_:-]+$'
  ),
  CONSTRAINT chk_post_trade_jobs_revisions CHECK (
    desired_revision BETWEEN 1 AND 9007199254740991
    AND processed_revision BETWEEN 0 AND desired_revision
  ),
  CONSTRAINT chk_post_trade_jobs_attempt_count CHECK (
    attempt_count BETWEEN 0 AND 2147483647
  ),
  CONSTRAINT chk_post_trade_jobs_lease_state CHECK (
    (lease_owner IS NULL AND lease_expires_at IS NULL)
    OR (
      lease_owner IS NOT NULL
      AND lease_expires_at IS NOT NULL
      AND btrim(lease_owner) <> ''
      AND char_length(lease_owner) <= 128
      AND lease_owner ~ '^[A-Za-z0-9_:-]+$'
    )
  ),
  CONSTRAINT chk_post_trade_jobs_last_error CHECK (
    last_error_code IS NULL
    OR (
      btrim(last_error_code) <> ''
      AND char_length(last_error_code) <= 128
      AND last_error_code ~ '^[A-Z0-9_:-]+$'
    )
  )
);

CREATE INDEX idx_post_trade_jobs_pending
  ON post_trade_reconciliation_jobs (next_attempt_at, requested_at, quote_id)
  WHERE processed_revision < desired_revision;

INSERT INTO post_trade_reconciliation_jobs (
  quote_id,
  desired_settlement_event_id,
  desired_revision,
  processed_revision,
  requested_at,
  next_attempt_at
)
SELECT event_quotes.quote_id,
       canonical_event.id,
       1,
       0,
       now(),
       now()
FROM (
  SELECT DISTINCT quote_id
  FROM settlement_events
) AS event_quotes
LEFT JOIN LATERAL (
  SELECT settlement.id
  FROM settlement_events AS settlement
  WHERE settlement.quote_id = event_quotes.quote_id
    AND settlement.canonical = TRUE
  ORDER BY settlement.block_number DESC, settlement.log_index DESC, settlement.id DESC
  LIMIT 1
) AS canonical_event ON TRUE;

CREATE OR REPLACE FUNCTION enqueue_post_trade_reconciliation_job()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  canonical_event_id TEXT;
BEGIN
  SELECT settlement.id
  INTO canonical_event_id
  FROM public.settlement_events AS settlement
  WHERE settlement.quote_id = NEW.quote_id
    AND settlement.canonical = TRUE
  ORDER BY settlement.block_number DESC, settlement.log_index DESC, settlement.id DESC
  LIMIT 1;

  INSERT INTO public.post_trade_reconciliation_jobs (
    quote_id,
    desired_settlement_event_id,
    desired_revision,
    processed_revision,
    requested_at,
    next_attempt_at
  ) VALUES (
    NEW.quote_id,
    canonical_event_id,
    1,
    0,
    now(),
    now()
  )
  ON CONFLICT (quote_id) DO UPDATE SET
    desired_settlement_event_id = EXCLUDED.desired_settlement_event_id,
    desired_revision = post_trade_reconciliation_jobs.desired_revision + 1,
    attempt_count = 0,
    requested_at = now(),
    next_attempt_at = now(),
    last_error_code = NULL,
    updated_at = now()
  WHERE post_trade_reconciliation_jobs.desired_settlement_event_id
    IS DISTINCT FROM EXCLUDED.desired_settlement_event_id;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_settlement_events_post_trade_reconciliation
AFTER INSERT OR UPDATE OF canonical ON settlement_events
FOR EACH ROW
EXECUTE FUNCTION enqueue_post_trade_reconciliation_job();
