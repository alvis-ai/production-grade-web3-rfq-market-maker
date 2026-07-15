export type Address = `0x${string}`;
export type UIntString = string;
export type IntString = string;
export const quoteSnapshotPnlModelDescription =
  "Gross settlement PnL in tokenOut base units versus the persisted quote-time mid price, excluding fees, gas, and hedge execution" as const;

export interface QuoteRequest {
  chainId: number;
  user: Address;
  tokenIn: Address;
  tokenOut: Address;
  amountIn: UIntString;
  slippageBps: number;
}

export interface SignedQuote {
  user: Address;
  tokenIn: Address;
  tokenOut: Address;
  amountIn: UIntString;
  amountOut: UIntString;
  minAmountOut: UIntString;
  nonce: UIntString;
  deadline: number;
  chainId: number;
}

export interface QuoteResponse {
  quoteId: string;
  snapshotId: string;
  amountOut: UIntString;
  minAmountOut: UIntString;
  deadline: number;
  nonce: UIntString;
  signature: `0x${string}`;
}

export interface SubmitQuoteRequest {
  quote: SignedQuote;
  signature: `0x${string}`;
  txHash?: `0x${string}`;
}

export interface SubmitQuoteResponse {
  status: "accepted";
  txHash?: `0x${string}`;
  settlementEventId?: string;
  hedgeOrderId?: string;
  pnlId?: string;
}

export type QuoteLifecycleStatus =
  | "requested"
  | "rejected"
  | "signed"
  | "expired"
  | "submitted"
  | "settled"
  | "failed";

export interface QuoteStatusResponse {
  quoteId: string;
  status: QuoteLifecycleStatus;
  snapshotId?: string;
  deadline?: number;
  txHash?: `0x${string}`;
  settlementEventId?: string;
  hedgeOrderId?: string;
  pnlId?: string;
  errorCode?: string;
}

export interface MarketSnapshot {
  snapshotId: string;
  midPrice: string;
  liquidityUsd: string;
  marketSpreadBps: number;
  volatilityBps: number;
  observedAt: string;
}

export type HedgeIntentStatus = "queued" | "filled" | "failed";
export type HedgeExecutionEvidenceVersion = "base-only-v1" | "base-and-quote-v2";
export type HedgeFeeReconciliationStatus = "pending" | "complete";

export interface HedgeCommissionTotal {
  asset: string;
  quantity: string;
}

export interface HedgeIntentStatusResponse {
  hedgeOrderId: string;
  status: HedgeIntentStatus;
  settlementEventId: string;
  quoteId: string;
  chainId: number;
  token: Address;
  side: "buy" | "sell";
  amount: UIntString;
  reason: "inventory_rebalance" | "risk_reduction";
  createdAt: string;
  externalOrderId?: string;
  filledAmount?: UIntString;
  venue?: string;
  venueSymbol?: string;
  venueOrderId?: string;
  executionEvidenceVersion?: HedgeExecutionEvidenceVersion;
  executedQuoteQuantity?: string;
  feeReconciliationStatus?: HedgeFeeReconciliationStatus;
  feeLastErrorCode?: string;
  feeReconciledAt?: string;
  commissionTotals?: HedgeCommissionTotal[];
  failureCode?: string;
  updatedAt?: string;
}

export interface SettlementEventStatusResponse {
  settlementEventId: string;
  status: "applied";
  quoteId: string;
  chainId: number;
  txHash: `0x${string}`;
  quoteHash: `0x${string}`;
  blockNumber: number;
  logIndex: number;
  user: Address;
  tokenIn: Address;
  tokenOut: Address;
  amountIn: UIntString;
  amountOut: UIntString;
  nonce: UIntString;
  observedAt: string;
}

export interface PnlTradeRecord {
  pnlId: string;
  quoteId: string;
  settlementEventId: string;
  snapshotId: string;
  chainId: number;
  user: Address;
  tokenIn: Address;
  tokenOut: Address;
  amountIn: UIntString;
  amountOut: UIntString;
  minAmountOut: UIntString;
  nonce: UIntString;
  deadline: number;
  midPrice: string;
  tokenInDecimals: number;
  tokenOutDecimals: number;
  fairAmountOut: UIntString;
  valuationObservedAt: string;
  grossPnlTokenOut: IntString;
  grossPnlBps: number;
  model: "quote_snapshot_edge_v1";
  modelDescription: "Gross settlement PnL in tokenOut base units versus the persisted quote-time mid price, excluding fees, gas, and hedge execution";
  realizedAt: string;
}

export interface PnlTokenTotal {
  chainId: number;
  tokenOut: Address;
  totalTrades: number;
  grossPnlTokenOut: IntString;
}

export const hedgeFillNetPnlModelDescription =
  "Net hedge execution PnL in the route quote asset using exact fills, quote/base commissions, and conservatively marked sub-step residual; third-asset commissions are unavailable" as const;

export type HedgeNetPnlUnavailableReason =
  | "HEDGE_EVIDENCE_MISSING"
  | "LEGACY_ROUTE_ACCOUNTING_UNAVAILABLE"
  | "HEDGE_NOT_EXECUTED"
  | "PARTIAL_HEDGE_UNCLOSED"
  | "UNVALUED_COMMISSION_ASSET";

interface HedgeNetPnlRecordBase {
  quoteId: string;
  chainId: number;
  model: "hedge_fill_net_v1";
  modelDescription: typeof hedgeFillNetPnlModelDescription;
}

export interface PendingHedgeNetPnlRecord extends HedgeNetPnlRecordBase {
  status: "pending";
  hedgeOrderId: string;
  valuationToken: Address;
  valuationAsset: string;
}

export interface CompleteHedgeNetPnlRecord extends HedgeNetPnlRecordBase {
  status: "complete";
  hedgeOrderId: string;
  valuationToken: Address;
  valuationAsset: string;
  netPnlQuoteQuantity: string;
  realizedAt: string;
}

export interface UnavailableHedgeNetPnlRecord extends HedgeNetPnlRecordBase {
  status: "unavailable";
  reasonCode: HedgeNetPnlUnavailableReason;
  hedgeOrderId?: string;
  valuationToken?: Address;
  valuationAsset?: string;
  unvaluedCommissionAssets?: string[];
  realizedAt?: string;
}

export type HedgeNetPnlRecord =
  | PendingHedgeNetPnlRecord
  | CompleteHedgeNetPnlRecord
  | UnavailableHedgeNetPnlRecord;

export interface HedgeNetPnlTotal {
  chainId: number;
  valuationToken: Address;
  valuationAsset: string;
  totalTrades: number;
  netPnlQuoteQuantity: string;
}

export interface HedgeNetPnlSummary {
  model: "hedge_fill_net_v1";
  modelDescription: typeof hedgeFillNetPnlModelDescription;
  totalTrades: number;
  completeTrades: number;
  pendingTrades: number;
  unavailableTrades: number;
  totals: HedgeNetPnlTotal[];
  records: HedgeNetPnlRecord[];
}

export interface PnlSummaryResponse {
  status: "ok";
  totalTrades: number;
  totals: PnlTokenTotal[];
  trades: PnlTradeRecord[];
  hedgeNet: HedgeNetPnlSummary;
}
