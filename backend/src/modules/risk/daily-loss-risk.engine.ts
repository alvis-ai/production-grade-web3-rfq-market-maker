import { createHash } from "node:crypto";
import type { Address, IntString, UIntString } from "../../shared/types/rfq.js";
import { requireTokenMetadata, type TokenRegistry } from "../pricing/token-registry.js";
import type { RiskDecision, RiskEngine, RiskInput } from "./risk.engine.js";

export interface DailyLossLimit {
  chainId: number;
  tokenAddress: Address;
  maxLossUsdE18: UIntString;
}

export interface DailyLossRiskConfig {
  policyVersion: string;
  limits: readonly DailyLossLimit[];
}

export interface DailyLossEvidence {
  chainId: number;
  tokenAddress: Address;
  netPnlUsdE18: IntString;
  windowStartedAt: string;
  observedAt: string;
}

export interface DailyLossEvidenceProvider {
  getDailyLossEvidence(chainId: number, tokenAddress: Address): Promise<DailyLossEvidence>;
}

export type DailyLossRiskFailureCode = "STORE_UNAVAILABLE" | "EVIDENCE_INVALID";

export interface DailyLossRiskObserver {
  recordDailyLossRiskObservation(
    chainId: number,
    tokenAddress: Address,
    netPnlUsdE18: IntString,
    maxLossUsdE18: UIntString,
  ): void;
  recordDailyLossRiskFailure(
    chainId: number,
    tokenAddress: Address,
    reason: DailyLossRiskFailureCode,
  ): void;
}

export class DailyLossEvidenceError extends Error {
  constructor(readonly code: DailyLossRiskFailureCode, message: string) {
    super(message);
    this.name = "DailyLossEvidenceError";
  }
}

export class DailyLossRiskEngine implements RiskEngine {
  private readonly baseEngine: RiskEngine;
  private readonly tokenRegistry: TokenRegistry;
  private readonly evidenceProvider: DailyLossEvidenceProvider;
  private readonly config: DailyLossRiskConfig;
  private readonly limits = new Map<string, DailyLossLimit>();

  constructor(
    baseEngine: RiskEngine,
    tokenRegistry: TokenRegistry,
    evidenceProvider: DailyLossEvidenceProvider,
    config: DailyLossRiskConfig,
    private readonly observer: DailyLossRiskObserver = noOpObserver,
  ) {
    assertRiskEngine(baseEngine);
    assertTokenRegistry(tokenRegistry);
    assertEvidenceProvider(evidenceProvider);
    assertDailyLossRiskConfig(config);
    assertObserver(observer);
    this.baseEngine = {
      evaluate: baseEngine.evaluate.bind(baseEngine),
      ...(baseEngine.checkHealth ? { checkHealth: baseEngine.checkHealth.bind(baseEngine) } : {}),
    };
    this.tokenRegistry = { getToken: tokenRegistry.getToken.bind(tokenRegistry) };
    this.evidenceProvider = {
      getDailyLossEvidence: evidenceProvider.getDailyLossEvidence.bind(evidenceProvider),
    };
    this.config = cloneConfig(config);
    for (const limit of this.config.limits) this.limits.set(limitKey(limit.chainId, limit.tokenAddress), limit);
  }

  async evaluate(input: RiskInput): Promise<RiskDecision> {
    const baseDecision = await this.baseEngine.evaluate(input);
    if (baseDecision.status === "rejected") return baseDecision;

    const tokenAddress = this.referenceToken(input);
    const limit = this.limits.get(limitKey(input.request.chainId, tokenAddress));
    if (!limit) throw new Error(`Daily loss risk has no limit for ${input.request.chainId}:${tokenAddress}`);
    const evidence = await this.readEvidence(limit);
    const policyVersion = combinePolicyVersion(baseDecision.policyVersion, this.config.policyVersion, evidence);
    if (BigInt(evidence.netPnlUsdE18) <= -BigInt(limit.maxLossUsdE18)) {
      return { status: "rejected", reasonCode: "DAILY_LOSS_LIMIT_EXCEEDED", policyVersion };
    }
    return { status: "approved", policyVersion };
  }

  async checkHealth(): Promise<void> {
    await this.baseEngine.checkHealth?.();
    for (const limit of this.config.limits) {
      const evidence = await this.readEvidence(limit);
      if (BigInt(evidence.netPnlUsdE18) <= -BigInt(limit.maxLossUsdE18)) {
        throw new Error(`Daily loss limit exceeded for ${limit.chainId}:${limit.tokenAddress}`);
      }
    }
  }

