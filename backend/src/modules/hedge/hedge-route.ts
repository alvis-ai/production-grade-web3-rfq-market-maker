import { createHash } from "node:crypto";
import type { Address, UIntString } from "../../shared/types/rfq.js";
import type { HedgeJob } from "./postgres-hedge-job.store.js";

export interface HedgeRoute {
  chainId: number;
  token: Address;
  venue: "binance";
  symbol: string;
  tokenDecimals: number;
  stepSizeRaw: UIntString;
}

const routeFields = ["chainId", "token", "venue", "symbol", "tokenDecimals", "stepSizeRaw"] as const;

export class HedgeRouteTable {
  private readonly routes: Map<string, HedgeRoute>;

  constructor(routes: readonly HedgeRoute[]) {
    if (!Array.isArray(routes) || routes.length === 0) {
      throw new Error("Hedge routes must be a non-empty array");
    }
    this.routes = new Map();
    for (const route of routes) {
      assertHedgeRoute(route);
      const snapshot = { ...route, token: route.token.toLowerCase() as Address };
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
  if (typeof amount !== "string" || !/^[1-9][0-9]*$/.test(amount)) {
    throw new Error("Hedge amount must be a canonical positive uint string");
  }
  assertHedgeRoute(route);
  const rawAmount = BigInt(amount);
  const stepSize = BigInt(route.stepSizeRaw);
  const quantized = (rawAmount / stepSize) * stepSize;
  if (quantized === 0n) throw new Error("HEDGE_AMOUNT_BELOW_STEP_SIZE");
  return formatUnits(quantized, route.tokenDecimals);
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
  if (route.venue !== "binance") throw new Error("Hedge route venue must be binance");
  if (typeof route.symbol !== "string" || !/^[A-Z0-9._-]{3,32}$/.test(route.symbol)) {
    throw new Error("Hedge route symbol is invalid");
  }
  if (!Number.isSafeInteger(route.tokenDecimals) || route.tokenDecimals < 0 || route.tokenDecimals > 36) {
    throw new Error("Hedge route tokenDecimals must be a safe integer between 0 and 36");
  }
  if (typeof route.stepSizeRaw !== "string" || !/^[1-9][0-9]*$/.test(route.stepSizeRaw)) {
    throw new Error("Hedge route stepSizeRaw must be a canonical positive uint string");
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
