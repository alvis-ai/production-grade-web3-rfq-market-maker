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
  executionEvidenceVersion?: HedgeExecutionEvidenceVersion;
  executedQuoteQuantity?: string;
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

export interface PnlSummaryResponse {
  status: "ok";
  totalTrades: number;
  totals: PnlTokenTotal[];
  trades: PnlTradeRecord[];
}
