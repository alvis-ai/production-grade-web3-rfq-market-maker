export type RFQErrorCode =
  | "INVALID_REQUEST"
  | "AUTHENTICATION_REQUIRED"
  | "AUTHORIZATION_DENIED"
  | "UNSUPPORTED_CHAIN"
  | "UNSUPPORTED_TOKEN"
  | "AMOUNT_TOO_SMALL"
  | "AMOUNT_TOO_LARGE"
  | "MARKET_DATA_UNAVAILABLE"
  | "ROUTING_UNAVAILABLE"
  | "PRICING_UNAVAILABLE"
  | "RISK_REJECTED"
  | "SIGNER_UNAVAILABLE"
  | "INVALID_SIGNATURE"
  | "QUOTE_STORE_UNAVAILABLE"
  | "QUOTE_NOT_FOUND"
  | "QUOTE_EXPIRED"
  | "QUOTE_ALREADY_USED"
  | "QUOTE_FAILED"
  | "IDEMPOTENCY_KEY_CONFLICT"
  | "IDEMPOTENCY_REQUEST_IN_PROGRESS"
  | "QUOTE_PAUSED"
  | "QUOTE_CONTROL_CONFLICT"
  | "QUOTE_CONTROL_UNAVAILABLE"
  | "TOXIC_FLOW_SCORE_CONFLICT"
  | "TOXIC_FLOW_SCORE_UNAVAILABLE"
  | "HEDGE_NOT_FOUND"
  | "HEDGE_STORE_UNAVAILABLE"
  | "SETTLEMENT_EVENT_NOT_FOUND"
  | "SETTLEMENT_EVENT_STORE_UNAVAILABLE"
  | "PNL_STORE_UNAVAILABLE"
  | "SETTLEMENT_UNAVAILABLE"
  | "SETTLEMENT_REVERTED"
  | "SUBMIT_RESERVATION_UNAVAILABLE"
  | "RATE_LIMITED"
  | "RATE_LIMIT_UNAVAILABLE"
  | "INTERNAL_ERROR";

export interface ErrorResponse {
  code: RFQErrorCode;
  message: string;
  traceId: string;
}

const rfqErrorCodeSet: ReadonlySet<string> = new Set([
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
  "IDEMPOTENCY_KEY_CONFLICT",
  "IDEMPOTENCY_REQUEST_IN_PROGRESS",
  "QUOTE_PAUSED",
  "QUOTE_CONTROL_CONFLICT",
  "QUOTE_CONTROL_UNAVAILABLE",
  "TOXIC_FLOW_SCORE_CONFLICT",
  "TOXIC_FLOW_SCORE_UNAVAILABLE",
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
] satisfies readonly RFQErrorCode[]);

export function isRFQErrorCode(value: unknown): value is RFQErrorCode {
  return typeof value === "string" && rfqErrorCodeSet.has(value);
}

export class APIError extends Error {
  constructor(
    readonly code: RFQErrorCode,
    message: string,
    readonly statusCode: number,
    readonly traceId?: string,
    readonly internalReasonCode?: string,
  ) {
    super(message);
    this.name = "APIError";
  }

  toResponse(traceId: string): ErrorResponse {
    return {
      code: this.code,
      message: this.message,
      traceId,
    };
  }
}

export function toAPIError(error: unknown, traceId?: string): APIError {
  if (error instanceof APIError) return error;

  return new APIError("INTERNAL_ERROR", "Internal server error", 500, traceId);
}
