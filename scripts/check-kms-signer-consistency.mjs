#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { readBackendGatewaySource } from "./lib/read-backend-gateway-source.mjs";

const paths = [
  "backend/package.json",
  "backend/src/main.ts",
  "backend/src/modules/health/readiness.service.ts",
  "backend/src/modules/signer/signer-runtime.ts",
  "backend/src/modules/signer/signer.service.ts",
  "backend/src/modules/signer/remote-signer.service.ts",
  "backend/src/shared/http/bounded-json-response.ts",
  "backend/src/modules/signer/signer-server.ts",
  "backend/src/modules/signer/signer-audit.store.ts",
  "backend/src/modules/signer/redis-signer-audit.store.ts",
  "backend/src/modules/signer/signer-audit-mirror.ts",
  "backend/src/modules/signer/signer-audit-runtime.ts",
  "backend/src/modules/signer/signer-audit-stream.metrics.ts",
  "backend/src/db/migrations/027-signer-audit.sql",
  "backend/src/db/migrations/028-signer-risk-context.sql",
  "backend/src/db/migrations/036-signer-audit-stream.sql",
  "backend/src/signer-main.ts",
  "backend/src/modules/settlement/settlement-verifier.service.ts",
  "backend/src/modules/signer/kms-signer.service.ts",
  "backend/src/modules/signer/aws-kms-signer.provider.ts",
  "backend/test/kms-signer.test.mjs",
  "backend/test/aws-kms-signer-provider.test.mjs",
  "backend/test/api-readiness.test.mjs",
  "backend/test/signer-runtime.test.mjs",
  "backend/test/remote-signer.test.mjs",
  "backend/test/signer-server.test.mjs",
  "backend/test/signer-audit-store.test.mjs",
  "backend/test/redis-signer-audit-store.test.mjs",
  "backend/test/signer-audit-mirror.test.mjs",
  "backend/test/signer-process-runtime.test.mjs",
  "backend/test/settlement-verifier.test.mjs",
  "backend/test/settlement-verifier-policy-validation.test.mjs",
  "scripts/aws-kms-integration-check.mjs",
  "scripts/aws-kms-integration-check.test.mjs",
  "scripts/verify.sh",
  "Makefile",
  "package.json",
  "infra/docker/backend.Dockerfile",
  "docker-compose.yml",
  "infra/k8s/configmap.yaml",
  "infra/k8s/backend-secret.yaml",
  "infra/k8s/backend-deployment.yaml",
  "infra/k8s/backend-service-account.yaml",
  "infra/k8s/signer-secret.yaml",
  "infra/k8s/signer-deployment.yaml",
  "infra/k8s/signer-service-account.yaml",
  "infra/helm/rfq-market-maker/values.yaml",
  "infra/helm/rfq-market-maker/templates/deployment.yaml",
  "infra/helm/rfq-market-maker/templates/signer-deployment.yaml",
  "infra/helm/rfq-market-maker/templates/service-account.yaml",
  "docs/adr/ADR-0005-Use-KMS-For-Production-Signing.md",
  "docs/adr/ADR-0008-Use-Bounded-Signer-Overlap-For-Key-Rotation.md",
  "docs/security/key-management.md",
  "docs/security/threat-model.md",
  "docs/security/audit-checklist.md",
  "book/Volume1-SystemArchitecture/Chapter09-Architecture-Review.md",
  "book/Volume5-BackendEngineering/Chapter05-Signer-Service.md",
  "book/Volume7-ProductionDeployment/Chapter05-Runbook.md",
  "README.md",
];
const files = Object.fromEntries(await Promise.all(
  paths.map(async (path) => [path, await readFile(path, "utf8")]),
));
files["backend/src/main.ts"] = await readBackendGatewaySource();
const backendPackage = JSON.parse(files["backend/package.json"]);
const rootPackage = JSON.parse(files["package.json"]);

