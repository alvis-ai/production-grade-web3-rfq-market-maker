#!/usr/bin/env node

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const requireFromBackend = createRequire(new URL("../backend/package.json", import.meta.url));
const {
  createPublicClient,
  defineChain,
  encodeAbiParameters,
  getAddress,
  http,
  keccak256,
  parseAbi,
  toBytes,
} = await import(pathToFileURL(requireFromBackend.resolve("viem")).href);

if (process.env.RFQ_CHAIN_INTEGRATION_CONFIRM !== "yes") {
  throw new Error("RFQ_CHAIN_INTEGRATION_CONFIRM=yes is required because this check reads a live chain deployment");
}

const rpcUrl = readRpcUrl("RFQ_CHAIN_INTEGRATION_RPC_URL");
const chainId = readInteger("RFQ_CHAIN_INTEGRATION_CHAIN_ID", undefined, 1, Number.MAX_SAFE_INTEGER);
const settlementAddress = readAddress("RFQ_CHAIN_INTEGRATION_SETTLEMENT_ADDRESS");
const treasuryAddress = readAddress("RFQ_CHAIN_INTEGRATION_TREASURY_ADDRESS");
const factoryAddress = readAddress("RFQ_CHAIN_INTEGRATION_FACTORY_ADDRESS");
const adminAddress = readAddress("RFQ_CHAIN_INTEGRATION_ADMIN_ADDRESS");
const trustedSignerConfig = readTrustedSignerConfig();
const whitelistedTokens = readTokenWhitelist();
const expectedPaused = readBoolean("RFQ_CHAIN_INTEGRATION_EXPECT_PAUSED", false);
const requestTimeoutMs = readInteger("RFQ_CHAIN_INTEGRATION_REQUEST_TIMEOUT_MS", 10_000, 1_000, 60_000);
const maxBlockAgeSeconds = readInteger("RFQ_CHAIN_INTEGRATION_MAX_BLOCK_AGE_SECONDS", 300, 1, 86_400);
const maxFutureSkewSeconds = readInteger("RFQ_CHAIN_INTEGRATION_MAX_FUTURE_SKEW_SECONDS", 30, 0, 300);

assert.equal(new Set([settlementAddress, treasuryAddress, factoryAddress]).size, 3,
  "Settlement, Treasury, and deployment factory addresses must be distinct");

