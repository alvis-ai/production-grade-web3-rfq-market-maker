import type { Address, QuoteRequest, SignedQuote, UIntString } from "../../shared/types/rfq.js";
import type { InventoryProjection } from "../inventory/inventory.service.js";
import type { PricingResult } from "../pricing/pricing.engine.js";
import type { QuoteExposureReservationResult } from "../risk/quote-exposure.store.js";
import type { RiskDecision, RiskRejectReasonCode } from "../risk/risk.engine.js";
import type { RoutePlan } from "../routing/routing.engine.js";

const routePlanFields = ["routeId", "venue", "tokenIn", "tokenOut", "expectedLiquidityUsd"] as const;
const inventoryProjectionFields = ["tokenIn", "tokenOut"] as const;
const inventoryPositionFields = ["chainId", "token", "balance"] as const;
const pricingResultFields = [
  "amountOut",
  "minAmountOut",
  "spreadBps",
  "sizeImpactBps",
  "marketSpreadBps",
  "inventorySkewBps",
  "volatilityPremiumBps",
  "hedgeCostBps",
  "pricingVersion",
] as const;
const riskDecisionBaseFields = ["status", "policyVersion"] as const;
const rejectedRiskDecisionFields = ["reasonCode"] as const;
const rejectedRiskDecisionFullFields = ["status", "policyVersion", "reasonCode"] as const;
const riskRejectReasonCodes = new Set<string>([
  "CHAIN_NOT_ENABLED",
  "TOKEN_NOT_ALLOWED",
  "MARKET_LIQUIDITY_TOO_LOW",
  "MARKET_VOLATILITY_LIMIT_EXCEEDED",
  "AMOUNT_IN_LIMIT_EXCEEDED",
  "AMOUNT_OUT_TOO_SMALL",
  "QUOTE_NOTIONAL_LIMIT_EXCEEDED",
  "USER_OPEN_NOTIONAL_LIMIT_EXCEEDED",
  "PAIR_OPEN_NOTIONAL_LIMIT_EXCEEDED",
  "TREASURY_LIQUIDITY_INSUFFICIENT",
  "PORTFOLIO_VAR_LIMIT_EXCEEDED",
  "USD_REFERENCE_REQUIRED",
  "SLIPPAGE_TOO_WIDE",
  "QUOTED_SPREAD_TOO_WIDE",
  "TOXIC_FLOW_RESTRICTED_USER",
  "TOXIC_FLOW_SCORE_EXCEEDED",
  "TOKEN_IN_INVENTORY_LIMIT_EXCEEDED",
  "TOKEN_OUT_INVENTORY_LIMIT_EXCEEDED",
  "RISK_ENGINE_UNAVAILABLE",
]);
const positiveUIntStringPattern = /^[1-9][0-9]*$/;
const safeIdentifierPattern = /^[A-Za-z0-9_:-]+$/;
const maxSafeIdentifierLength = 128;
const maxBps = 10_000;

export function assertRoutePlan(value: unknown, request: QuoteRequest): asserts value is RoutePlan {
  if (!isRecord(value)) {
    throw new Error("Quote service route plan must be an object");
  }
  assertOwnFields(value, routePlanFields, "route plan");
  assertNoUnknownFields(value, routePlanFields, "route plan");
  assertRouteSafeIdentifier(value.routeId);
  if (value.venue !== "internal_inventory") {
    throw new Error("Quote service route plan.venue must be internal_inventory");
  }
  const tokenIn = value.tokenIn;
  const tokenOut = value.tokenOut;
  assertRouteAddress(tokenIn, "tokenIn");
  assertRouteAddress(tokenOut, "tokenOut");
  if (
    tokenIn.toLowerCase() !== request.tokenIn.toLowerCase() ||
    tokenOut.toLowerCase() !== request.tokenOut.toLowerCase()
  ) {
    throw new Error("Quote service route plan token pair must match quote request token pair");
  }
  assertRouteExpectedLiquidity(value.expectedLiquidityUsd);
}

export function assertInventorySkewBps(value: unknown): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || Math.abs(value) > maxBps) {
    throw new Error("Quote service inventory skew bps must be a safe bps integer");
  }
}

export function assertHedgeRiskPenaltyBps(value: unknown): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > maxBps) {
    throw new Error("Quote service hedge risk penalty bps must be a non-negative bps integer");
  }
}

export function assertPricingAdjustmentBps(value: unknown): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || Math.abs(value) > maxBps) {
    throw new Error("Quote service pricing adjustment bps must be a safe bps integer");
  }
}

