import type { Address, QuoteRequest } from "@rfq-market-maker/sdk";

const addressPattern = /^0x[a-fA-F0-9]{40}$/;
const positiveUintPattern = /^[1-9][0-9]*$/;
const quoteFormRequestFields = ["chainId", "user", "tokenIn", "tokenOut", "amountIn", "slippageBps"] as const;

export function validateQuoteFormRequest(request: QuoteRequest): QuoteRequest {
  assertRecord(request, "quote form request");
  assertExactFields(request, quoteFormRequestFields, "quote form request");

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

function assertRecord(value: unknown, field: string): void {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${field} must be an object`);
  }
}

function assertExactFields(value: object, expectedFields: readonly string[], label: string): void {
  const expected = new Set(expectedFields);
  for (const key of Object.keys(value)) {
    if (!expected.has(key)) {
      throw new Error(`${label} must not include unknown field ${key}`);
    }
  }

  for (const field of expectedFields) {
    if (!Object.prototype.hasOwnProperty.call(value, field)) {
      throw new Error(`${label}.${field} must be an own field`);
    }
  }
}

function readAddress(value: unknown, field: keyof Pick<QuoteRequest, "user" | "tokenIn" | "tokenOut">): Address {
  if (typeof value !== "string" || !addressPattern.test(value)) {
    throw new Error(`${field} must be an EVM address`);
  }

  return value as Address;
}

function readPositiveAmountIn(value: unknown): string {
  if (typeof value !== "string" || !positiveUintPattern.test(value)) {
    throw new Error("amountIn must be a positive uint string");
  }

  return value;
}
