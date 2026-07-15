import type { Address } from "../../shared/types/rfq.js";
import type { PortfolioVarComponent, PortfolioVarEvaluation } from "./portfolio-var.js";

export interface PortfolioDeltaPolicy {
  modelVersion: string;
  softGrossLimitUsd: string;
  hardGrossLimitUsd: string;
  softNetLimitUsd: string;
  hardNetLimitUsd: string;
  assetLimits: PortfolioDeltaAssetLimit[];
}

export interface PortfolioDeltaAssetLimit {
  chainId: number;
  tokenAddress: Address;
  softLimitUsd: string;
  hardLimitUsd: string;
}

export interface NormalizedPortfolioDeltaPolicy {
  modelVersion: string;
  softGrossLimitUsdE18: bigint;
  hardGrossLimitUsdE18: bigint;
  softNetLimitUsdE18: bigint;
  hardNetLimitUsdE18: bigint;
  assetLimits: ReadonlyMap<string, NormalizedPortfolioDeltaAssetLimit>;
}

export interface NormalizedPortfolioDeltaAssetLimit {
  chainId: number;
  tokenAddress: Address;
  softLimitUsdE18: bigint;
  hardLimitUsdE18: bigint;
}

export interface PortfolioDeltaComponent {
  chainId: number;
  tokenAddress: Address;
  balance: string;
  exposureUsdE18: string;
  snapshotId: string;
  softLimitUsdE18: string;
  hardLimitUsdE18: string;
  softLimitBreached: boolean;
}

export interface PortfolioDeltaEvaluation {
  modelVersion: string;
  preTradeGrossDeltaUsdE18: string;
  postTradeGrossDeltaUsdE18: string;
  preTradeNetDeltaUsdE18: string;
  postTradeNetDeltaUsdE18: string;
  softGrossLimitUsdE18: string;
  hardGrossLimitUsdE18: string;
  softNetLimitUsdE18: string;
  hardNetLimitUsdE18: string;
  softLimitBreached: boolean;
  preTradeComponents: PortfolioDeltaComponent[];
  postTradeComponents: PortfolioDeltaComponent[];
}

const policyFields = [
  "modelVersion",
  "softGrossLimitUsd",
  "hardGrossLimitUsd",
  "softNetLimitUsd",
  "hardNetLimitUsd",
  "assetLimits",
] as const;
const assetLimitFields = ["chainId", "tokenAddress", "softLimitUsd", "hardLimitUsd"] as const;
const evaluationFields = [
  "modelVersion",
  "preTradeGrossDeltaUsdE18",
  "postTradeGrossDeltaUsdE18",
  "preTradeNetDeltaUsdE18",
  "postTradeNetDeltaUsdE18",
  "softGrossLimitUsdE18",
  "hardGrossLimitUsdE18",
  "softNetLimitUsdE18",
  "hardNetLimitUsdE18",
  "softLimitBreached",
  "preTradeComponents",
  "postTradeComponents",
] as const;
const evaluationComponentFields = [
  "chainId",
  "tokenAddress",
  "balance",
  "exposureUsdE18",
  "snapshotId",
  "softLimitUsdE18",
  "hardLimitUsdE18",
  "softLimitBreached",
] as const;
const usdScale = 10n ** 18n;
const maxUint256 = (1n << 256n) - 1n;

export function normalizePortfolioDeltaPolicy(
  policy: PortfolioDeltaPolicy,
): NormalizedPortfolioDeltaPolicy {
  assertPortfolioDeltaPolicy(policy);
  const normalized = {
    modelVersion: policy.modelVersion,
    softGrossLimitUsdE18: BigInt(policy.softGrossLimitUsd) * usdScale,
    hardGrossLimitUsdE18: BigInt(policy.hardGrossLimitUsd) * usdScale,
    softNetLimitUsdE18: BigInt(policy.softNetLimitUsd) * usdScale,
    hardNetLimitUsdE18: BigInt(policy.hardNetLimitUsd) * usdScale,
    assetLimits: new Map(policy.assetLimits.map((limit) => {
      const normalized = {
        chainId: limit.chainId,
        tokenAddress: limit.tokenAddress.toLowerCase() as Address,
        softLimitUsdE18: BigInt(limit.softLimitUsd) * usdScale,
        hardLimitUsdE18: BigInt(limit.hardLimitUsd) * usdScale,
      };
      return [assetLimitKey(normalized.chainId, normalized.tokenAddress), normalized] as const;
    })),
  };
  if (normalized.softGrossLimitUsdE18 > normalized.hardGrossLimitUsdE18) {
    throw new Error("Portfolio delta softGrossLimitUsd must not exceed hardGrossLimitUsd");
  }
  if (normalized.softNetLimitUsdE18 > normalized.hardNetLimitUsdE18) {
    throw new Error("Portfolio delta softNetLimitUsd must not exceed hardNetLimitUsd");
  }
  return normalized;
}

