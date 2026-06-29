#!/usr/bin/env node

import { readFile } from "node:fs/promises";

const backendSigner = await readFile("backend/src/modules/signer/signer.service.ts", "utf8");
const backendSettlement = await readFile("backend/src/modules/settlement/settlement-event.service.ts", "utf8");
const sdkEip712 = await readFile("sdk/src/eip712.ts", "utf8");
const sdkQuoteHash = await readFile("sdk/src/quote-hash.ts", "utf8");
const settlement = await readFile("contracts/src/RFQSettlement.sol", "utf8");

const backendDomain = extractTsDomain(backendSigner);
const sdkDomain = extractTsDomain(sdkEip712);
const contractDomain = extractContractDomain(settlement);

assertDeepEqual(backendDomain, sdkDomain, "backend signer domain must match SDK domain");
assertDeepEqual(sdkDomain, contractDomain, "SDK domain must match RFQSettlement domain");

const backendFields = extractTsQuoteFields(backendSigner);
const sdkFields = extractTsQuoteFields(sdkEip712);
const backendSettlementFields = extractQuoteTypeStringFields(backendSettlement, "backend settlement quote hash");
const sdkSettlementFields = extractQuoteTypeStringFields(sdkQuoteHash, "SDK settlement quote hash");
const contractFields = extractContractQuoteFields(settlement);

assertDeepEqual(backendFields, sdkFields, "backend signer Quote fields must match SDK Quote fields");
assertDeepEqual(sdkFields, contractFields, "SDK Quote fields must match RFQSettlement QUOTE_TYPEHASH");
assertDeepEqual(backendSettlementFields, contractFields, "backend settlement quote hash fields must match RFQSettlement QUOTE_TYPEHASH");
assertDeepEqual(sdkSettlementFields, contractFields, "SDK settlement quote hash fields must match RFQSettlement QUOTE_TYPEHASH");

console.log("EIP-712 consistency check passed");

function extractTsDomain(source) {
  return {
    name: capture(source, /RFQ_EIP712_DOMAIN_NAME\s*=\s*"([^"]+)"/, "TS domain name"),
    version: capture(source, /RFQ_EIP712_DOMAIN_VERSION\s*=\s*"([^"]+)"/, "TS domain version"),
  };
}

function extractContractDomain(source) {
  return {
    name: capture(source, /NAME_HASH\s*=\s*keccak256\("([^"]+)"\)/, "contract domain name"),
    version: capture(source, /VERSION_HASH\s*=\s*keccak256\("([^"]+)"\)/, "contract domain version"),
  };
}

function extractTsQuoteFields(source) {
  const quoteBlock = capture(source, /Quote:\s*\[([\s\S]*?)\]\s*,/m, "TS Quote field block");
  return [...quoteBlock.matchAll(/\{\s*name:\s*"([^"]+)",\s*type:\s*"([^"]+)"\s*\}/g)].map(
    ([, name, type]) => ({ name, type }),
  );
}

function extractContractQuoteFields(source) {
  const typeHash = capture(source, /QUOTE_TYPEHASH\s*=\s*keccak256\(\s*"([^"]+)"\s*\)/m, "contract quote typehash");
  return extractQuoteFieldsFromTypeString(typeHash, "contract Quote fields");
}

function extractQuoteTypeStringFields(source, label) {
  const typeString = capture(source, /"Quote\(([^"]+)\)"/m, label);
  return extractQuoteFieldsFromTypeString(`Quote(${typeString})`, label);
}

function extractQuoteFieldsFromTypeString(typeString, label) {
  const fields = capture(typeString, /^Quote\((.*)\)$/, label);
  return fields.split(",").map((field) => {
    const [type, name] = field.trim().split(/\s+/);
    return { name, type };
  });
}

function capture(source, pattern, label) {
  const match = source.match(pattern);
  if (!match?.[1]) {
    throw new Error(`Unable to extract ${label}`);
  }

  return match[1];
}

function assertDeepEqual(actual, expected, label) {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(`${label}\nactual: ${actualJson}\nexpected: ${expectedJson}`);
  }
}
