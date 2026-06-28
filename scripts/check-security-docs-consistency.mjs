#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const docs = {
  threatModel: await readFile("docs/security/threat-model.md", "utf8"),
  auditChecklist: await readFile("docs/security/audit-checklist.md", "utf8"),
  keyManagement: await readFile("docs/security/key-management.md", "utf8"),
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
    "Quote replay",
    "Cross-chain replay",
    "Quote field tampering",
    "Stale market data",
    "Risk bypass",
    "Mempool MEV",
    "Event duplication",
    "Chain reorg",
    "Hedge credential leak",
    "KMS/HSM",
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
    "`/quote` validates address format and amount strings",
    "Risk Engine runs before Signer Service",
    "Signer Service cannot be called directly from public API",
    "Rate limits protect public trading endpoints",
    "All errors include traceId",
    "Settlement events use `(chainId, txHash, logIndex)` idempotency",
    "Signer key rotation is documented",
    "Emergency pause procedure is documented",
  ],
  keyManagement: [
    "only sign typed RFQ quotes",
    "only sign quotes approved by Risk Engine",
    "quoteId, snapshotId, riskPolicyVersion and traceId",
    "Private keys must not be stored in application source code",
    "Key rotation must be possible without redeploying all services",
    "KMS/HSM key with restricted signing policy",
    "Network isolation for Signer Service",
    "mTLS or service identity",
    "Per-token and per-chain notional limits",
    "Audit logs for every signing request",
    "Emergency signer removal from `RFQSettlement`",
    "Wait for old quotes to expire",
    "`RFQSettlement.setTrustedSigner(newSigner)`",
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
assert.ok(checkedAuditItems >= 4, "audit checklist must mark implemented baseline backend controls");

const mermaidBlocks = [...docs.threatModel.matchAll(/^```mermaid$/gm)].length +
  [...docs.keyManagement.matchAll(/^```mermaid$/gm)].length;
assert.ok(mermaidBlocks >= 2, "security docs must include threat-boundary and key-management Mermaid diagrams");

console.log(`Security docs consistency check passed (${threatRows} threats, ${auditItems} audit items)`);
