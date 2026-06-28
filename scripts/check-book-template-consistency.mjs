#!/usr/bin/env node

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import assert from "node:assert/strict";

const requiredHeadings = [
  "## Abstract",
  "## Learning Objectives",
  "## Background",
  "## Problem Statement",
  "## Requirements",
  "## Existing Solutions",
  "## Trade-Off Analysis",
  "## System Design",
  "## Architecture Diagram",
  "## Sequence Diagram",
  "## State Machine",
  "## Data Model",
  "## API Design",
  "## Engineering Decisions",
  "## Failure Scenarios",
  "## Security Considerations",
  "## Performance Considerations",
  "## Testing Strategy",
  "## Interview Notes",
  "## Summary",
  "## References",
];

const chapterFiles = await listChapterFiles("book");
assert.ok(chapterFiles.length > 0, "book must contain chapter files");

for (const file of chapterFiles) {
  const source = await readFile(file, "utf8");
  const firstLine = source.split("\n", 1)[0];
  assert.ok(firstLine.startsWith("# Chapter "), `${file} must start with a Chapter H1`);

  const headings = [...source.matchAll(/^## .+$/gm)].map((match) => match[0]);
  assert.deepEqual(headings, requiredHeadings, `${file} must follow the standard book chapter template`);

  for (const heading of requiredHeadings) {
    const body = extractSectionBody(source, heading);
    assert.ok(body.trim().length > 0, `${file} ${heading} must not be empty`);
  }
}

console.log(`Book template consistency check passed (${chapterFiles.length} chapters)`);

async function listChapterFiles(root) {
  const result = [];
  const volumes = await readdir(root, { withFileTypes: true });
  for (const volume of volumes) {
    if (!volume.isDirectory()) continue;

    const volumePath = join(root, volume.name);
    const entries = await readdir(volumePath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && /^Chapter\d+-.+\.md$/.test(entry.name)) {
        result.push(join(volumePath, entry.name));
      }
    }
  }

  return result.sort();
}

function extractSectionBody(source, heading) {
  const start = source.indexOf(`${heading}\n`);
  assert.ok(start >= 0, `Unable to find ${heading}`);

  const bodyStart = start + heading.length + 1;
  const nextHeading = source.slice(bodyStart).match(/^## .+$/m);
  if (nextHeading?.index === undefined) {
    return source.slice(bodyStart);
  }

  return source.slice(bodyStart, bodyStart + nextHeading.index);
}
