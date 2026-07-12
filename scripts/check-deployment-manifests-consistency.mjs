#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const k8sDeployment = await readFile("infra/k8s/backend-deployment.yaml", "utf8");
const k8sService = await readFile("infra/k8s/backend-service.yaml", "utf8");
const k8sConfig = await readFile("infra/k8s/configmap.yaml", "utf8");
const k8sSecret = await readFile("infra/k8s/backend-secret.yaml", "utf8");
const k8sServiceAccount = await readFile("infra/k8s/backend-service-account.yaml", "utf8");
const k8sNetworkPolicy = await readFile("infra/k8s/network-policy.yaml", "utf8");
const k8sHedgeDeployment = await readFile("infra/k8s/hedge-worker-deployment.yaml", "utf8");
const k8sHedgeService = await readFile("infra/k8s/hedge-worker-service.yaml", "utf8");
const k8sHedgeSecret = await readFile("infra/k8s/hedge-worker-secret.yaml", "utf8");
const k8sHedgeNetworkPolicy = await readFile("infra/k8s/hedge-worker-network-policy.yaml", "utf8");
const k8sMigrationSecret = await readFile("infra/k8s/database-migration-secret.yaml", "utf8");
const k8sAnalyticsDeployment = await readFile("infra/k8s/analytics-worker-deployment.yaml", "utf8");
const k8sAnalyticsService = await readFile("infra/k8s/analytics-worker-service.yaml", "utf8");
const k8sAnalyticsSecret = await readFile("infra/k8s/analytics-worker-secret.yaml", "utf8");
const k8sAnalyticsNetworkPolicy = await readFile("infra/k8s/analytics-worker-network-policy.yaml", "utf8");
const k8sReconciliationDeployment = await readFile("infra/k8s/reconciliation-worker-deployment.yaml", "utf8");
const k8sReconciliationService = await readFile("infra/k8s/reconciliation-worker-service.yaml", "utf8");
const k8sReconciliationSecret = await readFile("infra/k8s/reconciliation-worker-secret.yaml", "utf8");
const k8sReconciliationNetworkPolicy = await readFile("infra/k8s/reconciliation-worker-network-policy.yaml", "utf8");
const helmValues = await readFile("infra/helm/rfq-market-maker/values.yaml", "utf8");
const helmDeployment = await readFile("infra/helm/rfq-market-maker/templates/deployment.yaml", "utf8");
const helmServiceAccount = await readFile("infra/helm/rfq-market-maker/templates/service-account.yaml", "utf8");
const helmService = await readFile("infra/helm/rfq-market-maker/templates/service.yaml", "utf8");
const helmHedgeDeployment = await readFile("infra/helm/rfq-market-maker/templates/hedge-worker-deployment.yaml", "utf8");
const helmHedgeService = await readFile("infra/helm/rfq-market-maker/templates/hedge-worker-service.yaml", "utf8");
const helmHedgeNetworkPolicy = await readFile("infra/helm/rfq-market-maker/templates/hedge-worker-network-policy.yaml", "utf8");
const helmAnalyticsDeployment = await readFile("infra/helm/rfq-market-maker/templates/analytics-worker-deployment.yaml", "utf8");
const helmAnalyticsService = await readFile("infra/helm/rfq-market-maker/templates/analytics-worker-service.yaml", "utf8");
const helmAnalyticsNetworkPolicy = await readFile("infra/helm/rfq-market-maker/templates/analytics-worker-network-policy.yaml", "utf8");
const helmReconciliationDeployment = await readFile(
  "infra/helm/rfq-market-maker/templates/reconciliation-worker-deployment.yaml",
  "utf8",
);
const helmReconciliationService = await readFile(
  "infra/helm/rfq-market-maker/templates/reconciliation-worker-service.yaml",
  "utf8",
);
const helmReconciliationNetworkPolicy = await readFile(
  "infra/helm/rfq-market-maker/templates/reconciliation-worker-network-policy.yaml",
  "utf8",
);
const kubernetesChapter = await readFile("book/Volume7-ProductionDeployment/Chapter02-Kubernetes.md", "utf8");