assert.equal(
  typeof backendPackage.dependencies?.["@aws-sdk/client-kms"],
  "string",
  "backend must depend on the official AWS KMS SDK",
);
assertContains("backend/src/modules/signer/aws-kms-signer.provider.ts", [
  "new SignCommand",
  'MessageType: "DIGEST"',
  'SigningAlgorithm: "ECDSA_SHA_256"',
  "digest.length !== 32",
  "output.Signature instanceof Uint8Array",
]);
assertContains("backend/src/modules/signer/kms-signer.service.ts", [
  "decodeDERSignature",
  "canonical short-form length",
  "non-canonical padding",
  "outside secp256k1 order",
  "SECP256K1N - s",
  "configured trusted signer",
  "assertSignature(matchingSignature)",
]);
assertContains("backend/src/modules/signer/signer.service.ts", [
  "hashQuoteTypedData",
  "recoverQuoteSigner",
  "hashQuoteSignature",
]);
assert.ok(
  !files["backend/src/modules/signer/kms-signer.service.ts"].includes("bootstrap") &&
    !files["backend/src/modules/signer/kms-signer.service.ts"].includes("firstRecoverable"),
  "KMS signer must never bootstrap trust from the first returned signature",
);
assertContains("backend/src/modules/signer/signer-runtime.ts", [
  'RFQ_SIGNER_MODE=local is not allowed when NODE_ENV=',
  'RFQ_SIGNER_PRIVATE_KEY must not be configured when RFQ_SIGNER_MODE=',
  'RFQ_SIGNER_MODE=external requires an injected signerService',
  'requireConfigured(keyIdValue, "RFQ_AWS_KMS_KEY_ID")',
  'requireConfigured(trustedSignerValue, "RFQ_TRUSTED_SIGNER_ADDRESS")',
  '"RFQ_TRUSTED_SIGNER_OVERLAP_ADDRESSES"',
  "must contain at most 4 addresses",
  'mode: "remote"',
  "RemoteSignerService",
]);
assertContains("backend/src/modules/signer/remote-signer.service.ts", [
  'this.requestBoundedJson("/internal/sign"',
  'path: "/internal/sign" | "/ready"',
  "new URL(path, this.baseUrl)",
  "authorization: `Bearer ${this.authToken}`",
  "readBoundedJson",
  "readBoundedJsonResponse",
  "cancelResponseBody",
  "requestBoundedJson",
  "maxResponseBytes = 1_024",
  "verifyQuoteSignature(input.quote, signature",
  "SIGNER_UNAVAILABLE",
  "assertAuthorizedSignQuoteInput",
]);
assert.ok(
  !files["backend/src/modules/signer/remote-signer.service.ts"].includes("response.text()"),
  "remote signer responses must be byte-bounded before complete buffering",
);
assertContains("backend/src/shared/http/bounded-json-response.ts", [
  "response.body.getReader()",
  "receivedBytes > maxBytes",
]);
assertContains("backend/test/remote-signer.test.mjs", [
  "cancels oversized response streams before complete buffering",
  "keeps stalled response bodies inside the request timeout",
  "cancels unused sign and readiness error bodies",
]);
assertContains("backend/src/modules/signer/signer-server.ts", [
  'server.post("/internal/sign"',
  "timingSafeEqual",
  "assertSigningEnvelope",
  "readinessCacheMs = 30_000",
  "rfq_signer_service_requests_total",
  "rfq_signer_service_audit_errors_total",
  "options.auditStore.append",
  "keccak256(signature)",
]);
assertContains("backend/src/modules/signer/signer-audit.store.ts", [
  "class PostgresSignerAuditStore",
  "INSERT INTO signer_audit_events",
  "FROM pg_attribute",
  "risk_decision_id",
  "risk_policy_version",
  "trace_id",
  "Signer audit success requires signatureHash",
]);
assertContains("backend/src/db/migrations/027-signer-audit.sql", [
  "CREATE TABLE signer_audit_events",
  "chk_signer_audit_signature_hash",
  "idx_signer_audit_quote",
]);
assertContains("backend/src/db/migrations/028-signer-risk-context.sql", [
  "ADD COLUMN context_version",
  "chk_signer_audit_risk_context",
  "idx_signer_audit_risk_decision",
]);
assertContains("backend/src/db/migrations/036-signer-audit-stream.sql", [
  "ADD COLUMN source_stream_id",
  "uq_signer_audit_source_stream_id",
]);
assertContains("backend/src/signer-main.ts", [
  "Signer process requires RFQ_SIGNER_MODE=local or aws-kms",
  "RFQ_SIGNER_TLS_CERT_PATH",
  "RFQ_SIGNER_TLS_KEY_PATH",
  "buildSignerServer",
  "createSignerAuditRuntime",
]);
assertContains("backend/src/modules/signer/signer-audit-runtime.ts", [
  "RFQ_SIGNER_AUDIT_BACKEND",
  "RFQ_SIGNER_AUDIT_DATABASE_URL",
  "RFQ_SIGNER_AUDIT_REDIS_URL",
  "PostgresSignerAuditStore",
  "RedisSignerAuditStore",
  "SignerAuditMirror",
]);
assertContains("backend/src/modules/settlement/settlement-verifier.service.ts", [
  "trustedSignerOverlapAddresses",
  "this.trustedSignerAddresses.has",
  "must contain at most 4 addresses",
]);
assertContains("backend/src/main.ts", [
  "readSignerRuntimeConfig",
  "createSignerRuntime",
  "buildDefaultSettlementVerifierPolicy(signerRuntimeConfig, managedRiskPairs)",
  "buildRuntimeSettlementEvidenceProvider(signerRuntimeConfig.settlementAddress)",
  "defaultSignerRuntime.close",
]);
assertContains("backend/src/modules/health/readiness.service.ts", [
  "signerProbeCacheMs = 30_000",
  "signerProbeInFlight",
  "this.signerStatusCache = { status, expiresAtMs:",
]);
assertContains("backend/test/kms-signer.test.mjs", [
  "canonicalizes high-s DER signatures",
  "fails closed when KMS signs with an unexpected key",
  "rejects malformed DER",
]);
assertContains("backend/test/aws-kms-signer-provider.test.mjs", [
  "fixed KMS signing parameters",
  'assert.equal(commands[0].input.MessageType, "DIGEST")',
]);
assertContains("backend/test/api-readiness.test.mjs", [
  "caches successful signer readiness probes",
  "coalesces concurrent signer readiness probes",
  "assert.equal(signerCalls, 1)",
]);
assertContains("backend/test/signer-runtime.test.mjs", [
  "requires AWS KMS or explicit injection outside local environments",
  "without private key material",
  "parses a bounded trusted signer overlap window",
  "rejects unsafe trusted signer overlap configuration",
]);
assertContains("backend/test/settlement-verifier.test.mjs", [
  "accepts an explicitly configured overlap signer",
  "trustedSignerOverlapAddresses.length = 0",
]);
assertContains("backend/test/settlement-verifier-policy-validation.test.mjs", [
  "trusted signer addresses must not contain duplicates",
  "must contain at most 4 addresses",
]);
assertContains("scripts/aws-kms-integration-check.mjs", [
  "RFQ_AWS_KMS_INTEGRATION_CONFIRM",
  "sign-eip712-digest",
  'NODE_ENV: "production"',
  'RFQ_SIGNER_MODE: "aws-kms"',
  "readSignerRuntimeConfig",
  "createSignerRuntime",
  "hashQuoteTypedData",
  "recoverQuoteSigner",
  "hashQuoteSignature",
  "runtime?.close?.()",
  "AWS KMS integration signing or recovery failed",
]);
assert.ok(
  !/^\s+signature,\s*$/m.test(files["scripts/aws-kms-integration-check.mjs"]),
  "AWS KMS integration result must not emit the raw signature",
);
assertContains("scripts/aws-kms-integration-check.test.mjs", [
  "uses production runtime config and independently recovers the trusted signer",
  "rejects missing acknowledgement and malformed quote inputs before runtime creation",
  "closes the runtime and redacts provider failure details",
  "rejects a valid signature from an unexpected key",
  "redacts runtime close failures",
]);
assertContains("Makefile", [
  "aws-kms-integration-check: backend-build",
  "aws-kms-canary-check: backend-build",
]);
assertContains("infra/docker/backend.Dockerfile", [
  "COPY scripts/aws-kms-integration-check.mjs scripts/aws-kms-integration-check.mjs",
]);
assert.equal(rootPackage.scripts?.["aws:kms:integration:check"], "make aws-kms-integration-check");
assert.equal(rootPackage.scripts?.["aws:kms:canary:check"], "make aws-kms-canary-check");
assertContains("scripts/verify.sh", ["run_step make aws-kms-canary-check"]);
assertContains("backend/test/signer-server.test.mjs", [
  "does not return a signature when durable audit fails",
  "readiness degrades when the audit store is unavailable",
]);
assertContains("backend/test/signer-audit-store.test.mjs", [
  "privacy-expanding event envelopes",
  "append-only table is absent",
]);
assertContains("docker-compose.yml", [
  "NODE_ENV: development",
  "RFQ_SIGNER_MODE: local",
  "RFQ_SIGNER_MODE: remote",
  "RFQ_SIGNER_SERVICE_ALLOW_INSECURE_HTTP",
  'RFQ_SIGNER_PRIVATE_KEY: "0x',
  'RFQ_TRUSTED_SIGNER_ADDRESS: "0x',
  'RFQ_SETTLEMENT_ADDRESS: "0x',
]);
assertContains("infra/k8s/configmap.yaml", [
  "RFQ_SIGNER_MODE: remote",
  "RFQ_SIGNER_SERVICE_URL: https://rfq-signer.rfq-market-maker.svc.cluster.local:3006",
]);
assertContains("infra/k8s/backend-secret.yaml", [
  "RFQ_SIGNER_SERVICE_TOKEN:",
  "ca.crt:",
  "RFQ_TRUSTED_SIGNER_ADDRESS:",
  "RFQ_SETTLEMENT_ADDRESS:",
]);
assert.ok(!files["infra/k8s/backend-secret.yaml"].includes("RFQ_AWS_KMS_KEY_ID"), "API Secret must not contain a KMS key id");
assertContains("infra/k8s/signer-secret.yaml", [
  "RFQ_AWS_KMS_KEY_ID:",
  "RFQ_SIGNER_SERVICE_TOKEN:",
  "tls.crt:",
  "tls.key:",
  "RFQ_SIGNER_AUDIT_DATABASE_URL:",
  "database-ca.crt:",
]);
for (const path of [
  "infra/k8s/backend-secret.yaml",
  "infra/helm/rfq-market-maker/templates/deployment.yaml",
]) {
  assert.ok(!files[path].includes("RFQ_SIGNER_PRIVATE_KEY"), `${path} must not mount a raw signer key`);
}
assertContains("infra/k8s/backend-deployment.yaml", ["serviceAccountName: rfq-backend", "NODE_EXTRA_CA_CERTS"]);
assert.ok(!files["infra/k8s/backend-deployment.yaml"].includes("RFQ_AWS_KMS_KEY_ID"), "API Deployment must not receive a KMS key id");
assertContains("infra/k8s/backend-service-account.yaml", [
  "kind: ServiceAccount",
  "name: rfq-backend",
]);
assert.ok(!files["infra/k8s/backend-service-account.yaml"].includes("eks.amazonaws.com/role-arn"), "API ServiceAccount must not have a KMS role");
assertContains("infra/k8s/signer-deployment.yaml", [
  "serviceAccountName: rfq-signer-kms",
  "RFQ_AWS_KMS_KEY_ID",
  "RFQ_SIGNER_TLS_CERT_PATH",
  "RFQ_SIGNER_AUDIT_BACKEND",
  "RFQ_SIGNER_AUDIT_DATABASE_URL",
  "RFQ_SIGNER_AUDIT_REDIS_URL",
]);
assertContains("infra/k8s/signer-service-account.yaml", [
  "kind: ServiceAccount",
  "eks.amazonaws.com/role-arn:",
]);
assertContains("infra/helm/rfq-market-maker/values.yaml", [
  "RFQ_SIGNER_MODE: remote",
  "signerService:",
  "kmsKeyIdKey: RFQ_AWS_KMS_KEY_ID",
  "trustedSignerAddressKey: RFQ_TRUSTED_SIGNER_ADDRESS",
  "auditDatabaseUrlKey: RFQ_SIGNER_AUDIT_DATABASE_URL",
  "auditRedisUrlKey: RFQ_SIGNER_AUDIT_REDIS_URL",
  "trustedSignerOverlapAddresses:",
  "key: RFQ_TRUSTED_SIGNER_OVERLAP_ADDRESSES",
]);
assertContains("infra/helm/rfq-market-maker/templates/service-account.yaml", [
  ".Values.signerService.serviceAccount.annotations",
]);
assert.ok(!files["infra/helm/rfq-market-maker/templates/deployment.yaml"].includes("RFQ_AWS_KMS_KEY_ID"), "Helm API Deployment must not receive a KMS key id");
assertContains("infra/helm/rfq-market-maker/templates/signer-deployment.yaml", [
  "value: aws-kms",
  "key: {{ .Values.signerService.secret.kmsKeyIdKey }}",
  "RFQ_SIGNER_TLS_CERT_PATH",
  "RFQ_SIGNER_AUDIT_DATABASE_URL",
  "RFQ_SIGNER_AUDIT_REDIS_URL",
]);
assertContains("docs/adr/ADR-0005-Use-KMS-For-Production-Signing.md", [
  "## Status",
  "Accepted",
  "ECC_SECG_P256K1",
  "MessageType=DIGEST",
  "RFQ_TRUSTED_SIGNER_ADDRESS",
]);
assertContains("README.md", [
  "RFQ_SIGNER_MODE=remote",
  "RFQ_SIGNER_MODE=aws-kms",
  "The API never receives a KMS key id",
  "DER decoding, low-s normalization and recovery remain fail-closed",
  "caches success for 30 seconds",
  "RFQ_TRUSTED_SIGNER_OVERLAP_ADDRESSES",
  "two-rollout procedure",
]);
assertContains("docs/adr/ADR-0008-Use-Bounded-Signer-Overlap-For-Key-Rotation.md", [
  "MAX_TRUSTED_SIGNERS",
  "at most four distinct non-zero addresses",
  "two backend rollouts",
]);
assertContains("docs/security/key-management.md", [
  "RFQSettlement.setTrustedSignerAuthorization(oldSigner, false)",
  "receipt-confirmation and indexer catch-up buffers",
  "make aws-kms-integration-check",
  "1 KiB pre-decode cap",
]);
assertContains("README.md", ["make aws-kms-integration-check", "make aws-kms-canary-check"]);
assertContains("book/Volume5-BackendEngineering/Chapter05-Signer-Service.md", [
  "make aws-kms-integration-check",
  "make aws-kms-canary-check",
]);
assertContains("book/Volume7-ProductionDeployment/Chapter05-Runbook.md", [
  "make aws-kms-integration-check",
  "node scripts/aws-kms-integration-check.mjs",
  "context-version-2 audit row",
]);
assertContains("book/Volume1-SystemArchitecture/Chapter09-Architecture-Review.md", [
  "AWS KMS signer identity canary",
]);
assertContains("docs/security/threat-model.md", [
  "Unverified KMS rollout identity or diagnostic leakage",
  "Oversized or stalled remote signer response",
]);
assertContains("docs/security/audit-checklist.md", [
  "target-workload AWS KMS canary",
  "1 KiB streaming pre-decode cap",
]);
assertContains("README.md", ["response streaming and JSON decoding inside `RFQ_SIGNER_SERVICE_REQUEST_TIMEOUT_MS`"]);

console.log("KMS signer consistency check passed: explicit trust root and workload identity");

function assertContains(path, needles) {
  for (const needle of needles) {
    assert.ok(files[path].includes(needle), `${path} must include ${needle}`);
  }
}