export function assertPortfolioDeltaPolicy(value: unknown): asserts value is PortfolioDeltaPolicy {
  assertRecord(value, "Portfolio delta policy");
  assertExactFields(value, policyFields, "Portfolio delta policy");
  if (typeof value.modelVersion !== "string" || !/^[A-Za-z0-9_:-]{1,128}$/.test(value.modelVersion)) {
    throw new Error("Portfolio delta policy.modelVersion must be a safe identifier");
  }
  for (const field of policyFields.slice(1)) {
    if (field === "assetLimits") continue;
    assertPositiveUsd(value[field], `Portfolio delta policy.${field}`);
  }
  assertAssetLimits(value.assetLimits);
  const policy = value as unknown as PortfolioDeltaPolicy;
  if (BigInt(policy.softGrossLimitUsd) > BigInt(policy.hardGrossLimitUsd)) {
    throw new Error("Portfolio delta softGrossLimitUsd must not exceed hardGrossLimitUsd");
  }
  if (BigInt(policy.softNetLimitUsd) > BigInt(policy.hardNetLimitUsd)) {
    throw new Error("Portfolio delta softNetLimitUsd must not exceed hardNetLimitUsd");
  }
}

export function evaluatePortfolioDelta(
  portfolioVar: PortfolioVarEvaluation,
  policy: NormalizedPortfolioDeltaPolicy,
  chainId: number,
): PortfolioDeltaEvaluation {
  assertPositiveSafeInteger(chainId, "Portfolio delta chainId");
  const preTrade = calculateDelta(portfolioVar.preTradeComponents, policy.assetLimits, chainId);
  const postTrade = calculateDelta(portfolioVar.postTradeComponents, policy.assetLimits, chainId);
  const softLimitBreached =
    postTrade.grossDeltaUsdE18 > policy.softGrossLimitUsdE18 ||
    abs(postTrade.netDeltaUsdE18) > policy.softNetLimitUsdE18 ||
    postTrade.components.some((component) => component.softLimitBreached);
  return {
    modelVersion: policy.modelVersion,
    preTradeGrossDeltaUsdE18: preTrade.grossDeltaUsdE18.toString(),
    postTradeGrossDeltaUsdE18: postTrade.grossDeltaUsdE18.toString(),
    preTradeNetDeltaUsdE18: preTrade.netDeltaUsdE18.toString(),
    postTradeNetDeltaUsdE18: postTrade.netDeltaUsdE18.toString(),
    softGrossLimitUsdE18: policy.softGrossLimitUsdE18.toString(),
    hardGrossLimitUsdE18: policy.hardGrossLimitUsdE18.toString(),
    softNetLimitUsdE18: policy.softNetLimitUsdE18.toString(),
    hardNetLimitUsdE18: policy.hardNetLimitUsdE18.toString(),
    softLimitBreached,
    preTradeComponents: preTrade.components,
    postTradeComponents: postTrade.components,
  };
}