const expectedRuntime = {
  namespace: "rfq-market-maker",
  appName: "rfq-backend",
  replicas: "2",
  port: "3000",
  terminationGracePeriodSeconds: "30",
  preStopSleepSeconds: "5",
  cpuRequest: "100m",
  memoryRequest: "128Mi",
  cpuLimit: "500m",
  memoryLimit: "512Mi",
};

assertContains(k8sDeployment, [
  "kind: Deployment",
  `namespace: ${expectedRuntime.namespace}`,
  `app.kubernetes.io/name: ${expectedRuntime.appName}`,
  `replicas: ${expectedRuntime.replicas}`,
  `terminationGracePeriodSeconds: ${expectedRuntime.terminationGracePeriodSeconds}`,
  "serviceAccountName: rfq-backend-kms",
  "initContainers:",
  'command: ["node", "backend/dist/db/migrate.js"]',
  "name: rfq-database-migration-secrets",
  'command: ["sh", "-c", "sleep 5"]',
  "path: /ready",
  "path: /health",
  "secretRef:",
  "name: rfq-backend-secrets",
  "cpu: 100m",
  "memory: 128Mi",
  "cpu: 500m",
  "memory: 512Mi",
], "infra/k8s/backend-deployment.yaml");

assertContains(k8sServiceAccount, [
  "kind: ServiceAccount",
  "name: rfq-backend-kms",
  `namespace: ${expectedRuntime.namespace}`,
  "eks.amazonaws.com/role-arn: replace-with-kms-signing-role-arn",
], "infra/k8s/backend-service-account.yaml");

assertContains(k8sService, [
  "kind: Service",
  `namespace: ${expectedRuntime.namespace}`,
  "type: ClusterIP",
  'prometheus.io/scrape: "true"',
  "prometheus.io/path: /metrics",
  'prometheus.io/port: "3000"',
  "targetPort: http",
], "infra/k8s/backend-service.yaml");

assertContains(k8sConfig, [
  "kind: ConfigMap",
  `namespace: ${expectedRuntime.namespace}`,
  "NODE_ENV: production",
  'HOST: "0.0.0.0"',
  'PORT: "3000"',
  'RFQ_ENABLE_HSTS: "true"',
  'RFQ_TRUST_PROXY: "false"',
  "RFQ_RATE_LIMIT_BACKEND: redis",
  "RFQ_SIGNER_MODE: aws-kms",
  "RFQ_AWS_KMS_REGION: us-east-1",
  'RFQ_AWS_KMS_MAX_ATTEMPTS: "3"',
  "RFQ_TOKEN_REGISTRY_JSON:",
  "RFQ_RISK_POLICY_JSON:",
], "infra/k8s/configmap.yaml");

assertContains(k8sSecret, [
  "kind: Secret",
  `namespace: ${expectedRuntime.namespace}`,
  "type: Opaque",
  "RFQ_AWS_KMS_KEY_ID: alias/replace-with-production-kms-key",
  "RFQ_TRUSTED_SIGNER_ADDRESS: replace-with-kms-signer-address",
  "RFQ_SETTLEMENT_ADDRESS: replace-with-rfq-settlement-address",
  "RFQ_REDIS_URL: redis://replace-with-redis-service:6379/0",
  "DATABASE_URL: postgres://rfq-user:replace-with-password@postgres.example.com:5432/rfq_market_maker",
], "infra/k8s/backend-secret.yaml");
assert.ok(!k8sSecret.includes("RFQ_SIGNER_PRIVATE_KEY"), "backend Secret must not contain raw signer private keys");

assertContains(k8sNetworkPolicy, [
  "kind: NetworkPolicy",
  `namespace: ${expectedRuntime.namespace}`,
  `app.kubernetes.io/name: ${expectedRuntime.appName}`,
  "policyTypes:",
  "- Ingress",
  "port: 3000",
], "infra/k8s/network-policy.yaml");

