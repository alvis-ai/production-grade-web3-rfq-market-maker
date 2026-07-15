import type { RFQErrorCode } from "./types.js";

export type RFQClientErrorCode = RFQErrorCode | "RFQ_CLIENT_ERROR";

export class RFQClientError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: RFQClientErrorCode = "RFQ_CLIENT_ERROR",
    readonly traceId?: string,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "RFQClientError";
  }
}