  private async readEvidence(limit: DailyLossLimit): Promise<DailyLossEvidence> {
    try {
      const evidence = await this.evidenceProvider.getDailyLossEvidence(limit.chainId, limit.tokenAddress);
      assertEvidence(evidence, limit.chainId, limit.tokenAddress);
      this.recordObservation(limit, evidence);
      return evidence;
    } catch (error) {
      const reason = error instanceof DailyLossEvidenceError ? error.code : "EVIDENCE_INVALID";
      this.recordFailure(limit, reason);
      throw error;
    }
  }

  private referenceToken(input: RiskInput): Address {
    const tokenIn = requireTokenMetadata(
      this.tokenRegistry,
      input.request.chainId,
      input.request.tokenIn,
      "Daily loss risk tokenIn",
    );
    const tokenOut = requireTokenMetadata(
      this.tokenRegistry,
      input.request.chainId,
      input.request.tokenOut,
      "Daily loss risk tokenOut",
    );
    if (tokenIn.usdReference) return tokenIn.tokenAddress.toLowerCase() as Address;
    if (tokenOut.usdReference) return tokenOut.tokenAddress.toLowerCase() as Address;
    throw new Error("Daily loss risk requires a USD-reference token");
  }

  private recordObservation(limit: DailyLossLimit, evidence: DailyLossEvidence): void {
    try {
      this.observer.recordDailyLossRiskObservation(
        limit.chainId,
        limit.tokenAddress,
        evidence.netPnlUsdE18,
        limit.maxLossUsdE18,
      );
    } catch {}
  }

  private recordFailure(limit: DailyLossLimit, reason: DailyLossRiskFailureCode): void {
    try {
      this.observer.recordDailyLossRiskFailure(limit.chainId, limit.tokenAddress, reason);
    } catch {}
  }
}

export function parseDailyLossRiskConfig(serialized: string): DailyLossRiskConfig {
  if (typeof serialized !== "string" || serialized.trim().length === 0) {
    throw new Error("RFQ_DAILY_LOSS_CONFIG_JSON must be a non-empty JSON string");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    throw new Error("RFQ_DAILY_LOSS_CONFIG_JSON must contain valid JSON");
  }
  assertDailyLossRiskConfig(parsed);
  return cloneConfig(parsed);
}

export function assertDailyLossRiskConfig(value: unknown): asserts value is DailyLossRiskConfig {
  assertRecord(value, "Daily loss risk config");
  assertExactFields(value, ["policyVersion", "limits"], "Daily loss risk config");
  if (typeof value.policyVersion !== "string" || !/^[A-Za-z0-9._:-]{1,64}$/.test(value.policyVersion)) {
    throw new Error("Daily loss risk config.policyVersion must be a bounded safe identifier");
  }
  if (!Array.isArray(value.limits) || value.limits.length === 0 || value.limits.length > 100) {
    throw new Error("Daily loss risk config.limits must contain between 1 and 100 limits");
  }
  const seen = new Set<string>();
  for (const entry of value.limits) {
    assertRecord(entry, "Daily loss risk limit");
    assertExactFields(entry, ["chainId", "tokenAddress", "maxLossUsdE18"], "Daily loss risk limit");
    if (!Number.isSafeInteger(entry.chainId) || Number(entry.chainId) <= 0) {
      throw new Error("Daily loss risk limit.chainId must be a positive safe integer");
    }
    assertAddress(entry.tokenAddress, "Daily loss risk limit.tokenAddress");
    if (typeof entry.maxLossUsdE18 !== "string" || !/^[1-9][0-9]{0,77}$/.test(entry.maxLossUsdE18)) {
      throw new Error("Daily loss risk limit.maxLossUsdE18 must be a canonical positive integer");
    }
    const key = limitKey(Number(entry.chainId), entry.tokenAddress as Address);
    if (seen.has(key)) throw new Error("Daily loss risk config must not contain duplicate chain/token limits");
    seen.add(key);
  }
}

