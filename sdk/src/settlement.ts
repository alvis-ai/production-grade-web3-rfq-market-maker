import { encodeAbiParameters, keccak256, toBytes } from "viem";
import type { Address, Quote, UIntString } from "./types.js";

const quoteTypeHash = keccak256(
  toBytes(
    "Quote(address user,address tokenIn,address tokenOut,uint256 amountIn,uint256 amountOut,uint256 minAmountOut,uint256 nonce,uint256 deadline,uint256 chainId)",
  ),
);

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

export interface TreasuryTransferInput {
  token: Address;
  to: Address;
  amount: UIntString | bigint;
}

export function toSettlementQuote(quote: Quote): SettlementQuote {
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
    nonce: parseUInt(quote.nonce, "quote.nonce"),
    deadline: parsePositiveInteger(quote.deadline, "quote.deadline"),
    chainId: parsePositiveInteger(quote.chainId, "quote.chainId"),
  };
}

export function buildSubmitQuoteArgs(quote: Quote, signature: `0x${string}`): SubmitQuoteArgs {
  return [toSettlementQuote(quote), parseSignature(signature, "signature")] as const;
}

export function hashSettlementQuote(quote: Quote): `0x${string}` {
  const settlementQuote = toSettlementQuote(quote);

  return keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "address" },
        { type: "address" },
        { type: "address" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "uint256" },
      ],
      [
        quoteTypeHash,
        settlementQuote.user,
        settlementQuote.tokenIn,
        settlementQuote.tokenOut,
        settlementQuote.amountIn,
        settlementQuote.amountOut,
        settlementQuote.minAmountOut,
        settlementQuote.nonce,
        settlementQuote.deadline,
        settlementQuote.chainId,
      ],
    ),
  );
}

export function buildTreasuryTransferArgs(input: TreasuryTransferInput): TreasuryTransferArgs {
  return [parseAddress(input.token, "token"), parseAddress(input.to, "to"), parseUInt(input.amount, "amount")] as const;
}

function parseAddress(value: Address, field: string): Address {
  if (!/^0x[a-fA-F0-9]{40}$/.test(value)) {
    throw new Error(`${field} must be a 20-byte hex address`);
  }

  return value;
}

function parseSignature(value: `0x${string}`, field: string): `0x${string}` {
  if (!/^0x[a-fA-F0-9]{130}$/.test(value)) {
    throw new Error(`${field} must be a 65-byte hex signature`);
  }

  return value;
}

function parsePositiveUInt(value: UIntString, field: string): bigint {
  const parsed = parseUInt(value, field);
  if (parsed <= 0n) {
    throw new Error(`${field} must be a positive uint string`);
  }

  return parsed;
}

function parseUInt(value: UIntString | bigint, field: string): bigint {
  if (typeof value === "bigint") {
    if (value < 0n) {
      throw new Error(`${field} must be a uint`);
    }

    return value;
  }

  if (!/^[0-9]+$/.test(value)) {
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
