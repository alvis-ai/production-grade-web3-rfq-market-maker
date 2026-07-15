export interface GammaGuardrailPolicy {
  modelVersion: string;
  elevatedInventoryUtilizationBps: number;
  criticalInventoryUtilizationBps: number;
  largeTradeUtilizationBps: number;
  blockTradeUtilizationBps: number;
  elevatedVolatilityUtilizationBps: number;
  extremeVolatilityUtilizationBps: number;
  maxRiskMultiplierBps: number;
}

export interface GammaGuardrailNotionalExposure {
  amount: bigint;
  limit: bigint;
}

export interface GammaGuardrailInventoryExposure {
  balance: bigint;
  hardLimit: bigint;
}

export interface GammaGuardrailInput {
  notionalExposures: readonly GammaGuardrailNotionalExposure[];
  inventoryExposures: readonly GammaGuardrailInventoryExposure[];
  volatilityBps: number;
  volatilityLimitBps: number;
}

export type GammaInventoryRegime = "balanced" | "elevated" | "critical";
export type GammaSizeBucket = "small" | "large" | "block";
export type GammaVolatilityRegime = "normal" | "elevated" | "extreme";

export interface GammaGuardrailResult {
  modelVersion: string;
  limitUtilizationBps: number;
  inventoryRegime: GammaInventoryRegime;
  sizeUtilizationBps: number;
  sizeBucket: GammaSizeBucket;
  volatilityUtilizationBps: number;
  volatilityRegime: GammaVolatilityRegime;
  riskMultiplierBps: number;
  reasonCode: "GAMMA_GUARDRAIL_TRIGGERED" | null;
}

const policyFields = [
  "modelVersion",
  "elevatedInventoryUtilizationBps",
  "criticalInventoryUtilizationBps",
  "largeTradeUtilizationBps",
  "blockTradeUtilizationBps",
  "elevatedVolatilityUtilizationBps",
  "extremeVolatilityUtilizationBps",
  "maxRiskMultiplierBps",
] as const;
const baseRiskMultiplierBps = 10_000;
const elevatedPremiumBps = 2_500;
const criticalPremiumBps = 5_000;
const maxRiskMultiplierBps = baseRiskMultiplierBps + (3 * criticalPremiumBps);
const utilizationScaleBps = 10_000n;

export function assertGammaGuardrailPolicy(value: unknown): asserts value is GammaGuardrailPolicy {
  assertRecord(value, "Gamma guardrail policy");
  assertExactFields(value, policyFields, "Gamma guardrail policy");
  if (typeof value.modelVersion !== "string" || !/^[A-Za-z0-9_:-]{1,128}$/.test(value.modelVersion)) {
    throw new Error("Gamma guardrail policy.modelVersion must be a safe identifier");
  }
  assertThresholdPair(
    value.elevatedInventoryUtilizationBps,
    value.criticalInventoryUtilizationBps,
    "inventory utilization",
  );
  assertThresholdPair(
    value.largeTradeUtilizationBps,
    value.blockTradeUtilizationBps,
    "trade utilization",
  );
  assertThresholdPair(
    value.elevatedVolatilityUtilizationBps,
    value.extremeVolatilityUtilizationBps,
    "volatility utilization",
  );
  if (
    typeof value.maxRiskMultiplierBps !== "number" ||
    !Number.isSafeInteger(value.maxRiskMultiplierBps) ||
    value.maxRiskMultiplierBps <= baseRiskMultiplierBps ||
    value.maxRiskMultiplierBps > maxRiskMultiplierBps
  ) {
    throw new Error(
      `Gamma guardrail policy.maxRiskMultiplierBps must be an integer between ${baseRiskMultiplierBps + 1} and ${maxRiskMultiplierBps}`,
    );
  }
}

export function evaluateGammaGuardrail(
  input: GammaGuardrailInput,
  policy: GammaGuardrailPolicy,
): GammaGuardrailResult {
  assertGammaGuardrailInput(input);
  assertGammaGuardrailPolicy(policy);

  const limitUtilizationBps = maxUtilizationBps(
    input.inventoryExposures.map((exposure) => ({
      numerator: abs(exposure.balance),
      denominator: exposure.hardLimit,
    })),
  );
  const sizeUtilizationBps = maxUtilizationBps(
    input.notionalExposures.map((exposure) => ({
      numerator: exposure.amount,
      denominator: exposure.limit,
    })),
  );
  const volatilityUtilizationBps = input.volatilityLimitBps === 0
    ? 0
    : boundedUtilizationBps(BigInt(input.volatilityBps), BigInt(input.volatilityLimitBps));

  const inventoryRegime = classifyInventory(limitUtilizationBps, policy);
  const sizeBucket = classifySize(sizeUtilizationBps, policy);
  const volatilityRegime = classifyVolatility(volatilityUtilizationBps, policy);
  const riskMultiplierBps = baseRiskMultiplierBps +
    regimePremium(inventoryRegime) +
    regimePremium(sizeBucket) +
    regimePremium(volatilityRegime);

  return {
    modelVersion: policy.modelVersion,
    limitUtilizationBps,
    inventoryRegime,
    sizeUtilizationBps,
    sizeBucket,
    volatilityUtilizationBps,
    volatilityRegime,
    riskMultiplierBps,
    reasonCode: riskMultiplierBps >= policy.maxRiskMultiplierBps
      ? "GAMMA_GUARDRAIL_TRIGGERED"
      : null,
  };
}

