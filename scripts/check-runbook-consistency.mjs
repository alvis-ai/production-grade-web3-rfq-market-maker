#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const alertRulesSource = await readFile("infra/prometheus/rules/rfq-alerts.yml", "utf8");
const runbookSource = await readFile("book/Volume7-ProductionDeployment/Chapter05-Runbook.md", "utf8");

const alertNames = extractAlertNames(alertRulesSource);
const runbookAlerts = extractRunbookAlertTable(runbookSource);

assert.ok(alertNames.length >= 10, "RFQ alert rules must include core production alerts");
assert.deepEqual(runbookAlerts, alertNames, "Runbook alert routing table must cover every Prometheus alert exactly");

for (const alertName of alertNames) {
  const block = extractAlertBlock(alertRulesSource, alertName);
  assert.match(block, /expr:\s+.+/, `${alertName} must declare a Prometheus expression`);
  assert.match(block, /for:\s+[0-9]+[smhd]/, `${alertName} must declare a hold duration`);
  assert.match(block, /severity:\s+(critical|warning)/, `${alertName} must declare severity`);
  assert.match(block, /summary:\s+.+/, `${alertName} must declare an operator summary`);
  assert.ok(
    block.includes("runbook: book/Volume7-ProductionDeployment/Chapter05-Runbook.md"),
    `${alertName} must link Chapter05 runbook`,
  );

  const row = extractRunbookRow(runbookSource, alertName);
  assert.ok(row.includes("|") && row.split("|").length >= 6, `${alertName} runbook row must have all columns`);
  assert.ok(!row.includes("TBD") && !row.includes("TODO"), `${alertName} runbook row must be actionable`);
}

for (const heading of [
  "### Signer Compromise",
  "### Market Data Stale",
  "### Indexer Lag",
  "### Hedge Failure",
  "### Post-Settlement Persistence Drift",
  "### Analytics Pipeline Backlog",
  "### Pod Termination Or Rollout Drain",
]) {
  assert.ok(runbookSource.includes(heading), `Runbook must include scenario heading ${heading}`);
}

console.log(`Runbook consistency check passed (${alertNames.length} alerts)`);

function extractAlertNames(source) {
  return [...source.matchAll(/^\s+- alert: ([A-Za-z0-9_]+)$/gm)].map((match) => match[1]).sort();
}

function extractRunbookAlertTable(source) {
  const lines = source.split("\n");
  const headerIndex = lines.findIndex((line) => line === "| Alert | Primary Triage | Immediate Mitigation | Verification |");
  assert.ok(headerIndex >= 0, "Runbook alert routing table header not found");
  const tableLines = [];
  for (let index = headerIndex + 2; index < lines.length && lines[index].startsWith("|"); index += 1) {
    tableLines.push(lines[index]);
  }
  const rows = tableLines
    .map((line) => /^\| `([A-Za-z0-9_]+)` \|/.exec(line)?.[1])
    .filter((name) => name !== undefined)
    .sort();
  assert.ok(rows.length > 0, "Runbook alert routing table not found");
  return rows;
}

function extractAlertBlock(source, alertName) {
  const lines = source.split("\n");
  const start = lines.findIndex((line) => line.trim() === `- alert: ${alertName}`);
  assert.ok(start >= 0, `${alertName} block not found`);

  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (lines[index].trim().startsWith("- alert: ")) {
      end = index;
      break;
    }
  }

  return lines.slice(start, end).join("\n");
}

function extractRunbookRow(source, alertName) {
  const match = source.match(new RegExp(`^\\| \`${alertName}\` \\| .+$`, "m"));
  assert.ok(match, `${alertName} runbook row not found`);
  return match[0];
}
