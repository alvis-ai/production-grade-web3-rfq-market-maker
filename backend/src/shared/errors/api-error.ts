export type RFQErrorCode =
  | "INVALID_REQUEST"
  | "UNSUPPORTED_CHAIN"
  | "UNSUPPORTED_TOKEN"
  | "AMOUNT_TOO_SMALL"
  | "AMOUNT_TOO_LARGE"
  | "MARKET_DATA_UNAVAILABLE"
  | "PRICING_UNAVAILABLE"
  | "RISK_REJECTED"
  | "SIGNER_UNAVAILABLE"
  | "QUOTE_NOT_FOUND"
  | "QUOTE_EXPIRED"
  | "QUOTE_ALREADY_USED"
  | "SETTLEMENT_REVERTED"
  | "RATE_LIMITED"
  | "INTERNAL_ERROR";

export interface ErrorResponse {
  code: RFQErrorCode;
  message: string;
  traceId?: string;
}

export class APIError extends Error {
  constructor(
    readonly code: RFQErrorCode,
    message: string,
    readonly statusCode: number,
    readonly traceId?: string,
  ) {
    super(message);
    this.name = "APIError";
  }

  toResponse(traceId = this.traceId): ErrorResponse {
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
