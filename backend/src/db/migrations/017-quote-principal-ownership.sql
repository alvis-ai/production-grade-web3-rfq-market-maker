BEGIN;

ALTER TABLE quotes
  ADD COLUMN IF NOT EXISTS principal_id TEXT;

-- Historical rows predate tenant attribution. Give each quote an isolated owner
-- so no configured institution can inherit another institution's records.
UPDATE quotes
SET principal_id = 'legacy:' || md5(id)
WHERE principal_id IS NULL;

ALTER TABLE quotes
  ALTER COLUMN principal_id SET NOT NULL,
  DROP CONSTRAINT IF EXISTS chk_quotes_principal_id_safe,
  ADD CONSTRAINT chk_quotes_principal_id_safe CHECK (
    btrim(principal_id) <> ''
    AND char_length(principal_id) <= 128
    AND principal_id ~ '^[A-Za-z0-9_:-]+$'
  );

CREATE INDEX IF NOT EXISTS idx_quotes_principal_created_at
  ON quotes (principal_id, created_at DESC);

COMMIT;
