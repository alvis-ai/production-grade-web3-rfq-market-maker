import type { MarketSnapshot, QuoteRequest } from "../../shared/types/rfq.js";

const maxSafeIdentifierLength = 128;
const safeIdentifierPattern = /^[A-Za-z0-9_:-]+$/;

export interface RouteInput {
  request: QuoteRequest;
  snapshot: MarketSnapshot;
}

export interface RoutePlan {
  routeId: string;
  venue: "internal_inventory";
  tokenIn: QuoteRequest["tokenIn"];
  tokenOut: QuoteRequest["tokenOut"];
  expectedLiquidityUsd: string;
}

export interface RoutingEngine {
  selectRoute(input: RouteInput): Promise<RoutePlan>;
}

export class InternalInventoryRoutingEngine implements RoutingEngine {
  async selectRoute(input: RouteInput): Promise<RoutePlan> {
    assertRouteInput(input);
    return {
      routeId: [
        "route",
        input.request.chainId.toString(),
        input.request.tokenIn.slice(2, 10).toLowerCase(),
        input.request.tokenOut.slice(2, 10).toLowerCase(),
      ].join("_"),
      venue: "internal_inventory",
      tokenIn: input.request.tokenIn,
      tokenOut: input.request.tokenOut,
      expectedLiquidityUsd: input.snapshot.liquidityUsd,
    };
  }
}

function assertRouteInput(input: RouteInput): void {
  assertObject(input, "input");
  assertObject(input.request, "request");
  assertObject(input.snapshot, "snapshot");
  assertPositiveSafeInteger(input.request.chainId, "request.chainId");
  assertAddress(input.request.user, "request.user");
  assertAddress(input.request.tokenIn, "request.tokenIn");
  assertAddress(input.request.tokenOut, "request.tokenOut");
  if (input.request.tokenIn.toLowerCase() === input.request.tokenOut.toLowerCase()) {
    throw new Error("Routing request token pair must contain distinct tokens");
  }
  assertPositiveUIntString(input.request.amountIn, "request.amountIn");
  assertNonNegativeBps(input.request.slippageBps, "request.slippageBps");

  assertSafeIdentifier(input.snapshot.snapshotId, "snapshot.snapshotId");
  assertPositiveDecimalString(input.snapshot.midPrice, "snapshot.midPrice");
  assertPositiveUIntString(input.snapshot.liquidityUsd, "snapshot.liquidityUsd");
  assertNonNegativeBps(input.snapshot.volatilityBps, "snapshot.volatilityBps");
}

function assertObject(value: unknown, field: "input" | "request" | "snapshot"): void {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Routing ${field} must be an object`);
  }
}

function assertPositiveSafeInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`Routing ${field} must be a positive safe integer`);
  }
}

function assertAddress(value: string, field: string): void {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new Error(`Routing ${field} must be a 20-byte hex address`);
  }
}

function assertPositiveUIntString(value: string, field: string): void {
  if (typeof value !== "string" || !/^[1-9][0-9]*$/.test(value)) {
    throw new Error(`Routing ${field} must be a positive uint string`);
  }
}

function assertNonNegativeBps(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Routing ${field} must be a non-negative safe integer`);
  }
  if (value > 10_000) {
    throw new Error(`Routing ${field} must be less than or equal to 10000 bps`);
  }
}

function assertSafeIdentifier(value: string, field: string): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Routing ${field} must be a non-empty string`);
  }
  if (value.length > maxSafeIdentifierLength) {
    throw new Error(`Routing ${field} must be 128 characters or fewer`);
  }
  if (!safeIdentifierPattern.test(value)) {
    throw new Error(`Routing ${field} must contain only letters, numbers, underscore, colon, or hyphen`);
  }
}

function assertPositiveDecimalString(value: string, field: string): void {
  if (typeof value !== "string" || !/^[0-9]+(\.[0-9]+)?$/.test(value) || parseDecimalToWad(value) <= 0n) {
    throw new Error(`Routing ${field} must be a positive decimal string`);
  }
}

function parseDecimalToWad(value: string): bigint {
  const [whole, fraction = ""] = value.split(".");
  const paddedFraction = `${fraction.slice(0, 18)}${"0".repeat(Math.max(0, 18 - fraction.length))}`;
  return BigInt(whole) * 1_000_000_000_000_000_000n + BigInt(paddedFraction);
}