assertContains(k8sHedgeDeployment, [
  "kind: Deployment",
  "name: rfq-hedge-worker",
  "replicas: 2",
  "initContainers:",
  'command: ["node", "backend/dist/db/migrate.js"]',
  "name: rfq-database-migration-secrets",
  'command: ["node", "backend/dist/hedge-worker-main.js"]',
  "containerPort: 3001",
  "name: rfq-hedge-worker-secrets",
  "path: /ready",
  "path: /health",
], "infra/k8s/hedge-worker-deployment.yaml");

assertContains(k8sHedgeService, [
  "kind: Service",
  "name: rfq-hedge-worker",
  'prometheus.io/scrape: "true"',
  'prometheus.io/port: "3001"',
  "port: 3001",
], "infra/k8s/hedge-worker-service.yaml");

assertContains(k8sHedgeSecret, [
  "name: rfq-hedge-worker-secrets",
  "DATABASE_URL:",
  "RFQ_BINANCE_API_KEY:",
  "RFQ_BINANCE_API_SECRET:",
], "infra/k8s/hedge-worker-secret.yaml");
for (const forbidden of ["RFQ_SIGNER_PRIVATE_KEY", "RFQ_AWS_KMS_KEY_ID"]) {
  assert.ok(!k8sHedgeSecret.includes(forbidden), `hedge worker Secret must not contain ${forbidden}`);
}
assertContains(k8sMigrationSecret, [
  "name: rfq-database-migration-secrets",
  "DATABASE_URL: postgres://rfq-migrator:",
], "infra/k8s/database-migration-secret.yaml");
assertContains(k8sHedgeNetworkPolicy, [
  "kind: NetworkPolicy",
  "app.kubernetes.io/name: rfq-hedge-worker",
  "- Ingress",
  "- Egress",
  "port: 3001",
  "port: 5432",
  "port: 443",
], "infra/k8s/hedge-worker-network-policy.yaml");

assertContains(k8sAnalyticsDeployment, [
  "kind: Deployment",
  "name: rfq-analytics-worker",
  "replicas: 2",
  "initContainers:",
  'command: ["node", "backend/dist/db/migrate.js"]',
  "name: rfq-database-migration-secrets",
  'command: ["node", "backend/dist/analytics-worker-main.js"]',
  "containerPort: 3002",
  "name: rfq-analytics-worker-secrets",
  "path: /ready",
  "path: /health",
], "infra/k8s/analytics-worker-deployment.yaml");
assertContains(k8sAnalyticsService, [
  "kind: Service",
  "name: rfq-analytics-worker",
  'prometheus.io/scrape: "true"',
  'prometheus.io/port: "3002"',
  "port: 3002",
], "infra/k8s/analytics-worker-service.yaml");
assertContains(k8sAnalyticsSecret, [
  "name: rfq-analytics-worker-secrets",
  "DATABASE_URL:",
  "RFQ_ANALYTICS_KAFKA_SASL_USERNAME:",
  "RFQ_ANALYTICS_KAFKA_SASL_PASSWORD:",
  "RFQ_CLICKHOUSE_USERNAME:",
  "RFQ_CLICKHOUSE_PASSWORD:",
], "infra/k8s/analytics-worker-secret.yaml");
for (const forbidden of ["RFQ_SIGNER_PRIVATE_KEY", "RFQ_AWS_KMS_KEY_ID"]) {
  assert.ok(!k8sAnalyticsSecret.includes(forbidden), `analytics Secret must not contain ${forbidden}`);
}
assert.ok(!k8sAnalyticsSecret.includes("RFQ_BINANCE_API_KEY"), "analytics Secret must not contain venue credentials");
assertContains(k8sAnalyticsNetworkPolicy, [
  "kind: NetworkPolicy",
  "app.kubernetes.io/name: rfq-analytics-worker",
  "- Ingress",
  "- Egress",
  "port: 3002",
  "port: 5432",
  "port: 9093",
  "port: 8443",
], "infra/k8s/analytics-worker-network-policy.yaml");

