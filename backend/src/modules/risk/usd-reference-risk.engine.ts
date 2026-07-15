import { createHash } from "node:crypto";
import type { Address } from "../../shared/types/rfq.js";
import type {
  UsdReferenceHealthEvidence,
  UsdReferenceHealthProvider,
} from "../market-data/chainlink-usd-reference.provider.js";
import {
  requireTokenMetadata,
  type TokenRegistry,
} from "../pricing/token-registry.js";
import type { RiskDecision, RiskEngine, RiskInput } from "./risk.engine.js";

export class UsdReferenceRiskEngine implements RiskEngine {
  private readonly baseEngine: RiskEngine;
  private readonly tokenRegistry: TokenRegistry;
  private readonly healthProvider: UsdReferenceHealthProvider;

  constructor(
    baseEngine: RiskEngine,
    tokenRegistry: TokenRegistry,
    healthProvider: UsdReferenceHealthProvider,
    private readonly policyVersion: string,
  ) {
    assertRiskEngine(baseEngine);
    assertTokenRegistry(tokenRegistry);
    assertHealthProvider(healthProvider);
    assertPolicyVersion(policyVersion);
    this.baseEngine = {
      evaluate: baseEngine.evaluate.bind(baseEngine),
      ...(baseEngine.checkHealth ? { checkHealth: baseEngine.checkHealth.bind(baseEngine) } : {}),
    };
    this.tokenRegistry = { getToken: tokenRegistry.getToken.bind(tokenRegistry) };
    this.healthProvider = {
      getHealth: healthProvider.getHealth.bind(healthProvider),
      checkHealth: healthProvider.checkHealth.bind(healthProvider),
    };
  }

  async evaluate(input: RiskInput): Promise<RiskDecision> {
    const baseDecision = await this.baseEngine.evaluate(input);
    if (baseDecision.status === "rejected") return baseDecision;

    const usdReferenceTokens = this.usdReferenceTokens(input);
    if (usdReferenceTokens.length === 0) {
      return {
        status: "rejected",
        reasonCode: "USD_REFERENCE_REQUIRED",
        policyVersion: combinePolicyVersion(baseDecision.policyVersion, this.policyVersion, []),
      };
    }

    const evidence: UsdReferenceHealthEvidence[] = [];
    for (const tokenAddress of usdReferenceTokens) {
      const result = await this.healthProvider.getHealth(input.request.chainId, tokenAddress);
      assertHealthEvidence(result, input.request.chainId, tokenAddress);
      evidence.push(result);
    }
    const combinedVersion = combinePolicyVersion(baseDecision.policyVersion, this.policyVersion, evidence);
    if (evidence.some(({ status }) => status === "depegged")) {
      return { status: "rejected", reasonCode: "USD_REFERENCE_DEPEG", policyVersion: combinedVersion };
    }
    return { status: "approved", policyVersion: combinedVersion };
  }

  async checkHealth(): Promise<void> {
    await this.baseEngine.checkHealth?.();
    await this.healthProvider.checkHealth();
  }

  private usdReferenceTokens(input: RiskInput): Address[] {
    const tokens = [input.request.tokenIn, input.request.tokenOut]
      .map((tokenAddress) => requireTokenMetadata(
        this.tokenRegistry,
        input.request.chainId,
        tokenAddress,
        "USD-reference risk",
      ))
      .filter(({ usdReference }) => usdReference)
      .map(({ tokenAddress }) => tokenAddress.toLowerCase() as Address);
    return [...new Set(tokens)];
  }
}

function combinePolicyVersion(
  basePolicyVersion: string,
  usdReferencePolicyVersion: string,
  evidence: readonly UsdReferenceHealthEvidence[],
): string {
  const evidenceIdentity = evidence
    .map(({ chainId, tokenAddress, aggregator, roundId }) =>
      `${chainId}:${tokenAddress.toLowerCase()}:${aggregator.toLowerCase()}:${roundId}`)
    .sort()
    .join("|");
  const digest = createHash("sha256")
    .update(`${basePolicyVersion}|${usdReferencePolicyVersion}|${evidenceIdentity}`)
    .digest("hex")
    .slice(0, 24);
  const prefix = `${basePolicyVersion}:${usdReferencePolicyVersion}`;
  return prefix.length <= 96 ? `${prefix}:u${digest}` : `usd-reference-risk:u${digest}`;
}

