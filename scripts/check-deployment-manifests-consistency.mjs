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
const k8sIndexerDeployment = await readFile("infra/k8s/settlement-indexer-deployment.yaml", "utf8");
const k8sIndexerService = await readFile("infra/k8s/settlement-indexer-service.yaml", "utf8");
const k8sIndexerSecret = await readFile("infra/k8s/settlement-indexer-secret.yaml", "utf8");
const k8sIndexerNetworkPolicy = await readFile("infra/k8s/settlement-indexer-network-policy.yaml", "utf8");
const k8sToxicFlowAnalyzerDeployment = await readFile(
  "infra/k8s/toxic-flow-analyzer-deployment.yaml",
  "utf8",
);
const k8sToxicFlowAnalyzerService = await readFile(
  "infra/k8s/toxic-flow-analyzer-service.yaml",
  "utf8",
);
const k8sToxicFlowAnalyzerSecret = await readFile(
  "infra/k8s/toxic-flow-analyzer-secret.yaml",
  "utf8",
);
const k8sToxicFlowAnalyzerNetworkPolicy = await readFile(
  "infra/k8s/toxic-flow-analyzer-network-policy.yaml",
  "utf8",
);
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
const helmIndexerDeployment = await readFile(
  "infra/helm/rfq-market-maker/templates/settlement-indexer-deployment.yaml",
  "utf8",
);
const helmIndexerService = await readFile(
  "infra/helm/rfq-market-maker/templates/settlement-indexer-service.yaml",
  "utf8",
);
const helmIndexerNetworkPolicy = await readFile(
  "infra/helm/rfq-market-maker/templates/settlement-indexer-network-policy.yaml",
  "utf8",
);
const helmToxicFlowAnalyzerDeployment = await readFile(
  "infra/helm/rfq-market-maker/templates/toxic-flow-analyzer-deployment.yaml",
  "utf8",
);
const helmToxicFlowAnalyzerService = await readFile(
  "infra/helm/rfq-market-maker/templates/toxic-flow-analyzer-service.yaml",
  "utf8",
);
const helmToxicFlowAnalyzerNetworkPolicy = await readFile(
  "infra/helm/rfq-market-maker/templates/toxic-flow-analyzer-network-policy.yaml",
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
  'RFQ_SUBMIT_RESERVATION_LEASE_MS: "900000"',
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
  "RFQ_API_KEY_CONFIG_JSON:",
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
  "configMapRef:",
  "name: rfq-backend-config",
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

assertContains(k8sIndexerDeployment, [
  "kind: Deployment",
  "name: rfq-settlement-indexer",
  "replicas: 2",
  "initContainers:",
  'command: ["node", "backend/dist/db/migrate.js"]',
  'command: ["node", "backend/dist/settlement-indexer-main.js"]',
  "containerPort: 3004",
  "name: rfq-settlement-indexer-secrets",
  "path: /ready",
  "path: /health",
], "infra/k8s/settlement-indexer-deployment.yaml");
assertContains(k8sIndexerService, [
  "kind: Service",
  "name: rfq-settlement-indexer",
  'prometheus.io/scrape: "true"',
  'prometheus.io/port: "3004"',
  "port: 3004",
], "infra/k8s/settlement-indexer-service.yaml");
assertContains(k8sIndexerSecret, [
  "name: rfq-settlement-indexer-secrets",
  "DATABASE_URL:",
  "RFQ_SETTLEMENT_INDEXER_CONFIG_JSON:",
], "infra/k8s/settlement-indexer-secret.yaml");
for (const forbidden of [
  "RFQ_SIGNER_PRIVATE_KEY",
  "RFQ_AWS_KMS_KEY_ID",
  "RFQ_BINANCE_API_KEY",
  "RFQ_ANALYTICS_KAFKA_SASL_USERNAME",
]) {
  assert.ok(!k8sIndexerSecret.includes(forbidden), `settlement indexer Secret must not contain ${forbidden}`);
}
assertContains(k8sIndexerNetworkPolicy, [
  "kind: NetworkPolicy",
  "app.kubernetes.io/name: rfq-settlement-indexer",
  "- Ingress",
  "- Egress",
  "port: 3004",
  "port: 5432",
  "port: 443",
], "infra/k8s/settlement-indexer-network-policy.yaml");

assertContains(k8sToxicFlowAnalyzerDeployment, [
  "kind: Deployment",
  "name: rfq-toxic-flow-analyzer",
  "replicas: 2",
  "initContainers:",
  'command: ["node", "backend/dist/db/migrate.js"]',
  'command: ["node", "backend/dist/toxic-flow-analyzer-main.js"]',
  "containerPort: 3005",
  "name: rfq-toxic-flow-analyzer-secrets",
  "path: /ready",
  "path: /health",
], "infra/k8s/toxic-flow-analyzer-deployment.yaml");
assertContains(k8sToxicFlowAnalyzerService, [
  "kind: Service",
  "name: rfq-toxic-flow-analyzer",
  'prometheus.io/scrape: "true"',
  'prometheus.io/port: "3005"',
  "port: 3005",
], "infra/k8s/toxic-flow-analyzer-service.yaml");
assertContains(k8sToxicFlowAnalyzerSecret, [
  "name: rfq-toxic-flow-analyzer-secrets",
  "DATABASE_URL:",
], "infra/k8s/toxic-flow-analyzer-secret.yaml");
for (const forbidden of [
  "RFQ_SIGNER_PRIVATE_KEY",
  "RFQ_AWS_KMS_KEY_ID",
  "RFQ_BINANCE_API_KEY",
  "RFQ_ANALYTICS_KAFKA_SASL_USERNAME",
  "RFQ_SETTLEMENT_INDEXER_CONFIG_JSON",
]) {
  assert.ok(
    !k8sToxicFlowAnalyzerSecret.includes(forbidden),
    `toxic-flow analyzer Secret must not contain ${forbidden}`,
  );
}
assertContains(k8sToxicFlowAnalyzerNetworkPolicy, [
  "kind: NetworkPolicy",
  "app.kubernetes.io/name: rfq-toxic-flow-analyzer",
  "- Ingress",
  "- Egress",
  "port: 3005",
  "port: 5432",
], "infra/k8s/toxic-flow-analyzer-network-policy.yaml");
assert.ok(
  !k8sToxicFlowAnalyzerNetworkPolicy.includes("port: 443"),
  "toxic-flow analyzer must not receive public HTTPS egress",
);

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
  'RFQ_SUBMIT_RESERVATION_LEASE_MS: "900000"',
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
  "apiKeySecret:",
  "configKey: RFQ_API_KEY_CONFIG_JSON",
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
  "settlementIndexer:",
  "RFQ_SETTLEMENT_INDEXER_LEASE_MS:",
  "name: rfq-settlement-indexer-secrets",
  "configJsonKey: RFQ_SETTLEMENT_INDEXER_CONFIG_JSON",
  "toxicFlowAnalyzer:",
  "RFQ_TOXIC_FLOW_MARKOUT_HORIZON_SECONDS:",
  "RFQ_TOXIC_FLOW_MARKOUT_MAX_SNAPSHOT_LAG_SECONDS:",
  "RFQ_TOXIC_FLOW_SCORE_WINDOW_SECONDS:",
  "name: rfq-toxic-flow-analyzer-secrets",
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
  "name: RFQ_API_KEY_CONFIG_JSON",
  "name: {{ .Values.apiKeySecret.name }}",
  "key: {{ .Values.apiKeySecret.configKey }}",
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
  "name: RFQ_TOKEN_REGISTRY_JSON",
  "env.RFQ_TOKEN_REGISTRY_JSON is required for hedge route decimals",
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

assertContains(helmIndexerDeployment, [
  "{{- if .Values.settlementIndexer.enabled }}",
  "replicas: {{ .Values.settlementIndexer.replicaCount }}",
  "initContainers:",
  'command: ["node", "backend/dist/db/migrate.js"]',
  'command: ["node", "backend/dist/settlement-indexer-main.js"]',
  "key: {{ .Values.settlementIndexer.secret.databaseUrlKey }}",
  "key: {{ .Values.settlementIndexer.secret.configJsonKey }}",
  "path: /ready",
  "path: /health",
], "infra/helm/rfq-market-maker/templates/settlement-indexer-deployment.yaml");
assertContains(helmIndexerService, [
  "{{- if .Values.settlementIndexer.enabled }}",
  "with .Values.settlementIndexer.service.annotations",
  "port: {{ .Values.settlementIndexer.port }}",
], "infra/helm/rfq-market-maker/templates/settlement-indexer-service.yaml");
assertContains(helmIndexerNetworkPolicy, [
  ".Values.settlementIndexer.networkPolicy.enabled",
  "app.kubernetes.io/component: settlement-indexer",
  "port: 5432",
  "port: 443",
], "infra/helm/rfq-market-maker/templates/settlement-indexer-network-policy.yaml");

assertContains(helmToxicFlowAnalyzerDeployment, [
  "{{- if .Values.toxicFlowAnalyzer.enabled }}",
  "replicas: {{ .Values.toxicFlowAnalyzer.replicaCount }}",
  "initContainers:",
  'command: ["node", "backend/dist/db/migrate.js"]',
  'command: ["node", "backend/dist/toxic-flow-analyzer-main.js"]',
  "RFQ_TOKEN_REGISTRY_JSON",
  "env.RFQ_TOKEN_REGISTRY_JSON is required for toxic-flow markout decimals",
  "key: {{ .Values.toxicFlowAnalyzer.secret.databaseUrlKey }}",
  "path: /ready",
  "path: /health",
], "infra/helm/rfq-market-maker/templates/toxic-flow-analyzer-deployment.yaml");
assertContains(helmToxicFlowAnalyzerService, [
  "{{- if .Values.toxicFlowAnalyzer.enabled }}",
  "with .Values.toxicFlowAnalyzer.service.annotations",
  "port: {{ .Values.toxicFlowAnalyzer.port }}",
], "infra/helm/rfq-market-maker/templates/toxic-flow-analyzer-service.yaml");
assertContains(helmToxicFlowAnalyzerNetworkPolicy, [
  ".Values.toxicFlowAnalyzer.networkPolicy.enabled",
  "app.kubernetes.io/component: toxic-flow-analyzer",
  "port: 5432",
], "infra/helm/rfq-market-maker/templates/toxic-flow-analyzer-network-policy.yaml");
assert.ok(
  !helmToxicFlowAnalyzerNetworkPolicy.includes("port: 443"),
  "Helm toxic-flow analyzer must not receive public HTTPS egress",
);

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
  "`RFQ_API_KEY_CONFIG_JSON`",
  "`RFQ_SUBMIT_RESERVATION_LEASE_MS`",
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
  "`rfq-settlement-indexer`",
  "Migration 007",
  "Migration 008",
  "`rfq-reconciliation-worker`",
  "Migration 005",
  "Migration 006",
  "`rfq-toxic-flow-analyzer`",
  "Migration 021",
  "`RFQ_TOXIC_FLOW_MARKOUT_HORIZON_SECONDS`",
], "book/Volume7-ProductionDeployment/Chapter02-Kubernetes.md");

console.log("Deployment manifests consistency check passed");

function assertContains(source, needles, label) {
  for (const needle of needles) {
    assert.ok(source.includes(needle), `${label} must include ${needle}`);
  }
}
