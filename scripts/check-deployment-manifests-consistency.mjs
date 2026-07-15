#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const backendDockerfile = await readFile("infra/docker/backend.Dockerfile", "utf8");
const frontendDockerfile = await readFile("infra/docker/frontend.Dockerfile", "utf8");
const frontendNginxConfig = await readFile("infra/docker/nginx.conf", "utf8");
const dockerCompose = await readFile("docker-compose.yml", "utf8");
const k8sDeployment = await readFile("infra/k8s/backend-deployment.yaml", "utf8");
const k8sService = await readFile("infra/k8s/backend-service.yaml", "utf8");
const k8sConfig = await readFile("infra/k8s/configmap.yaml", "utf8");
const k8sSecret = await readFile("infra/k8s/backend-secret.yaml", "utf8");
const k8sServiceAccount = await readFile("infra/k8s/backend-service-account.yaml", "utf8");
const k8sNetworkPolicy = await readFile("infra/k8s/network-policy.yaml", "utf8");
const k8sHorizontalPodAutoscaler = await readFile(
  "infra/k8s/backend-horizontal-pod-autoscaler.yaml",
  "utf8",
);
const k8sPodDisruptionBudgets = await readFile(
  "infra/k8s/pod-disruption-budgets.yaml",
  "utf8",
);
const k8sCiliumFqdnEgressPolicy = await readFile(
  "infra/k8s/cilium-fqdn-egress-policy.yaml",
  "utf8",
);
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
const helmChart = await readFile("infra/helm/rfq-market-maker/Chart.yaml", "utf8");
const helmHelpers = await readFile("infra/helm/rfq-market-maker/templates/_helpers.tpl", "utf8");
const helmValuesSchema = JSON.parse(
  await readFile("infra/helm/rfq-market-maker/values.schema.json", "utf8"),
);
const helmDeployment = await readFile("infra/helm/rfq-market-maker/templates/deployment.yaml", "utf8");
const helmNetworkPolicy = await readFile(
  "infra/helm/rfq-market-maker/templates/network-policy.yaml",
  "utf8",
);
const helmCiliumFqdnEgressPolicy = await readFile(
  "infra/helm/rfq-market-maker/templates/cilium-fqdn-egress-policy.yaml",
  "utf8",
);
const helmServiceAccount = await readFile("infra/helm/rfq-market-maker/templates/service-account.yaml", "utf8");
const helmService = await readFile("infra/helm/rfq-market-maker/templates/service.yaml", "utf8");
const helmHorizontalPodAutoscaler = await readFile(
  "infra/helm/rfq-market-maker/templates/horizontal-pod-autoscaler.yaml",
  "utf8",
);
const helmPodDisruptionBudgets = await readFile(
  "infra/helm/rfq-market-maker/templates/pod-disruption-budgets.yaml",
  "utf8",
);
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

assertContains(backendDockerfile, [
  "FROM node:22-alpine AS runtime",
  "EXPOSE 3000 3001 3002 3003 3004 3005",
  "USER node",
  'CMD ["node", "backend/dist/main.js"]',
], "infra/docker/backend.Dockerfile");
assertContains(frontendDockerfile, [
  "FROM nginx:1.27-alpine AS runtime",
  "COPY infra/docker/nginx.conf /etc/nginx/nginx.conf",
  "apk add --no-cache python3 make g++",
  "ENV npm_config_nodedir=/usr/local",
  "--mount=type=cache,id=rfq-frontend-pnpm",
  "EXPOSE 8080",
  "http://127.0.0.1:8080/",
  "USER nginx",
], "infra/docker/frontend.Dockerfile");
assertContains(frontendNginxConfig, [
  "pid /tmp/nginx.pid;",
  "client_body_temp_path /tmp/client_temp;",
  "proxy_temp_path /tmp/proxy_temp;",
  "listen 8080;",
  "try_files $uri $uri/ /index.html;",
], "infra/docker/nginx.conf");
assert.ok(dockerCompose.includes('- "5173:8080"'), "frontend compose port must target rootless Nginx 8080");
assert.ok(!dockerCompose.includes('- "5173:80"'), "frontend compose must not target privileged port 80");
assert.ok(
  helmChart.includes('kubeVersion: ">=1.31.0-0"'),
  "Helm chart must reject clusters older than the stable topology/PDB feature baseline",
);

assertContains(k8sHorizontalPodAutoscaler, [
  "apiVersion: autoscaling/v2",
  "kind: HorizontalPodAutoscaler",
  "name: rfq-backend",
  "minReplicas: 2",
  "maxReplicas: 10",
  "stabilizationWindowSeconds: 300",
  "value: 25",
  "averageUtilization: 70",
], "raw API HorizontalPodAutoscaler");
assert.equal(
  countOccurrences(k8sHorizontalPodAutoscaler, "scaleTargetRef:"),
  1,
  "raw manifests must autoscale only the API Deployment",
);

