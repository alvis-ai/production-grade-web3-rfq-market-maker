import type {
  Address,
  QuoteLifecycleStatus,
  QuoteRequest,
  QuoteStatusResponse,
  SignedQuote,
  UIntString,
} from "../../shared/types/rfq.js";
import type { RoutePlan } from "../routing/routing.engine.js";

export interface QuoteRecord {
  quoteId: string;
  principalId: string;
  chainId: number;
  user: Address;
  tokenIn: Address;
  tokenOut: Address;
  amountIn: UIntString;
  slippageBps: number;
  amountOut?: UIntString;
  minAmountOut?: UIntString;
  nonce?: UIntString;
  deadline?: number;
  snapshotId?: string;
  routeId?: string;
  routeVenue?: RoutePlan["venue"];
  routeExpectedLiquidityUsd?: UIntString;
  routeDecidedAt?: string;
  pricingVersion?: string;
  spreadBps?: number;
  sizeImpactBps?: number;
  marketSpreadBps?: number;
  inventorySkewBps?: number;
  volatilityPremiumBps?: number;
  hedgeCostBps?: number;
  riskPolicyVersion?: string;
  status: QuoteLifecycleStatus;
  signature?: `0x${string}`;
  rejectCode?: string;
  txHash?: `0x${string}`;
  settlementEventId?: string;
  hedgeOrderId?: string;
  pnlId?: string;
}

export interface QuoteStatusMetadata {
  txHash?: `0x${string}`;
  settlementEventId?: string;
  hedgeOrderId?: string;
  pnlId?: string;
}

export interface ClearSettlementStatusInput {
  quoteId: string;
  txHash: `0x${string}`;
  settlementEventId: string;
  nowSeconds?: number;
}

export interface ClearSettlementStatusResult {
  status?: QuoteStatusResponse;
  cleared: boolean;
}

export interface QuoteRepository {
  checkHealth?(): Promise<void>;
  saveRequested(input: SaveRequestedQuoteInput): Promise<void>;
  saveRouteDecision(input: SaveRouteDecisionInput): Promise<void>;
  saveRejected(input: SaveRejectedQuoteInput): Promise<void>;
  saveSigned(input: SaveSignedQuoteInput): Promise<void>;
  findStatus(quoteId: string, principalId?: string): Promise<QuoteStatusResponse | undefined>;
  findPrincipalId(quoteId: string): Promise<string | undefined>;
  markFailed(quoteId: string, errorCode: string): Promise<void>;
  markStatus(quoteId: string, status: QuoteLifecycleStatus, metadata?: QuoteStatusMetadata): Promise<void>;
  restoreSettlementStatus(quoteId: string, metadata: QuoteStatusMetadata): Promise<void>;
  clearSettlementStatus(input: ClearSettlementStatusInput): Promise<ClearSettlementStatusResult>;
  findSignedQuoteByQuoteId(quoteId: string, principalId?: string): Promise<QuoteRecord | undefined>;
  findQuoteIdByChainUserNonce(chainId: number, user: Address, nonce: UIntString): Promise<string | undefined>;
  findSignedQuoteByChainUserNonce(
    chainId: number,
    user: Address,
    nonce: UIntString,
    principalId?: string,
  ): Promise<QuoteRecord | undefined>;
}

export interface SaveRequestedQuoteInput {
  quoteId: string;
  principalId: string;
  request: QuoteRequest;
  snapshotId: string;
}

export interface SaveRejectedQuoteInput {
  quoteId: string;
  principalId: string;
  request: QuoteRequest;
  snapshotId: string;
  rejectCode: string;
  riskPolicyVersion?: string;
}

export interface SaveRouteDecisionInput {
  quoteId: string;
  principalId: string;
  snapshotId: string;
  routePlan: RoutePlan;
}

export interface SaveSignedQuoteInput {
  quoteId: string;
  principalId: string;
  snapshotId: string;
  slippageBps: number;
  quote: SignedQuote;
  pricingVersion: string;
  spreadBps: number;
  sizeImpactBps: number;
  marketSpreadBps: number;
  inventorySkewBps: number;
  volatilityPremiumBps: number;
  hedgeCostBps: number;
  riskPolicyVersion: string;
  signature: `0x${string}`;
}