export function assertInventoryProjection(
  value: unknown,
  request: QuoteRequest,
): asserts value is InventoryProjection {
  if (!isRecord(value)) {
    throw new Error("Quote service inventory projection must be an object");
  }
  assertOwnFields(value, inventoryProjectionFields, "inventory projection");
  assertNoUnknownFields(value, inventoryProjectionFields, "inventory projection");
  assertInventoryProjectionPosition(value.tokenIn, request.chainId, request.tokenIn, "tokenIn");
  assertInventoryProjectionPosition(value.tokenOut, request.chainId, request.tokenOut, "tokenOut");
}

export function assertPricingResult(value: unknown): asserts value is PricingResult {
  if (!isRecord(value)) {
    throw new Error("Quote service pricing result must be an object");
  }
  assertOwnFields(value, pricingResultFields, "pricing result");
  assertNoUnknownFields(value, pricingResultFields, "pricing result");
  const amountOut = value.amountOut;
  const minAmountOut = value.minAmountOut;
  assertPricingUIntString(amountOut, "amountOut");
  assertPricingUIntString(minAmountOut, "minAmountOut");
  if (BigInt(amountOut) < BigInt(minAmountOut)) {
    throw new Error(
      "Quote service pricing result.amountOut must be greater than or equal to pricing result.minAmountOut",
    );
  }
  assertNonNegativeBpsInteger(value.spreadBps, "spreadBps");
  assertNonNegativeBpsInteger(value.sizeImpactBps, "sizeImpactBps");
  assertNonNegativeBpsInteger(value.marketSpreadBps, "marketSpreadBps");
  assertBpsMagnitudeInteger(value.inventorySkewBps, "inventorySkewBps");
  assertNonNegativeBpsInteger(value.volatilityPremiumBps, "volatilityPremiumBps");
  assertNonNegativeBpsInteger(value.hedgeCostBps, "hedgeCostBps");
  assertPricingSafeIdentifier(value.pricingVersion);
}

export function assertQuoteExposureReservationResult(
  value: unknown,
): asserts value is QuoteExposureReservationResult {
  if (!isRecord(value)) {
    throw new Error("Quote service exposure reservation result must be an object");
  }
  if (value.status === "reserved") {
    assertOwnFields(value, ["status", "notionalUsdE18"], "exposure reservation result");
    assertOptionalOwnField(value, "portfolioVar", "exposure reservation result");
    assertNoUnknownFields(value, ["status", "notionalUsdE18", "portfolioVar"], "exposure reservation result");
    if (typeof value.notionalUsdE18 !== "string" || !positiveUIntStringPattern.test(value.notionalUsdE18)) {
      throw new Error("Quote service exposure reservation notionalUsdE18 must be a positive uint string");
    }
    if (value.portfolioVar !== undefined) assertPortfolioVarEvaluation(value.portfolioVar);
    return;
  }
  if (value.status === "rejected") {
    assertOwnFields(value, ["status", "reasonCode"], "exposure reservation result");
    assertNoUnknownFields(value, ["status", "reasonCode"], "exposure reservation result");
    if (
      value.reasonCode !== "USER_OPEN_NOTIONAL_LIMIT_EXCEEDED" &&
      value.reasonCode !== "PAIR_OPEN_NOTIONAL_LIMIT_EXCEEDED" &&
      value.reasonCode !== "TREASURY_LIQUIDITY_INSUFFICIENT" &&
      value.reasonCode !== "PORTFOLIO_VAR_LIMIT_EXCEEDED"
    ) {
      throw new Error("Quote service exposure reservation reasonCode is invalid");
    }
    return;
  }
  throw new Error("Quote service exposure reservation status is invalid");
}

export function assertRiskDecision(value: unknown): asserts value is RiskDecision {
  if (!isRecord(value)) {
    throw new Error("Quote service risk decision must be an object");
  }
  assertOwnFields(value, riskDecisionBaseFields, "risk decision");
  assertOptionalOwnField(value, "reasonCode", "risk decision");
  const status = value.status;
  if (status !== "approved" && status !== "rejected") {
    throw new Error("Quote service risk decision.status must be approved or rejected");
  }
  assertRiskPolicyVersion(value.policyVersion);
  if (status === "approved") {
    assertNoUnknownFields(value, riskDecisionBaseFields, "risk decision");
    return;
  }
  assertOwnFields(value, rejectedRiskDecisionFields, "risk decision");
  assertNoUnknownFields(value, rejectedRiskDecisionFullFields, "risk decision");
  assertRiskRejectReasonCode(value.reasonCode);
}

