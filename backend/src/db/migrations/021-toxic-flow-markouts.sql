ALTER TABLE settlement_events ADD COLUMN settled_at TIMESTAMPTZ;

ALTER TABLE toxic_flow_scores DROP CONSTRAINT chk_toxic_flow_scores_sample;
ALTER TABLE toxic_flow_scores ADD CONSTRAINT chk_toxic_flow_scores_sample
  CHECK (sample_size BETWEEN 0 AND 9007199254740991);
ALTER TABLE toxic_flow_scores ADD CONSTRAINT chk_toxic_flow_scores_empty_sample
  CHECK (sample_size > 0 OR (score_bps = 0 AND post_trade_drift_bps = 0));

ALTER TABLE toxic_flow_score_audit DROP CONSTRAINT chk_toxic_flow_score_audit_sample;
ALTER TABLE toxic_flow_score_audit ADD CONSTRAINT chk_toxic_flow_score_audit_sample
  CHECK (sample_size BETWEEN 0 AND 9007199254740991);
ALTER TABLE toxic_flow_score_audit ADD CONSTRAINT chk_toxic_flow_score_audit_empty_sample
  CHECK (sample_size > 0 OR (score_bps = 0 AND post_trade_drift_bps = 0));

CREATE TABLE toxic_flow_markout_jobs (
  settlement_event_id TEXT PRIMARY KEY REFERENCES settlement_events(id) ON DELETE CASCADE,
  desired_canonical BOOLEAN NOT NULL,
  desired_revision BIGINT NOT NULL DEFAULT 1,
  processed_revision BIGINT NOT NULL DEFAULT 0,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  settled_at TIMESTAMPTZ NOT NULL,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  lease_owner VARCHAR(128),
  lease_expires_at TIMESTAMPTZ,
  last_error_code VARCHAR(128),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_toxic_flow_markout_jobs_revisions CHECK (
    desired_revision BETWEEN 1 AND 9007199254740991
    AND processed_revision BETWEEN 0 AND desired_revision
  ),
  CONSTRAINT chk_toxic_flow_markout_jobs_attempt CHECK (attempt_count BETWEEN 0 AND 2147483647),
  CONSTRAINT chk_toxic_flow_markout_jobs_lease CHECK (
    (lease_owner IS NULL AND lease_expires_at IS NULL)
    OR (lease_owner ~ '^[A-Za-z0-9_:-]{1,128}$' AND lease_expires_at IS NOT NULL)
  ),
  CONSTRAINT chk_toxic_flow_markout_jobs_error CHECK (
    last_error_code IS NULL OR last_error_code ~ '^[A-Z0-9_:-]{1,128}$'
  )
);

CREATE INDEX idx_toxic_flow_markout_jobs_pending
  ON toxic_flow_markout_jobs (next_attempt_at, settled_at, settlement_event_id)
  WHERE processed_revision < desired_revision;

CREATE TABLE toxic_flow_markouts (
  settlement_event_id TEXT PRIMARY KEY REFERENCES settlement_events(id) ON DELETE CASCADE,
  quote_id TEXT NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  post_snapshot_id TEXT NOT NULL REFERENCES market_snapshots(id),
  chain_id BIGINT NOT NULL,
  user_address CHAR(42) NOT NULL,
  token_in CHAR(42) NOT NULL,
  token_out CHAR(42) NOT NULL,
  execution_price NUMERIC(38, 18) NOT NULL,
  post_mid_price NUMERIC(38, 18) NOT NULL,
  post_trade_drift_bps INTEGER NOT NULL,
  toxicity_score_bps INTEGER NOT NULL,
  horizon_seconds INTEGER NOT NULL,
  policy_version VARCHAR(128) NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL,
  canonical BOOLEAN NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_toxic_flow_markouts_chain CHECK (chain_id BETWEEN 1 AND 9007199254740991),
  CONSTRAINT chk_toxic_flow_markouts_addresses CHECK (
    user_address ~ '^0x[0-9a-f]{40}$' AND token_in ~ '^0x[0-9a-f]{40}$'
    AND token_out ~ '^0x[0-9a-f]{40}$' AND token_in <> token_out
  ),
  CONSTRAINT chk_toxic_flow_markouts_prices CHECK (execution_price > 0 AND post_mid_price > 0),
  CONSTRAINT chk_toxic_flow_markouts_bps CHECK (
    post_trade_drift_bps BETWEEN -10000 AND 10000 AND toxicity_score_bps BETWEEN 0 AND 10000
  ),
  CONSTRAINT chk_toxic_flow_markouts_horizon CHECK (horizon_seconds BETWEEN 1 AND 604800),
  CONSTRAINT chk_toxic_flow_markouts_policy CHECK (
    policy_version ~ '^[A-Za-z0-9_:-]{1,128}$'
  )
);

CREATE INDEX idx_toxic_flow_markouts_user_window
  ON toxic_flow_markouts (chain_id, user_address, observed_at DESC)
  WHERE canonical = TRUE;

CREATE OR REPLACE FUNCTION enqueue_toxic_flow_markout_job()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.settled_at IS NULL THEN
    RETURN NEW;
  END IF;
  INSERT INTO public.toxic_flow_markout_jobs (
    settlement_event_id, desired_canonical, desired_revision, processed_revision,
    settled_at, next_attempt_at
  ) VALUES (NEW.id, NEW.canonical, 1, 0, NEW.settled_at, now())
  ON CONFLICT (settlement_event_id) DO UPDATE SET
    desired_canonical = EXCLUDED.desired_canonical,
    desired_revision = toxic_flow_markout_jobs.desired_revision + 1,
    attempt_count = 0,
    next_attempt_at = now(),
    last_error_code = NULL,
    updated_at = now()
  WHERE toxic_flow_markout_jobs.desired_canonical IS DISTINCT FROM EXCLUDED.desired_canonical;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_settlement_events_toxic_flow_markout
AFTER INSERT OR UPDATE OF canonical ON settlement_events
FOR EACH ROW
EXECUTE FUNCTION enqueue_toxic_flow_markout_job();

INSERT INTO toxic_flow_markout_jobs (
  settlement_event_id, desired_canonical, desired_revision, processed_revision,
  settled_at, next_attempt_at
)
SELECT id, canonical, 1, 0, settled_at, now()
FROM settlement_events
WHERE settled_at IS NOT NULL
ON CONFLICT (settlement_event_id) DO NOTHING;
