import type { Address, Quote, QuoteResponse } from "@rfq-market-maker/sdk";

const walletQuoteFields = [
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
const quoteResponseFields = ["quoteId", "snapshotId", "amountOut", "minAmountOut", "deadline", "nonce", "signature"] as const;
const evmAddressPattern = /^0x[a-fA-F0-9]{40}$/;
const signaturePattern = /^0x[a-fA-F0-9]{130}$/;

export interface WalletState {
  address?: Address;
  chainId?: number;
}

export interface WalletSubmitInput {
  quote?: QuoteResponse;
  signedQuote?: Quote;
  wallet: WalletState;
}

export type WalletSubmitPreparation =
  | {
      ok: true;
      quote: Quote;
      signature: `0x${string}`;
    }
  | {
      ok: false;
      error: string;
    };

export function walletMatchesQuote(signedQuote: Quote | undefined, wallet: WalletState): boolean {
  const walletQuote = readOwnWalletQuote(signedQuote);
  if (!walletQuote || !wallet.address) return false;

  return wallet.address.toLowerCase() === walletQuote.user.toLowerCase() && wallet.chainId === walletQuote.chainId;
}

export function prepareWalletSubmit(input: WalletSubmitInput): WalletSubmitPreparation {
  if (!input.wallet.address) {
    return { ok: false, error: "Connect wallet before submitting onchain" };
  }

  const walletQuote = readOwnWalletQuote(input.signedQuote);
  if (!walletQuote) {
    return { ok: false, error: "Signed quote must provide closed own wallet submit fields" };
  }

  const signature = readOwnQuoteResponseSignature(input.quote);
  if (!signature) {
    return { ok: false, error: "Quote response must provide closed own wallet submit fields" };
  }

  if (input.wallet.address.toLowerCase() !== walletQuote.user.toLowerCase()) {
    return { ok: false, error: "Connected wallet must match quote user" };
  }
  if (input.wallet.chainId !== walletQuote.chainId) {
    return { ok: false, error: "Connected wallet network must match quote chainId" };
  }

  return {
    ok: true,
    quote: walletQuote.quote,
    signature,
  };
}

function readOwnWalletQuote(value: Quote | undefined): { quote: Quote; user: Address; chainId: number } | undefined {
  if (!isRecord(value) || !hasExactOwnFields(value, walletQuoteFields)) return undefined;

  const user = value.user;
  const chainId = value.chainId;
  if (!isAddress(user) || !Number.isSafeInteger(chainId) || chainId <= 0) return undefined;

  return {
    quote: value as Quote,
    user,
    chainId,
  };
}

function readOwnQuoteResponseSignature(value: QuoteResponse | undefined): `0x${string}` | undefined {
  if (!isRecord(value) || !hasExactOwnFields(value, quoteResponseFields)) return undefined;

  const signature = value.signature;
  return isSignature(signature) ? signature : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactOwnFields(value: Record<string, unknown>, expectedFields: readonly string[]): boolean {
  const expected = new Set(expectedFields);
  for (const key of Object.keys(value)) {
    if (!expected.has(key)) return false;
  }

  for (const field of expectedFields) {
    if (!Object.prototype.hasOwnProperty.call(value, field)) return false;
  }

  return true;
}

function isAddress(value: unknown): value is Address {
  return typeof value === "string" && evmAddressPattern.test(value);
}

function isSignature(value: unknown): value is `0x${string}` {
  return typeof value === "string" && signaturePattern.test(value);
}
