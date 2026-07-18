import { APIError } from "../../shared/errors/api-error.js";
import type { SignedQuote } from "../../shared/types/rfq.js";
import { assertPrincipalId, localPrincipalId } from "../../shared/validation/principal-id.js";
import { validateSubmitQuoteRequest } from "../../shared/validation/submit-request.js";
import type { QuoteServiceDeps, SubmittableQuoteOptions } from "./quote-service-contract.js";
import { quoteStoreFailure } from "./quote-service-errors.js";
import { isExactSignedQuote } from "./quote-service-result-validation.js";

export async function requireSubmittableQuote(
  deps: QuoteServiceDeps,
  quote: SignedQuote,
  signature: `0x${string}`,
  options: SubmittableQuoteOptions,
  markExpiredBestEffort: (quoteId: string) => Promise<void>,
): Promise<string> {
  if (typeof options !== "object" || options === null || Array.isArray(options)) {
    throw new APIError("INVALID_REQUEST", "Submit quote lookup options must be an object", 400);
  }
  const unknownOption = Object.keys(options).find(
    (field) => field !== "allowExpired" && field !== "principalId",
  );
  if (unknownOption) {
    throw new APIError("INVALID_REQUEST", `Submit quote lookup options contain unknown field ${unknownOption}`, 400);
  }
  if ("allowExpired" in options && !Object.prototype.hasOwnProperty.call(options, "allowExpired")) {
    throw new APIError("INVALID_REQUEST", "Submit quote lookup allowExpired must be an own field", 400);
  }
  if (options.allowExpired !== undefined && typeof options.allowExpired !== "boolean") {
    throw new APIError("INVALID_REQUEST", "Submit quote lookup allowExpired must be a boolean", 400);
  }
  if ("principalId" in options && !Object.prototype.hasOwnProperty.call(options, "principalId")) {
    throw new APIError("INVALID_REQUEST", "Submit quote lookup principalId must be an own field", 400);
  }
  try {
    assertPrincipalId(options.principalId ?? localPrincipalId, "Submit quote lookup principalId");
  } catch (error) {
    throw new APIError("INVALID_REQUEST", error instanceof Error ? error.message : "Invalid principalId", 400);
  }
  const allowExpired = options.allowExpired ?? false;
  const principalId = options.principalId ?? localPrincipalId;
  const validatedSubmitRequest = validateSubmitQuoteRequest({ quote, signature }, { allowExpired: true });
  const validatedQuote = validatedSubmitRequest.quote;
  let record;
  try {
    record = await deps.quoteRepository.findSignedQuoteByChainUserNonce(
      validatedQuote.chainId,
      validatedQuote.user,
      validatedQuote.nonce,
      principalId,
    );
  } catch (error) {
    throw quoteStoreFailure(error);
  }
  if (!record || !isExactSignedQuote(record, validatedQuote)) {
    throw new APIError("QUOTE_NOT_FOUND", "Signed quote not found", 404);
  }
  if (record.status === "submitted" || record.status === "settled") {
    throw new APIError("QUOTE_ALREADY_USED", "Quote already used", 409);
  }
  if (record.status === "failed") {
    throw new APIError("QUOTE_FAILED", "Quote already failed", 409);
  }
  if (record.status === "expired" && !allowExpired) {
    throw new APIError("QUOTE_EXPIRED", "Quote expired", 409);
  }
  if (!allowExpired && record.deadline && record.deadline < Math.floor(Date.now() / 1000)) {
    await markExpiredBestEffort(record.quoteId);
    throw new APIError("QUOTE_EXPIRED", "Quote expired", 409);
  }
  if (record.signature?.toLowerCase() !== validatedSubmitRequest.signature.toLowerCase()) {
    throw new APIError("INVALID_SIGNATURE", "Quote signature does not match stored signed quote", 409);
  }
  if (!await deps.signerService.verifyQuoteSignature(validatedQuote, validatedSubmitRequest.signature)) {
    throw new APIError("INVALID_SIGNATURE", "Quote signature is not from the trusted signer", 409);
  }
  return record.quoteId;
}
