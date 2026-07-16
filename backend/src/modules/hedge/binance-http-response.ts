import { readBoundedJsonResponse } from "../../shared/http/bounded-json-response.js";

export const MAX_BINANCE_HTTP_RESPONSE_BYTES = 2_097_152;

export function readBoundedBinanceJsonResponse(
  response: Response,
  label: string,
): Promise<unknown> {
  return readBoundedJsonResponse(response, label, MAX_BINANCE_HTTP_RESPONSE_BYTES);
}
