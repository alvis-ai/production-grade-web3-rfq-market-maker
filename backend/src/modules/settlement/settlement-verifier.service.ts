import { APIError } from "../../shared/errors/api-error.js";
import type { SubmitQuoteRequest } from "../../shared/types/rfq.js";

const SECP256K1N_HALF = BigInt("0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0");
const maxSafeIdentifierLength = 128;
const safeIdentifierPattern = /^[A-Za-z0-9_:-]+$/;

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
  private readonly policy: LocalSettlementVerifierPolicy;
  private readonly enabledChainIds: ReadonlySet<number>;
  private readonly tokenWhitelist: ReadonlySet<string>;

  constructor(policy: LocalSettlementVerifierPolicy = defaultLocalSettlementVerifierPolicy) {
    assertObject(policy, "policy");
    assertNonEmptyString(policy.verifierVersion, "verifierVersion");
    assertChainIds(policy.enabledChainIds);
    assertTokenWhitelist(policy.tokenWhitelist);

    this.policy = cloneLocalSettlementVerifierPolicy(policy);
    this.enabledChainIds = new Set(this.policy.enabledChainIds);
    this.tokenWhitelist = new Set(this.policy.tokenWhitelist.map((token) => token.toLowerCase()));
  }

  async verify(input: SettlementVerificationInput): Promise<SettlementVerificationResult> {
    assertVerificationInput(input);
    const { quote, signature } = input.request;

    this.assertCanonicalSignature(signature);
    this.assertSettlementQuoteShape(quote);

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

  private assertCanonicalSignature(signature: string): void {
    if (typeof signature !== "string" || !/^0x[0-9a-fA-F]{130}$/.test(signature)) {
      throw this.reverted("INVALID_SIGNATURE", "Settlement signature must be 65 bytes");
    }

    const s = BigInt(`0x${signature.slice(66, 130)}`);
    if (s > SECP256K1N_HALF) {
      throw this.reverted("INVALID_SIGNATURE", "Settlement signature s value must be in the lower half order");
    }

    const v = Number.parseInt(signature.slice(130, 132), 16);
    const normalizedV = v < 27 ? v + 27 : v;
    if (normalizedV !== 27 && normalizedV !== 28) {
      throw this.reverted("INVALID_SIGNATURE", "Settlement signature v value must be 27 or 28");
    }
  }

  private assertSettlementQuoteShape(quote: SubmitQuoteRequest["quote"]): void {
    if (!Number.isSafeInteger(quote.chainId) || quote.chainId <= 0) {
      throw this.reverted("INVALID_CHAIN_ID", "Settlement quote chain id is invalid");
    }
    if (!Number.isSafeInteger(quote.deadline) || quote.deadline <= 0) {
      throw this.reverted("INVALID_DEADLINE", "Settlement quote deadline is invalid");
    }
    this.assertAddress(quote.user, "INVALID_QUOTE_USER", "Settlement quote user must be a 20-byte address");
    this.assertAddress(quote.tokenIn, "INVALID_TOKEN", "Settlement quote tokenIn must be a 20-byte address");
    this.assertAddress(quote.tokenOut, "INVALID_TOKEN", "Settlement quote tokenOut must be a 20-byte address");
    this.assertPositiveUIntString(quote.amountIn, "INVALID_AMOUNT", "Settlement quote amountIn is invalid");
    this.assertPositiveUIntString(quote.amountOut, "INVALID_AMOUNT", "Settlement quote amountOut is invalid");
    this.assertPositiveUIntString(quote.minAmountOut, "INVALID_AMOUNT", "Settlement quote minAmountOut is invalid");
    this.assertPositiveUIntString(quote.nonce, "INVALID_NONCE", "Settlement quote nonce is invalid");
  }

  private assertAddress(value: string, reasonCode: string, message: string): void {
    if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
      throw this.reverted(reasonCode, message);
    }
  }

  private assertPositiveUIntString(value: string, reasonCode: string, message: string): void {
    if (typeof value !== "string" || !/^[1-9][0-9]*$/.test(value)) {
      throw this.reverted(reasonCode, message);
    }
  }
}

function cloneLocalSettlementVerifierPolicy(policy: LocalSettlementVerifierPolicy): LocalSettlementVerifierPolicy {
  return {
    ...policy,
    enabledChainIds: [...policy.enabledChainIds],
    tokenWhitelist: [...policy.tokenWhitelist],
  };
}

function assertNonEmptyString(value: string, field: string): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Local settlement verifier ${field} must be a non-empty string`);
  }
}

function assertVerificationInput(input: SettlementVerificationInput): void {
  assertObject(input, "input");
  assertSafeIdentifier(input.quoteId, "quoteId");
  assertObject(input.request, "request");
  assertObject(input.request.quote, "request.quote");
}

function assertSafeIdentifier(value: string, field: string): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Local settlement verifier ${field} must be a non-empty string`);
  }
  if (value.length > maxSafeIdentifierLength) {
    throw new Error(`Local settlement verifier ${field} must be 128 characters or fewer`);
  }
  if (!safeIdentifierPattern.test(value)) {
    throw new Error(
      `Local settlement verifier ${field} must contain only letters, numbers, underscore, colon, or hyphen`,
    );
  }
}

function assertChainIds(chainIds: readonly number[]): void {
  assertArray(chainIds, "enabledChainIds");
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
  assertArray(tokens, "tokenWhitelist");
  if (tokens.length === 0) {
    throw new Error("Local settlement verifier tokenWhitelist must contain at least one address");
  }

  const seenTokens = new Set<string>();
  for (const token of tokens) {
    if (typeof token !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(token)) {
      throw new Error("Local settlement verifier tokenWhitelist entries must be 20-byte hex addresses");
    }
    const normalized = token.toLowerCase();
    if (seenTokens.has(normalized)) {
      throw new Error("Local settlement verifier tokenWhitelist must not contain duplicate addresses");
    }
    seenTokens.add(normalized);
  }
}

function assertObject(value: unknown, field: string): void {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Local settlement verifier ${field} must be an object`);
  }
}

function assertArray(value: unknown, field: string): void {
  if (!Array.isArray(value)) {
    throw new Error(`Local settlement verifier ${field} must be an array`);
  }
}
