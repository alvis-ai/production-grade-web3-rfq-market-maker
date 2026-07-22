import assert from "node:assert/strict";
import test from "node:test";
import { defaultTokenRegistryConfig } from "../dist/modules/pricing/token-registry.js";
import { defaultTokenLimitRiskPolicy } from "../dist/modules/risk/token-limit-risk.engine.js";
import {
  createSignerQuoteCommitStore,
  readSignerProcessConfig,
} from "../dist/signer-main.js";

const env = {
  NODE_ENV: "development",
  RFQ_SIGNER_MODE: "local",
  RFQ_SIGNER_SERVICE_TOKEN: "s".repeat(43),
  RFQ_TOKEN_REGISTRY_JSON: JSON.stringify(defaultTokenRegistryConfig),
  RFQ_RISK_POLICY_JSON: JSON.stringify(defaultTokenLimitRiskPolicy),
};

test("signer process runtime separates server credentials from local or KMS signer config", () => {
  const config = readSignerProcessConfig(env);
  assert.equal(config.signer.mode, "local");
  assert.equal(config.authToken, "s".repeat(43));
  assert.equal(config.quoteTtlSeconds, 30);
  assert.equal(config.maxClockSkewSeconds, 5);
  assert.equal(config.bodyLimitBytes, 32768);
  assert.equal(config.listenHost, "127.0.0.1");
  assert.equal(config.listenPort, 3006);
  assert.deepEqual(config.audit, { backend: "memory" });
  assert.ok(config.tokenRegistry.getToken(1, defaultTokenRegistryConfig.tokens[0].tokenAddress));
});

test("signer process runtime rejects remote mode and unsafe server controls", () => {
  assert.throws(
    () => readSignerProcessConfig({
      ...env,
      NODE_ENV: "production",
      RFQ_SIGNER_MODE: "remote",
      RFQ_SETTLEMENT_ADDRESS: "0x0000000000000000000000000000000000000004",
      RFQ_TRUSTED_SIGNER_ADDRESS: "0x0000000000000000000000000000000000000005",
      RFQ_SIGNER_SERVICE_URL: "https://signer.example.internal",
    }),
    /requires RFQ_SIGNER_MODE=local or aws-kms/,
  );
  assert.throws(() => readSignerProcessConfig({ ...env, RFQ_SIGNER_SERVICE_TOKEN: "short" }), /SERVICE_TOKEN/);
  assert.throws(() => readSignerProcessConfig({ ...env, RFQ_SIGNER_SERVICE_PORT: "0" }), /SERVICE_PORT/);
  assert.throws(() => readSignerProcessConfig({ ...env, RFQ_QUOTE_TTL_SECONDS: "3601" }), /QUOTE_TTL/);
  assert.throws(() => readSignerProcessConfig({ ...env, RFQ_SIGNER_SERVICE_HOST: "bad host" }), /SERVICE_HOST/);
  assert.throws(() => readSignerProcessConfig({
    ...env,
    NODE_ENV: "production",
    RFQ_SIGNER_MODE: "aws-kms",
    RFQ_SETTLEMENT_ADDRESS: "0x0000000000000000000000000000000000000004",
    RFQ_TRUSTED_SIGNER_ADDRESS: "0x0000000000000000000000000000000000000005",
    RFQ_AWS_KMS_KEY_ID: "alias/rfq-signer",
    RFQ_AWS_KMS_REGION: "us-east-1",
  }), /TLS certificate and key paths are required/);
  assert.throws(() => readSignerProcessConfig({
    ...env,
    RFQ_SIGNER_TLS_CERT_PATH: "/etc/rfq-signer/tls.crt",
  }), /must be configured together/);
  assert.throws(() => readSignerProcessConfig({
    ...env,
    NODE_ENV: "production",
    RFQ_SIGNER_MODE: "aws-kms",
    RFQ_SETTLEMENT_ADDRESS: "0x0000000000000000000000000000000000000004",
    RFQ_TRUSTED_SIGNER_ADDRESS: "0x0000000000000000000000000000000000000005",
    RFQ_AWS_KMS_KEY_ID: "alias/rfq-signer",
    RFQ_AWS_KMS_REGION: "us-east-1",
    RFQ_SIGNER_TLS_CERT_PATH: "/etc/rfq-signer/tls.crt",
    RFQ_SIGNER_TLS_KEY_PATH: "/etc/rfq-signer/tls.key",
    RFQ_SIGNER_AUDIT_BACKEND: "memory",
  }), /AUDIT_BACKEND=memory is not allowed/);
});

