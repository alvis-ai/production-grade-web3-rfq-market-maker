CREATE TABLE toxic_flow_scores (
  chain_id BIGINT NOT NULL,
  user_address CHAR(42) NOT NULL,
  score_bps INTEGER NOT NULL,
  post_trade_drift_bps INTEGER NOT NULL,
  sample_size BIGINT NOT NULL,
  window_seconds INTEGER NOT NULL,
  policy_version VARCHAR(128) NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL,
  version BIGINT NOT NULL,
  updated_by VARCHAR(256) NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (chain_id, user_address),
  CONSTRAINT chk_toxic_flow_scores_chain CHECK (chain_id BETWEEN 1 AND 9007199254740991),
  CONSTRAINT chk_toxic_flow_scores_user CHECK (user_address ~ '^0x[0-9a-f]{40}$'),
  CONSTRAINT chk_toxic_flow_scores_score CHECK (score_bps BETWEEN 0 AND 10000),
  CONSTRAINT chk_toxic_flow_scores_drift CHECK (post_trade_drift_bps BETWEEN -10000 AND 10000),
  CONSTRAINT chk_toxic_flow_scores_sample CHECK (sample_size BETWEEN 1 AND 9007199254740991),
  CONSTRAINT chk_toxic_flow_scores_window CHECK (window_seconds BETWEEN 1 AND 604800),
  CONSTRAINT chk_toxic_flow_scores_policy CHECK (
    length(policy_version) BETWEEN 1 AND 128 AND policy_version ~ '^[A-Za-z0-9_:-]+$'
  ),
  CONSTRAINT chk_toxic_flow_scores_version CHECK (version BETWEEN 1 AND 9007199254740991),
  CONSTRAINT chk_toxic_flow_scores_actor CHECK (
    length(updated_by) BETWEEN 1 AND 256 AND updated_by ~ '^[A-Za-z0-9_:-]+$'
  )
);

CREATE TABLE toxic_flow_score_audit (
  chain_id BIGINT NOT NULL,
  user_address CHAR(42) NOT NULL,
  version BIGINT NOT NULL,
  score_bps INTEGER NOT NULL,
  post_trade_drift_bps INTEGER NOT NULL,
  sample_size BIGINT NOT NULL,
  window_seconds INTEGER NOT NULL,
  policy_version VARCHAR(128) NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL,
  updated_by VARCHAR(256) NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (chain_id, user_address, version),
  CONSTRAINT chk_toxic_flow_score_audit_chain CHECK (chain_id BETWEEN 1 AND 9007199254740991),
  CONSTRAINT chk_toxic_flow_score_audit_user CHECK (user_address ~ '^0x[0-9a-f]{40}$'),
  CONSTRAINT chk_toxic_flow_score_audit_score CHECK (score_bps BETWEEN 0 AND 10000),
  CONSTRAINT chk_toxic_flow_score_audit_drift CHECK (post_trade_drift_bps BETWEEN -10000 AND 10000),
  CONSTRAINT chk_toxic_flow_score_audit_sample CHECK (sample_size BETWEEN 1 AND 9007199254740991),
  CONSTRAINT chk_toxic_flow_score_audit_window CHECK (window_seconds BETWEEN 1 AND 604800),
  CONSTRAINT chk_toxic_flow_score_audit_policy CHECK (
    length(policy_version) BETWEEN 1 AND 128 AND policy_version ~ '^[A-Za-z0-9_:-]+$'
  ),
  CONSTRAINT chk_toxic_flow_score_audit_version CHECK (version BETWEEN 1 AND 9007199254740991),
  CONSTRAINT chk_toxic_flow_score_audit_actor CHECK (
    length(updated_by) BETWEEN 1 AND 256 AND updated_by ~ '^[A-Za-z0-9_:-]+$'
  )
);

CREATE INDEX idx_toxic_flow_scores_observed_at
  ON toxic_flow_scores (observed_at);
