import { APIError } from "../errors/api-error.js";
import type { Address, QuoteRequest } from "../types/rfq.js";
import { assertExactFields } from "./object-fields.js";

const ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;
const UINT_PATTERN = /^[0-9]+$/;
const QUOTE_REQUEST_FIELDS = ["chainId", "user", "tokenIn", "tokenOut", "amountIn", "slippageBps"];

export function validateQuoteRequest(input: unknown): QuoteRequest {
  if (!isRecord(input)) {
    throw new APIError("INVALID_REQUEST", "Request body must be a JSON object", 400);
  }

  assertExactFields(input, QUOTE_REQUEST_FIELDS, "Quote request");

  const chainId = readPositiveSafeInteger(input.chainId, "chainId");
  const user = readAddress(input.user, "user");
  const tokenIn = readAddress(input.tokenIn, "tokenIn");
  const tokenOut = readAddress(input.tokenOut, "tokenOut");
  const amountIn = readPositiveUint(input.amountIn, "amountIn");
  const slippageBps = readBasisPoints(input.slippageBps, "slippageBps");

  if (tokenIn.toLowerCase() === tokenOut.toLowerCase()) {
    throw new APIError("INVALID_REQUEST", "tokenIn and tokenOut must be different", 400);
  }
  return {
    chainId,
    user: user as Address,
    tokenIn: tokenIn as Address,
    tokenOut: tokenOut as Address,
    amountIn,
    slippageBps,
  };
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

function readAddress(input: unknown, field: string): string {
  if (typeof input !== "string" || !ADDRESS_PATTERN.test(input)) {
    throw new APIError("INVALID_REQUEST", `${field} must be an EVM address`, 400);
  }

  return input;
}

function readPositiveUint(input: unknown, field: string): string {
  if (typeof input !== "string" || !UINT_PATTERN.test(input) || BigInt(input) <= 0n) {
    throw new APIError("INVALID_REQUEST", `${field} must be a positive uint string`, 400);
  }

  return input;
}

function readPositiveSafeInteger(input: unknown, field: string): number {
  if (typeof input !== "number" || !Number.isSafeInteger(input) || input <= 0) {
    throw new APIError("INVALID_REQUEST", `${field} must be a positive safe integer`, 400);
  }

  return input;
}

function readBasisPoints(input: unknown, field: string): number {
  if (typeof input !== "number" || !Number.isInteger(input) || input < 0 || input > 10000) {
    throw new APIError("INVALID_REQUEST", `${field} must be an integer from 0 to 10000`, 400);
  }

  return input;
}
