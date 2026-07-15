ALTER TABLE signer_audit_events
  ADD COLUMN context_version SMALLINT NOT NULL DEFAULT 1,
  ADD COLUMN risk_decision_id VARCHAR(128),
  ADD COLUMN risk_policy_version VARCHAR(128),
  ADD COLUMN trace_id VARCHAR(128),
  ADD CONSTRAINT chk_signer_audit_context_version CHECK (context_version IN (1, 2)),
  ADD CONSTRAINT chk_signer_audit_risk_context CHECK (
    (context_version = 1
      AND risk_decision_id IS NULL
      AND risk_policy_version IS NULL
      AND trace_id IS NULL)
    OR
    (context_version = 2
      AND risk_decision_id IS NOT NULL
      AND risk_policy_version IS NOT NULL
      AND trace_id IS NOT NULL
      AND risk_decision_id = 'rd_' || quote_id
      AND risk_decision_id ~ '^[A-Za-z0-9_:-]{1,128}$'
      AND risk_policy_version ~ '^[A-Za-z0-9_.:-]{1,128}$'
      AND trace_id ~ '^tr_[A-Za-z0-9._:-]{1,125}$')
  );

CREATE INDEX idx_signer_audit_risk_decision
  ON signer_audit_events (risk_decision_id, occurred_at DESC, id DESC)
  WHERE risk_decision_id IS NOT NULL;
