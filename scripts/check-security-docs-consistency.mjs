#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const docs = {
  threatModel: await readFile("docs/security/threat-model.md", "utf8"),
  auditChecklist: await readFile("docs/security/audit-checklist.md", "utf8"),
  keyManagement: await readFile("docs/security/key-management.md", "utf8"),
  runbook: await readFile("book/Volume7-ProductionDeployment/Chapter05-Runbook.md", "utf8"),
  apiErrors: await readFile("docs/api/errors.md", "utf8"),
  openapi: await readFile("docs/api/openapi.yaml", "utf8"),
  apiGateway: await readFile("book/Volume5-BackendEngineering/Chapter01-API-Gateway.md", "utf8"),
  riskService: await readFile("book/Volume5-BackendEngineering/Chapter04-Risk-Service.md", "utf8"),
  storageAdr: await readFile("docs/adr/ADR-0003-Use-Postgres-Redis-Kafka-ClickHouse.md", "utf8"),
  erDiagram: await readFile("docs/database/er-diagram.md", "utf8"),
  metricsService: await readFile("book/Volume5-BackendEngineering/Chapter08-Metrics-Service.md", "utf8"),
  monitoring: await readFile("book/Volume7-ProductionDeployment/Chapter03-Monitoring.md", "utf8"),
};

const requiredHeadings = {
  threatModel: [
    "# Threat Model",
    "## Assets",
    "## Trust Boundaries",
    "## Threats",
    "## Security Requirements",
    "## Open Questions",
  ],
  auditChecklist: [
    "# Audit Checklist",
    "## Smart Contract",
    "## Backend",
    "## Data and Events",
    "## Operations",
  ],
  keyManagement: [
    "# Key Management",
    "## Principles",
    "## Recommended Production Model",
    "## Controls",
    "## Rotation Procedure",
    "## Incident Response",
  ],
};

const requiredTerms = {
  threatModel: [
    "Signer private key",
    "Trusted signer allowlist",
    "User funds and treasury funds",
    "Market data snapshots",
    "Inventory positions",
    "Hedge venue credentials",
    "Signer key compromise",
    "Signer rotation ordering gap",
    "Quote replay",
    "Cross-replica submit race",
    "Cross-chain replay",
    "Quote field tampering",
    "Stale market data",
    "Risk bypass",
    "Mempool MEV",
    "Event duplication",
    "Chain reorg",
    "Hedge credential leak",
    "AWS KMS workload identity",
    "Nonce replay protection",
    "EIP-712 domain",
    "short TTL",
    "private submission",
  ],
  auditChecklist: [
    "EIP-712 domain includes name, version, chainId and verifyingContract",
    "Quote struct fields match SDK and backend signer exactly",
    "`submitQuote` rejects expired quotes",
    "`submitQuote` rejects reused nonce",
    "`submitQuote` rejects untrusted signer",
    "`submitQuote` rejects unsupported tokenIn or tokenOut",
    "`submitQuote` uses SafeERC20 for transfers",
    "ReentrancyGuard protects settlement",
    "Pausable can stop settlement during incident response",
    "AccessControl protects signer and token whitelist updates",
    "Trusted signer authorization is capped at five entries",
    "`/quote` validates address format and amount strings",
    "Risk Engine runs before Signer Service",
    "Signer Service cannot be called directly from public API",
    "Rate limits protect public trading endpoints",
    "Production `/submit` uses a PostgreSQL quote-scoped lease",
    "All errors include traceId",
    "Settlement events use `(chainId, txHash, logIndex)` idempotency",
    "Signer key rotation is documented",
    "Signer rotation uses two backend rollouts",
    "Emergency pause procedure is documented",
  ],
  keyManagement: [
    "only sign typed RFQ quotes",
    "only sign quotes approved by Risk Engine",
    "Quote audit records must retain quoteId, snapshotId and riskPolicyVersion",
    "request logs retain traceId",
    "AWS KMS receives only the EIP-712 Quote digest",
    "Production API processes and Kubernetes Secrets must not contain the Ethereum private key",
    "Key rotation must be possible without redeploying all services",
    "`RFQ_SIGNER_MODE=aws-kms`",
    "Workload identity with `kms:Sign`",
    "no static AWS credentials",
    "Explicit `RFQ_TRUSTED_SIGNER_ADDRESS`",
    "`RFQ_TRUSTED_SIGNER_OVERLAP_ADDRESSES` contains at most four",
    "Strict DER parsing",
    "Per-token and per-chain notional limits",
    "Audit logs for every signing request",
    "Emergency signer removal from `RFQSettlement`",
    "Wait for old quotes to expire",
    "`RFQSettlement.setTrustedSigner(newSigner)`",
    "`RFQSettlement.setTrustedSignerAuthorization(oldSigner, false)`",
    "Pause settlement if blast radius is unclear",
  ],
};

