import { createHash } from "node:crypto";
import type { Address, UIntString } from "../../shared/types/rfq.js";
import type { TokenRegistry } from "../pricing/token-registry.js";
import type { HedgeJob } from "./postgres-hedge-job.store.js";

export interface HedgeRoute {
  chainId: number;
  token: Address;
  venue: "binance";
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  quoteToken: Address;
  tokenDecimals: number;
  quoteTokenDecimals: number;
  stepSizeRaw: UIntString;
  priceTick: string;
  maxSlippageBps: number;
}

const routeFields = [
  "chainId",
  "token",
  "venue",
  "symbol",
  "baseAsset",
  "quoteAsset",
  "quoteToken",
  "tokenDecimals",
  "quoteTokenDecimals",
  "stepSizeRaw",
  "priceTick",
  "maxSlippageBps",
] as const;

export class HedgeRouteTable {
  private readonly routes: Map<string, HedgeRoute>;

  constructor(routes: readonly HedgeRoute[]) {
    if (!Array.isArray(routes) || routes.length === 0) {
      throw new Error("Hedge routes must be a non-empty array");
    }
    this.routes = new Map();
    for (const route of routes) {
      assertHedgeRoute(route);
      const snapshot = {
        ...route,
        token: route.token.toLowerCase() as Address,
        quoteToken: route.quoteToken.toLowerCase() as Address,
      };
      const key = routeKey(snapshot.chainId, snapshot.token);
      if (this.routes.has(key)) throw new Error(`Duplicate hedge route for ${key}`);
      this.routes.set(key, snapshot);
    }
  }

  find(chainId: number, token: Address): HedgeRoute | undefined {
    assertPositiveSafeInteger(chainId, "chainId");
    assertAddress(token, "token");
    const route = this.routes.get(routeKey(chainId, token));
    return route ? { ...route } : undefined;
  }

  list(): HedgeRoute[] {
    return [...this.routes.values()].map((route) => ({ ...route }));
  }

  validateTokenRegistry(registry: TokenRegistry): void {
    if (typeof registry !== "object" || registry === null || Array.isArray(registry) ||
        typeof registry.getToken !== "function") {
      throw new Error("Hedge route tokenRegistry.getToken must be a function");
    }
    for (const route of this.routes.values()) {
      const metadata = registry.getToken(route.chainId, route.token);
      if (metadata === undefined) {
        throw new Error(`Hedge route token ${route.token} is not configured on chain ${route.chainId}`);
      }
      if (metadata.chainId !== route.chainId ||
          typeof metadata.tokenAddress !== "string" ||
          metadata.tokenAddress.toLowerCase() !== route.token.toLowerCase() ||
          !Number.isSafeInteger(metadata.decimals) ||
          metadata.decimals < 0 ||
          metadata.decimals > 36) {
        throw new Error("Hedge route token registry metadata is invalid");
      }
      if (metadata.decimals !== route.tokenDecimals) {
        throw new Error(
          `Hedge route tokenDecimals ${route.tokenDecimals} does not match token registry decimals ${metadata.decimals} ` +
            `for ${route.chainId}:${route.token}`,
        );
      }
      const quoteMetadata = registry.getToken(route.chainId, route.quoteToken);
      if (quoteMetadata === undefined) {
        throw new Error(`Hedge route quote token ${route.quoteToken} is not configured on chain ${route.chainId}`);
      }
      if (quoteMetadata.chainId !== route.chainId ||
          typeof quoteMetadata.tokenAddress !== "string" ||
          quoteMetadata.tokenAddress.toLowerCase() !== route.quoteToken.toLowerCase() ||
          !Number.isSafeInteger(quoteMetadata.decimals) ||
          quoteMetadata.decimals < 0 ||
          quoteMetadata.decimals > 18 ||
          typeof quoteMetadata.isWhitelisted !== "boolean" ||
          typeof quoteMetadata.usdReference !== "boolean") {
        throw new Error("Hedge route quote token registry metadata is invalid");
      }
      if (!quoteMetadata.isWhitelisted || !quoteMetadata.usdReference) {
        throw new Error(`Hedge route quote token ${route.quoteToken} must be a whitelisted USD reference`);
      }
      if (quoteMetadata.decimals !== route.quoteTokenDecimals) {
        throw new Error(
          `Hedge route quoteTokenDecimals ${route.quoteTokenDecimals} does not match token registry decimals ` +
            `${quoteMetadata.decimals} for ${route.chainId}:${route.quoteToken}`,
        );
      }
    }
  }
}