export function assertPortfolioDeltaEvaluation(
  value: unknown,
): asserts value is PortfolioDeltaEvaluation {
  assertRecord(value, "Portfolio delta evaluation");
  assertExactFields(value, evaluationFields, "Portfolio delta evaluation");
  if (typeof value.modelVersion !== "string" || !/^[A-Za-z0-9_:-]{1,128}$/.test(value.modelVersion)) {
    throw new Error("Portfolio delta evaluation.modelVersion must be a safe identifier");
  }
  for (const field of [
    "preTradeGrossDeltaUsdE18",
    "postTradeGrossDeltaUsdE18",
    "softGrossLimitUsdE18",
    "hardGrossLimitUsdE18",
    "softNetLimitUsdE18",
    "hardNetLimitUsdE18",
  ] as const) {
    assertNonNegativeE18(value[field], `Portfolio delta evaluation.${field}`);
  }
  for (const field of ["preTradeNetDeltaUsdE18", "postTradeNetDeltaUsdE18"] as const) {
    assertSignedE18(value[field], `Portfolio delta evaluation.${field}`);
  }
  if (typeof value.softLimitBreached !== "boolean") {
    throw new Error("Portfolio delta evaluation.softLimitBreached must be a boolean");
  }
  const evaluation = value as unknown as PortfolioDeltaEvaluation;
  const softGross = BigInt(evaluation.softGrossLimitUsdE18);
  const hardGross = BigInt(evaluation.hardGrossLimitUsdE18);
  const softNet = BigInt(evaluation.softNetLimitUsdE18);
  const hardNet = BigInt(evaluation.hardNetLimitUsdE18);
  if (softGross > hardGross || softNet > hardNet) {
    throw new Error("Portfolio delta evaluation soft limits must not exceed hard limits");
  }
  const preTrade = validateEvaluationComponents(evaluation.preTradeComponents, "preTradeComponents");
  const postTrade = validateEvaluationComponents(evaluation.postTradeComponents, "postTradeComponents");
  for (const [key, snapshotId] of preTrade.snapshots) {
    const postTradeSnapshot = postTrade.snapshots.get(key);
    if (postTradeSnapshot !== undefined && postTradeSnapshot !== snapshotId) {
      throw new Error("Portfolio delta evaluation pre/post asset snapshots and limits must match");
    }
  }
  if (
    preTrade.gross !== BigInt(evaluation.preTradeGrossDeltaUsdE18) ||
    preTrade.net !== BigInt(evaluation.preTradeNetDeltaUsdE18) ||
    postTrade.gross !== BigInt(evaluation.postTradeGrossDeltaUsdE18) ||
    postTrade.net !== BigInt(evaluation.postTradeNetDeltaUsdE18)
  ) {
    throw new Error("Portfolio delta evaluation aggregates must match components");
  }
  const expectedSoftBreach =
    postTrade.gross > softGross ||
    abs(postTrade.net) > softNet ||
    evaluation.postTradeComponents.some((component) => component.softLimitBreached);
  if (evaluation.softLimitBreached !== expectedSoftBreach) {
    throw new Error("Portfolio delta evaluation softLimitBreached is inconsistent");
  }
}

export function exceedsPortfolioDeltaHardLimit(
  evaluation: PortfolioDeltaEvaluation,
): boolean {
  assertPortfolioDeltaEvaluation(evaluation);
  return BigInt(evaluation.postTradeGrossDeltaUsdE18) > BigInt(evaluation.hardGrossLimitUsdE18) ||
    abs(BigInt(evaluation.postTradeNetDeltaUsdE18)) > BigInt(evaluation.hardNetLimitUsdE18) ||
    evaluation.postTradeComponents.some(
      (component) => abs(BigInt(component.exposureUsdE18)) > BigInt(component.hardLimitUsdE18),
    );
}

export function assertPortfolioDeltaEvaluationMatchesPolicy(
  evaluation: PortfolioDeltaEvaluation,
  policy: NormalizedPortfolioDeltaPolicy,
  chainId: number,
): void {
  assertPortfolioDeltaEvaluation(evaluation);
  assertPositiveSafeInteger(chainId, "Portfolio delta chainId");
  if (
    evaluation.modelVersion !== policy.modelVersion ||
    evaluation.softGrossLimitUsdE18 !== policy.softGrossLimitUsdE18.toString() ||
    evaluation.hardGrossLimitUsdE18 !== policy.hardGrossLimitUsdE18.toString() ||
    evaluation.softNetLimitUsdE18 !== policy.softNetLimitUsdE18.toString() ||
    evaluation.hardNetLimitUsdE18 !== policy.hardNetLimitUsdE18.toString()
  ) {
    throw new Error("Portfolio delta evaluation does not match active portfolio policy");
  }
  for (const component of [...evaluation.preTradeComponents, ...evaluation.postTradeComponents]) {
    if (component.chainId !== chainId) {
      throw new Error("Portfolio delta evaluation does not match active chain");
    }
    const limit = policy.assetLimits.get(assetLimitKey(chainId, component.tokenAddress));
    if (
      !limit ||
      component.softLimitUsdE18 !== limit.softLimitUsdE18.toString() ||
      component.hardLimitUsdE18 !== limit.hardLimitUsdE18.toString()
    ) {
      throw new Error("Portfolio delta evaluation does not match active asset policy");
    }
  }
}