for (const [docName, headings] of Object.entries(requiredHeadings)) {
  for (const heading of headings) {
    assert.ok(docs[docName].includes(heading), `${docName} must include heading: ${heading}`);
  }
}

for (const [docName, terms] of Object.entries(requiredTerms)) {
  for (const term of terms) {
    assert.ok(docs[docName].includes(term), `${docName} must cover security control: ${term}`);
  }
}

const threatRows = [...docs.threatModel.matchAll(/^\| [^|]+ \| [^|]+ \| [^|]+ \|$/gm)].length - 1;
assert.ok(threatRows >= 10, "threat model must document at least 10 concrete threats");

const auditItems = [...docs.auditChecklist.matchAll(/^- \[[ x]\] /gm)].length;
assert.ok(auditItems >= 30, "audit checklist must include at least 30 review items");

const checkedAuditItems = [...docs.auditChecklist.matchAll(/^- \[x\] /gm)].length;
assert.ok(checkedAuditItems >= 20, "audit checklist must mark implemented baseline controls");

const implementedAuditControls = [
  "EIP-712 domain includes name, version, chainId and verifyingContract.",
  "Quote struct fields match SDK and backend signer exactly.",
  "`submitQuote` rejects expired quotes.",
  "`submitQuote` rejects reused nonce.",
  "`submitQuote` rejects untrusted signer.",
  "`submitQuote` rejects unsupported tokenIn or tokenOut.",
  "`submitQuote` uses SafeERC20 for transfers.",
  "State updates are ordered safely around external calls.",
  "ReentrancyGuard protects settlement.",
  "Pausable can stop settlement during incident response.",
  "AccessControl protects signer and token whitelist updates.",
  "Trusted signer authorization is capped at five entries, cannot remove the primary or final signer, and emits an event for every membership change.",
  "Events contain enough data for idempotent indexing.",
  "`/quote` validates address format and amount strings.",
  "Risk Engine runs before Signer Service.",
  "Signer Service cannot be called directly from public API.",
  "Non-local standalone runtime requires AWS KMS and rejects raw signer private keys.",
  "KMS signatures are strictly DER-decoded and accepted only when recovery matches the configured trusted signer.",
  "Settlement verification accepts one primary plus at most four validated overlap signers and snapshots that trust policy at startup.",
  "Quote persistence includes snapshotId and riskPolicyVersion.",
  "Rejected quotes are logged without returning signatures.",
  "Rate limits protect public trading endpoints.",
  "Production `/submit` uses a PostgreSQL quote-scoped lease with server-time expiry and owner-token release across API replicas.",
  "Submit reservation acquisition failures fail closed and active contention is rejected before settlement verification.",
  "All errors include traceId.",
  "API and worker logs are structured, level-controlled, trace-correlated where applicable, and redact credentials, signatures, private keys, cookies and request headers.",
  "Public API responses include no-store cache control and baseline browser security headers.",
  "Browser access is restricted by a CORS origin allowlist.",
  "Sensitive thresholds are not exposed to users.",
  "Receipt-confirmed E2E broadcasts `submitQuote` on Anvil and verifies calldata, receipt, event, balances, nonce, inventory, hedge and PnL.",
  "Settlement events use `(chainId, txHash, logIndex)` idempotency.",
  "Indexer handles chain reorgs.",
  "Inventory updates are replayable.",
  "Hedge actions are linked to settlement events.",
  "ClickHouse analytics do not become operational source of truth.",
  "Alerts exist for signer failures, risk reject spikes, event lag and hedge failures.",
  "Dashboards cover quote latency, settlement failures and inventory exposure.",
  "Alerts and runbooks cover submit reservation persistence errors and contention spikes.",
  "Signer key rotation is documented.",
  "Signer rotation uses two backend rollouts, waits through TTL and settlement-observation buffers, and explicitly retires the old signer on chain and in backend configuration.",
  "Emergency pause procedure is documented.",
];

for (const control of implementedAuditControls) {
  assert.ok(
    docs.auditChecklist.includes(`- [x] ${control}`),
    `audit checklist must mark implemented control: ${control}`,
  );
}

const intentionallyOpenAuditControls = [];

for (const control of intentionallyOpenAuditControls) {
  assert.ok(
    docs.auditChecklist.includes(`- [ ] ${control}`),
    `audit checklist must leave unresolved control unchecked: ${control}`,
  );
}