function assertEvidence(value: unknown, chainId: number, tokenAddress: Address): asserts value is DailyLossEvidence {
  assertRecord(value, "Daily loss risk evidence");
  assertExactFields(
    value,
    ["chainId", "tokenAddress", "netPnlUsdE18", "windowStartedAt", "observedAt"],
    "Daily loss risk evidence",
  );
  if (value.chainId !== chainId || value.tokenAddress !== tokenAddress.toLowerCase()) {
    throw new DailyLossEvidenceError("EVIDENCE_INVALID", "Daily loss risk evidence identity does not match");
  }
  if (typeof value.netPnlUsdE18 !== "string" || !/^(0|-?[1-9][0-9]{0,77})$/.test(value.netPnlUsdE18)) {
    throw new DailyLossEvidenceError("EVIDENCE_INVALID", "Daily loss risk evidence net PnL is invalid");
  }
  assertCanonicalTimestamp(value.windowStartedAt, "windowStartedAt");
  assertCanonicalTimestamp(value.observedAt, "observedAt");
  if (String(value.observedAt) < String(value.windowStartedAt)) {
    throw new DailyLossEvidenceError("EVIDENCE_INVALID", "Daily loss risk evidence window is invalid");
  }
}

function combinePolicyVersion(base: string, policy: string, evidence: DailyLossEvidence): string {
  const digest = createHash("sha256")
    .update(`${base}|${policy}|${evidence.chainId}|${evidence.tokenAddress}|${evidence.netPnlUsdE18}|${evidence.windowStartedAt}`)
    .digest("hex")
    .slice(0, 24);
  const prefix = `${base}:${policy}`;
  return prefix.length <= 96 ? `${prefix}:dl${digest}` : `daily-loss-risk:dl${digest}`;
}

function cloneConfig(config: DailyLossRiskConfig): DailyLossRiskConfig {
  return { policyVersion: config.policyVersion, limits: config.limits.map((limit) => ({ ...limit })) };
}

function limitKey(chainId: number, tokenAddress: Address): string {
  return `${chainId}:${tokenAddress.toLowerCase()}`;
}

function assertRiskEngine(value: unknown): asserts value is RiskEngine {
  assertRecord(value, "Daily loss risk baseEngine");
  if (typeof value.evaluate !== "function") throw new Error("Daily loss risk baseEngine.evaluate must be a function");
  if (value.checkHealth !== undefined && typeof value.checkHealth !== "function") {
    throw new Error("Daily loss risk baseEngine.checkHealth must be a function when provided");
  }
}

function assertTokenRegistry(value: unknown): asserts value is TokenRegistry {
  assertRecord(value, "Daily loss risk tokenRegistry");
  if (typeof value.getToken !== "function") throw new Error("Daily loss risk tokenRegistry.getToken must be a function");
}

function assertEvidenceProvider(value: unknown): asserts value is DailyLossEvidenceProvider {
  assertRecord(value, "Daily loss risk evidenceProvider");
  if (typeof value.getDailyLossEvidence !== "function") {
    throw new Error("Daily loss risk evidenceProvider.getDailyLossEvidence must be a function");
  }
}

function assertObserver(value: unknown): asserts value is DailyLossRiskObserver {
  assertRecord(value, "Daily loss risk observer");
  if (typeof value.recordDailyLossRiskObservation !== "function" ||
      typeof value.recordDailyLossRiskFailure !== "function") {
    throw new Error("Daily loss risk observer methods must be functions");
  }
}

function assertRecord(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${label} must be an object`);
}

function assertExactFields(value: Record<string, unknown>, fields: readonly string[], label: string): void {
  const allowed = new Set(fields);
  if (Object.keys(value).length !== fields.length || Object.keys(value).some((field) => !allowed.has(field)) ||
      fields.some((field) => !Object.prototype.hasOwnProperty.call(value, field))) {
    throw new Error(`${label} fields are invalid`);
  }
}

function assertAddress(value: unknown, label: string): asserts value is Address {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value) || /^0x0{40}$/i.test(value)) {
    throw new Error(`${label} must be a non-zero 20-byte hex address`);
  }
}

function assertCanonicalTimestamp(value: unknown, field: string): void {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value)) || new Date(value).toISOString() !== value) {
    throw new DailyLossEvidenceError("EVIDENCE_INVALID", `Daily loss risk evidence ${field} is invalid`);
  }
}

const noOpObserver: DailyLossRiskObserver = {
  recordDailyLossRiskObservation() {},
  recordDailyLossRiskFailure() {},
};