assertContains(k8sReconciliationDeployment, [
  "kind: Deployment",
  "name: rfq-reconciliation-worker",
  "replicas: 2",
  "initContainers:",
  'command: ["node", "backend/dist/db/migrate.js"]',
  'command: ["node", "backend/dist/reconciliation-worker-main.js"]',
  "containerPort: 3003",
  "name: rfq-reconciliation-worker-secrets",
  "path: /ready",
  "path: /health",
], "infra/k8s/reconciliation-worker-deployment.yaml");
assertContains(k8sReconciliationService, [
  "kind: Service",
  "name: rfq-reconciliation-worker",
  'prometheus.io/scrape: "true"',
  'prometheus.io/port: "3003"',
  "port: 3003",
], "infra/k8s/reconciliation-worker-service.yaml");
assertContains(k8sReconciliationSecret, [
  "name: rfq-reconciliation-worker-secrets",
  "DATABASE_URL:",
], "infra/k8s/reconciliation-worker-secret.yaml");
for (const forbidden of [
  "RFQ_SIGNER_PRIVATE_KEY",
  "RFQ_AWS_KMS_KEY_ID",
  "RFQ_BINANCE_API_KEY",
  "RFQ_ANALYTICS_KAFKA_SASL_USERNAME",
]) {
  assert.ok(!k8sReconciliationSecret.includes(forbidden), `reconciliation Secret must not contain ${forbidden}`);
}
assertContains(k8sReconciliationNetworkPolicy, [
  "kind: NetworkPolicy",
  "app.kubernetes.io/name: rfq-reconciliation-worker",
  "- Ingress",
  "- Egress",
  "port: 3003",
  "port: 5432",
], "infra/k8s/reconciliation-worker-network-policy.yaml");

assertContains(helmValues, [
  `replicaCount: ${expectedRuntime.replicas}`,
  `terminationGracePeriodSeconds: ${expectedRuntime.terminationGracePeriodSeconds}`,
  `preStopSleepSeconds: ${expectedRuntime.preStopSleepSeconds}`,
  "repository: ghcr.io/example/rfq-backend",
  "type: ClusterIP",
  'port: 3000',
  'prometheus.io/scrape: "true"',
  "prometheus.io/path: /metrics",
  'prometheus.io/port: "3000"',
  'RFQ_TRUST_PROXY: "false"',
  "RFQ_RATE_LIMIT_BACKEND: redis",
  "RFQ_SIGNER_MODE: aws-kms",
  "RFQ_AWS_KMS_REGION: us-east-1",
  'RFQ_AWS_KMS_MAX_ATTEMPTS: "3"',
  "RFQ_TOKEN_REGISTRY_JSON:",
  "RFQ_RISK_POLICY_JSON:",
  "name: rfq-backend-secrets",
  "kmsKeyIdKey: RFQ_AWS_KMS_KEY_ID",
  "trustedSignerAddressKey: RFQ_TRUSTED_SIGNER_ADDRESS",
  "settlementAddressKey: RFQ_SETTLEMENT_ADDRESS",
  "serviceAccount:",
  "name: rfq-backend-kms",
  "eks.amazonaws.com/role-arn: replace-with-kms-signing-role-arn",
  "redisSecret:",
  "urlKey: RFQ_REDIS_URL",
  "databaseSecret:",
  "urlKey: DATABASE_URL",
  "migrationSecret:",
  "name: rfq-database-migration-secrets",
  "hedgeWorker:",
  "RFQ_HEDGE_ROUTES_JSON:",
  "RFQ_BINANCE_REQUEST_TIMEOUT_MS:",
  "apiKeyKey: RFQ_BINANCE_API_KEY",
  "apiSecretKey: RFQ_BINANCE_API_SECRET",
  "networkPolicy:",
  "analyticsWorker:",
  "RFQ_ANALYTICS_KAFKA_BROKERS:",
  "RFQ_CLICKHOUSE_URL:",
  "kafkaUsernameKey: RFQ_ANALYTICS_KAFKA_SASL_USERNAME",
  "clickhousePasswordKey: RFQ_CLICKHOUSE_PASSWORD",
  "reconciliationWorker:",
  "RFQ_RECONCILIATION_LEASE_MS:",
  "name: rfq-reconciliation-worker-secrets",
  "cpu: 100m",
  "memory: 128Mi",
  "cpu: 500m",
  "memory: 512Mi",
], "infra/helm/rfq-market-maker/values.yaml");

