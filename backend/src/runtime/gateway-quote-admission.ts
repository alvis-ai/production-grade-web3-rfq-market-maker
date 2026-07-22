import { RedisQuoteAdmissionStore } from "../modules/quote/redis-quote-admission.store.js";
import { normalizeRedisUrl } from "../shared/redis/redis-url.js";
import type { RedisQuoteExposureRuntime } from "./gateway-quote-exposure.js";
import type { GatewayQuoteIssuanceRuntime } from "./gateway-quote-issuance.js";

export function resolveRedisQuoteAdmissionStore(
  issuance: GatewayQuoteIssuanceRuntime | undefined,
  exposure: RedisQuoteExposureRuntime | undefined,
): RedisQuoteAdmissionStore | undefined {
  if (!issuance || !exposure) return undefined;
  if (normalizeRedisUrl(issuance.redisUrl) !== normalizeRedisUrl(exposure.redisUrl)) {
    throw new Error("Atomic quote admission requires one Redis authority");
  }
  return new RedisQuoteAdmissionStore(exposure.redisStore, issuance.redisStore);
}
