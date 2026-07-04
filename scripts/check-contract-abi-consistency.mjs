#!/usr/bin/env node

import { readFile } from "node:fs/promises";

const settlementSource = await readFile("contracts/src/RFQSettlement.sol", "utf8");
const settlementInterfaceSource = await readFile("contracts/src/interfaces/IRFQSettlement.sol", "utf8");
const treasurySource = await readFile("contracts/src/Treasury.sol", "utf8");
const sdkAbiSource = await readFile("sdk/src/abi.ts", "utf8");

const contracts = [
  {
    label: "RFQSettlement",
    source: `${settlementSource}\n${settlementInterfaceSource}`,
    abiExport: "rfqSettlementAbi",
    functions: [
      "DEFAULT_ADMIN_ROLE",
      "PAUSER_ROLE",
      "SIGNER_ADMIN_ROLE",
      "TOKEN_ADMIN_ROLE",
      "TREASURY_ADMIN_ROLE",
      "domainSeparator",
      "grantRole",
      "hashQuote",
      "hashTypedData",
      "hasRole",
      "owner",
      "paused",
      "revokeRole",
      "setPaused",
      "setTreasury",
      "setTokenWhitelist",
      "setTrustedSigner",
      "submitQuote",
      "tokenWhitelist",
      "treasury",
      "trustedSigner",
      "transferOwnership",
      "usedNonces",
    ],
    events: [
      "OwnerUpdated",
      "PausedUpdated",
      "QuoteSettled",
      "RoleGranted",
      "RoleRevoked",
      "TreasuryUpdated",
      "TokenWhitelistUpdated",
      "TrustedSignerUpdated",
    ],
  },
  {
    label: "Treasury",
    source: treasurySource,
    abiExport: "treasuryAbi",
    functions: [
      "emergencyWithdraw",
      "owner",
      "release",
      "setSettlement",
      "settlement",
      "transferOwnership",
    ],
    events: ["EmergencyWithdrawal", "FundsReleased", "OwnerUpdated", "SettlementUpdated"],
  },
];

for (const contract of contracts) {
  const abiBlock = extractAbiBlock(sdkAbiSource, contract.abiExport);
  const sdkFunctions = extractAbiNames(abiBlock, "function");
  const sdkEvents = extractAbiNames(abiBlock, "event");
  const sdkErrors = extractAbiNames(abiBlock, "error");
  const solidityErrors = extractSolidityErrors(contract.source);

  assertNames(
    sdkFunctions,
    contract.functions,
    `${contract.abiExport} functions must include ${contract.label} integration surface`,
  );
  assertNames(
    sdkEvents,
    contract.events,
    `${contract.abiExport} events must include ${contract.label} integration surface`,
  );
  assertNames(
    sdkErrors,
    solidityErrors,
    `${contract.abiExport} errors must include every ${contract.label} custom error for revert decoding`,
  );
  assertNames(
    solidityErrors,
    sdkErrors,
    `${contract.abiExport} errors must not include custom errors absent from ${contract.label}`,
  );

  for (const name of contract.functions) {
    assertSolidityFunctionOrGetter(contract.source, name, contract.label);
  }
  for (const name of contract.events) {
    assertSolidityEvent(contract.source, name, contract.label);
  }
}

console.log("Contract ABI consistency check passed");

function extractAbiBlock(source, exportName) {
  const pattern = new RegExp(`export const ${exportName} = \\[([\\s\\S]*?)\\] as const;`, "m");
  const match = source.match(pattern);
  if (!match?.[1]) {
    throw new Error(`Unable to extract SDK ABI export ${exportName}`);
  }

  return match[1];
}

function extractAbiNames(source, type) {
  const names = [];
  const entryPattern = /\{\s*type:\s*"([^"]+)",\s*name:\s*"([^"]+)"/g;
  for (const [, entryType, name] of source.matchAll(entryPattern)) {
    if (entryType === type) {
      names.push(name);
    }
  }

  return names;
}

function extractSolidityErrors(source) {
  return [...new Set([...source.matchAll(/\berror\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/g)].map(([, name]) => name))];
}

function assertNames(actual, expected, label) {
  const missing = expected.filter((name) => !actual.includes(name));
  if (missing.length > 0) {
    throw new Error(`${label}\nmissing: ${missing.join(", ")}\nactual: ${actual.join(", ")}`);
  }
}

function assertSolidityFunctionOrGetter(source, name, label) {
  if (new RegExp(`function\\s+${name}\\s*\\(`).test(source)) {
    return;
  }

  const publicGetterPattern = new RegExp(
    `(?:address|bool|uint256|bytes32|mapping\\([^;]+\\))\\s+public(?:\\s+constant)?\\s+${name}\\b`,
  );
  if (publicGetterPattern.test(source)) {
    return;
  }

  throw new Error(`${label}.${name} is required by SDK ABI but was not found in Solidity source`);
}

function assertSolidityEvent(source, name, label) {
  if (!new RegExp(`event\\s+${name}\\s*\\(`).test(source)) {
    throw new Error(`${label}.${name} event is required by SDK ABI but was not found in Solidity source`);
  }
}
