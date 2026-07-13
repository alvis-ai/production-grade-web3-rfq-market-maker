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
  txHash?: `0x${string}`;
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
export type ReadinessComponentName =
  | "marketData"
  | "marketSnapshotStore"
  | "routing"
  | "pricing"
  | "risk"
  | "signer"
  | "quoteRepository"
  | "riskDecisionStore"
  | "rateLimitStore"
  | "inventory"
  | "execution"
  | "settlementEventStore"
  | "pnl"
  | "metrics";
export type ReadinessComponents = Record<ReadinessComponentName, ReadinessComponentStatus>;

export interface ReadinessResponse {
  status: "ready" | "degraded";
  components: ReadinessComponents;
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

export type HedgeIntentStatusValue = "queued" | "filled" | "failed";
export type HedgeExecutionEvidenceVersion = "base-only-v1" | "base-and-quote-v2";

export interface HedgeIntentStatus {
  hedgeOrderId: string;
  status: HedgeIntentStatusValue;
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

export interface PnlSummary {
  status: "ok";
  totalTrades: number;
  totals: PnlTokenTotal[];
  trades: PnlTradeRecord[];
}

export const rfqErrorCodes = [
  "INVALID_REQUEST",
  "AUTHENTICATION_REQUIRED",
  "AUTHORIZATION_DENIED",
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
  "SUBMIT_RESERVATION_UNAVAILABLE",
  "RATE_LIMITED",
  "RATE_LIMIT_UNAVAILABLE",
  "INTERNAL_ERROR",
] as const;

export type RFQErrorCode = (typeof rfqErrorCodes)[number];

export interface RFQErrorResponse {
  code: RFQErrorCode;
  message: string;
  traceId: string;
}