function assertGammaGuardrailInput(value: unknown): asserts value is GammaGuardrailInput {
  assertRecord(value, "Gamma guardrail input");
  assertExactFields(
    value,
    ["notionalExposures", "inventoryExposures", "volatilityBps", "volatilityLimitBps"],
    "Gamma guardrail input",
  );
  assertExposureArray(value.notionalExposures, "notionalExposures", "amount", "limit", 1, 2);
  assertExposureArray(value.inventoryExposures, "inventoryExposures", "balance", "hardLimit", 2, 2, true);
  assertBps(value.volatilityBps, "Gamma guardrail input.volatilityBps");
  assertBps(value.volatilityLimitBps, "Gamma guardrail input.volatilityLimitBps");
  if (value.volatilityLimitBps === 0 && value.volatilityBps !== 0) {
    throw new Error("Gamma guardrail input volatility must be zero when its limit is zero");
  }
}

function assertExposureArray(
  value: unknown,
  field: string,
  numeratorField: string,
  denominatorField: string,
  minLength: number,
  maxLength: number,
  signedNumerator = false,
): void {
  if (!Array.isArray(value) || value.length < minLength || value.length > maxLength) {
    throw new Error(`Gamma guardrail input.${field} must contain between ${minLength} and ${maxLength} entries`);
  }
  for (const exposure of value) {
    assertRecord(exposure, `Gamma guardrail input.${field} entry`);
    assertExactFields(
      exposure,
      [numeratorField, denominatorField],
      `Gamma guardrail input.${field} entry`,
    );
    const numerator = exposure[numeratorField];
    const denominator = exposure[denominatorField];
    if (typeof numerator !== "bigint" || (!signedNumerator && numerator < 0n)) {
      throw new Error(`Gamma guardrail input.${field} entry.${numeratorField} must be a ${signedNumerator ? "signed" : "non-negative"} bigint`);
    }
    if (typeof denominator !== "bigint" || denominator <= 0n) {
      throw new Error(`Gamma guardrail input.${field} entry.${denominatorField} must be a positive bigint`);
    }
  }
}

function classifyInventory(utilizationBps: number, policy: GammaGuardrailPolicy): GammaInventoryRegime {
  if (utilizationBps >= policy.criticalInventoryUtilizationBps) return "critical";
  if (utilizationBps >= policy.elevatedInventoryUtilizationBps) return "elevated";
  return "balanced";
}

function classifySize(utilizationBps: number, policy: GammaGuardrailPolicy): GammaSizeBucket {
  if (utilizationBps >= policy.blockTradeUtilizationBps) return "block";
  if (utilizationBps >= policy.largeTradeUtilizationBps) return "large";
  return "small";
}

function classifyVolatility(utilizationBps: number, policy: GammaGuardrailPolicy): GammaVolatilityRegime {
  if (utilizationBps >= policy.extremeVolatilityUtilizationBps) return "extreme";
  if (utilizationBps >= policy.elevatedVolatilityUtilizationBps) return "elevated";
  return "normal";
}

function regimePremium(regime: GammaInventoryRegime | GammaSizeBucket | GammaVolatilityRegime): number {
  if (regime === "critical" || regime === "block" || regime === "extreme") return criticalPremiumBps;
  if (regime === "elevated" || regime === "large") return elevatedPremiumBps;
  return 0;
}

function maxUtilizationBps(exposures: readonly { numerator: bigint; denominator: bigint }[]): number {
  return exposures.reduce(
    (maximum, exposure) => Math.max(maximum, boundedUtilizationBps(exposure.numerator, exposure.denominator)),
    0,
  );
}

function boundedUtilizationBps(numerator: bigint, denominator: bigint): number {
  if (numerator === 0n) return 0;
  const utilization = ((numerator * utilizationScaleBps) + denominator - 1n) / denominator;
  return Number(utilization > utilizationScaleBps ? utilizationScaleBps : utilization);
}

function assertThresholdPair(elevated: unknown, critical: unknown, label: string): void {
  assertBps(elevated, `Gamma guardrail policy.${label} elevated threshold`);
  assertBps(critical, `Gamma guardrail policy.${label} critical threshold`);
  if (elevated === 0 || critical === 0 || elevated >= critical) {
    throw new Error(`Gamma guardrail policy ${label} thresholds must satisfy 0 < elevated < critical`);
  }
}

function assertBps(value: unknown, label: string): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > 10_000) {
    throw new Error(`${label} must be an integer between 0 and 10000`);
  }
}

function assertRecord(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
}

function assertExactFields(value: Record<string, unknown>, fields: readonly string[], label: string): void {
  const expected = new Set(fields);
  for (const field of Object.keys(value)) {
    if (!expected.has(field)) throw new Error(`${label} must not include unknown field ${field}`);
  }
  for (const field of fields) {
    if (!Object.prototype.hasOwnProperty.call(value, field)) {
      throw new Error(`${label}.${field} must be an own field`);
    }
  }
}

function abs(value: bigint): bigint {
  return value < 0n ? -value : value;
}