const chain = defineChain({
  id: chainId,
  name: `RFQ deployment integration ${chainId}`,
  nativeCurrency: { name: "Native", symbol: "NATIVE", decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
});
const publicClient = createPublicClient({
  chain,
  transport: http(rpcUrl, { timeout: requestTimeoutMs }),
});
const actualChainId = await publicClient.getChainId();
assert.equal(actualChainId, chainId, "Target RPC chainId does not match RFQ_CHAIN_INTEGRATION_CHAIN_ID");

const block = await publicClient.getBlock({ blockTag: "latest" });
assert.equal(typeof block.number, "bigint", "Target RPC latest block must have a number");
assert.match(block.hash ?? "", /^0x[0-9a-fA-F]{64}$/, "Target RPC latest block must have a hash");
const blockTimestamp = Number(block.timestamp);
assert.equal(Number.isSafeInteger(blockTimestamp) && blockTimestamp > 0, true,
  "Target RPC latest block timestamp must be a positive safe integer");
const blockAgeSeconds = Math.floor(Date.now() / 1_000) - blockTimestamp;
assert.equal(
  blockAgeSeconds >= -maxFutureSkewSeconds && blockAgeSeconds <= maxBlockAgeSeconds,
  true,
  `Target RPC latest block age ${blockAgeSeconds}s is outside bounds`,
);

const [settlementArtifact, treasuryArtifact, factoryArtifact] = await Promise.all([
  loadArtifact("contracts/out/RFQSettlement.sol/RFQSettlement.json"),
  loadArtifact("contracts/out/Treasury.sol/Treasury.json"),
  loadArtifact("contracts/out/Deploy.s.sol/RFQDeploymentFactory.json"),
]);
const addressesWithArtifacts = [
  ["RFQSettlement", settlementAddress, settlementArtifact],
  ["Treasury", treasuryAddress, treasuryArtifact],
  ["RFQDeploymentFactory", factoryAddress, factoryArtifact],
];
const runtimeEvidence = {};
for (const [label, address, artifact] of addressesWithArtifacts) {
  const bytecode = await publicClient.getBytecode({ address, blockNumber: block.number });
  runtimeEvidence[label] = assertRuntimeBytecode(label, bytecode, artifact);
}
for (const token of whitelistedTokens) {
  const bytecode = await publicClient.getBytecode({ address: token, blockNumber: block.number });
  assert.equal(typeof bytecode === "string" && bytecode !== "0x", true,
    `Whitelisted token ${token} must contain runtime bytecode`);
}

const settlementAbi = parseAbi([
  "function owner() view returns (address)",
  "function treasury() view returns (address)",
  "function trustedSigner() view returns (address)",
  "function trustedSigners(address signer) view returns (bool)",
  "function trustedSignerCount() view returns (uint256)",
  "function tokenWhitelist(address token) view returns (bool)",
  "function tokenWhitelistCount() view returns (uint256)",
  "function paused() view returns (bool)",
  "function domainSeparator() view returns (bytes32)",
  "function hasRole(bytes32 role, address account) view returns (bool)",
  "function roleMemberCount(bytes32 role) view returns (uint256)",
]);
const treasuryAbi = parseAbi([
  "function owner() view returns (address)",
  "function settlement() view returns (address)",
]);
const readSettlement = (functionName, args = []) => publicClient.readContract({
  address: settlementAddress,
  abi: settlementAbi,
  functionName,
  args,
  blockNumber: block.number,
});

const [
  settlementOwner,
  configuredTreasury,
  primaryTrustedSigner,
  trustedSignerCount,
  tokenWhitelistCount,
  paused,
  domainSeparator,
  treasuryOwner,
  treasurySettlement,
] = await Promise.all([
  readSettlement("owner"),
  readSettlement("treasury"),
  readSettlement("trustedSigner"),
  readSettlement("trustedSignerCount"),
  readSettlement("tokenWhitelistCount"),
  readSettlement("paused"),
  readSettlement("domainSeparator"),
  publicClient.readContract({
    address: treasuryAddress,
    abi: treasuryAbi,
    functionName: "owner",
    blockNumber: block.number,
  }),
  publicClient.readContract({
    address: treasuryAddress,
    abi: treasuryAbi,
    functionName: "settlement",
    blockNumber: block.number,
  }),
]);

assert.equal(getAddress(settlementOwner), adminAddress, "RFQSettlement owner does not match expected admin");
assert.equal(getAddress(treasuryOwner), adminAddress, "Treasury owner does not match expected admin");
assert.equal(getAddress(configuredTreasury), treasuryAddress, "RFQSettlement does not reference expected Treasury");
assert.equal(getAddress(treasurySettlement), settlementAddress, "Treasury does not reference expected RFQSettlement");
assert.equal(getAddress(primaryTrustedSigner), trustedSignerConfig.primary,
  "RFQSettlement primary trusted signer does not match expected signer");
assert.equal(trustedSignerCount, BigInt(trustedSignerConfig.authorized.length),
  "RFQSettlement trusted signer count does not match the expected complete set");
assert.equal(tokenWhitelistCount, BigInt(whitelistedTokens.length),
  "RFQSettlement token whitelist count does not match the expected complete set");
assert.equal(paused, expectedPaused, "RFQSettlement pause state does not match deployment expectation");

const expectedDomainSeparator = computeDomainSeparator(chainId, settlementAddress);
assert.equal(domainSeparator, expectedDomainSeparator,
  "RFQSettlement EIP-712 domain separator does not match chain and contract address");

for (const signer of trustedSignerConfig.authorized) {
  assert.equal(await readSettlement("trustedSigners", [signer]), true,
    `Expected trusted signer ${signer} is not authorized`);
}
for (const token of whitelistedTokens) {
  assert.equal(await readSettlement("tokenWhitelist", [token]), true,
    `Expected token ${token} is not whitelisted`);
}

const roles = [
  ["DEFAULT_ADMIN_ROLE", `0x${"00".repeat(32)}`],
  ["SIGNER_ADMIN_ROLE", keccak256(toBytes("SIGNER_ADMIN_ROLE"))],
  ["TOKEN_ADMIN_ROLE", keccak256(toBytes("TOKEN_ADMIN_ROLE"))],
  ["TREASURY_ADMIN_ROLE", keccak256(toBytes("TREASURY_ADMIN_ROLE"))],
  ["PAUSER_ROLE", keccak256(toBytes("PAUSER_ROLE"))],
];
for (const [name, role] of roles) {
  const [adminAuthorized, factoryAuthorized, memberCount] = await Promise.all([
    readSettlement("hasRole", [role, adminAddress]),
    readSettlement("hasRole", [role, factoryAddress]),
    readSettlement("roleMemberCount", [role]),
  ]);
  assert.equal(adminAuthorized, true, `${name} is not assigned to the expected admin`);
  assert.equal(factoryAuthorized, false, `Deployment factory retained ${name}`);
  assert.equal(memberCount, 1n, `${name} must have exactly one post-deployment member`);
}

process.stdout.write(`${JSON.stringify({
  status: "ok",
  chainId,
  block: {
    number: block.number.toString(),
    hash: block.hash,
    timestamp: new Date(blockTimestamp * 1_000).toISOString(),
    ageSeconds: blockAgeSeconds,
  },
  contracts: {
    settlement: settlementAddress,
    treasury: treasuryAddress,
    factory: factoryAddress,
    runtime: runtimeEvidence,
  },
  administration: {
    admin: adminAddress,
    roleMemberCount: 1,
    factoryRetainsRoles: false,
  },
  signing: {
    primary: trustedSignerConfig.primary,
    authorizedCount: trustedSignerConfig.authorized.length,
    domainSeparator,
  },
  tokenWhitelistCount: whitelistedTokens.length,
  paused,
}, null, 2)}\n`);

function computeDomainSeparator(expectedChainId, verifyingContract) {
  return keccak256(encodeAbiParameters(
    [
      { type: "bytes32" },
      { type: "bytes32" },
      { type: "bytes32" },
      { type: "uint256" },
      { type: "address" },
    ],
    [
      keccak256(toBytes("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)")),
      keccak256(toBytes("ProductionGradeRFQ")),
      keccak256(toBytes("1")),
      BigInt(expectedChainId),
      verifyingContract,
    ],
  ));
}

async function loadArtifact(path) {
  const artifact = JSON.parse(await readFile(path, "utf8"));
  const deployedBytecode = artifact?.deployedBytecode;
  if (typeof deployedBytecode?.object !== "string" || !/^0x[0-9a-fA-F]+$/.test(deployedBytecode.object)) {
    throw new Error(`Contract artifact ${path} does not contain deployed bytecode`);
  }
  if (Object.keys(deployedBytecode.linkReferences ?? {}).length > 0) {
    throw new Error(`Contract artifact ${path} contains unresolved runtime links`);
  }
  return {
    bytecode: deployedBytecode.object,
    immutableReferences: deployedBytecode.immutableReferences ?? {},
  };
}

function assertRuntimeBytecode(label, actualBytecode, artifact) {
  assert.equal(typeof actualBytecode === "string" && actualBytecode !== "0x", true,
    `${label} address must contain runtime bytecode`);
  assert.equal(actualBytecode.length, artifact.bytecode.length,
    `${label} runtime bytecode length does not match the local artifact`);
  assert.equal(
    maskImmutableReferences(actualBytecode, artifact.immutableReferences),
    maskImmutableReferences(artifact.bytecode, artifact.immutableReferences),
    `${label} runtime bytecode does not match the local artifact outside immutable fields`,
  );
  return {
    byteLength: (actualBytecode.length - 2) / 2,
    codeHash: keccak256(actualBytecode),
    artifactMatched: true,
  };
}

function maskImmutableReferences(bytecode, immutableReferences) {
  const chars = bytecode.slice(2).toLowerCase().split("");
  for (const references of Object.values(immutableReferences)) {
    if (!Array.isArray(references)) throw new Error("Contract artifact immutable references are invalid");
    for (const reference of references) {
      if (!Number.isSafeInteger(reference?.start) || !Number.isSafeInteger(reference?.length) ||
          reference.start < 0 || reference.length <= 0 ||
          (reference.start + reference.length) * 2 > chars.length) {
        throw new Error("Contract artifact immutable reference range is invalid");
      }
      chars.fill("0", reference.start * 2, (reference.start + reference.length) * 2);
    }
  }
  return chars.join("");
}

function readTrustedSignerConfig() {
  const value = readJsonObject("RFQ_CHAIN_INTEGRATION_TRUSTED_SIGNERS_JSON", ["primary", "authorized"]);
  const primary = normalizeAddress(value.primary, "RFQ_CHAIN_INTEGRATION_TRUSTED_SIGNERS_JSON.primary");
  const authorized = readAddressArray(
    value.authorized,
    "RFQ_CHAIN_INTEGRATION_TRUSTED_SIGNERS_JSON.authorized",
    5,
  );
  if (!authorized.includes(primary)) {
    throw new Error("RFQ_CHAIN_INTEGRATION_TRUSTED_SIGNERS_JSON.authorized must include primary");
  }
  return { primary, authorized };
}

function readTokenWhitelist() {
  const value = readJsonObject("RFQ_CHAIN_INTEGRATION_TOKEN_WHITELIST_JSON", ["tokens"]);
  return readAddressArray(value.tokens, "RFQ_CHAIN_INTEGRATION_TOKEN_WHITELIST_JSON.tokens", 256);
}

function readJsonObject(field, fields) {
  const raw = process.env[field];
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 32_768) {
    throw new Error(`${field} must be a non-empty bounded JSON object`);
  }
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error(`${field} must be valid JSON`);
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${field} must be a JSON object`);
  }
  const actualFields = Object.keys(value).sort();
  const expectedFields = [...fields].sort();
  assert.deepEqual(actualFields, expectedFields, `${field} must contain exactly ${expectedFields.join(", ")}`);
  return value;
}

function readAddressArray(value, field, maxLength) {
  if (!Array.isArray(value) || value.length === 0 || value.length > maxLength) {
    throw new Error(`${field} must contain 1-${maxLength} addresses`);
  }
  const addresses = value.map((address, index) => normalizeAddress(address, `${field}[${index}]`));
  if (new Set(addresses).size !== addresses.length) throw new Error(`${field} must not contain duplicates`);
  return addresses;
}

function readAddress(field) {
  return normalizeAddress(process.env[field], field);
}

function normalizeAddress(value, field) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value) || /^0x0{40}$/i.test(value)) {
    throw new Error(`${field} must be a non-zero 20-byte hex address`);
  }
  try {
    return getAddress(value);
  } catch {
    throw new Error(`${field} must have a valid address checksum when mixed case is used`);
  }
}

function readRpcUrl(field) {
  const value = process.env[field];
  if (typeof value !== "string" || value.length === 0 || value.length > 2_048 || /\s/.test(value)) {
    throw new Error(`${field} must be a bounded HTTP(S) URL without whitespace`);
  }
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${field} must be an absolute HTTP(S) URL`);
  }
  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.hash.length > 0) {
    throw new Error(`${field} must be an HTTP(S) URL without a fragment`);
  }
  return value;
}

function readBoolean(field, fallback) {
  const value = process.env[field];
  if (value === undefined || value.length === 0) return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${field} must be true or false`);
}

function readInteger(field, fallback, min, max) {
  const value = process.env[field];
  if (value === undefined || value.length === 0) {
    if (fallback !== undefined) return fallback;
    throw new Error(`${field} is required`);
  }
  if (!/^(0|[1-9][0-9]*)$/.test(value)) throw new Error(`${field} must be an integer between ${min} and ${max}`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${field} must be an integer between ${min} and ${max}`);
  }
  return parsed;
}