test("signer process parses a dedicated production audit database without exposing its URL", () => {
  const config = readSignerProcessConfig({
    ...env,
    NODE_ENV: "production",
    RFQ_SIGNER_MODE: "aws-kms",
    RFQ_SETTLEMENT_ADDRESS: "0x0000000000000000000000000000000000000004",
    RFQ_TRUSTED_SIGNER_ADDRESS: "0x0000000000000000000000000000000000000005",
    RFQ_AWS_KMS_KEY_ID: "alias/rfq-signer",
    RFQ_AWS_KMS_REGION: "us-east-1",
    RFQ_SIGNER_TLS_CERT_PATH: "/etc/rfq-signer/tls.crt",
    RFQ_SIGNER_TLS_KEY_PATH: "/etc/rfq-signer/tls.key",
    RFQ_SIGNER_AUDIT_BACKEND: "postgres",
    RFQ_SIGNER_AUDIT_DATABASE_URL:
      "postgres://rfq_signer_audit:secret@postgres.example.com:5432/rfq_market_maker?minPool=1&maxPool=3&sslmode=verify-full&sslrootcert=%2Fetc%2Frfq%2Fdatabase-ca%2Fca.crt",
    RFQ_SIGNER_AUDIT_TIMEOUT_MS: "1500",
  });
  assert.equal(config.audit.backend, "postgres");
  assert.equal(config.audit.database.user, "rfq_signer_audit");
  assert.equal(config.audit.database.maxPoolSize, 3);
  assert.equal(config.audit.queryTimeoutMs, 1500);
  assert.equal("auditDatabaseUrl" in config, false);
});

test("signer process requires replicated TLS Redis for the production audit stream", () => {
  const production = {
    ...env,
    NODE_ENV: "production",
    HOSTNAME: "signer-pod-1",
    RFQ_SIGNER_MODE: "aws-kms",
    RFQ_SETTLEMENT_ADDRESS: "0x0000000000000000000000000000000000000004",
    RFQ_TRUSTED_SIGNER_ADDRESS: "0x0000000000000000000000000000000000000005",
    RFQ_AWS_KMS_KEY_ID: "alias/rfq-signer",
    RFQ_AWS_KMS_REGION: "us-east-1",
    RFQ_SIGNER_TLS_CERT_PATH: "/etc/rfq-signer/tls.crt",
    RFQ_SIGNER_TLS_KEY_PATH: "/etc/rfq-signer/tls.key",
    RFQ_SIGNER_AUDIT_BACKEND: "redis-stream",
    RFQ_SIGNER_AUDIT_DATABASE_URL:
      "postgres://rfq_signer_audit:secret@postgres.example.com:5432/rfq_market_maker?minPool=1&maxPool=3&sslmode=verify-full&sslrootcert=%2Fetc%2Frfq%2Fdatabase-ca%2Fca.crt",
    RFQ_SIGNER_AUDIT_REDIS_URL: "rediss://audit-redis.example.com:6380/0",
    RFQ_SIGNER_AUDIT_STREAM_EPOCH: "production_v1",
    RFQ_SIGNER_AUDIT_MIN_REPLICA_ACKS: "1",
  };
  const config = readSignerProcessConfig(production);
  assert.equal(config.audit.backend, "redis-stream");
  assert.equal(config.audit.redisUrl, "rediss://audit-redis.example.com:6380/0");
  assert.equal(config.audit.minReplicaAcks, 1);
  assert.equal(config.audit.requireAof, true);
  assert.equal(config.audit.sourceEpoch, "production_v1");
  assert.equal(config.audit.consumer, "signer-pod-1");
  assert.equal(config.audit.maxBacklog, 10_000);

  assert.throws(
    () => readSignerProcessConfig({ ...production, RFQ_SIGNER_AUDIT_REDIS_URL: "redis://redis:6379/0" }),
    /must use rediss/,
  );
  assert.throws(
    () => readSignerProcessConfig({ ...production, RFQ_SIGNER_AUDIT_MIN_REPLICA_ACKS: "0" }),
    /must be at least 1/,
  );
  const { RFQ_SIGNER_AUDIT_MIN_REPLICA_ACKS: _acks, ...withoutAcks } = production;
  assert.throws(() => readSignerProcessConfig(withoutAcks), /MIN_REPLICA_ACKS is required/);
  const { RFQ_SIGNER_AUDIT_STREAM_EPOCH: _epoch, ...withoutEpoch } = production;
  assert.throws(() => readSignerProcessConfig(withoutEpoch), /STREAM_EPOCH is required/);
  assert.throws(
    () => readSignerProcessConfig({ ...production, RFQ_SIGNER_AUDIT_STREAM_EPOCH: "2026/07" }),
    /must be a safe epoch identifier/,
  );
});

