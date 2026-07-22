import type { MarketSnapshot, QuoteRequest, SignedQuote } from "../../shared/types/rfq.js";
import type { PricingResult } from "../pricing/pricing.engine.js";
import type { SignerQuoteCommitContext } from "../signer/signer-quote-commit.js";
import {
  assertRiskDecisionRecord,
  type RiskDecisionRecord,
} from "../risk/risk-decision.repository.js";
import type { RiskDecision } from "../risk/risk.engine.js";
import { persistQuoteRiskDecision } from "./quote-risk-decision.js";
import type {
  AuthorizeQuoteIssuanceInput,
  PrepareQuoteIssuanceInput,
} from "./quote-issuance.store.js";
import { assertQuoteAdmissionResult } from "./quote-admission.store.js";
import type { QuoteServiceDeps } from "./quote-service-contract.js";
import { quoteStoreFailure } from "./quote-service-errors.js";
import {
  assertInventoryProjection,
  assertQuoteExposureReservationResult,
  assertRiskDecision,
  riskUnavailableDecision,
} from "./quote-service-result-validation.js";

export interface AuthorizeQuoteInput {
  request: QuoteRequest;
  snapshot: MarketSnapshot;
  pricing: PricingResult;
  quoteId: string;
  deadline: number;
  preparation?: PrepareQuoteIssuanceInput;
  signingAuthorization?: {
    quote: SignedQuote;
    quoteId: string;
    snapshotId: string;
    commit: Omit<SignerQuoteCommitContext, "riskPolicyVersion">;
  };
  beforeJointAdmission?: (risk: RiskDecision) => void;
}

export interface AuthorizedQuote {
  risk: RiskDecision;
  persistedRiskDecision: RiskDecisionRecord;
  exposureReserved: boolean;
}