function validateEvaluationComponents(
  value: unknown,
  field: string,
): { gross: bigint; net: bigint; snapshots: ReadonlyMap<string, string> } {
  if (!Array.isArray(value) || value.length > 10_000) {
    throw new Error(`Portfolio delta evaluation.${field} must be an array with at most 10000 entries`);
  }
  let gross = 0n;
  let net = 0n;
  const snapshots = new Map<string, string>();
  for (const component of value) {
    assertEvaluationComponent(component, field);
    const key = assetLimitKey(component.chainId, component.tokenAddress);
    if (snapshots.has(key)) {
      throw new Error(`Portfolio delta evaluation.${field} must not contain duplicate chain/token assets`);
    }
    snapshots.set(
      key,
      `${component.snapshotId}:${component.softLimitUsdE18}:${component.hardLimitUsdE18}`,
    );
    const exposure = BigInt(component.exposureUsdE18);
    gross += abs(exposure);
    net += exposure;
  }
  return { gross, net, snapshots };
}

function assertEvaluationComponent(
  value: unknown,
  field: string,
): asserts value is PortfolioDeltaComponent {
  assertRecord(value, `Portfolio delta evaluation.${field} component`);
  assertExactFields(value, evaluationComponentFields, `Portfolio delta evaluation.${field} component`);
  assertComponent(value);
  const component = value as unknown as PortfolioDeltaComponent;
  assertPositiveSafeInteger(component.chainId, `Portfolio delta evaluation.${field} component.chainId`);
  if (component.tokenAddress !== component.tokenAddress.toLowerCase()) {
    throw new Error(`Portfolio delta evaluation.${field} component.tokenAddress must be lowercase`);
  }
  assertPositiveE18(component.softLimitUsdE18, `Portfolio delta evaluation.${field} component.softLimitUsdE18`);
  assertPositiveE18(component.hardLimitUsdE18, `Portfolio delta evaluation.${field} component.hardLimitUsdE18`);
  if (BigInt(component.softLimitUsdE18) > BigInt(component.hardLimitUsdE18)) {
    throw new Error(`Portfolio delta evaluation.${field} component soft limit must not exceed hard limit`);
  }
  if (typeof component.softLimitBreached !== "boolean") {
    throw new Error(`Portfolio delta evaluation.${field} component.softLimitBreached must be a boolean`);
  }
  if (component.softLimitBreached !== (abs(BigInt(component.exposureUsdE18)) > BigInt(component.softLimitUsdE18))) {
    throw new Error(`Portfolio delta evaluation.${field} component.softLimitBreached is inconsistent`);
  }
}

function calculateDelta(
  components: readonly PortfolioVarComponent[],
  assetLimits: ReadonlyMap<string, NormalizedPortfolioDeltaAssetLimit>,
  chainId: number,
): {
  grossDeltaUsdE18: bigint;
  netDeltaUsdE18: bigint;
  components: PortfolioDeltaComponent[];
} {
  if (!Array.isArray(components)) throw new Error("Portfolio delta components must be an array");
  let grossDeltaUsdE18 = 0n;
  let netDeltaUsdE18 = 0n;
  const normalized = components.map((component) => {
    assertComponent(component);
    const exposure = BigInt(component.exposureUsdE18);
    const assetLimit = assetLimits.get(assetLimitKey(chainId, component.tokenAddress));
    if (!assetLimit) {
      throw new Error(`Portfolio delta has no asset limit for ${assetLimitKey(chainId, component.tokenAddress)}`);
    }
    grossDeltaUsdE18 += abs(exposure);
    netDeltaUsdE18 += exposure;
    return {
      chainId,
      tokenAddress: component.tokenAddress.toLowerCase() as Address,
      balance: component.balance,
      exposureUsdE18: component.exposureUsdE18,
      snapshotId: component.snapshotId,
      softLimitUsdE18: assetLimit.softLimitUsdE18.toString(),
      hardLimitUsdE18: assetLimit.hardLimitUsdE18.toString(),
      softLimitBreached: abs(exposure) > assetLimit.softLimitUsdE18,
    };
  });
  return { grossDeltaUsdE18, netDeltaUsdE18, components: normalized };
}

