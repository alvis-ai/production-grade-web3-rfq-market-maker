import { RFQClientError } from "@rfq-market-maker/sdk";

export interface UIError {
  message: string;
  code?: string;
  status?: number;
  traceId?: string;
}

export function toUIError(error: unknown, fallbackMessage: string): UIError {
  if (error instanceof RFQClientError) {
    return {
      message: error.message,
      code: error.code,
      status: error.status,
      traceId: error.traceId,
    };
  }

  if (error instanceof Error) {
    return { message: error.message };
  }

  return { message: fallbackMessage };
}
