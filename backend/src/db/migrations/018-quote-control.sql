CREATE TABLE quote_control (
  singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton = TRUE),
  paused BOOLEAN NOT NULL DEFAULT FALSE,
  version BIGINT NOT NULL DEFAULT 0,
  reason VARCHAR(256),
  updated_by VARCHAR(256) NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_quote_control_version CHECK (version BETWEEN 0 AND 9007199254740991),
  CONSTRAINT chk_quote_control_reason CHECK (
    reason IS NULL OR (
      length(reason) BETWEEN 1 AND 256 AND reason = btrim(reason) AND reason !~ '[[:cntrl:]]'
    )
  ),
  CONSTRAINT chk_quote_control_paused_reason CHECK (paused = FALSE OR reason IS NOT NULL),
  CONSTRAINT chk_quote_control_updated_by CHECK (
    length(updated_by) BETWEEN 1 AND 256 AND updated_by ~ '^[A-Za-z0-9_:-]+$'
  )
);

CREATE TABLE quote_control_audit (
  version BIGINT PRIMARY KEY,
  paused BOOLEAN NOT NULL,
  reason VARCHAR(256),
  updated_by VARCHAR(256) NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT chk_quote_control_audit_version CHECK (version BETWEEN 0 AND 9007199254740991),
  CONSTRAINT chk_quote_control_audit_reason CHECK (
    reason IS NULL OR (
      length(reason) BETWEEN 1 AND 256 AND reason = btrim(reason) AND reason !~ '[[:cntrl:]]'
    )
  ),
  CONSTRAINT chk_quote_control_audit_paused_reason CHECK (paused = FALSE OR reason IS NOT NULL),
  CONSTRAINT chk_quote_control_audit_updated_by CHECK (
    length(updated_by) BETWEEN 1 AND 256 AND updated_by ~ '^[A-Za-z0-9_:-]+$'
  )
);

INSERT INTO quote_control (singleton, paused, version, reason, updated_by)
VALUES (TRUE, FALSE, 0, NULL, 'migration')
ON CONFLICT (singleton) DO NOTHING;

INSERT INTO quote_control_audit (version, paused, reason, updated_by, updated_at)
SELECT version, paused, reason, updated_by, updated_at
FROM quote_control
ON CONFLICT (version) DO NOTHING;
