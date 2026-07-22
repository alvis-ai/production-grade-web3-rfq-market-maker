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
import type { SignerQuoteCommitContext } from "../signer/signer-quote-commit.js";

export interface PrepareQuoteIssuanceInput {
  marketSnapshot: SaveMarketSnapshotInput;
  requestedQuote: SaveRequestedQuoteInput;
  routeDecision: SaveRouteDecisionInput;
  idempotency?: QuoteIdempotencyReservation;
}

export interface QuoteSigningAuthorization {
  quote: SignedQuote;
  quoteId: string;
  snapshotId: string;
  commit: SignerQuoteCommitContext;
}

export type AuthorizeQuoteIssuanceInput = SaveRiskDecisionInput & {
  signingAuthorization?: QuoteSigningAuthorization;
};

export interface AdmitQuoteIssuanceInput {
  preparation: PrepareQuoteIssuanceInput;
  authorization: AuthorizeQuoteIssuanceInput;
}

export interface FinalizeQuoteIssuanceInput {
  signedQuote: SaveSignedQuoteInput;
  response: QuoteResponse;
  idempotency?: QuoteIdempotencyReservation;
}

export interface QuoteIssuanceStore {
  readonly asynchronousProjection?: true;
  admit?(input: AdmitQuoteIssuanceInput): Promise<RiskDecisionRecord>;
  prepare(input: PrepareQuoteIssuanceInput): Promise<void>;
  authorize(input: AuthorizeQuoteIssuanceInput): Promise<RiskDecisionRecord>;
  finalize(input: FinalizeQuoteIssuanceInput): Promise<void>;
  recoverFinalizedResponse?(quoteId: string, principalId: string): Promise<QuoteResponse | undefined>;
  findHotStatus?(quoteId: string, principalId: string): Promise<QuoteStatusResponse | undefined>;
  awaitSignedQuoteProjection?(quote: SignedQuote, principalId: string): Promise<void>;
}
