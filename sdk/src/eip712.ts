import type { Address, Quote } from "./types.js";

export const RFQ_EIP712_DOMAIN_NAME = "RFQSettlement";
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
    chainId,
    verifyingContract,
  };
}

export function buildQuoteTypedData(quote: Quote, verifyingContract: Address) {
  return {
    domain: buildRFQDomain(quote.chainId, verifyingContract),
    types: quoteTypes,
    primaryType: "Quote",
    message: quote,
  } as const;
}
