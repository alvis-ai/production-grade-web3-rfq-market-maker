#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { readBackendGatewaySource } from "./lib/read-backend-gateway-source.mjs";

const paths = [
  "backend/package.json",
  "backend/src/main.ts",
  "backend/src/modules/health/readiness.service.ts",
  "backend/src/modules/signer/signer-runtime.ts",
  "backend/src/modules/signer/remote-signer.service.ts",
  "backend/src/modules/signer/signer-server.ts",
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
  "backend/test/signer-process-runtime.test.mjs",
  "backend/test/settlement-verifier.test.mjs",
  "backend/test/settlement-verifier-policy-validation.test.mjs",
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
  "README.md",
];
const files = Object.fromEntries(await Promise.all(
  paths.map(async (path) => [path, await readFile(path, "utf8")]),
));
files["backend/src/main.ts"] = await readBackendGatewaySource();
const backendPackage = JSON.parse(files["backend/package.json"]);

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
  'new URL("/internal/sign", this.baseUrl)',
  "authorization: `Bearer ${this.authToken}`",
  "readBoundedJson",
  "verifyQuoteSignature(input.quote, signature",
  "SIGNER_UNAVAILABLE",
]);
assertContains("backend/src/modules/signer/signer-server.ts", [
  'server.post("/internal/sign"',
  "timingSafeEqual",
  "assertSigningEnvelope",
  "readinessCacheMs = 30_000",
  "rfq_signer_service_requests_total",
]);
assertContains("backend/src/signer-main.ts", [
  "Signer process requires RFQ_SIGNER_MODE=local or aws-kms",
  "RFQ_SIGNER_TLS_CERT_PATH",
  "RFQ_SIGNER_TLS_KEY_PATH",
  "buildSignerServer",
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
assertContains("docker-compose.yml", [
  "NODE_ENV: development",
  "RFQ_SIGNER_MODE: local",
  "RFQ_SIGNER_MODE: remote",
  "RFQ_SIGNER_SERVICE_ALLOW_INSECURE_HTTP",
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
]);

console.log("KMS signer consistency check passed: explicit trust root and workload identity");

function assertContains(path, needles) {
  for (const needle of needles) {
    assert.ok(files[path].includes(needle), `${path} must include ${needle}`);
  }
}
