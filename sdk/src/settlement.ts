import { rfqSettlementAbi } from "./abi.js";
import type { Address, Quote, UIntString } from "./types.js";

const SECP256K1N_HALF = BigInt("0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0");
const settlementQuoteFields = [
  "user",
  "tokenIn",
  "tokenOut",
  "amountIn",
  "amountOut",
  "minAmountOut",
  "nonce",
  "deadline",
  "chainId",
] as const;
const submitQuoteWriteRequestFields = ["settlementAddress", "quote", "signature"] as const;
const treasuryTransferFields = ["token", "to", "amount"] as const;

export interface SettlementQuote {
  user: Address;
  tokenIn: Address;
  tokenOut: Address;
  amountIn: bigint;
  amountOut: bigint;
  minAmountOut: bigint;
  nonce: bigint;
  deadline: bigint;
  chainId: bigint;
}

export type SubmitQuoteArgs = readonly [SettlementQuote, `0x${string}`];
export type TreasuryTransferArgs = readonly [Address, Address, bigint];

export interface SubmitQuoteWriteRequestInput {
  settlementAddress: Address;
  quote: Quote;
  signature: `0x${string}`;
}

export interface SubmitQuoteWriteRequest {
  address: Address;
  abi: typeof rfqSettlementAbi;
  functionName: "submitQuote";
  args: SubmitQuoteArgs;
}

export interface TreasuryTransferInput {
  token: Address;
  to: Address;
  amount: UIntString | bigint;
}

export function toSettlementQuote(quote: Quote): SettlementQuote {
  assertRecord(quote, "quote");
  assertExactFields(quote, settlementQuoteFields, "quote");

  const tokenIn = parseAddress(quote.tokenIn, "quote.tokenIn");
  const tokenOut = parseAddress(quote.tokenOut, "quote.tokenOut");
  const amountOut = parsePositiveUInt(quote.amountOut, "quote.amountOut");
  const minAmountOut = parsePositiveUInt(quote.minAmountOut, "quote.minAmountOut");

  if (tokenIn.toLowerCase() === tokenOut.toLowerCase()) {
    throw new Error("quote.tokenIn and quote.tokenOut must be different");
  }
  if (amountOut < minAmountOut) {
    throw new Error("quote.amountOut must be greater than or equal to quote.minAmountOut");
  }

  return {
    user: parseAddress(quote.user, "quote.user"),
    tokenIn,
    tokenOut,
    amountIn: parsePositiveUInt(quote.amountIn, "quote.amountIn"),
    amountOut,
    minAmountOut,
    nonce: parsePositiveUInt(quote.nonce, "quote.nonce"),
    deadline: parsePositiveInteger(quote.deadline, "quote.deadline"),
    chainId: parsePositiveInteger(quote.chainId, "quote.chainId"),
  };
}

export function buildSubmitQuoteArgs(quote: Quote, signature: `0x${string}`): SubmitQuoteArgs {
  return [toSettlementQuote(quote), parseSignature(signature, "signature")] as const;
}

export function buildSubmitQuoteWriteRequest(input: SubmitQuoteWriteRequestInput): SubmitQuoteWriteRequest {
  assertRecord(input, "submit quote write request input");
  assertExactFields(input, submitQuoteWriteRequestFields, "submit quote write request input");

  return {
    address: parseAddress(input.settlementAddress, "settlementAddress"),
    abi: rfqSettlementAbi,
    functionName: "submitQuote",
    args: buildSubmitQuoteArgs(input.quote, input.signature),
  };
}

export function buildTreasuryTransferArgs(input: TreasuryTransferInput): TreasuryTransferArgs {
  assertRecord(input, "treasury transfer input");
  assertExactFields(input, treasuryTransferFields, "treasury transfer input");

  return [parseAddress(input.token, "token"), parseAddress(input.to, "to"), parseUInt(input.amount, "amount")] as const;
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

function parseAddress(value: Address, field: string): Address {
  if (typeof value !== "string" || !/^0x[a-fA-F0-9]{40}$/.test(value)) {
    throw new Error(`${field} must be a 20-byte hex address`);
  }

  return value;
}

function parseSignature(value: `0x${string}`, field: string): `0x${string}` {
  if (typeof value !== "string" || !/^0x[a-fA-F0-9]{130}$/.test(value)) {
    throw new Error(`${field} must be a 65-byte hex signature`);
  }

  const s = BigInt(`0x${value.slice(66, 130)}`);
  if (s > SECP256K1N_HALF) {
    throw new Error(`${field} s value must be in the lower half order`);
  }

  const v = Number.parseInt(value.slice(130, 132), 16);
  const normalizedV = v < 27 ? v + 27 : v;
  if (normalizedV !== 27 && normalizedV !== 28) {
    throw new Error(`${field} v value must be 27 or 28`);
  }

  return value;
}

function parsePositiveUInt(value: UIntString, field: string): bigint {
  if (typeof value !== "string" || !/^[1-9][0-9]*$/.test(value)) {
    throw new Error(`${field} must be a positive uint string`);
  }

  return BigInt(value);
}

function parseUInt(value: UIntString | bigint, field: string): bigint {
  if (typeof value === "bigint") {
    if (value < 0n) {
      throw new Error(`${field} must be a uint`);
    }

    return value;
  }

  if (typeof value !== "string" || !/^[0-9]+$/.test(value)) {
    throw new Error(`${field} must be a uint string`);
  }

  return BigInt(value);
}

function parsePositiveInteger(value: number, field: string): bigint {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${field} must be a positive safe integer`);
  }

  return BigInt(value);
}
