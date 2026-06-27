export type Address = `0x${string}`;
export type UIntString = string;
export type IntString = string;

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
}

export interface SubmitQuoteResponse {
  status: "accepted";
  txHash?: `0x${string}`;
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
  errorCode?: string;
}

export interface MarketSnapshot {
  snapshotId: string;
  midPrice: string;
  liquidityUsd: string;
  volatilityBps: number;
  observedAt: string;
}

export interface HedgeIntentStatusResponse {
  hedgeOrderId: string;
  status: "queued";
  quoteId: string;
  chainId: number;
  token: Address;
  side: "buy" | "sell";
  amount: UIntString;
  reason: "inventory_rebalance" | "risk_reduction";
  createdAt: string;
}

export interface PnlTradeRecord {
  pnlId: string;
  quoteId: string;
  chainId: number;
  tokenIn: Address;
  tokenOut: Address;
  amountIn: UIntString;
  amountOut: UIntString;
  grossPnlTokenOut: IntString;
  grossPnlBps: number;
  model: "simulated_mid_price_v1";
  realizedAt: string;
}

export interface PnlSummaryResponse {
  status: "ok";
  totalTrades: number;
  grossPnlTokenOut: IntString;
  trades: PnlTradeRecord[];
}
