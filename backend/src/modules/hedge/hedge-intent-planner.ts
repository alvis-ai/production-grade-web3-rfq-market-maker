import type { Address, SettlementEventStatusResponse, UIntString } from "../../shared/types/rfq.js";
import { ConfiguredTokenRegistry, type TokenMetadata, type TokenRegistry } from "../pricing/token-registry.js";
import type { HedgeIntent } from "./hedge.service.js";

export const deltaNeutralHedgeStrategyVersion = "delta-neutral-v2" as const;
const planInputFields = [
  "settlementEventId",
  "quoteId",
  "chainId",
  "tokenIn",
  "tokenOut",
  "amountIn",
  "amountOut",
] as const;
const tokenMetadataFields = [
  "chainId",
  "tokenAddress",
  "symbol",
  "decimals",
  "isWhitelisted",
  "riskTier",
  "usdReference",
] as const;
const safeIdentifierPattern = /^[A-Za-z0-9_:-]{1,128}$/;

export interface HedgeIntentPlanInput {
  settlementEventId: string;
  quoteId: string;
  chainId: number;
  tokenIn: Address;
  tokenOut: Address;
  amountIn: UIntString;
  amountOut: UIntString;
}

export interface HedgeIntentPlanner {
  plan(input: HedgeIntentPlanInput): HedgeIntent;
}

export class DeltaNeutralHedgePlanner implements HedgeIntentPlanner {
  constructor(private readonly tokenRegistry: TokenRegistry = new ConfiguredTokenRegistry()) {
    assertTokenRegistry(tokenRegistry);
  }

  plan(input: HedgeIntentPlanInput): HedgeIntent {
    assertPlanInput(input);
    const tokenIn = readTokenMetadata(this.tokenRegistry, input.chainId, input.tokenIn, "tokenIn");
    const tokenOut = readTokenMetadata(this.tokenRegistry, input.chainId, input.tokenOut, "tokenOut");

    if (!tokenIn.usdReference && !tokenOut.usdReference) {
      throw new Error("HEDGE_REFERENCE_ASSET_AMBIGUOUS");
    }

    return tokenOut.usdReference && !tokenIn.usdReference
      ? {
          settlementEventId: input.settlementEventId,
          quoteId: input.quoteId,
          chainId: input.chainId,
          token: input.tokenIn,
          side: "sell",
          amount: input.amountIn,
          reason: "inventory_rebalance",
        }
      : {
          settlementEventId: input.settlementEventId,
          quoteId: input.quoteId,
          chainId: input.chainId,
          token: input.tokenOut,
          side: "buy",
          amount: input.amountOut,
          reason: "inventory_rebalance",
        };
  }
}

export function hedgePlanInputFromSettlementEvent(
  event: SettlementEventStatusResponse,
): HedgeIntentPlanInput {
  return {
    settlementEventId: event.settlementEventId,
    quoteId: event.quoteId,
    chainId: event.chainId,
    tokenIn: event.tokenIn,
    tokenOut: event.tokenOut,
    amountIn: event.amountIn,
    amountOut: event.amountOut,
  };
}

function readTokenMetadata(
  registry: TokenRegistry,
  chainId: number,
  tokenAddress: `0x${string}`,
  field: "tokenIn" | "tokenOut",
): TokenMetadata {
  const metadata = registry.getToken(chainId, tokenAddress);
  if (metadata === undefined) throw new Error(`HEDGE_${field.toUpperCase()}_NOT_CONFIGURED`);
  if (
    typeof metadata !== "object" ||
    metadata === null ||
    Array.isArray(metadata) ||
    !hasExactOwnFields(metadata, tokenMetadataFields) ||
    metadata.chainId !== chainId ||
    typeof metadata.tokenAddress !== "string" ||
    metadata.tokenAddress.toLowerCase() !== tokenAddress.toLowerCase() ||
    typeof metadata.symbol !== "string" ||
    !/^[A-Za-z0-9._-]{1,32}$/.test(metadata.symbol) ||
    !Number.isSafeInteger(metadata.decimals) ||
    metadata.decimals < 0 ||
    metadata.decimals > 36 ||
    typeof metadata.isWhitelisted !== "boolean" ||
    (metadata.riskTier !== "low" && metadata.riskTier !== "medium" && metadata.riskTier !== "high") ||
    typeof metadata.usdReference !== "boolean"
  ) {
    throw new Error(`HEDGE_${field.toUpperCase()}_METADATA_INVALID`);
  }
  return { ...metadata };
}

function assertTokenRegistry(value: unknown): asserts value is TokenRegistry {
  if (typeof value !== "object" || value === null || Array.isArray(value) ||
      typeof (value as Record<string, unknown>).getToken !== "function") {
    throw new Error("Hedge planner tokenRegistry.getToken must be a function");
  }
}

function assertPlanInput(input: HedgeIntentPlanInput): void {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error("Hedge planner input must be an object");
  }
  if (!hasExactOwnFields(input, planInputFields)) {
    throw new Error("Hedge planner input fields are invalid");
  }
  for (const field of planInputFields) {
    if (!Object.prototype.hasOwnProperty.call(input, field)) {
      throw new Error(`Hedge planner input.${field} must be an own field`);
    }
  }
  for (const field of ["settlementEventId", "quoteId"] as const) {
    if (typeof input[field] !== "string" || !safeIdentifierPattern.test(input[field])) {
      throw new Error(`Hedge planner input.${field} must be a safe identifier`);
    }
  }
  if (!Number.isSafeInteger(input.chainId) || input.chainId <= 0) {
    throw new Error("Hedge planner input.chainId must be a positive safe integer");
  }
  for (const field of ["tokenIn", "tokenOut"] as const) {
    if (typeof input[field] !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(input[field])) {
      throw new Error(`Hedge planner input.${field} must be a 20-byte hex address`);
    }
  }
  if (input.tokenIn.toLowerCase() === input.tokenOut.toLowerCase()) {
    throw new Error("Hedge planner token pair must contain distinct tokens");
  }
  for (const field of ["amountIn", "amountOut"] as const) {
    if (typeof input[field] !== "string" || !/^[1-9][0-9]*$/.test(input[field])) {
      throw new Error(`Hedge planner input.${field} must be a canonical positive uint string`);
    }
  }
}

function hasExactOwnFields(value: object, fields: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === fields.length && fields.every((field) => Object.prototype.hasOwnProperty.call(value, field));
}
