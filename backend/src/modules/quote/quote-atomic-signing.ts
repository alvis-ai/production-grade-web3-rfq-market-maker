import type { QuoteResponse, SignedQuote } from "../../shared/types/rfq.js";
import type { PricingResult } from "../pricing/pricing.engine.js";
import type { SignerQuoteCommitContext } from "../signer/signer-quote-commit.js";
import type { SignerService } from "../signer/signer.service.js";
import type { QuoteIdempotencyReservation } from "./quote-idempotency.store.js";
import type { QuoteIssuanceStore } from "./quote-issuance.store.js";

export interface SignerCommitBaseInput {
  enabled: boolean;
  principalId: string;
  slippageBps: number;
  pricing: PricingResult;
  idempotency?: QuoteIdempotencyReservation;
}

export type SignerCommitBase = Omit<SignerQuoteCommitContext, "riskPolicyVersion">;

export function buildSignerCommitBase(input: SignerCommitBaseInput): SignerCommitBase | undefined {
  if (!input.enabled) return undefined;
  return {
    principalId: input.principalId,
    slippageBps: input.slippageBps,
    pricingVersion: input.pricing.pricingVersion,
    spreadBps: input.pricing.spreadBps,
    sizeImpactBps: input.pricing.sizeImpactBps,
    marketSpreadBps: input.pricing.marketSpreadBps,
    inventorySkewBps: input.pricing.inventorySkewBps,
    volatilityPremiumBps: input.pricing.volatilityPremiumBps,
    hedgeCostBps: input.pricing.hedgeCostBps,
    ...(input.idempotency ? { idempotency: input.idempotency } : {}),
  };
}

export type AtomicQuoteSigningResult =
  | { status: "signed"; signature: `0x${string}` }
  | { status: "recovered"; response: QuoteResponse }
  | { status: "failed"; error: unknown; releaseExposure: boolean };

export async function signQuoteWithAtomicRecovery(input: {
  signerService: SignerService;
  quoteIssuanceStore?: QuoteIssuanceStore;
  atomicCommit: boolean;
  quote: SignedQuote;
  quoteId: string;
  principalId: string;
  snapshotId: string;
  pricing: PricingResult;
  riskDecisionId: string;
  riskPolicyVersion: string;
  traceId: string;
  commit?: SignerQuoteCommitContext;
}): Promise<AtomicQuoteSigningResult> {
  try {
    const signature = await input.signerService.signQuote({
      quote: input.quote,
      quoteId: input.quoteId,
      snapshotId: input.snapshotId,
      riskDecisionId: input.riskDecisionId,
      riskPolicyVersion: input.riskPolicyVersion,
      traceId: input.traceId,
      ...(input.commit ? { commit: input.commit } : {}),
    });
    return { status: "signed", signature };
  } catch (error) {
    if (!input.atomicCommit) return { status: "failed", error, releaseExposure: true };
    const recovered = await recoverAtomicSignerCommit(input);
    if (recovered.status === "committed") {
      return { status: "recovered", response: recovered.response };
    }
    return {
      status: "failed",
      error,
      releaseExposure: recovered.status === "not_committed",
    };
  }
}

async function recoverAtomicSignerCommit(input: {
  signerService: SignerService;
  quoteIssuanceStore?: QuoteIssuanceStore;
  quoteId: string;
  principalId: string;
  snapshotId: string;
  quote: SignedQuote;
  pricing: PricingResult;
}): Promise<
  | { status: "committed"; response: QuoteResponse }
  | { status: "not_committed" }
  | { status: "unknown" }
> {
  const recover = input.quoteIssuanceStore?.recoverFinalizedResponse;
  if (!recover) return { status: "unknown" };
  try {
    const response = await recover.call(input.quoteIssuanceStore, input.quoteId, input.principalId);
    if (!response) return { status: "not_committed" };
    if (response.quoteId !== input.quoteId || response.snapshotId !== input.snapshotId ||
        response.amountOut !== input.pricing.amountOut ||
        response.minAmountOut !== input.pricing.minAmountOut ||
        response.deadline !== input.quote.deadline || response.nonce !== input.quote.nonce ||
        !await input.signerService.verifyQuoteSignature(input.quote, response.signature)) {
      return { status: "unknown" };
    }
    return { status: "committed", response };
  } catch {
    return { status: "unknown" };
  }
}
