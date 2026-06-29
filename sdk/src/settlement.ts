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
  return {
    user: quote.user,
    tokenIn: quote.tokenIn,
    tokenOut: quote.tokenOut,
    amountIn: BigInt(quote.amountIn),
    amountOut: BigInt(quote.amountOut),
    minAmountOut: BigInt(quote.minAmountOut),
    nonce: BigInt(quote.nonce),
    deadline: BigInt(quote.deadline),
    chainId: BigInt(quote.chainId),
  };
}

export function buildSubmitQuoteArgs(quote: Quote, signature: `0x${string}`): SubmitQuoteArgs {
  return [toSettlementQuote(quote), signature] as const;
}

export function hashSettlementQuote(quote: Quote): `0x${string}` {
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
        quote.user,
        quote.tokenIn,
        quote.tokenOut,
        BigInt(quote.amountIn),
        BigInt(quote.amountOut),
        BigInt(quote.minAmountOut),
        BigInt(quote.nonce),
        BigInt(quote.deadline),
        BigInt(quote.chainId),
      ],
    ),
  );
}

export function buildTreasuryTransferArgs(input: TreasuryTransferInput): TreasuryTransferArgs {
  return [input.token, input.to, BigInt(input.amount)] as const;
}