export function riskUnavailableDecision(): RiskDecision {
  return {
    status: "rejected",
    reasonCode: "RISK_ENGINE_UNAVAILABLE",
    policyVersion: "risk-engine-unavailable",
  };
}

export function isExactSignedQuote(
  record: {
    chainId: number;
    user: string;
    tokenIn: string;
    tokenOut: string;
    amountIn: string;
    amountOut?: string;
    minAmountOut?: string;
    nonce?: string;
    deadline?: number;
  },
  quote: SignedQuote,
): boolean {
  return (
    record.chainId === quote.chainId &&
    record.user.toLowerCase() === quote.user.toLowerCase() &&
    record.tokenIn.toLowerCase() === quote.tokenIn.toLowerCase() &&
    record.tokenOut.toLowerCase() === quote.tokenOut.toLowerCase() &&
    record.amountIn === quote.amountIn &&
    record.amountOut === quote.amountOut &&
    record.minAmountOut === quote.minAmountOut &&
    record.nonce === quote.nonce &&
    record.deadline === quote.deadline
  );
}

function assertInventoryProjectionPosition(
  value: unknown,
  expectedChainId: number,
  expectedToken: Address,
  field: "tokenIn" | "tokenOut",
): asserts value is InventoryProjection["tokenIn"] {
  if (!isRecord(value)) {
    throw new Error(`Quote service inventory projection.${field} must be an object`);
  }
  assertOwnFields(value, inventoryPositionFields, `inventory projection.${field}`);
  assertNoUnknownFields(value, inventoryPositionFields, `inventory projection.${field}`);
  const chainId = value.chainId;
  const token = value.token;
  const balance = value.balance;
  if (typeof chainId !== "number" || !Number.isSafeInteger(chainId) || chainId <= 0) {
    throw new Error(`Quote service inventory projection.${field}.chainId must be a positive safe integer`);
  }
  assertInventoryProjectionAddress(token, field);
  if (chainId !== expectedChainId || token.toLowerCase() !== expectedToken.toLowerCase()) {
    throw new Error(`Quote service inventory projection.${field} must match quote request ${field}`);
  }
  if (typeof balance !== "bigint") {
    throw new Error(`Quote service inventory projection.${field}.balance must be a bigint`);
  }
}

function assertPortfolioVarEvaluation(value: unknown): void {
  if (!isRecord(value)) throw new Error("Quote service portfolio VaR evaluation must be an object");
  const fields = [
    "modelVersion",
    "horizonSeconds",
    "preTradeVarUsdE18",
    "postTradeVarUsdE18",
    "varLimitUsdE18",
    "preTradeComponents",
    "postTradeComponents",
  ] as const;
  assertOwnFields(value, fields, "portfolio VaR evaluation");
  assertNoUnknownFields(value, fields, "portfolio VaR evaluation");
  if (typeof value.modelVersion !== "string" || !safeIdentifierPattern.test(value.modelVersion)) {
    throw new Error("Quote service portfolio VaR modelVersion must be a safe identifier");
  }
  if (!Number.isSafeInteger(value.horizonSeconds) || Number(value.horizonSeconds) <= 0) {
    throw new Error("Quote service portfolio VaR horizonSeconds must be a positive safe integer");
  }
  for (const field of ["preTradeVarUsdE18", "postTradeVarUsdE18", "varLimitUsdE18"] as const) {
    if (typeof value[field] !== "string" || !/^(0|[1-9][0-9]*)$/.test(value[field])) {
      throw new Error(`Quote service portfolio VaR ${field} must be a canonical non-negative integer`);
    }
  }
  if (!Array.isArray(value.preTradeComponents) || !Array.isArray(value.postTradeComponents)) {
    throw new Error("Quote service portfolio VaR components must be arrays");
  }
  for (const component of [...value.preTradeComponents, ...value.postTradeComponents]) {
    assertPortfolioVarComponent(component);
  }
}

