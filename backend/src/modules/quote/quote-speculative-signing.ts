import type { QuoteResponse, SignedQuote } from "../../shared/types/rfq.js";
import type { PricingResult } from "../pricing/pricing.engine.js";
import type { RiskDecision } from "../risk/risk.engine.js";
import type { SignerService } from "../signer/signer.service.js";
import type { QuoteIssuanceStore } from "./quote-issuance.store.js";
import {
  signQuoteWithAtomicRecovery,
  type SignerCommitBase,
} from "./quote-atomic-signing.js";

interface SpeculativeQuoteSigningInput {
  enabled: boolean;
  signerService: SignerService;
  quoteIssuanceStore?: QuoteIssuanceStore;
  quote: SignedQuote;
  quoteId: string;
  principalId: string;
  snapshotId: string;
  pricing: PricingResult;
  traceId: string;
  commitBase?: SignerCommitBase;
}

export interface SpeculativeQuoteSigning {
  readonly signaturePromise?: Promise<`0x${string}`>;
  beforeJointAdmission(risk: RiskDecision): void;
  recoverAdmissionFailure(): Promise<
    | { status: "committed"; response: QuoteResponse }
    | { status: "failed"; releaseExposure: boolean }
  >;
}

export function createSpeculativeQuoteSigning(
  input: SpeculativeQuoteSigningInput,
): SpeculativeQuoteSigning | undefined {
  if (!input.enabled || !input.commitBase) return undefined;
  const commitBase = input.commitBase;
  let signaturePromise: Promise<`0x${string}`> | undefined;
  let riskPolicyVersion: string | undefined;

  return {
    get signaturePromise() { return signaturePromise; },
    beforeJointAdmission(risk) {
      if (risk.status !== "approved" || signaturePromise) {
        throw new Error("Speculative quote signing requires one approved admission");
      }
      riskPolicyVersion = risk.policyVersion;
      signaturePromise = input.signerService.signQuote(signingRequest(input, commitBase, risk.policyVersion));
      void signaturePromise.catch(() => undefined);
    },
    async recoverAdmissionFailure() {
      if (!signaturePromise || !riskPolicyVersion) {
        return { status: "failed", releaseExposure: false };
      }
      const signing = await signQuoteWithAtomicRecovery({
        ...signingOperation(input, commitBase, riskPolicyVersion),
        signaturePromise,
      });
      if (signing.status === "recovered") {
        return { status: "committed", response: signing.response };
      }
      if (signing.status === "signed") {
        return {
          status: "committed",
          response: {
            quoteId: input.quoteId,
            snapshotId: input.snapshotId,
            amountOut: input.pricing.amountOut,
            minAmountOut: input.pricing.minAmountOut,
            deadline: input.quote.deadline,
            nonce: input.quote.nonce,
            signature: signing.signature,
          },
        };
      }
      return { status: "failed", releaseExposure: signing.releaseExposure };
    },
  };
}

function signingRequest(
  input: SpeculativeQuoteSigningInput,
  commitBase: SignerCommitBase,
  riskPolicyVersion: string,
) {
  return {
    quote: input.quote,
    quoteId: input.quoteId,
    snapshotId: input.snapshotId,
    riskDecisionId: `rd_${input.quoteId}`,
    riskPolicyVersion,
    traceId: input.traceId,
    commit: { ...commitBase, riskPolicyVersion },
  };
}

function signingOperation(
  input: SpeculativeQuoteSigningInput,
  commitBase: SignerCommitBase,
  riskPolicyVersion: string,
) {
  return {
    signerService: input.signerService,
    ...(input.quoteIssuanceStore ? { quoteIssuanceStore: input.quoteIssuanceStore } : {}),
    atomicCommit: true,
    quote: input.quote,
    quoteId: input.quoteId,
    principalId: input.principalId,
    snapshotId: input.snapshotId,
    pricing: input.pricing,
    riskDecisionId: `rd_${input.quoteId}`,
    riskPolicyVersion,
    traceId: input.traceId,
    commit: { ...commitBase, riskPolicyVersion },
  };
}
