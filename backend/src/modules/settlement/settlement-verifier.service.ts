import { APIError } from "../../shared/errors/api-error.js";
import type { SubmitQuoteRequest } from "../../shared/types/rfq.js";

export interface SettlementVerifier {
  verify(input: SettlementVerificationInput): Promise<SettlementVerificationResult>;
}

export interface SettlementVerificationInput {
  quoteId: string;
  request: SubmitQuoteRequest;
}

export interface SettlementVerificationResult {
  status: "verified";
  verifierVersion: string;
  amountOut: string;
}

export interface LocalSettlementVerifierPolicy {
  verifierVersion: string;
  enabledChainIds: readonly number[];
  tokenWhitelist: readonly `0x${string}`[];
}

export const defaultLocalSettlementVerifierPolicy: LocalSettlementVerifierPolicy = {
  verifierVersion: "local-rfq-settlement-v1",
  enabledChainIds: [1, 8453, 42161],
  tokenWhitelist: [
    "0x0000000000000000000000000000000000000002",
    "0x0000000000000000000000000000000000000003",
  ],
};

export class LocalSettlementVerifier implements SettlementVerifier {
  private readonly enabledChainIds: ReadonlySet<number>;
  private readonly tokenWhitelist: ReadonlySet<string>;

  constructor(private readonly policy: LocalSettlementVerifierPolicy = defaultLocalSettlementVerifierPolicy) {
    assertNonEmptyString(policy.verifierVersion, "verifierVersion");
    assertChainIds(policy.enabledChainIds);
    assertTokenWhitelist(policy.tokenWhitelist);

    this.enabledChainIds = new Set(policy.enabledChainIds);
    this.tokenWhitelist = new Set(policy.tokenWhitelist.map((token) => token.toLowerCase()));
  }

  async verify(input: SettlementVerificationInput): Promise<SettlementVerificationResult> {
    const { quote } = input.request;

    if (!this.enabledChainIds.has(quote.chainId)) {
      throw this.reverted("INVALID_CHAIN_ID", "Quote chain id is not enabled for settlement");
    }

    if (quote.deadline < Math.floor(Date.now() / 1000)) {
      throw this.reverted("QUOTE_EXPIRED", "Quote expired before settlement verification");
    }

    if (quote.tokenIn.toLowerCase() === quote.tokenOut.toLowerCase()) {
      throw this.reverted("INVALID_TOKEN_PAIR", "Settlement token pair is invalid");
    }

    if (!this.isWhitelisted(quote.tokenIn) || !this.isWhitelisted(quote.tokenOut)) {
      throw this.reverted("TOKEN_NOT_WHITELISTED", "Settlement token is not whitelisted");
    }

    if (BigInt(quote.amountIn) <= 0n || BigInt(quote.amountOut) <= 0n || BigInt(quote.minAmountOut) <= 0n) {
      throw this.reverted("INVALID_AMOUNT", "Settlement quote amount is invalid");
    }

    if (BigInt(quote.amountOut) < BigInt(quote.minAmountOut)) {
      throw this.reverted("AMOUNT_OUT_BELOW_MINIMUM", "Settlement amountOut is below minimum");
    }

    return {
      status: "verified",
      verifierVersion: this.policy.verifierVersion,
      amountOut: quote.amountOut,
    };
  }

  private isWhitelisted(token: `0x${string}`): boolean {
    return this.tokenWhitelist.has(token.toLowerCase());
  }

  private reverted(reasonCode: string, message: string): APIError {
    return new APIError("SETTLEMENT_REVERTED", message, 409, undefined, reasonCode);
  }
}

function assertNonEmptyString(value: string, field: keyof LocalSettlementVerifierPolicy): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Local settlement verifier ${field} must be a non-empty string`);
  }
}

function assertChainIds(chainIds: readonly number[]): void {
  if (chainIds.length === 0) {
    throw new Error("Local settlement verifier enabledChainIds must contain at least one chain id");
  }

  const seenChainIds = new Set<number>();
  for (const chainId of chainIds) {
    if (!Number.isSafeInteger(chainId) || chainId <= 0) {
      throw new Error("Local settlement verifier enabledChainIds entries must be positive safe integers");
    }
    if (seenChainIds.has(chainId)) {
      throw new Error("Local settlement verifier enabledChainIds must not contain duplicate chain ids");
    }
    seenChainIds.add(chainId);
  }
}

function assertTokenWhitelist(tokens: readonly `0x${string}`[]): void {
  if (tokens.length === 0) {
    throw new Error("Local settlement verifier tokenWhitelist must contain at least one address");
  }

  const seenTokens = new Set<string>();
  for (const token of tokens) {
    if (!/^0x[0-9a-fA-F]{40}$/.test(token)) {
      throw new Error("Local settlement verifier tokenWhitelist entries must be 20-byte hex addresses");
    }
    const normalized = token.toLowerCase();
    if (seenTokens.has(normalized)) {
      throw new Error("Local settlement verifier tokenWhitelist must not contain duplicate addresses");
    }
    seenTokens.add(normalized);
  }
}