assertContains(helmDeployment, [
  "replicas: {{ .Values.replicaCount }}",
  "terminationGracePeriodSeconds: {{ .Values.terminationGracePeriodSeconds }}",
  "serviceAccountName: {{ .Values.serviceAccount.name }}",
  "initContainers:",
  'command: ["node", "backend/dist/db/migrate.js"]',
  "name: {{ .Values.migrationSecret.name }}",
  "key: {{ .Values.migrationSecret.urlKey }}",
  'command: ["sh", "-c", "sleep {{ .Values.preStopSleepSeconds }}"]',
  "path: /ready",
  "path: /health",
  "secretKeyRef:",
  "key: {{ .Values.signerSecret.kmsKeyIdKey }}",
  "key: {{ .Values.signerSecret.trustedSignerAddressKey }}",
  "key: {{ .Values.signerSecret.settlementAddressKey }}",
  "name: RFQ_REDIS_URL",
  "key: {{ .Values.redisSecret.urlKey }}",
  "name: DATABASE_URL",
  "key: {{ .Values.databaseSecret.urlKey }}",
  "toYaml .Values.resources",
], "infra/helm/rfq-market-maker/templates/deployment.yaml");

assertContains(helmServiceAccount, [
  ".Values.serviceAccount.create",
  "kind: ServiceAccount",
  "name: {{ .Values.serviceAccount.name }}",
  "with .Values.serviceAccount.annotations",
], "infra/helm/rfq-market-maker/templates/service-account.yaml");

assertContains(helmService, [
  "type: {{ .Values.service.type }}",
  "annotations:",
  "toYaml .",
  "port: {{ .Values.service.port }}",
  "targetPort: http",
], "infra/helm/rfq-market-maker/templates/service.yaml");

assertContains(helmHedgeDeployment, [
  "{{- if .Values.hedgeWorker.enabled }}",
  "replicas: {{ .Values.hedgeWorker.replicaCount }}",
  "initContainers:",
  'command: ["node", "backend/dist/db/migrate.js"]',
  "name: {{ .Values.migrationSecret.name }}",
  "key: {{ .Values.migrationSecret.urlKey }}",
  'command: ["node", "backend/dist/hedge-worker-main.js"]',
  "key: {{ .Values.hedgeWorker.secret.databaseUrlKey }}",
  "key: {{ .Values.hedgeWorker.secret.apiKeyKey }}",
  "key: {{ .Values.hedgeWorker.secret.apiSecretKey }}",
  "path: /ready",
  "path: /health",
], "infra/helm/rfq-market-maker/templates/hedge-worker-deployment.yaml");

assertContains(helmHedgeService, [
  "{{- if .Values.hedgeWorker.enabled }}",
  "with .Values.hedgeWorker.service.annotations",
  "toYaml .",
  "port: {{ .Values.hedgeWorker.port }}",
], "infra/helm/rfq-market-maker/templates/hedge-worker-service.yaml");

assertContains(helmHedgeNetworkPolicy, [
  ".Values.hedgeWorker.networkPolicy.enabled",
  "kind: NetworkPolicy",
  "app.kubernetes.io/component: hedge-worker",
  "port: 5432",
  "port: 443",
], "infra/helm/rfq-market-maker/templates/hedge-worker-network-policy.yaml");

