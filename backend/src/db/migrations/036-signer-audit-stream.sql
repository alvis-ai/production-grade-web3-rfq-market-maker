ALTER TABLE signer_audit_events
  ADD COLUMN source_stream_id VARCHAR(128),
  ADD CONSTRAINT chk_signer_audit_source_stream_id CHECK (
    source_stream_id IS NULL OR source_stream_id ~ '^[A-Za-z][A-Za-z0-9_-]{0,63}:[0-9]+-[0-9]+$'
  ),
  ADD CONSTRAINT uq_signer_audit_source_stream_id UNIQUE (source_stream_id);
