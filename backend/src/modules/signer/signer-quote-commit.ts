import { createHash } from "node:crypto";
import type { SignedQuote } from "../../shared/types/rfq.js";
import type { QuoteIdempotencyReservation } from "../quote/quote-idempotency.store.js";
import type { FinalizeQuoteIssuanceInput } from "../quote/quote-issuance.store.js";
import { assertQuoteIssuanceFinalization } from "../quote/postgres-quote-issuance.store.js";

const commitContextFields = [
  "principalId",
  "slippageBps",
  "pricingVersion",
  "spreadBps",
  "sizeImpactBps",
  "marketSpreadBps",
  "inventorySkewBps",
  "volatilityPremiumBps",
  "hedgeCostBps",
  "riskPolicyVersion",
  "idempotency",
] as const;
const validationSignature = `0x${"00".repeat(64)}1b` as const;

export interface SignerQuoteCommitContext {
  principalId: string;
  slippageBps: number;
  pricingVersion: string;
  spreadBps: number;
  sizeImpactBps: number;
  marketSpreadBps: number;
  inventorySkewBps: number;
  volatilityPremiumBps: number;
  hedgeCostBps: number;
  riskPolicyVersion: string;
  idempotency?: QuoteIdempotencyReservation;
}

export interface SignerQuoteCommitEnvelope {
  quote: SignedQuote;
  quoteId: string;
  snapshotId: string;
}

export function assertSignerQuoteCommitContext(
  value: unknown,
  envelope: SignerQuoteCommitEnvelope,
): asserts value is SignerQuoteCommitContext {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Signer quote commit context must be an object");
  }
  const context = value as Record<string, unknown>;
  const allowed = new Set(commitContextFields);
  if (Object.keys(context).some((field) => !allowed.has(field as typeof commitContextFields[number]))) {
    throw new Error("Signer quote commit context fields are invalid");
  }
  for (const field of commitContextFields) {
    if (field === "idempotency") continue;
    if (!Object.prototype.hasOwnProperty.call(context, field)) {
      throw new Error(`Signer quote commit context.${field} must be an own field`);
    }
  }
  if ("idempotency" in context && !Object.prototype.hasOwnProperty.call(context, "idempotency")) {
    throw new Error("Signer quote commit context.idempotency must be an own field when provided");
  }
  assertQuoteIssuanceFinalization(buildSignerQuoteFinalization(
    envelope,
    value as SignerQuoteCommitContext,
    validationSignature,
  ));
}

export function buildSignerQuoteFinalization(
  envelope: SignerQuoteCommitEnvelope,
  context: SignerQuoteCommitContext,
  signature: `0x${string}`,
): FinalizeQuoteIssuanceInput {
  const signedQuote = {
    quoteId: envelope.quoteId,
    principalId: context.principalId,
    snapshotId: envelope.snapshotId,
    slippageBps: context.slippageBps,
    quote: canonicalQuote(envelope.quote),
    pricingVersion: context.pricingVersion,
    spreadBps: context.spreadBps,
    sizeImpactBps: context.sizeImpactBps,
    marketSpreadBps: context.marketSpreadBps,
    inventorySkewBps: context.inventorySkewBps,
    volatilityPremiumBps: context.volatilityPremiumBps,
    hedgeCostBps: context.hedgeCostBps,
    riskPolicyVersion: context.riskPolicyVersion,
    signature,
  };
  const response = {
    quoteId: envelope.quoteId,
    snapshotId: envelope.snapshotId,
    amountOut: envelope.quote.amountOut,
    minAmountOut: envelope.quote.minAmountOut,
    deadline: envelope.quote.deadline,
    nonce: envelope.quote.nonce,
    signature,
  };
  return {
    signedQuote,
    response,
    ...(context.idempotency ? { idempotency: canonicalIdempotency(context.idempotency) } : {}),
  };
}

