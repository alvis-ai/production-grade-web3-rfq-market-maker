import type { RiskDecisionRecord } from "../risk/risk-decision.repository.js";
import type {
  QuoteExposureReservationResult,
  ReserveQuoteExposureInput,
} from "../risk/quote-exposure.store.js";
import type { AdmitQuoteIssuanceInput } from "./quote-issuance.store.js";

export interface AdmitQuoteInput {
  exposure: ReserveQuoteExposureInput;
  issuance: AdmitQuoteIssuanceInput;
}

export type QuoteAdmissionResult =
  | {
      exposure: Extract<QuoteExposureReservationResult, { status: "reserved" }>;
      riskDecision: RiskDecisionRecord;
    }
  | {
      exposure: Extract<QuoteExposureReservationResult, { status: "rejected" }>;
    };

export interface QuoteAdmissionStore {
  admit(input: AdmitQuoteInput, beforeCommit?: () => void): Promise<QuoteAdmissionResult>;
}

export function assertQuoteAdmissionResult(
  value: unknown,
): asserts value is QuoteAdmissionResult {
  if (!isRecord(value) || !Object.prototype.hasOwnProperty.call(value, "exposure")) {
    throw new Error("Quote admission result must contain exposure");
  }
  if (!isRecord(value.exposure) ||
      (value.exposure.status !== "reserved" && value.exposure.status !== "rejected")) {
    throw new Error("Quote admission exposure result is invalid");
  }
  const fields = Object.keys(value);
  if (value.exposure.status === "reserved") {
    if (fields.length !== 2 || !fields.includes("riskDecision") || !isRecord(value.riskDecision)) {
      throw new Error("Reserved quote admission must contain a risk decision");
    }
    return;
  }
  if (fields.length !== 1) {
    throw new Error("Rejected quote admission cannot contain a risk decision");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
