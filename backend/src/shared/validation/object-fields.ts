import { APIError } from "../errors/api-error.js";

export function assertExactFields(
  input: Record<string, unknown>,
  allowedFields: readonly string[],
  label: string,
): void {
  const allowed = new Set(allowedFields);
  const unknown = Object.keys(input).find((field) => !allowed.has(field));
  if (unknown) {
    throw new APIError("INVALID_REQUEST", `${label} contains unknown field ${unknown}`, 400);
  }

  const missing = allowedFields.find((field) => !Object.prototype.hasOwnProperty.call(input, field));
  if (missing) {
    throw new APIError("INVALID_REQUEST", `${label} must include field ${missing}`, 400);
  }
}
