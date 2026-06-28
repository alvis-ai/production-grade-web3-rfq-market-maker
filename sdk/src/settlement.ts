import type { Address, Quote, UIntString } from "./types.js";

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

export function buildTreasuryTransferArgs(input: TreasuryTransferInput): TreasuryTransferArgs {
  return [input.token, input.to, BigInt(input.amount)] as const;
}