test("signer process binds atomic quote commit to the durable audit stream and issuance ledger", async () => {
  const atomic = {
    ...env,
    RFQ_SIGNER_AUDIT_BACKEND: "redis-stream",
    RFQ_SIGNER_AUDIT_DATABASE_URL: "postgres://rfq:rfq@postgres:5432/rfq_market_maker",
    RFQ_SIGNER_AUDIT_REDIS_URL: "redis://redis:6379/0",
    RFQ_SIGNER_AUDIT_STREAM_KEY: "rfq:{quote-issuance}:signer-audit-events:v1",
    RFQ_SIGNER_ATOMIC_QUOTE_COMMIT: "true",
    RFQ_QUOTE_ISSUANCE_LEDGER_EPOCH: "local_atomic_v1",
    RFQ_QUOTE_ISSUANCE_REQUIRE_AOF: "true",
  };
  const config = readSignerProcessConfig(atomic);
  assert.equal(config.quoteCommit.quoteKeyPrefix, "rfq:{quote-issuance}:ledger");
  assert.equal(config.quoteCommit.auditStreamKey, atomic.RFQ_SIGNER_AUDIT_STREAM_KEY);
  assert.equal(config.quoteCommit.ledgerEpoch, "local_atomic_v1");
  assert.equal(config.quoteCommit.requireAof, true);
  assert.equal(config.quoteCommit.minReplicaAcks, 0);
  const store = createSignerQuoteCommitStore(config.quoteCommit);
  assert.ok(store);
  await store.close();

  assert.throws(
    () => readSignerProcessConfig({ ...atomic, RFQ_SIGNER_AUDIT_STREAM_KEY: "rfq:{other}:events:v1" }),
    /one Redis Cluster hash tag/,
  );
  assert.throws(
    () => readSignerProcessConfig({ ...atomic, RFQ_QUOTE_ISSUANCE_REQUIRE_AOF: "false" }),
    /cannot be disabled/,
  );
  assert.throws(
    () => readSignerProcessConfig({ ...env, RFQ_SIGNER_ATOMIC_QUOTE_COMMIT: "true" }),
    /requires RFQ_SIGNER_AUDIT_BACKEND=redis-stream/,
  );
  assert.throws(
    () => readSignerProcessConfig({ ...atomic, RFQ_SIGNER_ATOMIC_QUOTE_COMMIT: "yes" }),
    /must be true or false/,
  );
});

test("signer process requires a replicated quote ledger for production atomic commit", () => {
  const productionAtomic = {
    ...env,
    NODE_ENV: "production",
    HOSTNAME: "signer-pod-1",
    RFQ_SIGNER_MODE: "aws-kms",
    RFQ_SETTLEMENT_ADDRESS: "0x0000000000000000000000000000000000000004",
    RFQ_TRUSTED_SIGNER_ADDRESS: "0x0000000000000000000000000000000000000005",
    RFQ_AWS_KMS_KEY_ID: "alias/rfq-signer",
    RFQ_AWS_KMS_REGION: "us-east-1",
    RFQ_SIGNER_TLS_CERT_PATH: "/etc/rfq-signer/tls.crt",
    RFQ_SIGNER_TLS_KEY_PATH: "/etc/rfq-signer/tls.key",
    RFQ_SIGNER_AUDIT_BACKEND: "redis-stream",
    RFQ_SIGNER_AUDIT_DATABASE_URL:
      "postgres://rfq_signer_audit:secret@postgres.example.com:5432/rfq_market_maker?minPool=1&maxPool=3&sslmode=verify-full&sslrootcert=%2Fetc%2Frfq%2Fdatabase-ca%2Fca.crt",
    RFQ_SIGNER_AUDIT_REDIS_URL: "rediss://audit-redis.example.com:6380/0",
    RFQ_SIGNER_AUDIT_STREAM_KEY: "rfq:{quote-issuance}:signer-audit-events:v1",
    RFQ_SIGNER_AUDIT_STREAM_EPOCH: "production_atomic_v1",
    RFQ_SIGNER_AUDIT_MIN_REPLICA_ACKS: "1",
    RFQ_SIGNER_ATOMIC_QUOTE_COMMIT: "true",
    RFQ_QUOTE_ISSUANCE_LEDGER_EPOCH: "production_atomic_v1",
    RFQ_QUOTE_ISSUANCE_MIN_REPLICA_ACKS: "1",
    RFQ_QUOTE_ISSUANCE_REQUIRE_AOF: "true",
  };
  const config = readSignerProcessConfig(productionAtomic);
  assert.equal(config.quoteCommit.requireTls, true);
  assert.equal(config.quoteCommit.minReplicaAcks, 1);

  assert.throws(
    () => readSignerProcessConfig({ ...productionAtomic, RFQ_QUOTE_ISSUANCE_MIN_REPLICA_ACKS: "0" }),
    /must be at least 1 for atomic signer commit/,
  );
  const { RFQ_QUOTE_ISSUANCE_LEDGER_EPOCH: _epoch, ...withoutEpoch } = productionAtomic;
  assert.throws(() => readSignerProcessConfig(withoutEpoch), /LEDGER_EPOCH is required/);
});
