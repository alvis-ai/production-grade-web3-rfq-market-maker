#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { readBackendGatewaySource } from "./lib/read-backend-gateway-source.mjs";
import { readBackendMetricsSource } from "./lib/read-backend-metrics-source.mjs";
import { readSdkClientSource } from "./lib/read-sdk-client-source.mjs";

const [
  authSource,
  mainSource,
  metricsSource,
  backendTestSource,
  sdkSource,
  sdkTestSource,
  openapiSource,
  errorsSource,
  envSource,
  k8sSecretSource,
  helmValuesSource,
  helmDeploymentSource,
  keyManagementSource,
  principalIsolationTestSource,
  threatModelSource,
] = await Promise.all([
  readFile("backend/src/modules/auth/api-key-auth.service.ts", "utf8"),
  readBackendGatewaySource(),
  readBackendMetricsSource(),
  readFile("backend/test/api-auth-runtime.test.mjs", "utf8"),
  readSdkClientSource(),
  readFile("sdk/test/sdk-client-config.test.mjs", "utf8"),
  readFile("docs/api/openapi.yaml", "utf8"),
  readFile("docs/api/errors.md", "utf8"),
  readFile(".env.example", "utf8"),
  readFile("infra/k8s/backend-secret.yaml", "utf8"),
  readFile("infra/helm/rfq-market-maker/values.yaml", "utf8"),
  readFile("infra/helm/rfq-market-maker/templates/deployment.yaml", "utf8"),
  readFile("docs/security/key-management.md", "utf8"),
  readFile("backend/test/api-principal-isolation.test.mjs", "utf8"),
  readFile("docs/security/threat-model.md", "utf8"),
]);

for (const scope of ["quote:write", "submit:write", "status:read", "pnl:read", "admin:read", "admin:write"]) {
  assert.ok(authSource.includes(`"${scope}"`), `backend auth service must define ${scope}`);
  assert.ok(openapiSource.includes(`x-required-scope: ${scope}`), `OpenAPI must map ${scope} to an operation`);
  assert.ok(keyManagementSource.includes(`\`${scope}\``), `key management must document ${scope}`);
}

for (const control of [
  'createHash("sha256")',
  "timingSafeEqual",
  "dummyDigest",
  "secretSha256",
  "expiresAtMs",
  "keySecretPattern",
  "assertApiKeyAuthResult",
]) {
  assert.ok(authSource.includes(control), `API key authenticator must enforce ${control}`);
}

for (const runtimeControl of [
  "RFQ_API_KEY_CONFIG_JSON is required when NODE_ENV=",
  'throw new APIError("AUTHENTICATION_REQUIRED"',
  'throw new APIError("AUTHORIZATION_DENIED"',
  'return "quote:write"',
  'return "submit:write"',
  'return "status:read"',
  'return "pnl:read"',
  'return "admin:read"',
  'return "admin:write"',
  "api-key:${principal.keyId.toLowerCase()}",
  'request.headers["x-api-key"]',
]) {
  assert.ok(mainSource.includes(runtimeControl), `backend runtime must enforce ${runtimeControl}`);
}

assert.ok(
  mainSource.includes('access-control-allow-headers", "content-type,idempotency-key,x-api-key,x-trace-id"'),
  "CORS must allow idempotency and API-key headers for approved origins",
);
assert.ok(
  metricsSource.includes("rfq_api_auth_rejections_total") &&
    metricsSource.includes('"missing"') &&
    metricsSource.includes('"scope_denied"'),
  "metrics must expose bounded authentication rejection reasons",
);

for (const testCase of [
  "protects business routes while leaving probes and metrics public",
  "uses authenticated key identity for distributed rate-limit decisions",
  "requires API key auth configuration or an injected authenticator",
  "CORS contract permits the API key request header",
]) {
  assert.ok(backendTestSource.includes(testCase), `backend auth tests must cover ${testCase}`);
}

assert.ok(
  sdkSource.includes('readonly apiKey?: string | RFQClientApiKeyProvider') &&
    sdkSource.includes('{ "x-api-key": apiKey }') &&
    sdkSource.includes("this.requestInit({}, false)"),
  "SDK must support rotating API keys and omit them from public probes",
);
assert.ok(
  sdkTestSource.includes("sends API keys only to protected endpoints") &&
    sdkTestSource.includes("without evaluating them for public probes"),
  "SDK tests must cover API-key header isolation and rotation",
);

for (const openapiControl of [
  "security:\n  - ApiKeyAuth: []",
  "securitySchemes:",
  "type: apiKey",
  "in: header",
  "name: x-api-key",
  "AUTHENTICATION_REQUIRED",
  "AUTHORIZATION_DENIED",
]) {
  assert.ok(openapiSource.includes(openapiControl), `OpenAPI must define ${openapiControl}`);
}
assert.equal(
  [...openapiSource.matchAll(/^      security: \[\]$/gm)].length,
  3,
  "Only health, readiness, and metrics operations should override API-key security",
);
assert.ok(errorsSource.includes("常量时间摘要比较"), "API error docs must define constant-time auth behavior");
assert.ok(
  mainSource.includes("principal?.principalId ?? localPrincipalId") &&
    mainSource.includes("requireQuoteOwnership") &&
    mainSource.includes("findPrincipalId") &&
    mainSource.includes("pnlService.summary(principal"),
  "gateway must scope quote and post-trade resources by authenticated principal",
);
for (const testCase of [
  "stable principal",
  "institution_a_rotated",
  "QUOTE_NOT_FOUND",
  "SETTLEMENT_EVENT_NOT_FOUND",
  "HEDGE_NOT_FOUND",
  "foreignPnl.body.totalTrades, 0",
]) {
  assert.ok(principalIsolationTestSource.includes(testCase), `principal isolation tests must cover ${testCase}`);
}
assert.ok(
  openapiSource.includes("cross-principal") &&
    errorsSource.includes("避免 IDOR") &&
    threatModelSource.includes("Cross-tenant IDOR"),
  "API and threat-model docs must define anti-enumeration tenant isolation",
);

for (const source of [envSource, k8sSecretSource, helmValuesSource, helmDeploymentSource]) {
  assert.ok(source.includes("RFQ_API_KEY_CONFIG_JSON"), "all configuration surfaces must carry API-key digest config");
}
assert.ok(helmValuesSource.includes("apiKeySecret:"), "Helm values must expose a dedicated API-key Secret reference");
assert.ok(
  helmDeploymentSource.includes("name: {{ .Values.apiKeySecret.name }}") &&
    helmDeploymentSource.includes("key: {{ .Values.apiKeySecret.configKey }}"),
  "Helm deployment must inject API-key config from Secret",
);

console.log("API authentication consistency check passed");
