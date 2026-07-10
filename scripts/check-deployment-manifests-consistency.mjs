#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const k8sDeployment = await readFile("infra/k8s/backend-deployment.yaml", "utf8");
const k8sService = await readFile("infra/k8s/backend-service.yaml", "utf8");
const k8sConfig = await readFile("infra/k8s/configmap.yaml", "utf8");
const k8sSecret = await readFile("infra/k8s/backend-secret.yaml", "utf8");
const k8sNetworkPolicy = await readFile("infra/k8s/network-policy.yaml", "utf8");
const helmValues = await readFile("infra/helm/rfq-market-maker/values.yaml", "utf8");
const helmDeployment = await readFile("infra/helm/rfq-market-maker/templates/deployment.yaml", "utf8");
const helmService = await readFile("infra/helm/rfq-market-maker/templates/service.yaml", "utf8");
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
], "infra/k8s/configmap.yaml");

assertContains(k8sSecret, [
  "kind: Secret",
  `namespace: ${expectedRuntime.namespace}`,
  "type: Opaque",
  "RFQ_SIGNER_PRIVATE_KEY: replace-with-production-signer-private-key",
  "RFQ_SETTLEMENT_ADDRESS: replace-with-rfq-settlement-address",
  "RFQ_REDIS_URL: redis://replace-with-redis-service:6379/0",
], "infra/k8s/backend-secret.yaml");

assertContains(k8sNetworkPolicy, [
  "kind: NetworkPolicy",
  `namespace: ${expectedRuntime.namespace}`,
  `app.kubernetes.io/name: ${expectedRuntime.appName}`,
  "policyTypes:",
  "- Ingress",
  "port: 3000",
], "infra/k8s/network-policy.yaml");

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
  "name: rfq-backend-secrets",
  "privateKeyKey: RFQ_SIGNER_PRIVATE_KEY",
  "settlementAddressKey: RFQ_SETTLEMENT_ADDRESS",
  "redisSecret:",
  "urlKey: RFQ_REDIS_URL",
  "cpu: 100m",
  "memory: 128Mi",
  "cpu: 500m",
  "memory: 512Mi",
], "infra/helm/rfq-market-maker/values.yaml");

assertContains(helmDeployment, [
  "replicas: {{ .Values.replicaCount }}",
  "terminationGracePeriodSeconds: {{ .Values.terminationGracePeriodSeconds }}",
  'command: ["sh", "-c", "sleep {{ .Values.preStopSleepSeconds }}"]',
  "path: /ready",
  "path: /health",
  "secretKeyRef:",
  "key: {{ .Values.signerSecret.privateKeyKey }}",
  "key: {{ .Values.signerSecret.settlementAddressKey }}",
  "name: RFQ_REDIS_URL",
  "key: {{ .Values.redisSecret.urlKey }}",
  "toYaml .Values.resources",
], "infra/helm/rfq-market-maker/templates/deployment.yaml");

assertContains(helmService, [
  "type: {{ .Values.service.type }}",
  "annotations:",
  "toYaml .",
  "port: {{ .Values.service.port }}",
  "targetPort: http",
], "infra/helm/rfq-market-maker/templates/service.yaml");

assertContains(kubernetesChapter, [
  "`terminationGracePeriodSeconds=30`",
  "preStop` sleep of 5 seconds",
  "Readiness 使用 `/ready`",
  "liveness 使用 `/health`",
  "`RFQ_SIGNER_PRIVATE_KEY`",
  "`RFQ_SETTLEMENT_ADDRESS`",
  "`RFQ_REDIS_URL`",
  "`rateLimitStore`",
  "Resource request/limit",
  "NetworkPolicy",
], "book/Volume7-ProductionDeployment/Chapter02-Kubernetes.md");

console.log("Deployment manifests consistency check passed");

function assertContains(source, needles, label) {
  for (const needle of needles) {
    assert.ok(source.includes(needle), `${label} must include ${needle}`);
  }
}
