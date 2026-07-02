import { APIError } from "../errors/api-error.js";
import type { Address, SubmitQuoteRequest } from "../types/rfq.js";
import { assertExactFields } from "./object-fields.js";

const ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;
const HEX_PATTERN = /^0x[a-fA-F0-9]+$/;
const UINT_PATTERN = /^[0-9]+$/;
const POSITIVE_UINT_PATTERN = /^[1-9][0-9]*$/;
const SECP256K1N_HALF = BigInt("0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0");
const SUBMIT_REQUEST_FIELDS = ["quote", "signature"];
const SIGNED_QUOTE_FIELDS = [
  "user",
  "tokenIn",
  "tokenOut",
  "amountIn",
  "amountOut",
  "minAmountOut",
  "nonce",
  "deadline",
  "chainId",
];

export interface SubmitQuoteRequestValidationOptions {
  allowExpired?: boolean;
}

export function validateSubmitQuoteRequest(
  input: unknown,
  options: SubmitQuoteRequestValidationOptions = {},
): SubmitQuoteRequest {
  if (!isRecord(input) || !isRecord(input.quote)) {
    throw new APIError("INVALID_REQUEST", "Submit request must include a quote object", 400);
  }

  assertExactFields(input, SUBMIT_REQUEST_FIELDS, "Submit request");

  const quote = input.quote;
  assertExactFields(quote, SIGNED_QUOTE_FIELDS, "Submit quote");

  const signature = readSignature(input.signature);

  if (!HEX_PATTERN.test(signature)) {
    throw new APIError("INVALID_REQUEST", "signature must be hex encoded", 400);
  }
  if (signature.length !== 132) {
    throw new APIError("INVALID_REQUEST", "signature must be 65 bytes", 400);
  }
  assertCanonicalSignature(signature);

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
  if (!options.allowExpired && deadline < Math.floor(Date.now() / 1000)) {
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
      nonce: readPositiveUint(quote.nonce, "quote.nonce"),
      deadline,
      chainId: readPositiveInteger(quote.chainId, "quote.chainId"),
    },
    signature: signature as `0x${string}`,
  };
}

function assertCanonicalSignature(signature: string): void {
  const s = BigInt(`0x${signature.slice(66, 130)}`);
  if (s > SECP256K1N_HALF) {
    throw new APIError("INVALID_REQUEST", "signature s value must be in the lower half order", 400);
  }

  const v = Number.parseInt(signature.slice(130, 132), 16);
  const normalizedV = v < 27 ? v + 27 : v;
  if (normalizedV !== 27 && normalizedV !== 28) {
    throw new APIError("INVALID_REQUEST", "signature v value must be 27 or 28", 400);
  }
}

function readAddress(input: unknown, field: string): Address {
  if (typeof input !== "string" || !ADDRESS_PATTERN.test(input)) {
    throw new APIError("INVALID_REQUEST", `${field} must be an EVM address`, 400);
  }

  return input as Address;
}

function readUint(input: unknown, field: string): string {
  if (typeof input !== "string" || !UINT_PATTERN.test(input)) {
    throw new APIError("INVALID_REQUEST", `${field} must be a uint string`, 400);
  }

  return input;
}

function readPositiveUint(input: unknown, field: string): string {
  const value = readUint(input, field);
  if (!POSITIVE_UINT_PATTERN.test(value)) {
    throw new APIError("INVALID_REQUEST", `${field} must be a positive uint string`, 400);
  }

  return value;
}

function readPositiveInteger(input: unknown, field: string): number {
  if (typeof input !== "number" || !Number.isSafeInteger(input) || input <= 0) {
    throw new APIError("INVALID_REQUEST", `${field} must be a positive safe integer`, 400);
  }

  return input;
}

function readSignature(input: unknown): `0x${string}` {
  if (typeof input !== "string") {
    throw new APIError("INVALID_REQUEST", "signature must be hex encoded", 400);
  }

  return input as `0x${string}`;
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}