assert.equal(
  countOccurrences(k8sPodDisruptionBudgets, "kind: PodDisruptionBudget"),
  6,
  "raw manifests must define one PodDisruptionBudget per workload",
);
assert.equal(
  countOccurrences(k8sPodDisruptionBudgets, "maxUnavailable: 1"),
  6,
  "every raw PodDisruptionBudget must permit at most one unavailable replica",
);
assert.equal(
  countOccurrences(k8sPodDisruptionBudgets, "unhealthyPodEvictionPolicy: AlwaysAllow"),
  6,
  "every raw PodDisruptionBudget must permit unhealthy Pod eviction",
);
for (const workloadName of [
  "rfq-backend",
  "rfq-hedge-worker",
  "rfq-analytics-worker",
  "rfq-reconciliation-worker",
  "rfq-settlement-indexer",
  "rfq-toxic-flow-analyzer",
]) {
  assert.ok(
    countOccurrences(k8sPodDisruptionBudgets, `app.kubernetes.io/name: ${workloadName}`) === 1,
    `raw PodDisruptionBudget must select exactly ${workloadName}`,
  );
}

assertContains(helmHorizontalPodAutoscaler, [
  "{{- if .Values.autoscaling.enabled }}",
  "apiVersion: autoscaling/v2",
  "kind: HorizontalPodAutoscaler",
  "name: {{ include \"rfq-market-maker.fullname\" . }}",
  "minReplicas: {{ .Values.autoscaling.minReplicas }}",
  "maxReplicas: {{ .Values.autoscaling.maxReplicas }}",
  "toYaml .Values.autoscaling.behavior",
  "averageUtilization: {{ .Values.autoscaling.targetCPUUtilizationPercentage }}",
  "autoscaling.minReplicas must not exceed autoscaling.maxReplicas",
  "replicaCount must be within the autoscaling minReplicas/maxReplicas range",
], "Helm API HorizontalPodAutoscaler");
assert.equal(
  countOccurrences(helmPodDisruptionBudgets, "kind: PodDisruptionBudget"),
  6,
  "Helm must template one PodDisruptionBudget per workload",
);
assert.equal(
  countOccurrences(helmPodDisruptionBudgets, ".Values.disruptionBudget.maxUnavailable"),
  6,
  "every Helm PodDisruptionBudget must use the reviewed unavailable bound",
);
assert.equal(
  countOccurrences(helmPodDisruptionBudgets, ".Values.disruptionBudget.unhealthyPodEvictionPolicy"),
  6,
  "every Helm PodDisruptionBudget must use the reviewed unhealthy eviction policy",
);
for (const component of [
  "api",
  "hedge-worker",
  "analytics-worker",
  "reconciliation-worker",
  "settlement-indexer",
  "toxic-flow-analyzer",
]) {
  assert.equal(
    countOccurrences(helmPodDisruptionBudgets, `app.kubernetes.io/component: ${component}`),
    2,
    `Helm PodDisruptionBudget must label and select only ${component}`,
  );
}

for (const [label, source] of [
  ["backend", k8sDeployment],
  ["hedge worker", k8sHedgeDeployment],
  ["analytics worker", k8sAnalyticsDeployment],
  ["reconciliation worker", k8sReconciliationDeployment],
  ["settlement indexer", k8sIndexerDeployment],
  ["toxic-flow analyzer", k8sToxicFlowAnalyzerDeployment],
]) {
  assert.ok(!source.includes(":latest"), `${label} manifest must not use a mutable latest tag`);
  const digestImages = source.match(/image:\s+\S+@sha256:[0-9a-f]{64}/g) ?? [];
  assert.equal(digestImages.length, 2, `${label} manifest must pin both containers by valid digest`);
  assertContains(source, [
    "runAsNonRoot: true",
    "runAsUser: 1000",
    "runAsGroup: 1000",
    "fsGroup: 1000",
    "fsGroupChangePolicy: OnRootMismatch",
    "type: RuntimeDefault",
    "sizeLimit: 16Mi",
  ], `${label} raw Deployment pod security`);
  assert.equal(
    countOccurrences(source, "allowPrivilegeEscalation: false"),
    2,
    `${label} raw Deployment must disable privilege escalation for init and runtime containers`,
  );
  assert.equal(
    countOccurrences(source, "readOnlyRootFilesystem: true"),
    2,
    `${label} raw Deployment must make init and runtime root filesystems read-only`,
  );
  assert.equal(
    countOccurrences(source, 'drop: ["ALL"]'),
    2,
    `${label} raw Deployment must drop every Linux capability`,
  );
  assert.equal(
    countOccurrences(source, "mountPath: /tmp"),
    2,
    `${label} raw Deployment must expose only bounded temporary storage to both containers`,
  );
}

