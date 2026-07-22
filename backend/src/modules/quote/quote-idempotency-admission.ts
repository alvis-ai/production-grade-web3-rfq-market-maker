import type { QuoteResponse } from "../../shared/types/rfq.js";
import { APIError, toAPIError } from "../../shared/errors/api-error.js";
import type {
  QuoteIdempotencyReservation,
  QuoteIdempotencyStore,
} from "./quote-idempotency.store.js";

export class QuoteIdempotencyReplay extends Error {
  constructor(readonly response: QuoteResponse) {
    super("Quote idempotency replay");
  }
}

export interface IdempotentQuoteOperationResult {
  response: QuoteResponse;
  idempotencyCompleted: boolean;
}

export interface FusedIdempotentQuoteInput {
  store: QuoteIdempotencyStore;
  principalId: string;
  key: string;
  requestHash: string;
  execute(admission: Promise<QuoteIdempotencyReservation>): Promise<IdempotentQuoteOperationResult>;
}

export async function executeFusedIdempotentQuote(input: FusedIdempotentQuoteInput): Promise<QuoteResponse> {
  const admission = acquireQuoteIdempotency(input.store, input.principalId, input.key, input.requestHash);
  void admission.catch(() => undefined);
  let result: IdempotentQuoteOperationResult;
  try {
    result = await input.execute(admission);
  } catch (error) {
    let reservation: QuoteIdempotencyReservation;
    try {
      reservation = await admission;
    } catch (admissionError) {
      if (admissionError instanceof QuoteIdempotencyReplay) return admissionError.response;
      throw admissionError;
    }
    const apiError = toAPIError(error);
    try {
      await input.store.fail(reservation, {
        code: apiError.code,
        message: apiError.message,
        statusCode: apiError.statusCode,
      });
    } catch {
      throw new APIError("QUOTE_STORE_UNAVAILABLE", "Quote idempotency store unavailable", 503);
    }
    throw error;
  }
  if (!result.idempotencyCompleted) {
    try {
      await input.store.complete(await admission, result.response);
    } catch {
      throw new APIError("QUOTE_STORE_UNAVAILABLE", "Quote idempotency completion unavailable", 503);
    }
  }
  return result.response;
}

async function acquireQuoteIdempotency(
  store: QuoteIdempotencyStore,
  principalId: string,
  key: string,
  requestHash: string,
): Promise<QuoteIdempotencyReservation> {
  let claim;
  try {
    claim = await store.acquire(principalId, key, requestHash);
  } catch {
    throw new APIError("QUOTE_STORE_UNAVAILABLE", "Quote idempotency store unavailable", 503);
  }
  if (claim.status === "replay") throw new QuoteIdempotencyReplay(claim.response);
  if (claim.status === "failed") {
    throw new APIError(claim.error.code, claim.error.message, claim.error.statusCode);
  }
  if (claim.status === "conflict") {
    throw new APIError("IDEMPOTENCY_KEY_CONFLICT", "Idempotency-Key was already used for another request", 409);
  }
  if (claim.status === "in_progress") {
    throw new APIError("IDEMPOTENCY_REQUEST_IN_PROGRESS", "Idempotent quote request is still processing", 409);
  }
  return claim.reservation;
}

export function isIdempotencyReservation(
  value: QuoteIdempotencyReservation | Promise<QuoteIdempotencyReservation> | undefined,
): value is QuoteIdempotencyReservation {
  return value !== undefined && typeof (value as Promise<QuoteIdempotencyReservation>).then !== "function";
}
