export type Address = `0x${string}`;
export type UIntString = string;
export type IntString = string;
export const simulatedPnlModelDescription =
  "Simulated same-decimal quote attribution where grossPnlTokenOut equals amountIn minus amountOut and is not cross-token accounting PnL" as const;

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
  volatilityBps: number;
  observedAt: string;
}

export type HedgeIntentStatus = "queued" | "filled" | "failed";

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
  chainId: number;
  user: Address;
  tokenIn: Address;
  tokenOut: Address;
  amountIn: UIntString;
  amountOut: UIntString;
  minAmountOut: UIntString;
  nonce: UIntString;
  deadline: number;
  grossPnlTokenOut: IntString;
  grossPnlBps: number;
  model: "simulated_mid_price_v1";
  modelDescription: "Simulated same-decimal quote attribution where grossPnlTokenOut equals amountIn minus amountOut and is not cross-token accounting PnL";
  realizedAt: string;
}

export interface PnlSummaryResponse {
  status: "ok";
  totalTrades: number;
  grossPnlTokenOut: IntString;
  trades: PnlTradeRecord[];
}
