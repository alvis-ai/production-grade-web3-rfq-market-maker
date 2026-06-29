import assert from "node:assert/strict";
import test from "node:test";
import { APIError, toAPIError } from "../dist/shared/errors/api-error.js";

test("APIError serializes stable client responses without internal reason codes", () => {
  const error = new APIError(
    "SETTLEMENT_REVERTED",
    "Settlement reverted",
    409,
    "tr_original",
    "TOKEN_NOT_WHITELISTED",
  );

  assert.equal(error.name, "APIError");
  assert.equal(error.code, "SETTLEMENT_REVERTED");
  assert.equal(error.statusCode, 409);
  assert.equal(error.traceId, "tr_original");
  assert.equal(error.internalReasonCode, "TOKEN_NOT_WHITELISTED");
  assert.deepEqual(error.toResponse("tr_public"), {
    code: "SETTLEMENT_REVERTED",
    message: "Settlement reverted",
    traceId: "tr_public",
  });
});

test("toAPIError preserves APIError instances and maps unknown failures to INTERNAL_ERROR", () => {
  const apiError = new APIError("QUOTE_NOT_FOUND", "Quote not found", 404);

  assert.equal(toAPIError(apiError), apiError);
  assert.deepEqual(toAPIError(new Error("database offline"), "tr_unknown"), new APIError(
    "INTERNAL_ERROR",
    "Internal server error",
    500,
    "tr_unknown",
  ));
});