export function quoteFinalizationPayload(input: FinalizeQuoteIssuanceInput): {
  signedQuote: FinalizeQuoteIssuanceInput["signedQuote"];
  response: FinalizeQuoteIssuanceInput["response"];
} {
  assertQuoteIssuanceFinalization(input);
  const signed = input.signedQuote;
  return {
    signedQuote: {
      quoteId: signed.quoteId,
      principalId: signed.principalId,
      snapshotId: signed.snapshotId,
      slippageBps: signed.slippageBps,
      quote: canonicalQuote(signed.quote),
      pricingVersion: signed.pricingVersion,
      spreadBps: signed.spreadBps,
      sizeImpactBps: signed.sizeImpactBps,
      marketSpreadBps: signed.marketSpreadBps,
      inventorySkewBps: signed.inventorySkewBps,
      volatilityPremiumBps: signed.volatilityPremiumBps,
      hedgeCostBps: signed.hedgeCostBps,
      riskPolicyVersion: signed.riskPolicyVersion,
      signature: signed.signature,
    },
    response: {
      quoteId: input.response.quoteId,
      snapshotId: input.response.snapshotId,
      amountOut: input.response.amountOut,
      minAmountOut: input.response.minAmountOut,
      deadline: input.response.deadline,
      nonce: input.response.nonce,
      signature: input.response.signature,
    },
  };
}

export function quoteFinalizationHash(input: FinalizeQuoteIssuanceInput): string {
  return createHash("sha256").update(JSON.stringify(quoteFinalizationPayload(input))).digest("hex");
}

export function quoteSigningAuthorizationHash(
  envelope: SignerQuoteCommitEnvelope,
  context: SignerQuoteCommitContext,
): string {
  assertQuoteIssuanceFinalization(buildSignerQuoteFinalization(envelope, context, validationSignature));
  const payload = {
    quote: canonicalQuote(envelope.quote),
    quoteId: envelope.quoteId,
    snapshotId: envelope.snapshotId,
    commit: canonicalCommitContext(context),
  };
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export function quoteSigningAuthorizationHashFromFinalization(
  input: FinalizeQuoteIssuanceInput,
): string {
  assertQuoteIssuanceFinalization(input);
  const signed = input.signedQuote;
  return quoteSigningAuthorizationHash({
    quote: signed.quote,
    quoteId: signed.quoteId,
    snapshotId: signed.snapshotId,
  }, {
    principalId: signed.principalId,
    slippageBps: signed.slippageBps,
    pricingVersion: signed.pricingVersion,
    spreadBps: signed.spreadBps,
    sizeImpactBps: signed.sizeImpactBps,
    marketSpreadBps: signed.marketSpreadBps,
    inventorySkewBps: signed.inventorySkewBps,
    volatilityPremiumBps: signed.volatilityPremiumBps,
    hedgeCostBps: signed.hedgeCostBps,
    riskPolicyVersion: signed.riskPolicyVersion,
    ...(input.idempotency ? { idempotency: input.idempotency } : {}),
  });
}

function canonicalQuote(quote: SignedQuote): SignedQuote {
  return {
    user: quote.user,
    tokenIn: quote.tokenIn,
    tokenOut: quote.tokenOut,
    amountIn: quote.amountIn,
    amountOut: quote.amountOut,
    minAmountOut: quote.minAmountOut,
    nonce: quote.nonce,
    deadline: quote.deadline,
    chainId: quote.chainId,
  };
}

function canonicalCommitContext(context: SignerQuoteCommitContext): SignerQuoteCommitContext {
  return {
    principalId: context.principalId,
    slippageBps: context.slippageBps,
    pricingVersion: context.pricingVersion,
    spreadBps: context.spreadBps,
    sizeImpactBps: context.sizeImpactBps,
    marketSpreadBps: context.marketSpreadBps,
    inventorySkewBps: context.inventorySkewBps,
    volatilityPremiumBps: context.volatilityPremiumBps,
    hedgeCostBps: context.hedgeCostBps,
    riskPolicyVersion: context.riskPolicyVersion,
    ...(context.idempotency ? { idempotency: canonicalIdempotency(context.idempotency) } : {}),
  };
}

function canonicalIdempotency(
  reservation: QuoteIdempotencyReservation,
): QuoteIdempotencyReservation {
  return {
    principalId: reservation.principalId,
    key: reservation.key,
    requestHash: reservation.requestHash,
    ownerToken: reservation.ownerToken,
    expiresAt: reservation.expiresAt,
  };
}
