import type { Address, Quote } from "./types.js";

export const RFQ_EIP712_DOMAIN_NAME = "ProductionGradeRFQ";
export const RFQ_EIP712_DOMAIN_VERSION = "1";

export const quoteTypes = {
  Quote: [
    { name: "user", type: "address" },
    { name: "tokenIn", type: "address" },
    { name: "tokenOut", type: "address" },
    { name: "amountIn", type: "uint256" },
    { name: "amountOut", type: "uint256" },
    { name: "minAmountOut", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
    { name: "chainId", type: "uint256" },
  ],
} as const;

export interface RFQDomain {
  name: typeof RFQ_EIP712_DOMAIN_NAME;
  version: typeof RFQ_EIP712_DOMAIN_VERSION;
  chainId: number;
  verifyingContract: Address;
}

export function buildRFQDomain(chainId: number, verifyingContract: Address): RFQDomain {
  return {
    name: RFQ_EIP712_DOMAIN_NAME,
    version: RFQ_EIP712_DOMAIN_VERSION,
    chainId: parsePositiveInteger(chainId, "chainId"),
    verifyingContract: parseAddress(verifyingContract, "verifyingContract"),
  };
}

export function buildQuoteTypedData(quote: Quote, verifyingContract: Address) {
  assertQuoteShape(quote);

  return {
    domain: buildRFQDomain(quote.chainId, verifyingContract),
    types: quoteTypes,
    primaryType: "Quote",
    message: quote,
  } as const;
}

function assertQuoteShape(quote: Quote): void {
  assertRecord(quote, "quote");
  parseAddress(quote.user, "quote.user");
  parseAddress(quote.tokenIn, "quote.tokenIn");
  parseAddress(quote.tokenOut, "quote.tokenOut");
  if (quote.tokenIn.toLowerCase() === quote.tokenOut.toLowerCase()) {
    throw new Error("quote.tokenIn and quote.tokenOut must be different");
  }
  parsePositiveUInt(quote.amountIn, "quote.amountIn");
  const amountOut = parsePositiveUInt(quote.amountOut, "quote.amountOut");
  const minAmountOut = parsePositiveUInt(quote.minAmountOut, "quote.minAmountOut");
  if (amountOut < minAmountOut) {
    throw new Error("quote.amountOut must be greater than or equal to quote.minAmountOut");
  }
  parseUInt(quote.nonce, "quote.nonce");
  parsePositiveInteger(quote.deadline, "quote.deadline");
  parsePositiveInteger(quote.chainId, "quote.chainId");
}

function assertRecord(value: unknown, field: string): void {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${field} must be an object`);
  }
}

function parseAddress(value: Address, field: string): Address {
  if (!/^0x[a-fA-F0-9]{40}$/.test(value)) {
    throw new Error(`${field} must be a 20-byte hex address`);
  }

  return value;
}

function parsePositiveUInt(value: string, field: string): bigint {
  const parsed = parseUInt(value, field);
  if (parsed <= 0n) {
    throw new Error(`${field} must be a positive uint string`);
  }

  return parsed;
}

function parseUInt(value: string, field: string): bigint {
  if (!/^[0-9]+$/.test(value)) {
    throw new Error(`${field} must be a uint string`);
  }

  return BigInt(value);
}

function parsePositiveInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${field} must be a positive safe integer`);
  }

  return value;
}
