#!/usr/bin/env node

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import assert from "node:assert/strict";

const requiredHeadings = [
  "## Status",
  "## Context",
  "## Decision",
  "## Consequences",
  "## Alternatives Considered",
];
const requiredConsequenceHeadings = [
  "### Positive",
  "### Negative",
  "### Mitigation",
];

const adrFiles = (await readdir("docs/adr"))
  .filter((name) => /^ADR-\d{4}-.+\.md$/.test(name))
  .sort()
  .map((name) => join("docs/adr", name));

assert.ok(adrFiles.length > 0, "docs/adr must contain ADR files");

for (let index = 0; index < adrFiles.length; index += 1) {
  const file = adrFiles[index];
  const expectedNumber = String(index + 1).padStart(4, "0");
  assert.ok(file.includes(`ADR-${expectedNumber}-`), `${file} must use contiguous ADR number ${expectedNumber}`);

  const source = await readFile(file, "utf8");
  const firstLine = source.split("\n", 1)[0];
  assert.ok(firstLine.startsWith(`# ADR-${expectedNumber}: `), `${file} must start with matching ADR H1`);

  const headings = [...source.matchAll(/^## .+$/gm)].map((match) => match[0]);
  assert.deepEqual(headings, requiredHeadings, `${file} must follow the standard ADR template`);

  const status = extractSectionBody(source, "## Status").trim();
  assert.equal(status, "Accepted", `${file} status must be Accepted`);

  const consequenceHeadings = [...extractSectionBody(source, "## Consequences").matchAll(/^### .+$/gm)]
    .map((match) => match[0]);
  assert.deepEqual(
    consequenceHeadings,
    requiredConsequenceHeadings,
    `${file} consequences must include Positive, Negative, and Mitigation sections`,
  );

  for (const heading of requiredHeadings) {
    assert.ok(extractSectionBody(source, heading).trim().length > 0, `${file} ${heading} must not be empty`);
  }
  for (const heading of requiredConsequenceHeadings) {
    assert.ok(extractSectionBody(source, heading).trim().length > 0, `${file} ${heading} must not be empty`);
  }
}

console.log(`ADR consistency check passed (${adrFiles.length} ADRs)`);

function extractSectionBody(source, heading) {
  const start = source.indexOf(`${heading}\n`);
  assert.ok(start >= 0, `Unable to find ${heading}`);

  const bodyStart = start + heading.length + 1;
  const headingLevel = heading.startsWith("### ") ? "{2,3}" : "{2}";
  const nextHeading = source.slice(bodyStart).match(new RegExp(`^#${headingLevel} .+$`, "m"));
  if (nextHeading?.index === undefined) {
    return source.slice(bodyStart);
  }

  return source.slice(bodyStart, bodyStart + nextHeading.index);
}