for (const term of [
  "Open a change record",
  "run the normal quote-path canary in staging",
  "The retirement time must be later than the final old-key signature",
  "`RFQSettlement.setTrustedSigner(newSigner)`",
  "`RFQSettlement.setTrustedSignerAuthorization(oldSigner, false)`",
]) {
  assert.ok(docs.keyManagement.includes(term), `key management rotation procedure must include: ${term}`);
}

for (const term of [
  "### Emergency Pause Procedure",
  "`RFQSettlement.setPaused(true)`",
  "negative submit canary",
  "`RFQSettlement.paused()` is true",
  "`RFQSettlement.setPaused(false)`",
  "two-person approval",
]) {
  assert.ok(docs.runbook.includes(term), `runbook emergency pause procedure must include: ${term}`);
}

for (const term of [
  "不直接暴露内部 policy threshold",
  "对外只返回通用说明",
]) {
  assert.ok(docs.apiErrors.includes(term), `API errors docs must protect sensitive risk details: ${term}`);
}

for (const term of [
  "Gateway 不返回内部 risk threshold",
  "policyVersion",
  "internal reasonCode",
  "inventory limit",
  "toxic-flow score",
  "pricing adjustment breakdown",
]) {
  assert.ok(docs.apiGateway.includes(term), `API gateway docs must define sensitive field boundary: ${term}`);
}

for (const term of [
  "Public API responses must not expose internal risk thresholds",
  "policyVersion or internal reasonCode values",
  "detailed `reasonCode` and `policyVersion` stay in internal audit records",
]) {
  assert.ok(docs.riskService.includes(term), `Risk service docs must define sensitive threshold boundary: ${term}`);
}

const tradingOpenApi = docs.openapi.match(/^paths:\n([\s\S]*?)^  \/admin\//m)?.[1];
assert.ok(tradingOpenApi, "OpenAPI must define trading routes before protected administrative routes");
for (const sensitivePublicField of [
  "riskPolicyVersion",
  "policyVersion",
  "reasonCode",
  "maxNotional",
  "maxQuotedSpread",
  "inventoryLimit",
  "toxicFlowScore",
  "inventorySkewBps",
  "sizeImpactBps",
  "spreadBps",
  "hedgeCostBps",
]) {
  assert.ok(
    !tradingOpenApi.includes(sensitivePublicField),
    `OpenAPI trading contract must not expose sensitive risk field: ${sensitivePublicField}`,
  );
}
assert.ok(
  docs.openapi.includes("/admin/toxic-flow/scores/{chainId}/{user}:") &&
    docs.openapi.includes("x-required-scope: admin:read") &&
    docs.openapi.includes("x-required-scope: admin:write") &&
    docs.openapi.includes("ToxicFlowScoreState:") &&
    docs.openapi.includes("policyVersion:"),
  "OpenAPI may expose versioned toxic-flow evidence only through scoped administrative operations",
);

for (const term of [
  "PostgreSQL 是操作型状态来源，ClickHouse 是分析副本",
  "ClickHouse 保存高吞吐分析事件",
]) {
  assert.ok(docs.storageAdr.includes(term), `storage ADR must keep ClickHouse analytical-only boundary: ${term}`);
}

for (const term of [
  "PostgreSQL 保存权威业务状态，ClickHouse 保存分析副本",
  "权威成交、对冲和 PnL 明细",
]) {
  assert.ok(docs.erDiagram.includes(term), `ER diagram must keep operational truth boundary: ${term}`);
}

for (const term of [
  "ClickHouse is an analytics replica only",
  "must read operational truth from PostgreSQL, settlement events and in-process service state",
  "never from ClickHouse query results",
]) {
  assert.ok(docs.metricsService.includes(term), `metrics docs must keep ClickHouse out of operational decisions: ${term}`);
}

for (const term of [
  "ClickHouse dashboards may explain quote funnels",
  "must never be used as the operational source of truth",
  "quote status, settlement state, inventory, hedge execution, readiness or reconciliation decisions",
]) {
  assert.ok(docs.monitoring.includes(term), `monitoring docs must keep ClickHouse out of operational decisions: ${term}`);
}

const mermaidBlocks = [...docs.threatModel.matchAll(/^```mermaid$/gm)].length +
  [...docs.keyManagement.matchAll(/^```mermaid$/gm)].length;
assert.ok(mermaidBlocks >= 2, "security docs must include threat-boundary and key-management Mermaid diagrams");

console.log(`Security docs consistency check passed (${threatRows} threats, ${auditItems} audit items)`);