for (const [label, workloadName, source] of [
  ["backend", "rfq-backend", k8sDeployment],
  ["hedge worker", "rfq-hedge-worker", k8sHedgeDeployment],
  ["analytics worker", "rfq-analytics-worker", k8sAnalyticsDeployment],
  ["reconciliation worker", "rfq-reconciliation-worker", k8sReconciliationDeployment],
  ["settlement indexer", "rfq-settlement-indexer", k8sIndexerDeployment],
  ["toxic-flow analyzer", "rfq-toxic-flow-analyzer", k8sToxicFlowAnalyzerDeployment],
]) {
  assert.equal(
    countOccurrences(source, "topologySpreadConstraints:"),
    1,
    `${label} raw Deployment must define one topology-spread list`,
  );
  assert.equal(countOccurrences(source, "maxSkew: 1"), 2, `${label} must bound node and zone skew`);
  assert.equal(countOccurrences(source, "minDomains: 2"), 2, `${label} must require two failure domains`);
  assert.equal(
    countOccurrences(source, "whenUnsatisfiable: DoNotSchedule"),
    2,
    `${label} must fail closed when node or zone spreading is impossible`,
  );
  assert.equal(
    countOccurrences(source, "topologyKey: kubernetes.io/hostname"),
    1,
    `${label} must spread replicas across nodes`,
  );
  assert.equal(
    countOccurrences(source, "topologyKey: topology.kubernetes.io/zone"),
    1,
    `${label} must spread replicas across zones`,
  );
  assert.equal(
    countOccurrences(source, `app.kubernetes.io/name: ${workloadName}`),
    5,
    `${label} topology selectors must match the owning Deployment labels`,
  );
}
assert.ok(
  k8sDeployment.includes("automountServiceAccountToken: false"),
  "backend must not receive the default Kubernetes API token",
);
for (const [label, source] of [
  ["hedge worker", k8sHedgeDeployment],
  ["analytics worker", k8sAnalyticsDeployment],
  ["reconciliation worker", k8sReconciliationDeployment],
  ["settlement indexer", k8sIndexerDeployment],
  ["toxic-flow analyzer", k8sToxicFlowAnalyzerDeployment],
]) {
  assert.ok(
    source.includes("automountServiceAccountToken: false"),
    `${label} must not receive a Kubernetes ServiceAccount token`,
  );
}

for (const [label, component, source] of [
  ["backend", "api", helmDeployment],
  ["hedge worker", "hedge-worker", helmHedgeDeployment],
  ["analytics worker", "analytics-worker", helmAnalyticsDeployment],
  ["reconciliation worker", "reconciliation-worker", helmReconciliationDeployment],
  ["settlement indexer", "settlement-indexer", helmIndexerDeployment],
  ["toxic-flow analyzer", "toxic-flow-analyzer", helmToxicFlowAnalyzerDeployment],
]) {
  assert.equal(
    countOccurrences(
      source,
      `include "rfq-market-maker.topologySpreadConstraints" (list . "${component}")`,
    ),
    1,
    `Helm ${label} Deployment must render topology selectors for its own component`,
  );
}
assertContains(helmHelpers, [
  'define "rfq-market-maker.topologySpreadConstraints"',
  ".Values.topologySpread.topologyKeys",
  ".Values.topologySpread.maxSkew",
  ".Values.topologySpread.minDomains",
  ".Values.topologySpread.whenUnsatisfiable",
  'include "rfq-market-maker.selectorLabels"',
  "app.kubernetes.io/component:",
], "Helm topology-spread helper");

for (const [label, source] of [
  ["backend", k8sDeployment],
  ["hedge worker", k8sHedgeDeployment],
  ["analytics worker", k8sAnalyticsDeployment],
  ["reconciliation worker", k8sReconciliationDeployment],
  ["settlement indexer", k8sIndexerDeployment],
  ["toxic-flow analyzer", k8sToxicFlowAnalyzerDeployment],
]) {
  assertContains(source, [
    "name: NODE_ENV",
    "configMapKeyRef:",
    "key: NODE_ENV",
  ], `${label} raw Deployment migration environment`);
}

for (const [label, source] of [
  ["backend", helmDeployment],
  ["hedge worker", helmHedgeDeployment],
  ["analytics worker", helmAnalyticsDeployment],
  ["reconciliation worker", helmReconciliationDeployment],
  ["settlement indexer", helmIndexerDeployment],
  ["toxic-flow analyzer", helmToxicFlowAnalyzerDeployment],
]) {
  const imageReferences = source.match(/include "rfq-market-maker\.image" \. \| quote/g) ?? [];
  assert.equal(imageReferences.length, 2, `${label} Helm template must reuse one digest-aware image reference`);
  assert.ok(!source.includes(".Values.image.tag"), `${label} Helm template must not assemble mutable tags directly`);
  assertContains(source, [
    "toYaml .Values.podSecurityContext",
    "toYaml .Values.containerSecurityContext",
    "mountPath: /tmp",
    ".Values.tmpVolumeSizeLimit",
  ], `${label} Helm workload security`);
  assert.equal(
    countOccurrences(source, "toYaml .Values.containerSecurityContext"),
    2,
    `${label} Helm template must harden init and runtime containers`,
  );
  assert.equal(
    countOccurrences(source, "mountPath: /tmp"),
    2,
    `${label} Helm template must mount bounded temporary storage for both containers`,
  );
}
assert.ok(
  helmDeployment.includes("automountServiceAccountToken: {{ .Values.serviceAccount.automountServiceAccountToken }}"),
  "Helm API Deployment must explicitly control Kubernetes API token automount",
);
for (const [label, source] of [
  ["hedge worker", helmHedgeDeployment],
  ["analytics worker", helmAnalyticsDeployment],
  ["reconciliation worker", helmReconciliationDeployment],
  ["settlement indexer", helmIndexerDeployment],
  ["toxic-flow analyzer", helmToxicFlowAnalyzerDeployment],
]) {
  assert.ok(
    source.includes("automountServiceAccountToken: false"),
    `Helm ${label} must not receive a Kubernetes ServiceAccount token`,
  );
}

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
  'eks.amazonaws.com/sts-regional-endpoints: "true"',
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
  "RFQ_REDIS_URL: rediss://replace-with-user:replace-with-password@redis.example.com:6380/0",
  "RFQ_API_KEY_CONFIG_JSON:",
  "DATABASE_URL: postgres://rfq-user:replace-with-password@postgres.example.com:5432/rfq_market_maker?sslmode=verify-full",
], "infra/k8s/backend-secret.yaml");
assert.ok(!k8sSecret.includes("RFQ_SIGNER_PRIVATE_KEY"), "backend Secret must not contain raw signer private keys");

