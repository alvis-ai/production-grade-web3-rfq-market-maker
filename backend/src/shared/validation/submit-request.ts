import { APIError } from "../errors/api-error.js";
import type { Address, SubmitQuoteRequest } from "../types/rfq.js";

const ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;
const HEX_PATTERN = /^0x[a-fA-F0-9]+$/;
const UINT_PATTERN = /^[0-9]+$/;

export function validateSubmitQuoteRequest(input: unknown): SubmitQuoteRequest {
  if (!isRecord(input) || !isRecord(input.quote)) {
    throw new APIError("INVALID_REQUEST", "Submit request must include a quote object", 400);
  }

  const quote = input.quote;
  const signature = String(input.signature ?? "");

  if (!HEX_PATTERN.test(signature)) {
    throw new APIError("INVALID_REQUEST", "signature must be hex encoded", 400);
  }
  if (signature.length !== 132) {
    throw new APIError("INVALID_REQUEST", "signature must be 65 bytes", 400);
  }

  const user = readAddress(quote.user, "quote.user");
  const tokenIn = readAddress(quote.tokenIn, "quote.tokenIn");
  const tokenOut = readAddress(quote.tokenOut, "quote.tokenOut");
  if (tokenIn.toLowerCase() === tokenOut.toLowerCase()) {
    throw new APIError("INVALID_REQUEST", "quote.tokenIn and quote.tokenOut must be different", 400);
  }

  const amountIn = readPositiveUint(quote.amountIn, "quote.amountIn");
  const amountOut = readPositiveUint(quote.amountOut, "quote.amountOut");
  const minAmountOut = readPositiveUint(quote.minAmountOut, "quote.minAmountOut");
  if (BigInt(amountOut) < BigInt(minAmountOut)) {
    throw new APIError("INVALID_REQUEST", "quote.amountOut must be greater than or equal to quote.minAmountOut", 400);
  }
  const deadline = readPositiveInteger(quote.deadline, "quote.deadline");
  if (deadline < Math.floor(Date.now() / 1000)) {
    throw new APIError("QUOTE_EXPIRED", "Quote expired", 409);
  }

  return {
    quote: {
      user,
      tokenIn,
      tokenOut,
      amountIn,
      amountOut,
      minAmountOut,
      nonce: readUint(quote.nonce, "quote.nonce"),
      deadline,
      chainId: readPositiveInteger(quote.chainId, "quote.chainId"),
    },
    signature: signature as `0x${string}`,
  };
}

function readAddress(input: unknown, field: string): Address {
  const value = String(input ?? "");
  if (!ADDRESS_PATTERN.test(value)) {
    throw new APIError("INVALID_REQUEST", `${field} must be an EVM address`, 400);
  }

  return value as Address;
}

function readUint(input: unknown, field: string): string {
  const value = String(input ?? "");
  if (!UINT_PATTERN.test(value)) {
    throw new APIError("INVALID_REQUEST", `${field} must be a uint string`, 400);
  }

  return value;
}

function readPositiveUint(input: unknown, field: string): string {
  const value = readUint(input, field);
  if (BigInt(value) <= 0n) {
    throw new APIError("INVALID_REQUEST", `${field} must be a positive uint string`, 400);
  }

  return value;
}

function readPositiveInteger(input: unknown, field: string): number {
  const value = Number(input);
  if (!Number.isInteger(value) || value <= 0) {
    throw new APIError("INVALID_REQUEST", `${field} must be a positive integer`, 400);
  }

  return value;
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}
