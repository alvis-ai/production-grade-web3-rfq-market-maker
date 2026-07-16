import { readBoundedJsonResponse as readBoundedHttpJsonResponse } from "../../../shared/http/bounded-json-response.js";

export const MAX_CEX_WS_MESSAGE_BYTES = 1_048_576;
export const MAX_CEX_SNAPSHOT_BYTES = 2_097_152;

export function callCexCallbackBestEffort<T>(
  callback: ((value: T) => void) | undefined,
  value: T,
): void {
  try {
    callback?.(value);
  } catch {
    // Connector state transitions must not depend on optional observers.
  }
}

export function parseBoundedJsonMessage(
  raw: unknown,
  label: string,
  maxBytes = MAX_CEX_WS_MESSAGE_BYTES,
): unknown {
  assertByteLimit(maxBytes);
  if (typeof raw !== "string") {
    throw new Error(`${label} must be a text frame`);
  }
  if (raw.length > maxBytes || new TextEncoder().encode(raw).byteLength > maxBytes) {
    throw new Error(`${label} exceeds ${maxBytes} bytes`);
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new Error(`${label} must contain valid JSON`);
  }
}

export async function readBoundedJsonResponse(
  response: Response,
  label: string,
  maxBytes = MAX_CEX_SNAPSHOT_BYTES,
): Promise<unknown> {
  return readBoundedHttpJsonResponse(response, label, maxBytes);
}

export function exponentialReconnectDelayMs(
  attempt: number,
  initialDelayMs: number,
  maxDelayMs: number,
  randomValue = Math.random(),
): number {
  if (!Number.isSafeInteger(attempt) || attempt < 0) {
    throw new Error("Reconnect attempt must be a non-negative safe integer");
  }
  if (!Number.isSafeInteger(initialDelayMs) || initialDelayMs <= 0 ||
      !Number.isSafeInteger(maxDelayMs) || maxDelayMs < initialDelayMs) {
    throw new Error("Reconnect delay bounds are invalid");
  }
  if (!Number.isFinite(randomValue) || randomValue < 0 || randomValue >= 1) {
    throw new Error("Reconnect jitter source must be in [0, 1)");
  }

  const exponentialDelay = initialDelayMs * 2 ** Math.min(attempt, 52);
  const cappedDelay = Math.min(exponentialDelay, maxDelayMs);
  return Math.max(1, Math.min(maxDelayMs, Math.round(cappedDelay * (0.5 + randomValue))));
}

function assertByteLimit(maxBytes: number): void {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new Error("Byte limit must be a positive safe integer");
  }
}