assertContains(k8sNetworkPolicy, [
  "kind: NetworkPolicy",
  `namespace: ${expectedRuntime.namespace}`,
  `app.kubernetes.io/name: ${expectedRuntime.appName}`,
  "policyTypes:",
  "- Ingress",
  "- Egress",
  "kubernetes.io/metadata.name: ingress-nginx",
  "kubernetes.io/metadata.name: monitoring",
  "port: 3000",
  "egress: []",
], "infra/k8s/network-policy.yaml");
assert.ok(
  !k8sNetworkPolicy.includes("namespaceSelector: {}"),
  "backend NetworkPolicy must not admit every namespace",
);

for (const [label, source] of [
  ["hedge worker", k8sHedgeNetworkPolicy],
  ["analytics worker", k8sAnalyticsNetworkPolicy],
  ["reconciliation worker", k8sReconciliationNetworkPolicy],
  ["settlement indexer", k8sIndexerNetworkPolicy],
  ["toxic-flow analyzer", k8sToxicFlowAnalyzerNetworkPolicy],
]) {
  assert.ok(
    source.includes("kubernetes.io/metadata.name: monitoring"),
    `${label} NetworkPolicy must admit the monitoring namespace`,
  );
}

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
  "DATABASE_URL: postgres://rfq-worker:replace-with-password@postgres.example.com:5432/rfq_market_maker?sslmode=verify-full",
  "RFQ_BINANCE_API_KEY:",
  "RFQ_BINANCE_API_SECRET:",
], "infra/k8s/hedge-worker-secret.yaml");
for (const forbidden of ["RFQ_SIGNER_PRIVATE_KEY", "RFQ_AWS_KMS_KEY_ID"]) {
  assert.ok(!k8sHedgeSecret.includes(forbidden), `hedge worker Secret must not contain ${forbidden}`);
}
assertContains(k8sMigrationSecret, [
  "name: rfq-database-migration-secrets",
  "DATABASE_URL: postgres://rfq-migrator:",
  "sslmode=verify-full",
], "infra/k8s/database-migration-secret.yaml");
assertContains(k8sHedgeNetworkPolicy, [
  "kind: NetworkPolicy",
  "app.kubernetes.io/name: rfq-hedge-worker",
  "- Ingress",
  "- Egress",
  "port: 3001",
  "egress: []",
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
  "DATABASE_URL: postgres://rfq-analytics:",
  "sslmode=verify-full",
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
  "egress: []",
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
  "DATABASE_URL: postgres://rfq-reconciliation:",
  "sslmode=verify-full",
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
  "egress: []",
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
  "DATABASE_URL: postgres://rfq-indexer:",
  "sslmode=verify-full",
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
  "egress: []",
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
  "DATABASE_URL: postgres://rfq-toxic-analyzer:",
  "sslmode=verify-full",
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
  "egress: []",
], "infra/k8s/toxic-flow-analyzer-network-policy.yaml");
assert.ok(
  !k8sToxicFlowAnalyzerNetworkPolicy.includes("port: 443"),
  "toxic-flow analyzer must not receive public HTTPS egress",
);

