#!/usr/bin/env node

import { readFile } from "node:fs/promises";

const settlementSource = await readFile("contracts/src/RFQSettlement.sol", "utf8");
const settlementInterfaceSource = await readFile("contracts/src/interfaces/IRFQSettlement.sol", "utf8");
const treasurySource = await readFile("contracts/src/Treasury.sol", "utf8");
const sdkAbiSource = await readFile("sdk/src/abi.ts", "utf8");
const openZeppelinPackage = JSON.parse(
  await readFile("contracts/lib/openzeppelin-contracts/package.json", "utf8"),
);
const remappings = await readFile("contracts/remappings.txt", "utf8");
const gitmodules = await readFile(".gitmodules", "utf8");

if (openZeppelinPackage.version !== "5.6.1") {
  throw new Error(`OpenZeppelin Contracts must remain pinned to 5.6.1 (got ${openZeppelinPackage.version})`);
}
if (!remappings.includes("@openzeppelin/=lib/openzeppelin-contracts/")) {
  throw new Error("Foundry remappings must resolve the pinned OpenZeppelin submodule");
}
if (!gitmodules.includes("contracts/lib/openzeppelin-contracts")) {
  throw new Error("OpenZeppelin Contracts must be tracked as a git submodule");
}
for (const requiredImport of [
  "@openzeppelin/contracts/access/AccessControl.sol",
  "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol",
  "@openzeppelin/contracts/utils/Pausable.sol",
  "@openzeppelin/contracts/utils/ReentrancyGuard.sol",
  "@openzeppelin/contracts/utils/cryptography/ECDSA.sol",
  "@openzeppelin/contracts/utils/cryptography/EIP712.sol",
]) {
  if (!settlementSource.includes(requiredImport)) {
    throw new Error(`RFQSettlement must import ${requiredImport}`);
  }
}
for (const requiredImport of [
  "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol",
  "@openzeppelin/contracts/utils/ReentrancyGuard.sol",
]) {
  if (!treasurySource.includes(requiredImport)) {
    throw new Error(`Treasury must import ${requiredImport}`);
  }
}

const contracts = [
  {
    label: "RFQSettlement",
    source: `${settlementSource}\n${settlementInterfaceSource}`,
    abiExport: "rfqSettlementAbi",
    functions: [
      "DEFAULT_ADMIN_ROLE",
      "DOMAIN_TYPEHASH",
      "NAME_HASH",
      "PAUSER_ROLE",
      "QUOTE_TYPEHASH",
      "SIGNER_ADMIN_ROLE",
      "TOKEN_ADMIN_ROLE",
      "TREASURY_ADMIN_ROLE",
      "VERSION_HASH",
      "domainSeparator",
      "eip712Domain",
      "getRoleAdmin",
      "grantRole",
      "hashQuote",
      "hashTypedData",
      "hasRole",
      "owner",
      "paused",
      "renounceRole",
      "revokeRole",
      "setPaused",
      "setTreasury",
      "setTokenWhitelist",
      "setTrustedSigner",
      "submitQuote",
      "supportsInterface",
      "tokenWhitelist",
      "treasury",
      "trustedSigner",
      "transferOwnership",
      "usedNonces",
    ],
    events: [
      "EIP712DomainChanged",
      "OwnerUpdated",
      "Paused",
      "PausedUpdated",
      "QuoteSettled",
      "RoleAdminChanged",
      "RoleGranted",
      "RoleRevoked",
      "TreasuryUpdated",
      "TokenWhitelistUpdated",
      "TrustedSignerUpdated",
      "Unpaused",
    ],
    inheritedFunctions: [
      "DEFAULT_ADMIN_ROLE",
      "eip712Domain",
      "getRoleAdmin",
      "renounceRole",
      "supportsInterface",
    ],
    inheritedEvents: [
      "EIP712DomainChanged",
      "Paused",
      "RoleAdminChanged",
      "RoleGranted",
      "RoleRevoked",
      "Unpaused",
    ],
    inheritedErrors: [
      "AccessControlBadConfirmation",
      "AccessControlUnauthorizedAccount",
      "EnforcedPause",
      "ExpectedPause",
      "InvalidShortString",
      "ReentrancyGuardReentrantCall",
      "StringTooLong",
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
    inheritedFunctions: [],
    inheritedEvents: [],
    inheritedErrors: ["ReentrancyGuardReentrantCall"],
  },
];

for (const contract of contracts) {
  const abiBlock = extractAbiBlock(sdkAbiSource, contract.abiExport);
  const sdkFunctions = extractAbiNames(abiBlock, "function");
  const sdkEvents = extractAbiNames(abiBlock, "event");
  const sdkErrors = extractAbiNames(abiBlock, "error");
  const solidityErrors = [
    ...extractSolidityErrors(contract.source),
    ...contract.inheritedErrors,
  ];

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
    if (contract.inheritedFunctions.includes(name)) continue;
    assertSolidityFunctionOrGetter(contract.source, name, contract.label);
  }
  for (const name of contract.events) {
    if (contract.inheritedEvents.includes(name)) continue;
    assertSolidityEvent(contract.source, name, contract.label);
  }
}

console.log("Contract ABI consistency check passed (OpenZeppelin Contracts 5.6.1)");

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