function assertPortfolioVarComponent(value: unknown): void {
  if (!isRecord(value)) throw new Error("Quote service portfolio VaR component must be an object");
  const fields = [
    "tokenAddress",
    "balance",
    "exposureUsdE18",
    "volatilityBps",
    "componentVarUsdE18",
    "snapshotId",
  ] as const;
  assertOwnFields(value, fields, "portfolio VaR component");
  assertNoUnknownFields(value, fields, "portfolio VaR component");
  if (typeof value.tokenAddress !== "string" || !/^0x[0-9a-f]{40}$/.test(value.tokenAddress)) {
    throw new Error("Quote service portfolio VaR tokenAddress must be normalized");
  }
  for (const field of ["balance", "exposureUsdE18"] as const) {
    if (typeof value[field] !== "string" || !/^(0|-?[1-9][0-9]*)$/.test(value[field])) {
      throw new Error(`Quote service portfolio VaR ${field} must be a canonical integer`);
    }
  }
  if (typeof value.componentVarUsdE18 !== "string" || !/^(0|[1-9][0-9]*)$/.test(value.componentVarUsdE18)) {
    throw new Error("Quote service portfolio VaR componentVarUsdE18 must be a canonical non-negative integer");
  }
  if (!Number.isSafeInteger(value.volatilityBps) || Number(value.volatilityBps) < 0 ||
      Number(value.volatilityBps) > maxBps) {
    throw new Error("Quote service portfolio VaR volatilityBps must be an integer from 0 to 10000");
  }
  if (typeof value.snapshotId !== "string" || !safeIdentifierPattern.test(value.snapshotId)) {
    throw new Error("Quote service portfolio VaR snapshotId must be a safe identifier");
  }
}

function assertRouteSafeIdentifier(value: unknown): asserts value is string {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value.length > maxSafeIdentifierLength ||
    !safeIdentifierPattern.test(value)
  ) {
    throw new Error("Quote service route plan.routeId must be a safe identifier");
  }
}

function assertRouteAddress(value: unknown, field: "tokenIn" | "tokenOut"): asserts value is Address {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new Error(`Quote service route plan.${field} must be a 20-byte hex address`);
  }
}

function assertRouteExpectedLiquidity(value: unknown): asserts value is UIntString {
  if (typeof value !== "string" || !positiveUIntStringPattern.test(value)) {
    throw new Error("Quote service route plan.expectedLiquidityUsd must be a positive uint string");
  }
}

function assertInventoryProjectionAddress(value: unknown, field: "tokenIn" | "tokenOut"): asserts value is Address {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new Error(`Quote service inventory projection.${field}.token must be a 20-byte hex address`);
  }
}

function assertPricingUIntString(
  value: unknown,
  field: "amountOut" | "minAmountOut",
): asserts value is UIntString {
  if (typeof value !== "string" || !positiveUIntStringPattern.test(value)) {
    throw new Error(`Quote service pricing result.${field} must be a positive uint string`);
  }
}

function assertNonNegativeBpsInteger(
  value: unknown,
  field: "spreadBps" | "sizeImpactBps" | "marketSpreadBps" | "volatilityPremiumBps" | "hedgeCostBps",
): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > maxBps) {
    throw new Error(`Quote service pricing result.${field} must be a non-negative bps integer`);
  }
}

function assertBpsMagnitudeInteger(value: unknown, field: "inventorySkewBps"): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || Math.abs(value) > maxBps) {
    throw new Error(`Quote service pricing result.${field} must be a safe bps integer`);
  }
}

function assertPricingSafeIdentifier(value: unknown): void {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value.length > maxSafeIdentifierLength ||
    !safeIdentifierPattern.test(value)
  ) {
    throw new Error("Quote service pricing result.pricingVersion must be a safe identifier");
  }
}

function assertRiskPolicyVersion(value: unknown): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error("Quote service risk decision.policyVersion must be a non-empty string");
  }
}

function assertRiskRejectReasonCode(value: unknown): asserts value is RiskRejectReasonCode {
  if (typeof value !== "string" || !riskRejectReasonCodes.has(value)) {
    throw new Error("Quote service risk decision.reasonCode must be a stable risk reject reason");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertOwnFields(value: object, fields: readonly string[], path: string): void {
  for (const field of fields) {
    if (!Object.prototype.hasOwnProperty.call(value, field)) {
      throw new Error(`Quote service ${path}.${field} must be an own field`);
    }
  }
}

function assertOptionalOwnField(value: object, field: string, path: string): void {
  if (field in value && !Object.prototype.hasOwnProperty.call(value, field)) {
    throw new Error(`Quote service ${path}.${field} must be an own field when provided`);
  }
}

function assertNoUnknownFields(value: object, fields: readonly string[], path: string): void {
  for (const field of Object.keys(value)) {
    if (!fields.includes(field)) {
      throw new Error(`Quote service ${path} must not include unknown field ${field}`);
    }
  }
}
