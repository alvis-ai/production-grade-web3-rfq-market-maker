import type { Address, QuoteRequest } from "@rfq-market-maker/sdk";

const addressPattern = /^0x[a-fA-F0-9]{40}$/;
const uintPattern = /^[0-9]+$/;

export function validateQuoteFormRequest(request: QuoteRequest): QuoteRequest {
  if (!Number.isSafeInteger(request.chainId) || request.chainId <= 0) {
    throw new Error("chainId must be a positive safe integer");
  }
  const user = readAddress(request.user, "user");
  const tokenIn = readAddress(request.tokenIn, "tokenIn");
  const tokenOut = readAddress(request.tokenOut, "tokenOut");
  if (tokenIn.toLowerCase() === tokenOut.toLowerCase()) {
    throw new Error("tokenIn and tokenOut must be different");
  }
  const amountIn = readPositiveAmountIn(request.amountIn);
  if (!Number.isInteger(request.slippageBps) || request.slippageBps < 0 || request.slippageBps > 10_000) {
    throw new Error("slippageBps must be an integer from 0 to 10000");
  }

  return {
    chainId: request.chainId,
    user,
    tokenIn,
    tokenOut,
    amountIn,
    slippageBps: request.slippageBps,
  };
}

function readAddress(value: string, field: keyof Pick<QuoteRequest, "user" | "tokenIn" | "tokenOut">): Address {
  if (!addressPattern.test(value)) {
    throw new Error(`${field} must be an EVM address`);
  }

  return value as Address;
}

function readPositiveAmountIn(value: string): string {
  if (!uintPattern.test(value) || BigInt(value) <= 0n) {
    throw new Error("amountIn must be a positive uint string");
  }

  return value;
}
