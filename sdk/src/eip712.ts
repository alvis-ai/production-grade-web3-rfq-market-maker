import type { Address, Quote } from "./types.js";
import { toSettlementQuote } from "./settlement.js";

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
  toSettlementQuote(quote);
}

function parseAddress(value: Address, field: string): Address {
  if (typeof value !== "string" || !/^0x[a-fA-F0-9]{40}$/.test(value)) {
    throw new Error(`${field} must be a 20-byte hex address`);
  }

  return value;
}

function parsePositiveInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${field} must be a positive safe integer`);
  }

  return value;
}