export function parseHedgeRoutesJson(value: string): HedgeRouteTable {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error("RFQ_HEDGE_ROUTES_JSON must be a non-empty JSON string");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("RFQ_HEDGE_ROUTES_JSON must be valid JSON");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("RFQ_HEDGE_ROUTES_JSON root must be an object");
  }
  const record = parsed as Record<string, unknown>;
  if (Object.keys(record).length !== 1 || !Object.prototype.hasOwnProperty.call(record, "routes")) {
    throw new Error("RFQ_HEDGE_ROUTES_JSON root must contain only routes");
  }
  if (!Array.isArray(record.routes)) throw new Error("RFQ_HEDGE_ROUTES_JSON routes must be an array");
  return new HedgeRouteTable(record.routes as HedgeRoute[]);
}

export function buildHedgeClientOrderId(hedgeOrderId: string): string {
  if (typeof hedgeOrderId !== "string" || hedgeOrderId.length === 0 || hedgeOrderId.length > 128 ||
      !/^[A-Za-z0-9_:-]+$/.test(hedgeOrderId)) {
    throw new Error("Hedge order id must be a safe identifier");
  }
  return `rfq_${createHash("sha256").update(hedgeOrderId).digest("hex").slice(0, 32)}`;
}

export function formatHedgeQuantity(amount: UIntString, route: HedgeRoute): string {
  return formatUnits(BigInt(quantizeHedgeAmount(amount, route)), route.tokenDecimals);
}

export function quantizeHedgeAmount(amount: UIntString, route: HedgeRoute): UIntString {
  if (typeof amount !== "string" || !/^[1-9][0-9]*$/.test(amount)) {
    throw new Error("Hedge amount must be a canonical positive uint string");
  }
  assertHedgeRoute(route);
  const rawAmount = BigInt(amount);
  const stepSize = BigInt(route.stepSizeRaw);
  const quantized = (rawAmount / stepSize) * stepSize;
  if (quantized === 0n) throw new Error("HEDGE_AMOUNT_BELOW_STEP_SIZE");
  return quantized.toString() as UIntString;
}

export function calculateHedgeLimitPrice(
  side: "buy" | "sell",
  baseAmount: UIntString,
  referenceAmount: UIntString,
  route: HedgeRoute,
): string {
  if (side !== "buy" && side !== "sell") throw new Error("Hedge limit side must be buy or sell");
  if (typeof baseAmount !== "string" || !/^[1-9][0-9]*$/.test(baseAmount) ||
      typeof referenceAmount !== "string" || !/^[1-9][0-9]*$/.test(referenceAmount)) {
    throw new Error("Hedge limit amounts must be canonical positive uint strings");
  }
  assertHedgeRoute(route);
  const scale = 10n ** 18n;
  const numerator = BigInt(referenceAmount) * 10n ** BigInt(route.tokenDecimals) * scale *
    BigInt(side === "buy" ? 10_000 + route.maxSlippageBps : 10_000 - route.maxSlippageBps);
  const denominator = BigInt(baseAmount) * 10n ** BigInt(route.quoteTokenDecimals) * 10_000n;
  const unquantized = side === "buy"
    ? divideCeil(numerator, denominator)
    : numerator / denominator;
  const tick = parsePriceTick(route.priceTick);
  const quantized = side === "buy"
    ? divideCeil(unquantized, tick) * tick
    : unquantized / tick * tick;
  if (quantized <= 0n) throw new Error("HEDGE_LIMIT_PRICE_BELOW_TICK");
  return formatPrice(quantized);
}

export function parseHedgeExecutedQuantity(quantity: string, route: HedgeRoute): UIntString | undefined {
  if (typeof quantity !== "string" || !/^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(quantity)) {
    throw new Error("HEDGE_EXECUTED_QUANTITY_INVALID");
  }
  assertHedgeRoute(route);
  const [integer, fraction = ""] = quantity.split(".");
  if (fraction.length > route.tokenDecimals) throw new Error("HEDGE_EXECUTED_QUANTITY_INVALID");
  const raw = BigInt(integer) * 10n ** BigInt(route.tokenDecimals) +
    BigInt((fraction + "0".repeat(route.tokenDecimals)).slice(0, route.tokenDecimals) || "0");
  if (raw === 0n) return undefined;
  if (raw % BigInt(route.stepSizeRaw) !== 0n) throw new Error("HEDGE_EXECUTED_QUANTITY_INVALID");
  return raw.toString() as UIntString;
}

