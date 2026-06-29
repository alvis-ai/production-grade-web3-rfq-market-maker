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

  const chainId = Number(input.chainId);
  const user = String(input.user ?? "");
  const tokenIn = String(input.tokenIn ?? "");
  const tokenOut = String(input.tokenOut ?? "");
  const amountIn = String(input.amountIn ?? "");
  const slippageBps = Number(input.slippageBps);

  if (!Number.isSafeInteger(chainId) || chainId <= 0) {
    throw new APIError("INVALID_REQUEST", "chainId must be a positive safe integer", 400);
  }
  if (!isAddress(user)) {
    throw new APIError("INVALID_REQUEST", "user must be an EVM address", 400);
  }
  if (!isAddress(tokenIn)) {
    throw new APIError("INVALID_REQUEST", "tokenIn must be an EVM address", 400);
  }
  if (!isAddress(tokenOut)) {
    throw new APIError("INVALID_REQUEST", "tokenOut must be an EVM address", 400);
  }
  if (tokenIn.toLowerCase() === tokenOut.toLowerCase()) {
    throw new APIError("INVALID_REQUEST", "tokenIn and tokenOut must be different", 400);
  }
  if (!UINT_PATTERN.test(amountIn) || BigInt(amountIn) <= 0n) {
    throw new APIError("INVALID_REQUEST", "amountIn must be a positive uint string", 400);
  }
  if (!Number.isInteger(slippageBps) || slippageBps < 0 || slippageBps > 10000) {
    throw new APIError("INVALID_REQUEST", "slippageBps must be an integer from 0 to 10000", 400);
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

function isAddress(input: string): boolean {
  return ADDRESS_PATTERN.test(input);
}
