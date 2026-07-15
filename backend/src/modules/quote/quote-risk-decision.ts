import {
  assertRiskDecisionRecord,
  type RiskDecisionRecord,
  type RiskDecisionStore,
  type SaveRiskDecisionInput,
} from "../risk/risk-decision.repository.js";
import { quoteStoreFailure } from "./quote-service-errors.js";

export async function persistQuoteRiskDecision(
  store: RiskDecisionStore,
  input: SaveRiskDecisionInput,
): Promise<RiskDecisionRecord> {
  try {
    const record = await store.saveDecision(input);
    assertRiskDecisionRecord(record, input);
    return record;
  } catch (error) {
    throw quoteStoreFailure(error);
  }
}
