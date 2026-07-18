import type { QuoteResponse, QuoteStatusResponse, SignedQuote } from "../../shared/types/rfq.js";
import type { SaveMarketSnapshotInput } from "../market-data/market-snapshot.repository.js";
import type {
  RiskDecisionRecord,
  SaveRiskDecisionInput,
} from "../risk/risk-decision.repository.js";
import type {
  SaveRequestedQuoteInput,
  SaveRouteDecisionInput,
  SaveSignedQuoteInput,
} from "./quote-repository-contract.js";
import type { QuoteIdempotencyReservation } from "./quote-idempotency.store.js";

export interface PrepareQuoteIssuanceInput {
  marketSnapshot: SaveMarketSnapshotInput;
  requestedQuote: SaveRequestedQuoteInput;
  routeDecision: SaveRouteDecisionInput;
  idempotency?: QuoteIdempotencyReservation;
}

export type AuthorizeQuoteIssuanceInput = SaveRiskDecisionInput;

export interface FinalizeQuoteIssuanceInput {
  signedQuote: SaveSignedQuoteInput;
  response: QuoteResponse;
  idempotency?: QuoteIdempotencyReservation;
}

export interface QuoteIssuanceStore {
  readonly asynchronousProjection?: true;
  prepare(input: PrepareQuoteIssuanceInput): Promise<void>;
  authorize(input: AuthorizeQuoteIssuanceInput): Promise<RiskDecisionRecord>;
  finalize(input: FinalizeQuoteIssuanceInput): Promise<void>;
  findHotStatus?(quoteId: string, principalId: string): Promise<QuoteStatusResponse | undefined>;
  awaitSignedQuoteProjection?(quote: SignedQuote, principalId: string): Promise<void>;
}
