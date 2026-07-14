CREATE TABLE quote_pair_control (
  chain_id BIGINT NOT NULL,
  token_low CHAR(42) NOT NULL,
  token_high CHAR(42) NOT NULL,
  paused BOOLEAN NOT NULL,
  version BIGINT NOT NULL,
  reason VARCHAR(256) NOT NULL,
  updated_by VARCHAR(256) NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (chain_id, token_low, token_high),
  CONSTRAINT chk_quote_pair_control_chain CHECK (chain_id BETWEEN 1 AND 9007199254740991),
  CONSTRAINT chk_quote_pair_control_token_low CHECK (token_low ~ '^0x[0-9a-f]{40}$'),
  CONSTRAINT chk_quote_pair_control_token_high CHECK (token_high ~ '^0x[0-9a-f]{40}$'),
  CONSTRAINT chk_quote_pair_control_order CHECK (token_low < token_high),
  CONSTRAINT chk_quote_pair_control_version CHECK (version BETWEEN 1 AND 9007199254740991),
  CONSTRAINT chk_quote_pair_control_reason CHECK (
    length(reason) BETWEEN 1 AND 256 AND reason = btrim(reason) AND reason !~ '[[:cntrl:]]'
  ),
  CONSTRAINT chk_quote_pair_control_updated_by CHECK (
    length(updated_by) BETWEEN 1 AND 256 AND updated_by ~ '^[A-Za-z0-9_:-]+$'
  )
);

CREATE TABLE quote_pair_control_audit (
  chain_id BIGINT NOT NULL,
  token_low CHAR(42) NOT NULL,
  token_high CHAR(42) NOT NULL,
  version BIGINT NOT NULL,
  paused BOOLEAN NOT NULL,
  reason VARCHAR(256) NOT NULL,
  updated_by VARCHAR(256) NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (chain_id, token_low, token_high, version),
  CONSTRAINT chk_quote_pair_control_audit_chain CHECK (chain_id BETWEEN 1 AND 9007199254740991),
  CONSTRAINT chk_quote_pair_control_audit_token_low CHECK (token_low ~ '^0x[0-9a-f]{40}$'),
  CONSTRAINT chk_quote_pair_control_audit_token_high CHECK (token_high ~ '^0x[0-9a-f]{40}$'),
  CONSTRAINT chk_quote_pair_control_audit_order CHECK (token_low < token_high),
  CONSTRAINT chk_quote_pair_control_audit_version CHECK (version BETWEEN 1 AND 9007199254740991),
  CONSTRAINT chk_quote_pair_control_audit_reason CHECK (
    length(reason) BETWEEN 1 AND 256 AND reason = btrim(reason) AND reason !~ '[[:cntrl:]]'
  ),
  CONSTRAINT chk_quote_pair_control_audit_updated_by CHECK (
    length(updated_by) BETWEEN 1 AND 256 AND updated_by ~ '^[A-Za-z0-9_:-]+$'
  )
);

CREATE INDEX idx_quote_pair_control_paused
  ON quote_pair_control (chain_id, token_low, token_high)
  WHERE paused = TRUE;