export function routeForJob(table: HedgeRouteTable, job: HedgeJob): HedgeRoute {
  const route = table.find(job.chainId, job.token);
  if (!route) throw new Error("HEDGE_ROUTE_NOT_CONFIGURED");
  if (route.quoteToken.toLowerCase() !== job.referenceToken.toLowerCase()) {
    throw new Error("HEDGE_ROUTE_REFERENCE_TOKEN_MISMATCH");
  }
  return route;
}

function assertHedgeRoute(route: HedgeRoute): void {
  if (typeof route !== "object" || route === null || Array.isArray(route)) {
    throw new Error("Hedge route must be an object");
  }
  const keys = Object.keys(route);
  if (keys.length !== routeFields.length || routeFields.some((field) => !Object.prototype.hasOwnProperty.call(route, field))) {
    throw new Error("Hedge route fields are invalid");
  }
  assertPositiveSafeInteger(route.chainId, "chainId");
  assertAddress(route.token, "token");
  assertAddress(route.quoteToken, "quoteToken");
  if (route.token.toLowerCase() === route.quoteToken.toLowerCase()) {
    throw new Error("Hedge route token and quoteToken must be distinct");
  }
  if (route.venue !== "binance") throw new Error("Hedge route venue must be binance");
  if (typeof route.symbol !== "string" || !/^[A-Z0-9._-]{3,32}$/.test(route.symbol)) {
    throw new Error("Hedge route symbol is invalid");
  }
  assertVenueAsset(route.baseAsset, "baseAsset");
  assertVenueAsset(route.quoteAsset, "quoteAsset");
  if (route.baseAsset === route.quoteAsset) throw new Error("Hedge route venue assets must be distinct");
  if (!Number.isSafeInteger(route.tokenDecimals) || route.tokenDecimals < 0 || route.tokenDecimals > 36) {
    throw new Error("Hedge route tokenDecimals must be a safe integer between 0 and 36");
  }
  if (!Number.isSafeInteger(route.quoteTokenDecimals) || route.quoteTokenDecimals < 0 ||
      route.quoteTokenDecimals > 18) {
    throw new Error("Hedge route quoteTokenDecimals must be a safe integer between 0 and 18");
  }
  if (typeof route.stepSizeRaw !== "string" || !/^[1-9][0-9]*$/.test(route.stepSizeRaw)) {
    throw new Error("Hedge route stepSizeRaw must be a canonical positive uint string");
  }
  parsePriceTick(route.priceTick);
  if (!Number.isSafeInteger(route.maxSlippageBps) || route.maxSlippageBps < 0 || route.maxSlippageBps > 1_000) {
    throw new Error("Hedge route maxSlippageBps must be a safe integer between 0 and 1000");
  }
}

function parsePriceTick(value: unknown): bigint {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)(?:\.[0-9]{1,18})?$/.test(value)) {
    throw new Error("Hedge route priceTick must be a canonical positive decimal with at most 18 fractional digits");
  }
  const [integer, fraction = ""] = value.split(".");
  const parsed = BigInt(integer) * 10n ** 18n + BigInt((fraction + "0".repeat(18)).slice(0, 18));
  if (parsed <= 0n) {
    throw new Error("Hedge route priceTick must be a canonical positive decimal with at most 18 fractional digits");
  }
  return parsed;
}

function formatPrice(value: bigint): string {
  const raw = value.toString().padStart(19, "0");
  const integer = raw.slice(0, -18);
  const fraction = raw.slice(-18).replace(/0+$/, "");
  return fraction.length === 0 ? integer : `${integer}.${fraction}`;
}

function divideCeil(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator - 1n) / denominator;
}

function assertVenueAsset(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || !/^[A-Z0-9._-]{1,32}$/.test(value)) {
    throw new Error(`Hedge route ${field} is invalid`);
  }
}

function routeKey(chainId: number, token: Address): string {
  return `${chainId}:${token.toLowerCase()}`;
}

function assertPositiveSafeInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`Hedge route ${field} must be a positive safe integer`);
}

function assertAddress(value: unknown, field: string): asserts value is Address {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new Error(`Hedge route ${field} must be a 20-byte hex address`);
  }
}

function formatUnits(value: bigint, decimals: number): string {
  if (decimals === 0) return value.toString();
  const raw = value.toString().padStart(decimals + 1, "0");
  const integer = raw.slice(0, -decimals);
  const fraction = raw.slice(-decimals).replace(/0+$/, "");
  return fraction.length === 0 ? integer : `${integer}.${fraction}`;
}