function assertComponent(value: unknown): asserts value is PortfolioVarComponent {
  assertRecord(value, "Portfolio delta component");
  for (const field of ["tokenAddress", "balance", "exposureUsdE18", "snapshotId"] as const) {
    if (!Object.prototype.hasOwnProperty.call(value, field)) {
      throw new Error(`Portfolio delta component.${field} must be an own field`);
    }
  }
  if (typeof value.tokenAddress !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value.tokenAddress)) {
    throw new Error("Portfolio delta component.tokenAddress must be a 20-byte hex address");
  }
  if (typeof value.balance !== "string" || !/^(0|-?[1-9][0-9]{0,77})$/.test(value.balance)) {
    throw new Error("Portfolio delta component.balance must be a bounded canonical integer");
  }
  if (typeof value.exposureUsdE18 !== "string" || !/^(0|-?[1-9][0-9]{0,95})$/.test(value.exposureUsdE18)) {
    throw new Error("Portfolio delta component.exposureUsdE18 must be a bounded canonical integer");
  }
  if (typeof value.snapshotId !== "string" || !/^[A-Za-z0-9_:-]{1,128}$/.test(value.snapshotId)) {
    throw new Error("Portfolio delta component.snapshotId must be a safe identifier");
  }
}

function assertAssetLimits(value: unknown): asserts value is PortfolioDeltaAssetLimit[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 10_000) {
    throw new Error("Portfolio delta policy.assetLimits must contain between 1 and 10000 entries");
  }
  const seen = new Set<string>();
  for (const limit of value) {
    assertRecord(limit, "Portfolio delta asset limit");
    assertExactFields(limit, assetLimitFields, "Portfolio delta asset limit");
    assertPositiveSafeInteger(limit.chainId, "Portfolio delta asset limit.chainId");
    if (typeof limit.tokenAddress !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(limit.tokenAddress)) {
      throw new Error("Portfolio delta asset limit.tokenAddress must be a 20-byte hex address");
    }
    assertPositiveUsd(limit.softLimitUsd, "Portfolio delta asset limit.softLimitUsd");
    assertPositiveUsd(limit.hardLimitUsd, "Portfolio delta asset limit.hardLimitUsd");
    if (BigInt(limit.softLimitUsd) > BigInt(limit.hardLimitUsd)) {
      throw new Error("Portfolio delta asset limit.softLimitUsd must not exceed hardLimitUsd");
    }
    const key = assetLimitKey(limit.chainId, limit.tokenAddress);
    if (seen.has(key)) throw new Error("Portfolio delta policy.assetLimits must not contain duplicates");
    seen.add(key);
  }
}

function assertPositiveUsd(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !/^[1-9][0-9]{0,59}$/.test(value) || BigInt(value) > maxUint256) {
    throw new Error(`${label} must be a canonical positive uint256 string`);
  }
}

function assertNonNegativeE18(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]{0,95})$/.test(value)) {
    throw new Error(`${label} must be a bounded canonical non-negative integer`);
  }
}

function assertSignedE18(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !/^(0|-?[1-9][0-9]{0,95})$/.test(value)) {
    throw new Error(`${label} must be a bounded canonical integer`);
  }
}

function assertPositiveE18(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !/^[1-9][0-9]{0,95}$/.test(value)) {
    throw new Error(`${label} must be a bounded canonical positive integer`);
  }
}

function assertRecord(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
}

function assertExactFields(value: Record<string, unknown>, fields: readonly string[], label: string): void {
  const allowed = new Set(fields);
  for (const field of Object.keys(value)) {
    if (!allowed.has(field)) throw new Error(`${label} has unknown field ${field}`);
  }
  for (const field of fields) {
    if (!Object.prototype.hasOwnProperty.call(value, field)) {
      throw new Error(`${label}.${field} must be an own field`);
    }
  }
}

function assertPositiveSafeInteger(value: unknown, label: string): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive safe integer`);
  }
}

function assetLimitKey(chainId: number, tokenAddress: string): string {
  return `${chainId}:${tokenAddress.toLowerCase()}`;
}

function abs(value: bigint): bigint {
  return value < 0n ? -value : value;
}
