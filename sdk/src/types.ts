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

export interface Quote {
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
  quote: Quote;
  signature: `0x${string}`;
}

export interface SubmitQuoteResponse {
  status: "accepted";
  txHash?: `0x${string}`;
  settlementEventId?: string;
  hedgeOrderId?: string;
  pnlId?: string;
}

export interface HealthResponse {
  status: "ok";
}

export type ReadinessComponentStatus = "ok" | "degraded";

export interface ReadinessResponse {
  status: "ready" | "degraded";
  components: Record<string, ReadinessComponentStatus>;
}

export type QuoteLifecycleStatus =
  | "requested"
  | "rejected"
  | "signed"
  | "expired"
  | "submitted"
  | "settled"
  | "failed";

export interface QuoteStatus {
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

export interface HedgeIntentStatus {
  hedgeOrderId: string;
  status: "queued";
  settlementEventId: string;
  quoteId: string;
  chainId: number;
  token: Address;
  side: "buy" | "sell";
  amount: UIntString;
  reason: "inventory_rebalance" | "risk_reduction";
  createdAt: string;
}

export interface SettlementEventStatus {
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
  observedAt: string;
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

export interface PnlSummary {
  status: "ok";
  totalTrades: number;
  grossPnlTokenOut: IntString;
  trades: PnlTradeRecord[];
}

export const rfqErrorCodes = [
  "INVALID_REQUEST",
  "UNSUPPORTED_CHAIN",
  "UNSUPPORTED_TOKEN",
  "AMOUNT_TOO_SMALL",
  "AMOUNT_TOO_LARGE",
  "MARKET_DATA_UNAVAILABLE",
  "ROUTING_UNAVAILABLE",
  "PRICING_UNAVAILABLE",
  "RISK_REJECTED",
  "SIGNER_UNAVAILABLE",
  "INVALID_SIGNATURE",
  "QUOTE_STORE_UNAVAILABLE",
  "QUOTE_NOT_FOUND",
  "QUOTE_EXPIRED",
  "QUOTE_ALREADY_USED",
  "QUOTE_FAILED",
  "HEDGE_NOT_FOUND",
  "HEDGE_STORE_UNAVAILABLE",
  "SETTLEMENT_EVENT_NOT_FOUND",
  "SETTLEMENT_EVENT_STORE_UNAVAILABLE",
  "PNL_STORE_UNAVAILABLE",
  "SETTLEMENT_UNAVAILABLE",
  "SETTLEMENT_REVERTED",
  "RATE_LIMITED",
  "INTERNAL_ERROR",
] as const;

export type RFQErrorCode = (typeof rfqErrorCodes)[number];

export interface RFQErrorResponse {
  code: RFQErrorCode;
  message: string;
  traceId: string;
}
