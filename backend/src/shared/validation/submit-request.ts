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

  return {
    quote: {
      user: readAddress(quote.user, "quote.user"),
      tokenIn: readAddress(quote.tokenIn, "quote.tokenIn"),
      tokenOut: readAddress(quote.tokenOut, "quote.tokenOut"),
      amountIn: readUint(quote.amountIn, "quote.amountIn"),
      amountOut: readUint(quote.amountOut, "quote.amountOut"),
      minAmountOut: readUint(quote.minAmountOut, "quote.minAmountOut"),
      nonce: readUint(quote.nonce, "quote.nonce"),
      deadline: readPositiveInteger(quote.deadline, "quote.deadline"),
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
