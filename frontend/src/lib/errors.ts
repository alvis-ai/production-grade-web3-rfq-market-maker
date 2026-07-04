import { RFQClientError } from "@rfq-market-maker/sdk";

export interface UIError {
  message: string;
  code?: string;
  status?: number;
  traceId?: string;
  retryAfterSeconds?: number;
}

const walletErrorMessageFields = ["shortMessage", "details", "reason"] as const;
const maxWalletErrorDepth = 4;
const maxWalletErrorMessageLength = 512;

export function toUIError(error: unknown, fallbackMessage: string): UIError {
  if (error instanceof RFQClientError) {
    return {
      message: error.message,
      code: error.code,
      status: error.status,
      traceId: error.traceId,
      retryAfterSeconds: error.retryAfterSeconds,
    };
  }

  const walletErrorMessage = readWalletErrorMessage(error);
  if (walletErrorMessage) {
    return { message: walletErrorMessage };
  }

  if (error instanceof Error) {
    return { message: error.message };
  }

  return { message: fallbackMessage };
}

function readWalletErrorMessage(error: unknown): string | undefined {
  const visited = new Set<unknown>();
  let current: unknown = error;

  for (let depth = 0; depth < maxWalletErrorDepth; depth += 1) {
    if (!isRecord(current) || visited.has(current)) {
      return undefined;
    }
    visited.add(current);

    for (const field of walletErrorMessageFields) {
      const message = readBoundedOwnString(current, field);
      if (message) {
        return message;
      }
    }

    current = Object.prototype.hasOwnProperty.call(current, "cause")
      ? current.cause
      : undefined;
  }

  return undefined;
}

function readBoundedOwnString(value: Record<string, unknown>, field: string): string | undefined {
  if (!Object.prototype.hasOwnProperty.call(value, field)) {
    return undefined;
  }

  const fieldValue = value[field];
  if (typeof fieldValue !== "string") {
    return undefined;
  }

  const message = fieldValue.trim();
  if (message.length === 0 || message.length > maxWalletErrorMessageLength) {
    return undefined;
  }

  return message;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
