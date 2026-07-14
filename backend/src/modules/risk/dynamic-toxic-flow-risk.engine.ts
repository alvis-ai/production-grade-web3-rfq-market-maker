import { createHash } from "node:crypto";
import {
  assertToxicFlowScoreState,
  assertToxicFlowScoreStore,
  type ToxicFlowScoreState,
  type ToxicFlowScoreStore,
} from "./toxic-flow-score.store.js";
import type { RiskDecision, RiskEngine, RiskInput } from "./risk.engine.js";

export interface DynamicToxicFlowRiskConfig {
  maxScoreAgeMs: number;
  maxFutureSkewMs: number;
  minSampleSize: number;
  maxToxicScoreBps: number;
}

export const defaultDynamicToxicFlowRiskConfig: DynamicToxicFlowRiskConfig = {
  maxScoreAgeMs: 86_400_000,
  maxFutureSkewMs: 60_000,
  minSampleSize: 5,
  maxToxicScoreBps: 8_000,
};

export class DynamicToxicFlowRiskEngine implements RiskEngine {
  private readonly config: DynamicToxicFlowRiskConfig;
  private readonly baseEngine: RiskEngine;
  private readonly scoreStore: ToxicFlowScoreStore;

  constructor(
    baseEngine: RiskEngine,
    scoreStore: ToxicFlowScoreStore,
    config: DynamicToxicFlowRiskConfig = defaultDynamicToxicFlowRiskConfig,
    private readonly now: () => number = Date.now,
  ) {
    assertRiskEngine(baseEngine);
    assertToxicFlowScoreStore(scoreStore);
    assertDynamicToxicFlowRiskConfig(config);
    if (typeof now !== "function") throw new Error("Dynamic toxic flow risk clock must be a function");
    currentTime(now);
    this.baseEngine = { evaluate: baseEngine.evaluate.bind(baseEngine) };
    this.scoreStore = {
      checkHealth: scoreStore.checkHealth.bind(scoreStore),
      getScore: scoreStore.getScore.bind(scoreStore),
      updateScore: scoreStore.updateScore.bind(scoreStore),
    };
    this.config = { ...config };
  }

  async evaluate(input: RiskInput): Promise<RiskDecision> {
    const baseDecision = await this.baseEngine.evaluate(input);
    if (baseDecision.status === "rejected") return baseDecision;

    const score = await this.scoreStore.getScore({
      chainId: input.request.chainId,
      user: input.request.user,
    });
    if (score === null) return baseDecision;
    assertToxicFlowScoreState(score);
    assertScoreFresh(score, currentTime(this.now), this.config);

    const policyVersion = combinedPolicyVersion(baseDecision.policyVersion, score.version);
    if (score.sampleSize >= this.config.minSampleSize && score.scoreBps > this.config.maxToxicScoreBps) {
      return {
        status: "rejected",
        reasonCode: "TOXIC_FLOW_SCORE_EXCEEDED",
        policyVersion,
      };
    }
    return { status: "approved", policyVersion };
  }
}

export function assertDynamicToxicFlowRiskConfig(
  value: unknown,
): asserts value is DynamicToxicFlowRiskConfig {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Dynamic toxic flow risk config must be an object");
  }
  const config = value as Record<string, unknown>;
  const fields = ["maxScoreAgeMs", "maxFutureSkewMs", "minSampleSize", "maxToxicScoreBps"] as const;
  const allowed = new Set<string>(fields);
  if (Object.keys(config).length !== fields.length || Object.keys(config).some((field) => !allowed.has(field))) {
    throw new Error("Dynamic toxic flow risk config fields are invalid");
  }
  for (const field of fields) {
    if (!Object.prototype.hasOwnProperty.call(config, field)) {
      throw new Error(`Dynamic toxic flow risk config.${field} must be an own field`);
    }
  }
  assertPositiveSafeInteger(config.maxScoreAgeMs, "maxScoreAgeMs");
  assertNonNegativeSafeInteger(config.maxFutureSkewMs, "maxFutureSkewMs");
  assertPositiveSafeInteger(config.minSampleSize, "minSampleSize");
  assertBps(config.maxToxicScoreBps, "maxToxicScoreBps");
}

function assertScoreFresh(
  score: ToxicFlowScoreState,
  now: number,
  config: DynamicToxicFlowRiskConfig,
): void {
  const observedAt = Date.parse(score.observedAt);
  const ageMs = now - observedAt;
  if (ageMs < -config.maxFutureSkewMs) {
    throw new Error("Dynamic toxic flow score is from the future");
  }
  if (ageMs > config.maxScoreAgeMs) {
    throw new Error("Dynamic toxic flow score is stale");
  }
}

function combinedPolicyVersion(basePolicyVersion: string, scoreVersion: number): string {
  const suffix = `:tf${scoreVersion}`;
  if (basePolicyVersion.length + suffix.length <= 128) return `${basePolicyVersion}${suffix}`;
  const digest = createHash("sha256").update(`${basePolicyVersion}:${scoreVersion}`).digest("hex").slice(0, 32);
  return `dynamic-risk:${digest}`;
}

function currentTime(now: () => number): number {
  const value = now();
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("Dynamic toxic flow risk clock must return a non-negative safe integer timestamp");
  }
  return value;
}

function assertRiskEngine(value: unknown): asserts value is RiskEngine {
  if (typeof value !== "object" || value === null || Array.isArray(value) ||
      typeof (value as Record<string, unknown>).evaluate !== "function") {
    throw new Error("Dynamic toxic flow risk baseEngine.evaluate must be a function");
  }
}

function assertPositiveSafeInteger(value: unknown, field: string): void {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) {
    throw new Error(`Dynamic toxic flow risk ${field} must be a positive safe integer`);
  }
}

function assertNonNegativeSafeInteger(value: unknown, field: string): void {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new Error(`Dynamic toxic flow risk ${field} must be a non-negative safe integer`);
  }
}

function assertBps(value: unknown, field: string): void {
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > 10_000) {
    throw new Error(`Dynamic toxic flow risk ${field} must be an integer from 0 to 10000`);
  }
}