function assertRiskEngine(value: unknown): asserts value is RiskEngine {
  if (typeof value !== "object" || value === null || Array.isArray(value) ||
      typeof (value as Record<string, unknown>).evaluate !== "function") {
    throw new Error("USD-reference risk baseEngine.evaluate must be a function");
  }
  const checkHealth = (value as Record<string, unknown>).checkHealth;
  if (checkHealth !== undefined && typeof checkHealth !== "function") {
    throw new Error("USD-reference risk baseEngine.checkHealth must be a function when provided");
  }
}

function assertTokenRegistry(value: unknown): asserts value is TokenRegistry {
  if (typeof value !== "object" || value === null || Array.isArray(value) ||
      typeof (value as Record<string, unknown>).getToken !== "function") {
    throw new Error("USD-reference risk tokenRegistry.getToken must be a function");
  }
}

function assertHealthProvider(value: unknown): asserts value is UsdReferenceHealthProvider {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("USD-reference risk healthProvider must be an object");
  }
  const provider = value as Record<string, unknown>;
  if (typeof provider.getHealth !== "function" || typeof provider.checkHealth !== "function") {
    throw new Error("USD-reference risk healthProvider methods must be functions");
  }
}

function assertPolicyVersion(value: string): void {
  if (typeof value !== "string" || value.length < 1 || value.length > 64 || value.trim() !== value) {
    throw new Error("USD-reference risk policyVersion must be a bounded non-empty string");
  }
}

function assertHealthEvidence(
  value: unknown,
  expectedChainId: number,
  expectedTokenAddress: Address,
): asserts value is UsdReferenceHealthEvidence {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("USD-reference risk evidence must be an object");
  }
  const evidence = value as Record<string, unknown>;
  const fields = [
    "chainId", "tokenAddress", "aggregator", "roundId", "answer", "decimals", "deviationBps", "observedAt", "status",
  ];
  const expected = new Set(fields);
  if (Object.keys(evidence).length !== fields.length || Object.keys(evidence).some((field) => !expected.has(field)) ||
      fields.some((field) => !Object.prototype.hasOwnProperty.call(evidence, field))) {
    throw new Error("USD-reference risk evidence fields are invalid");
  }
  if (evidence.chainId !== expectedChainId || evidence.tokenAddress !== expectedTokenAddress.toLowerCase()) {
    throw new Error("USD-reference risk evidence does not match the requested chain/token");
  }
  if (typeof evidence.aggregator !== "string" || !/^0x[0-9a-f]{40}$/i.test(evidence.aggregator)) {
    throw new Error("USD-reference risk evidence aggregator is invalid");
  }
  if (typeof evidence.roundId !== "string" || !/^[1-9][0-9]*$/.test(evidence.roundId) ||
      typeof evidence.answer !== "string" || !/^[1-9][0-9]*$/.test(evidence.answer)) {
    throw new Error("USD-reference risk evidence round is invalid");
  }
  if (!Number.isSafeInteger(evidence.decimals) || Number(evidence.decimals) < 0 || Number(evidence.decimals) > 18 ||
      !Number.isSafeInteger(evidence.deviationBps) || Number(evidence.deviationBps) < 0) {
    throw new Error("USD-reference risk evidence numeric fields are invalid");
  }
  if (typeof evidence.observedAt !== "string" || !Number.isFinite(Date.parse(evidence.observedAt)) ||
      (evidence.status !== "healthy" && evidence.status !== "depegged")) {
    throw new Error("USD-reference risk evidence status or timestamp is invalid");
  }
}