assert.equal(
  countOccurrences(k8sCiliumFqdnEgressPolicy, "kind: CiliumNetworkPolicy"),
  6,
  "raw manifests must define one Cilium FQDN policy per workload",
);
assertContains(k8sCiliumFqdnEgressPolicy, [
  "apiVersion: cilium.io/v2",
  "k8s:io.kubernetes.pod.namespace: kube-system",
  "k8s:k8s-app: kube-dns",
  'port: "53"',
  "protocol: ANY",
  "rules:",
  "dns:",
  'matchPattern: "*"',
  "app.kubernetes.io/name: rfq-backend",
  "app.kubernetes.io/name: rfq-hedge-worker",
  "app.kubernetes.io/name: rfq-analytics-worker",
  "app.kubernetes.io/name: rfq-reconciliation-worker",
  "app.kubernetes.io/name: rfq-settlement-indexer",
  "app.kubernetes.io/name: rfq-toxic-flow-analyzer",
], "infra/k8s/cilium-fqdn-egress-policy.yaml");
for (const [hostname, port, count] of [
  ["postgres.example.com", 5432, 6],
  ["redis.example.com", 6380, 1],
  ["kms.us-east-1.amazonaws.com", 443, 1],
  ["sts.us-east-1.amazonaws.com", 443, 1],
  ["api.binance.com", 443, 2],
  ["stream.binance.com", 9443, 1],
  ["ws-feed.exchange.coinbase.com", 443, 1],
  ["replace-with-production-rpc.example.com", 443, 2],
  ["redpanda.example.internal", 9093, 1],
  ["clickhouse.example.internal", 8443, 1],
]) {
  assert.equal(
    countFqdnPortPairs(k8sCiliumFqdnEgressPolicy, hostname, port),
    count,
    `raw Cilium policy must bind ${hostname}:${port} exactly ${count} time(s)`,
  );
}
assert.ok(
  !k8sCiliumFqdnEgressPolicy.includes("toCIDR"),
  "raw Cilium policy must not allow CIDR egress",
);
assert.equal(
  countOccurrences(k8sCiliumFqdnEgressPolicy, 'matchPattern: "*"'),
  6,
  "raw Cilium policies may use a wildcard only for each workload's DNS proxy rule",
);