export async function authorizeQuote(
  deps: QuoteServiceDeps,
  input: AuthorizeQuoteInput,
): Promise<AuthorizedQuote> {
  let risk = await evaluateRisk(deps, input);
  let asynchronousPreparation: Promise<{ error?: unknown; failed: boolean }> | undefined;
  const directAdmission = deps.quoteIssuanceStore?.admit !== undefined || deps.quoteAdmissionStore !== undefined;
  if (deps.quoteIssuanceStore) {
    if (!input.preparation) throw quoteStoreFailure(new Error("Quote issuance preparation is required"));
    if (!directAdmission) {
      if (deps.quoteIssuanceStore.asynchronousProjection === true) {
        asynchronousPreparation = deps.quoteIssuanceStore.prepare(input.preparation).then(
          () => ({ failed: false }),
          (error: unknown) => ({ error, failed: true }),
        );
      } else {
        try {
          await deps.quoteIssuanceStore.prepare(input.preparation);
        } catch (error) {
          throw quoteStoreFailure(error);
        }
      }
    }
  }

  let exposureReserved = false;
  let jointlyPersistedRiskDecision: RiskDecisionRecord | undefined;
  let speculativeAdmissionStarted = false;
  if (risk.status === "approved") {
    try {
      const treasuryLiquidity = deps.treasuryLiquidityProvider
        ? await deps.treasuryLiquidityProvider.getLiquidity({
            chainId: input.request.chainId,
            token: input.request.tokenOut,
          })
        : undefined;
      await deps.settlementIndexerRiskGuard?.assertQuoteSafe({
        chainId: input.request.chainId,
        ...(treasuryLiquidity ? { observedHead: treasuryLiquidity.blockNumber } : {}),
      });
      if (deps.quoteExposureStore) {
        const exposureInput = {
          quoteId: input.quoteId,
          request: input.request,
          pricing: input.pricing,
          deadline: input.deadline,
          ...(treasuryLiquidity ? { treasuryLiquidity } : {}),
        };
        let jointAdmission;
        if (deps.quoteAdmissionStore && deps.quoteIssuanceStore && input.preparation) {
          jointAdmission = await deps.quoteAdmissionStore.admit({
            exposure: exposureInput,
            issuance: {
              preparation: input.preparation,
              authorization: buildAuthorizationInput(input, risk),
            },
          }, input.beforeJointAdmission ? () => {
            input.beforeJointAdmission!(risk);
            speculativeAdmissionStarted = true;
          } : undefined);
          if (jointAdmission.exposure.status === "reserved") exposureReserved = true;
          assertQuoteAdmissionResult(jointAdmission);
        }
        const exposure = jointAdmission
          ? jointAdmission.exposure
          : await deps.quoteExposureStore.reserve(exposureInput);
        assertQuoteExposureReservationResult(exposure);
        if (exposure.status === "reserved") {
          exposureReserved = true;
          if (jointAdmission && "riskDecision" in jointAdmission) {
            assertRiskDecisionRecord(jointAdmission.riskDecision, {
              quoteId: input.quoteId,
              decision: risk,
            });
            jointlyPersistedRiskDecision = jointAdmission.riskDecision;
          }
        } else {
          risk = {
            status: "rejected",
            policyVersion: risk.policyVersion,
            reasonCode: exposure.reasonCode,
          };
        }
      }
    } catch (error) {
      if (speculativeAdmissionStarted) throw error;
      if (exposureReserved) {
        await releaseExposureBestEffort(deps, input.quoteId);
        exposureReserved = false;
      }
      risk = riskUnavailableDecision();
    }
  }

  if (asynchronousPreparation) {
    const preparation = await asynchronousPreparation;
    if (preparation.failed) {
      if (exposureReserved) await releaseExposureBestEffort(deps, input.quoteId);
      throw quoteStoreFailure(preparation.error);
    }
  }

  if (jointlyPersistedRiskDecision) {
    return {
      risk,
      persistedRiskDecision: jointlyPersistedRiskDecision,
      exposureReserved,
    };
  }

  const riskDecisionInput = { quoteId: input.quoteId, decision: risk };
  const authorizationInput = buildAuthorizationInput(input, risk);
  try {
    const persistedRiskDecision = deps.quoteIssuanceStore
      ? directAdmission
        ? await deps.quoteIssuanceStore.admit!({
            preparation: input.preparation!,
            authorization: authorizationInput,
          })
        : await deps.quoteIssuanceStore.authorize(authorizationInput)
      : await persistQuoteRiskDecision(deps.riskDecisionStore, riskDecisionInput);
    assertRiskDecisionRecord(persistedRiskDecision, riskDecisionInput);
    return { risk, persistedRiskDecision, exposureReserved };
  } catch (error) {
    if (exposureReserved) await releaseExposureBestEffort(deps, input.quoteId);
    throw quoteStoreFailure(error);
  }
}

function buildAuthorizationInput(
  input: AuthorizeQuoteInput,
  risk: RiskDecision,
): AuthorizeQuoteIssuanceInput {
  return {
    quoteId: input.quoteId,
    decision: risk,
    ...(input.signingAuthorization ? {
      signingAuthorization: {
        ...input.signingAuthorization,
        commit: {
          ...input.signingAuthorization.commit,
          riskPolicyVersion: risk.policyVersion,
        },
      },
    } : {}),
  };
}

async function evaluateRisk(deps: QuoteServiceDeps, input: AuthorizeQuoteInput): Promise<RiskDecision> {
  try {
    const projection = await deps.inventoryService.projectSettlement({
      chainId: input.request.chainId,
      tokenIn: input.request.tokenIn,
      tokenOut: input.request.tokenOut,
      amountIn: input.request.amountIn,
      amountOut: input.pricing.amountOut,
    });
    assertInventoryProjection(projection, input.request);
    const risk = await deps.riskEngine.evaluate({
      request: input.request,
      pricing: input.pricing,
      snapshot: input.snapshot,
      inventoryProjection: projection,
    });
    assertRiskDecision(risk);
    return risk;
  } catch {
    return riskUnavailableDecision();
  }
}

async function releaseExposureBestEffort(deps: QuoteServiceDeps, quoteId: string): Promise<void> {
  try {
    await deps.quoteExposureStore?.release(quoteId);
  } catch {
    // The reservation is deadline-bound and will stop counting even when release fails.
  }
}