assertContains(helmAnalyticsDeployment, [
  "{{- if .Values.analyticsWorker.enabled }}",
  "replicas: {{ .Values.analyticsWorker.replicaCount }}",
  "initContainers:",
  'command: ["node", "backend/dist/db/migrate.js"]',
  "name: {{ .Values.migrationSecret.name }}",
  'command: ["node", "backend/dist/analytics-worker-main.js"]',
  "key: {{ .Values.analyticsWorker.secret.databaseUrlKey }}",
  "key: {{ .Values.analyticsWorker.secret.kafkaUsernameKey }}",
  "key: {{ .Values.analyticsWorker.secret.clickhousePasswordKey }}",
  "path: /ready",
  "path: /health",
], "infra/helm/rfq-market-maker/templates/analytics-worker-deployment.yaml");
assertContains(helmAnalyticsService, [
  "{{- if .Values.analyticsWorker.enabled }}",
  "with .Values.analyticsWorker.service.annotations",
  "port: {{ .Values.analyticsWorker.port }}",
], "infra/helm/rfq-market-maker/templates/analytics-worker-service.yaml");
assertContains(helmAnalyticsNetworkPolicy, [
  ".Values.analyticsWorker.networkPolicy.enabled",
  "app.kubernetes.io/component: analytics-worker",
  "port: 5432",
  "port: 9093",
  "port: 8443",
], "infra/helm/rfq-market-maker/templates/analytics-worker-network-policy.yaml");

assertContains(helmReconciliationDeployment, [
  "{{- if .Values.reconciliationWorker.enabled }}",
  "replicas: {{ .Values.reconciliationWorker.replicaCount }}",
  "initContainers:",
  'command: ["node", "backend/dist/db/migrate.js"]',
  'command: ["node", "backend/dist/reconciliation-worker-main.js"]',
  "RFQ_TOKEN_REGISTRY_JSON",
  "env.RFQ_TOKEN_REGISTRY_JSON is required for reconciliation PnL",
  "key: {{ .Values.reconciliationWorker.secret.databaseUrlKey }}",
  "path: /ready",
  "path: /health",
], "infra/helm/rfq-market-maker/templates/reconciliation-worker-deployment.yaml");
assertContains(helmReconciliationService, [
  "{{- if .Values.reconciliationWorker.enabled }}",
  "with .Values.reconciliationWorker.service.annotations",
  "port: {{ .Values.reconciliationWorker.port }}",
], "infra/helm/rfq-market-maker/templates/reconciliation-worker-service.yaml");
assertContains(helmReconciliationNetworkPolicy, [
  ".Values.reconciliationWorker.networkPolicy.enabled",
  "app.kubernetes.io/component: reconciliation-worker",
  "port: 5432",
], "infra/helm/rfq-market-maker/templates/reconciliation-worker-network-policy.yaml");

assertContains(kubernetesChapter, [
  "`terminationGracePeriodSeconds=30`",
  "preStop` sleep of 5 seconds",
  "Readiness 使用 `/ready`",
  "liveness 使用 `/health`",
  "`RFQ_SIGNER_MODE=aws-kms`",
  "`RFQ_AWS_KMS_KEY_ID`",
  "`RFQ_TRUSTED_SIGNER_ADDRESS`",
  "`RFQ_SETTLEMENT_ADDRESS`",
  "`RFQ_REDIS_URL`",
  "`DATABASE_URL`",
  "`RFQ_TOKEN_REGISTRY_JSON`",
  "`RFQ_RISK_POLICY_JSON`",
  "`rateLimitStore`",
  "Resource request/limit",
  "NetworkPolicy",
  "`rfq-hedge-worker-secrets`",
  "`FOR UPDATE SKIP LOCKED`",
  "`rfq-analytics-worker-secrets`",
  "`rfq.analytics.v1`",
  "`005-post-trade-reconciliation.sql`",
  "`006-quote-snapshot-pnl.sql`",
  "`rfq-reconciliation-worker`",
  "Migration 005",
  "Migration 006",
], "book/Volume7-ProductionDeployment/Chapter02-Kubernetes.md");

console.log("Deployment manifests consistency check passed");

function assertContains(source, needles, label) {
  for (const needle of needles) {
    assert.ok(source.includes(needle), `${label} must include ${needle}`);
  }
}