assertContains(helmValues, [
  'tag: "0.1.0"',
  'digest: ""',
  `replicaCount: ${expectedRuntime.replicas}`,
  `terminationGracePeriodSeconds: ${expectedRuntime.terminationGracePeriodSeconds}`,
  `preStopSleepSeconds: ${expectedRuntime.preStopSleepSeconds}`,
  "tmpVolumeSizeLimit: 16Mi",
  "runAsNonRoot: true",
  "runAsUser: 1000",
  "runAsGroup: 1000",
  "fsGroup: 1000",
  "fsGroupChangePolicy: OnRootMismatch",
  "type: RuntimeDefault",
  "allowPrivilegeEscalation: false",
  "readOnlyRootFilesystem: true",
  "automountServiceAccountToken: false",
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
  "trustedSignerOverlapAddresses:",
  "key: RFQ_TRUSTED_SIGNER_OVERLAP_ADDRESSES",
  "settlementAddressKey: RFQ_SETTLEMENT_ADDRESS",
  "serviceAccount:",
  "name: rfq-backend-kms",
  "eks.amazonaws.com/role-arn: replace-with-kms-signing-role-arn",
  'eks.amazonaws.com/sts-regional-endpoints: "true"',
  "redisSecret:",
  "urlKey: RFQ_REDIS_URL",
  "apiKeySecret:",
  "configKey: RFQ_API_KEY_CONFIG_JSON",
  "databaseSecret:",
  "urlKey: DATABASE_URL",
  "migrationSecret:",
  "name: rfq-database-migration-secrets",
  "apiIngressNamespaceLabels:",
  "kubernetes.io/metadata.name: ingress-nginx",
  "monitoringNamespaceLabels:",
  "kubernetes.io/metadata.name: monitoring",
  "fqdnEgress:",
  "endpointLabels:",
  "k8s:io.kubernetes.pod.namespace: kube-system",
  "k8s:k8s-app: kube-dns",
  "hostname: kms.us-east-1.amazonaws.com",
  "hostname: stream.binance.com",
  "port: 9443",
  "hostname: redpanda.example.internal",
  "port: 9093",
  "hostname: clickhouse.example.internal",
  "port: 8443",
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

assertContains(helmHelpers, [
  'define "rfq-market-maker.image"',
  ".Values.image.digest",
  'printf "%s@%s" .Values.image.repository .Values.image.digest',
  'required "image.tag is required when image.digest is empty"',
], "infra/helm/rfq-market-maker/templates/_helpers.tpl");
assert.deepEqual(
  helmValuesSchema.properties.image.properties.digest.oneOf[1],
  { type: "string", pattern: "^sha256:[0-9a-f]{64}$" },
  "Helm values schema must require a canonical sha256 digest",
);
assert.equal(
  helmValuesSchema.properties.image.properties.tag.not.const,
  "latest",
  "Helm values schema must reject the mutable latest tag",
);
assert.ok(helmValuesSchema.required.includes("env"), "Helm values schema must require env");
for (const requiredSecurityField of [
  "podSecurityContext",
  "containerSecurityContext",
  "tmpVolumeSizeLimit",
  "serviceAccount",
  "autoscaling",
  "disruptionBudget",
  "topologySpread",
  "replicaCount",
  "hedgeWorker",
  "analyticsWorker",
  "reconciliationWorker",
  "settlementIndexer",
  "toxicFlowAnalyzer",
]) {
  assert.ok(
    helmValuesSchema.required.includes(requiredSecurityField),
    `Helm values schema must require ${requiredSecurityField}`,
  );
}
assert.equal(helmValuesSchema.properties.tmpVolumeSizeLimit.const, "16Mi");
assert.equal(helmValuesSchema.properties.podSecurityContext.properties.runAsNonRoot.const, true);
assert.equal(helmValuesSchema.properties.podSecurityContext.properties.runAsUser.const, 1000);
assert.equal(helmValuesSchema.properties.podSecurityContext.properties.runAsGroup.const, 1000);
assert.equal(helmValuesSchema.properties.podSecurityContext.properties.fsGroup.const, 1000);
assert.equal(
  helmValuesSchema.properties.podSecurityContext.properties.seccompProfile.properties.type.const,
  "RuntimeDefault",
);
assert.equal(
  helmValuesSchema.properties.containerSecurityContext.properties.allowPrivilegeEscalation.const,
  false,
);
assert.equal(
  helmValuesSchema.properties.containerSecurityContext.properties.readOnlyRootFilesystem.const,
  true,
);
assert.equal(
  helmValuesSchema.properties.containerSecurityContext.properties.capabilities.properties.drop.items.const,
  "ALL",
);
assert.equal(
  helmValuesSchema.properties.serviceAccount.properties.automountServiceAccountToken.const,
  false,
);
assert.equal(helmValuesSchema.properties.autoscaling.properties.enabled.const, true);
assert.equal(helmValuesSchema.properties.autoscaling.properties.minReplicas.minimum, 2);
assert.equal(helmValuesSchema.properties.autoscaling.properties.maxReplicas.maximum, 100);
assert.equal(
  helmValuesSchema.properties.autoscaling.properties.targetCPUUtilizationPercentage.maximum,
  100,
);
assert.equal(helmValuesSchema.properties.disruptionBudget.properties.enabled.const, true);
assert.equal(helmValuesSchema.properties.disruptionBudget.properties.maxUnavailable.const, 1);
assert.equal(
  helmValuesSchema.properties.disruptionBudget.properties.unhealthyPodEvictionPolicy.const,
  "AlwaysAllow",
);
assert.equal(helmValuesSchema.properties.topologySpread.properties.enabled.const, true);
assert.equal(helmValuesSchema.properties.topologySpread.properties.maxSkew.const, 1);
assert.equal(helmValuesSchema.properties.topologySpread.properties.minDomains.const, 2);
assert.equal(
  helmValuesSchema.properties.topologySpread.properties.whenUnsatisfiable.const,
  "DoNotSchedule",
);
assert.equal(helmValuesSchema.properties.topologySpread.properties.topologyKeys.minItems, 2);
assert.equal(helmValuesSchema.properties.topologySpread.properties.topologyKeys.maxItems, 2);
assert.deepEqual(
  helmValuesSchema.properties.topologySpread.properties.topologyKeys.items.enum,
  ["kubernetes.io/hostname", "topology.kubernetes.io/zone"],
);
assert.equal(helmValuesSchema.properties.replicaCount.minimum, 2);
for (const workerName of [
  "hedgeWorker",
  "analyticsWorker",
  "reconciliationWorker",
  "settlementIndexer",
  "toxicFlowAnalyzer",
]) {
  assert.equal(
    helmValuesSchema.properties[workerName].$ref,
    "#/definitions/replicatedWorker",
    `Helm schema must enforce replicated availability for ${workerName}`,
  );
}
assert.equal(
  helmValuesSchema.definitions.replicatedWorker.allOf[0].then.properties.replicaCount.minimum,
  2,
);
assert.equal(
  helmValuesSchema.properties.env.properties.NODE_ENV.const,
  "production",
  "Helm values schema must keep deployment transport policy in production mode",
);
assert.ok(
  helmValuesSchema.required.includes("networkPolicy"),
  "Helm values schema must require networkPolicy configuration",
);
assert.deepEqual(
  helmValuesSchema.properties.networkPolicy.required,
  ["enabled", "apiIngressNamespaceLabels", "monitoringNamespaceLabels", "fqdnEgress"],
  "Helm values schema must require ingress selectors and FQDN egress policy",
);
assert.equal(
  helmValuesSchema.properties.networkPolicy.properties.enabled.const,
  true,
  "Helm values schema must keep production NetworkPolicy enabled",
);
assert.equal(
  helmValuesSchema.properties.networkPolicy.properties.apiIngressNamespaceLabels.minProperties,
  1,
  "Helm API ingress namespace selector must not be empty",
);
assert.equal(
  helmValuesSchema.properties.networkPolicy.properties.monitoringNamespaceLabels.minProperties,
  1,
  "Helm monitoring namespace selector must not be empty",
);
const fqdnEgressSchema = helmValuesSchema.properties.networkPolicy.properties.fqdnEgress;
assert.equal(fqdnEgressSchema.properties.enabled.const, true, "Helm FQDN egress must remain enabled");
assert.equal(
  fqdnEgressSchema.properties.dns.properties.endpointLabels.minProperties,
  1,
  "Helm Cilium DNS endpoint selector must not be empty",
);
for (const workload of [
  "api",
  "hedgeWorker",
  "analyticsWorker",
  "reconciliationWorker",
  "settlementIndexer",
  "toxicFlowAnalyzer",
]) {
  assert.equal(
    fqdnEgressSchema.properties[workload].$ref,
    "#/definitions/fqdnEndpointList",
    `Helm ${workload} FQDN endpoints must use the validated non-empty list schema`,
  );
}
assert.equal(
  helmValuesSchema.definitions.fqdnEndpointList.minItems,
  1,
  "Helm FQDN endpoint lists must not be empty",
);
assert.equal(
  helmValuesSchema.definitions.fqdnEndpointList.uniqueItems,
  true,
  "Helm FQDN endpoint lists must reject duplicate entries",
);
assert.equal(
  helmValuesSchema.definitions.fqdnEndpoint.properties.hostname.maxLength,
  253,
  "Helm FQDN hostnames must respect the DNS length bound",
);
assert.equal(
  helmValuesSchema.definitions.fqdnEndpoint.properties.port.maximum,
  65535,
  "Helm FQDN endpoint ports must be bounded",
);

assertContains(helmDeployment, [
  'include "rfq-market-maker.image" . | quote',
  "app.kubernetes.io/component: api",
  "replicas: {{ .Values.replicaCount }}",
  "terminationGracePeriodSeconds: {{ .Values.terminationGracePeriodSeconds }}",
  "serviceAccountName: {{ .Values.serviceAccount.name }}",
  "initContainers:",
  'command: ["node", "backend/dist/db/migrate.js"]',
  "env.NODE_ENV is required for database transport policy",
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
assert.equal(
  countOccurrences(helmDeployment, "app.kubernetes.io/component: api"),
  3,
  "Helm API Deployment must label metadata, selector and pod template as the api component",
);

assertContains(helmNetworkPolicy, [
  ".Values.networkPolicy.enabled",
  "kind: NetworkPolicy",
  'include "rfq-market-maker.selectorLabels"',
  "app.kubernetes.io/component: api",
  ".Values.networkPolicy.apiIngressNamespaceLabels",
  ".Values.networkPolicy.monitoringNamespaceLabels",
  "- Ingress",
  "- Egress",
  "port: {{ .Values.service.port }}",
  "egress: []",
], "infra/helm/rfq-market-maker/templates/network-policy.yaml");
assert.ok(
  !helmNetworkPolicy.includes("namespaceSelector: {}"),
  "Helm backend NetworkPolicy must not admit every namespace",
);
assert.equal(
  countOccurrences(helmNetworkPolicy, "app.kubernetes.io/component: api"),
  2,
  "Helm API NetworkPolicy metadata and pod selector must identify only the api component",
);

assertContains(helmServiceAccount, [
  ".Values.serviceAccount.create",
  "kind: ServiceAccount",
  "name: {{ .Values.serviceAccount.name }}",
  "with .Values.serviceAccount.annotations",
], "infra/helm/rfq-market-maker/templates/service-account.yaml");

assertContains(helmService, [
  "type: {{ .Values.service.type }}",
  "app.kubernetes.io/component: api",
  "annotations:",
  "toYaml .",
  "port: {{ .Values.service.port }}",
  "targetPort: http",
], "infra/helm/rfq-market-maker/templates/service.yaml");
assert.equal(
  countOccurrences(helmService, "app.kubernetes.io/component: api"),
  2,
  "Helm API Service metadata and selector must identify only the api component",
);

assertContains(helmHedgeDeployment, [
  "{{- if .Values.hedgeWorker.enabled }}",
  "replicas: {{ .Values.hedgeWorker.replicaCount }}",
  "initContainers:",
  'command: ["node", "backend/dist/db/migrate.js"]',
  "env.NODE_ENV is required for database transport policy",
  "env.NODE_ENV is required for worker transport policy",
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
  ".Values.networkPolicy.monitoringNamespaceLabels",
  "kind: NetworkPolicy",
  "app.kubernetes.io/component: hedge-worker",
  "egress: []",
], "infra/helm/rfq-market-maker/templates/hedge-worker-network-policy.yaml");

assertContains(helmAnalyticsDeployment, [
  "{{- if .Values.analyticsWorker.enabled }}",
  "replicas: {{ .Values.analyticsWorker.replicaCount }}",
  "initContainers:",
  'command: ["node", "backend/dist/db/migrate.js"]',
  "env.NODE_ENV is required for database transport policy",
  "env.NODE_ENV is required for worker transport policy",
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
  ".Values.networkPolicy.monitoringNamespaceLabels",
  "app.kubernetes.io/component: analytics-worker",
  "egress: []",
], "infra/helm/rfq-market-maker/templates/analytics-worker-network-policy.yaml");

assertContains(helmReconciliationDeployment, [
  "{{- if .Values.reconciliationWorker.enabled }}",
  "replicas: {{ .Values.reconciliationWorker.replicaCount }}",
  "initContainers:",
  'command: ["node", "backend/dist/db/migrate.js"]',
  "env.NODE_ENV is required for database transport policy",
  "env.NODE_ENV is required for worker transport policy",
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
  ".Values.networkPolicy.monitoringNamespaceLabels",
  "app.kubernetes.io/component: reconciliation-worker",
  "egress: []",
], "infra/helm/rfq-market-maker/templates/reconciliation-worker-network-policy.yaml");

assertContains(helmIndexerDeployment, [
  "{{- if .Values.settlementIndexer.enabled }}",
  "replicas: {{ .Values.settlementIndexer.replicaCount }}",
  "initContainers:",
  'command: ["node", "backend/dist/db/migrate.js"]',
  "env.NODE_ENV is required for database transport policy",
  "env.NODE_ENV is required for worker transport policy",
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
  ".Values.networkPolicy.monitoringNamespaceLabels",
  "app.kubernetes.io/component: settlement-indexer",
  "egress: []",
], "infra/helm/rfq-market-maker/templates/settlement-indexer-network-policy.yaml");

assertContains(helmToxicFlowAnalyzerDeployment, [
  "{{- if .Values.toxicFlowAnalyzer.enabled }}",
  "replicas: {{ .Values.toxicFlowAnalyzer.replicaCount }}",
  "initContainers:",
  'command: ["node", "backend/dist/db/migrate.js"]',
  "env.NODE_ENV is required for database transport policy",
  "env.NODE_ENV is required for worker transport policy",
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
  ".Values.networkPolicy.monitoringNamespaceLabels",
  "app.kubernetes.io/component: toxic-flow-analyzer",
  "egress: []",
], "infra/helm/rfq-market-maker/templates/toxic-flow-analyzer-network-policy.yaml");
assert.ok(
  !helmToxicFlowAnalyzerNetworkPolicy.includes("port: 443"),
  "Helm toxic-flow analyzer must not receive public HTTPS egress",
);

assertContains(helmCiliumFqdnEgressPolicy, [
  'define "rfq-market-maker.ciliumFqdnEgressRules"',
  ".Values.networkPolicy.fqdnEgress.dns.endpointLabels",
  ".Values.networkPolicy.fqdnEgress.dns.port",
  "kind: CiliumNetworkPolicy",
  "toFQDNs:",
  "matchName: {{ .hostname | quote }}",
  "port: {{ .port | quote }}",
  "protocol: TCP",
  "rules:",
  "dns:",
  'matchPattern: "*"',
  ".Values.networkPolicy.fqdnEgress.api",
  ".Values.networkPolicy.fqdnEgress.hedgeWorker",
  ".Values.networkPolicy.fqdnEgress.analyticsWorker",
  ".Values.networkPolicy.fqdnEgress.reconciliationWorker",
  ".Values.networkPolicy.fqdnEgress.settlementIndexer",
  ".Values.networkPolicy.fqdnEgress.toxicFlowAnalyzer",
], "infra/helm/rfq-market-maker/templates/cilium-fqdn-egress-policy.yaml");
assert.equal(
  countOccurrences(helmCiliumFqdnEgressPolicy, "kind: CiliumNetworkPolicy"),
  6,
  "Helm must render one Cilium FQDN policy template per enabled workload",
);
assert.ok(
  !helmCiliumFqdnEgressPolicy.includes("toCIDR"),
  "Helm Cilium policy must not allow CIDR egress",
);
assert.equal(
  countOccurrences(helmCiliumFqdnEgressPolicy, 'matchPattern: "*"'),
  1,
  "Helm Cilium template may use a wildcard only in the shared DNS proxy rule",
);

assertContains(kubernetesChapter, [
  "`terminationGracePeriodSeconds=30`",
  "preStop` sleep of 5 seconds",
  "Readiness 使用 `/ready`",
  "liveness 使用 `/health`",
  "`RFQ_SIGNER_MODE=aws-kms`",
  "`RFQ_AWS_KMS_KEY_ID`",
  "`RFQ_TRUSTED_SIGNER_ADDRESS`",
  "`RFQ_TRUSTED_SIGNER_OVERLAP_ADDRESSES`",
  "`RFQ_SETTLEMENT_ADDRESS`",
  "`RFQ_REDIS_URL`",
  "`RFQ_API_KEY_CONFIG_JSON`",
  "`RFQ_SUBMIT_RESERVATION_LEASE_MS`",
  "`RFQ_QUOTE_IDEMPOTENCY_LEASE_MS`",
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
  "Migration 022",
  "Migration 023",
  "`RFQ_TOXIC_FLOW_MARKOUT_HORIZON_SECONDS`",
  "Cilium DNS-aware policy enforcement",
  "`networkPolicy.fqdnEgress`",
  "`egress: []`",
  "Binance REST 443 and WebSocket 9443",
  "`runAsNonRoot=true`",
  "`RuntimeDefault` seccomp",
  "bounded 16Mi `/tmp`",
  "`automountServiceAccountToken=false`",
  "`autoscaling/v2` HPA",
  "`policy/v1` PDB",
  "Workers intentionally do not use CPU HPAs",
  "`topologySpreadConstraints`",
  "`minDomains=2`",
], "book/Volume7-ProductionDeployment/Chapter02-Kubernetes.md");

console.log("Deployment manifests consistency check passed");

function assertContains(source, needles, label) {
  for (const needle of needles) {
    assert.ok(source.includes(needle), `${label} must include ${needle}`);
  }
}

function countOccurrences(source, needle) {
  return source.split(needle).length - 1;
}

function countFqdnPortPairs(source, hostname, port) {
  const escapedHostname = hostname.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `matchName: ${escapedHostname}\\n[\\s\\S]{0,180}?port: "${port}"`,
    "g",
  );
  return [...source.matchAll(pattern)].length;
}
