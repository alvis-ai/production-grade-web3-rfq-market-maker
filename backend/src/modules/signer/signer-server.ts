import { createHash, timingSafeEqual } from "node:crypto";
import type { ServerOptions as HttpsServerOptions } from "node:https";
import Fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";
import { hashTypedData, keccak256 } from "viem";
import { createHistogramState, recordHistogram } from "../metrics/histogram.js";
import {
  latencyBucketsSeconds,
  type HistogramState,
} from "../metrics/metrics-contract.js";
import type { TokenRegistry } from "../pricing/token-registry.js";
import { requireTokenMetadata } from "../pricing/token-registry.js";
import type { TokenLimitRiskPolicy, TokenRiskLimit } from "../risk/token-limit-risk.engine.js";
import {
  assertAuthorizedSignQuoteInput,
  assertSignature,
  buildQuoteTypedData,
  type AuthorizedSignQuoteInput,
  type SignQuoteInput,
  type SignerService,
} from "./signer.service.js";
import type { SignerAuditEvent, SignerAuditStore } from "./signer-audit.store.js";
import type { SignerQuoteCommitStore } from "./redis-signer-quote-commit.store.js";
import { buildSignerQuoteFinalization } from "./signer-quote-commit.js";

export interface SignerServerConfig {
  authToken: string;
  settlementAddress: `0x${string}`;
  trustedSignerAddress: `0x${string}`;
  maxQuoteTtlSeconds: number;
  maxClockSkewSeconds: number;
  bodyLimitBytes: number;
}

export interface SignerServerOptions {
  signerService: SignerService;
  auditStore: SignerAuditStore;
  quoteCommitStore?: SignerQuoteCommitStore;
  tokenRegistry: TokenRegistry;
  riskPolicy: TokenLimitRiskPolicy;
  config: SignerServerConfig;
  logger?: FastifyServerOptions["logger"];
  https?: HttpsServerOptions;
  now?: () => number;
  auditMetrics?: SignerAuditMetricsProvider;
}

export interface SignerAuditMetricsProvider {
  renderPrometheus(): string;
}

type SignerRequestOutcome = "success" | "auth_rejected" | "invalid" | "error";
type SignerRequestStage = "validation" | "digest" | "authorization" | "signature" | "audit";

const signerRequestStages: readonly SignerRequestStage[] = [
  "validation",
  "digest",
  "authorization",
  "signature",
  "audit",
];

export class SignerServerMetrics {
  private readonly requests = new Map<SignerRequestOutcome, number>([
    ["success", 0],
    ["auth_rejected", 0],
    ["invalid", 0],
    ["error", 0],
  ]);
  private lastSuccessTimestampSeconds = 0;
  private auditErrors = 0;
  private readonly stageLatency = new Map<SignerRequestStage, HistogramState>(
    signerRequestStages.map((stage) => [stage, createHistogramState()]),
  );

  record(outcome: SignerRequestOutcome, nowMs = Date.now()): void {
    this.requests.set(outcome, this.requests.get(outcome)! + 1);
    if (outcome === "success") this.lastSuccessTimestampSeconds = Math.floor(nowMs / 1_000);
  }

  recordAuditError(): void {
    this.auditErrors += 1;
  }

  recordStage(stage: SignerRequestStage, startedAtMs: number): void {
    recordHistogram(this.stageLatency.get(stage)!, (performance.now() - startedAtMs) / 1_000);
  }

  renderPrometheus(): string {
    return [
      "# HELP rfq_signer_service_requests_total Internal signer requests by bounded outcome.",
      "# TYPE rfq_signer_service_requests_total counter",
      ...[...this.requests].map(([outcome, value]) =>
        `rfq_signer_service_requests_total{outcome="${outcome}"} ${value}`),
      "# HELP rfq_signer_service_last_success_timestamp_seconds Unix timestamp of the latest successful signature.",
      "# TYPE rfq_signer_service_last_success_timestamp_seconds gauge",
      `rfq_signer_service_last_success_timestamp_seconds ${this.lastSuccessTimestampSeconds}`,
      "# HELP rfq_signer_service_audit_errors_total Signer audit persistence and health-check failures.",
      "# TYPE rfq_signer_service_audit_errors_total counter",
      `rfq_signer_service_audit_errors_total ${this.auditErrors}`,
      "# HELP rfq_signer_service_stage_latency_seconds Isolated signer request latency by fixed internal stage.",
      "# TYPE rfq_signer_service_stage_latency_seconds histogram",
      ...signerRequestStages.flatMap((stage) =>
        renderStageHistogram(stage, this.stageLatency.get(stage)!),
      ),
      "",
    ].join("\n");
  }
}

const authTokenPattern = /^[A-Za-z0-9._~-]{43,256}$/;
const signerServerConfigFields = [
  "authToken",
  "settlementAddress",
  "trustedSignerAddress",
  "maxQuoteTtlSeconds",
  "maxClockSkewSeconds",
  "bodyLimitBytes",
];
const readinessCacheMs = 30_000;

export function buildSignerServer(options: SignerServerOptions): FastifyInstance {
  assertOptions(options);
  const now = options.now ?? Date.now;
  if (typeof now !== "function") throw new Error("Signer server clock dependency must be a function");
  const config = { ...options.config };
  const tokenDigest = digestToken(config.authToken);
  const limits = buildLimits(options.riskPolicy);
  const enabledChains = new Set(options.riskPolicy.enabledChainIds);
  const readinessInput = buildReadinessInput(options.tokenRegistry, options.riskPolicy, config, now);
  const metrics = new SignerServerMetrics();
  let readinessValidUntilMs = 0;
  let readinessCheck: Promise<void> | undefined;
  const serverOptions = {
    logger: options.logger ?? false,
    disableRequestLogging: true,
    bodyLimit: config.bodyLimitBytes,
  } as const;
  const server: FastifyInstance = options.https
    ? Fastify({ ...serverOptions, https: options.https }) as unknown as FastifyInstance
    : Fastify(serverOptions);

  server.get("/health", async () => ({ status: "ok" }));
  server.get("/ready", async (_request, reply) => {
    try {
      const currentTimeMs = now();
      if (currentTimeMs >= readinessValidUntilMs) {
        readinessCheck ??= verifyReadiness(
          options.signerService,
          options.auditStore,
          options.quoteCommitStore,
          readinessInput,
          metrics,
        )
          .then(() => { readinessValidUntilMs = now() + readinessCacheMs; })
          .finally(() => { readinessCheck = undefined; });
        await readinessCheck;
      }
      return options.quoteCommitStore
        ? {
            status: "ok",
            capabilities: options.quoteCommitStore.waitsForDurableAuthorization === true
              ? ["atomic_quote_commit_v1", "durable_authorization_wait_v1"]
              : ["atomic_quote_commit_v1"],
          }
        : { status: "ok" };
    } catch {
      return reply.code(503).send({ status: "degraded" });
    }
  });
  server.get("/metrics", async (_request, reply) =>
    reply.type("text/plain; version=0.0.4; charset=utf-8").send(
      `${metrics.renderPrometheus()}${options.auditMetrics?.renderPrometheus() ?? ""}`,
    ));

  server.post("/internal/sign", async (request, reply) => {
    if (!authorized(request.headers.authorization, tokenDigest)) {
      metrics.record("auth_rejected", now());
      return reply.code(401).send({ error: "unauthorized" });
    }
    let input: AuthorizedSignQuoteInput;
    const validationStartedAt = performance.now();
    try {
      const requestInput = request.body as SignQuoteInput;
      assertAuthorizedSignQuoteInput(requestInput);
      input = requestInput;
      if ((options.quoteCommitStore !== undefined) !== (input.commit !== undefined)) {
        throw new Error("Signer quote commit capability does not match request");
      }
      assertSigningEnvelope(input, options.tokenRegistry, enabledChains, limits, config, now());
    } catch {
      metrics.recordStage("validation", validationStartedAt);
      metrics.record("invalid", now());
      return reply.code(400).send({ error: "invalid_signing_request" });
    }
    metrics.recordStage("validation", validationStartedAt);

    let quoteDigest: `0x${string}`;
    const digestStartedAt = performance.now();
    try {
      quoteDigest = hashTypedData(buildQuoteTypedData(input.quote, config.settlementAddress));
    } catch {
      metrics.recordStage("digest", digestStartedAt);
      metrics.record("error", now());
      return reply.code(503).send({ error: "signer_unavailable" });
    }
    metrics.recordStage("digest", digestStartedAt);

    const authorizationStartedAt = performance.now();
    try {
      await options.quoteCommitStore?.assertAuthorized(input);
    } catch {
      metrics.recordStage("authorization", authorizationStartedAt);
      metrics.recordAuditError();
      metrics.record("error", now());
      return reply.code(503).send({ error: "signer_unavailable" });
    }
    metrics.recordStage("authorization", authorizationStartedAt);

    let signature: `0x${string}`;
    const signatureStartedAt = performance.now();
    try {
      signature = options.signerService.signQuoteDigest
        ? await options.signerService.signQuoteDigest(input, quoteDigest)
        : await options.signerService.signQuote(input);
      assertSignature(signature);
      if (options.signerService.signaturesSelfVerified !== true &&
          !await options.signerService.verifyQuoteSignature(input.quote, signature)) {
        throw new Error("Signer returned an unverifiable signature");
      }
    } catch {
      metrics.recordStage("signature", signatureStartedAt);
      const auditStartedAt = performance.now();
      await appendAuditBestEffort(options.auditStore, buildAuditEvent(
        input,
        config,
        quoteDigest,
        "signer_error",
        now(),
      ), metrics);
      metrics.recordStage("audit", auditStartedAt);
      metrics.record("error", now());
      return reply.code(503).send({ error: "signer_unavailable" });
    }
    metrics.recordStage("signature", signatureStartedAt);

    const auditStartedAt = performance.now();
    try {
      const event = buildAuditEvent(
        input,
        config,
        quoteDigest,
        "success",
        now(),
        keccak256(signature),
      );
      if (options.quoteCommitStore && input.commit) {
        const evidence = await options.quoteCommitStore.commit(
          event,
          buildSignerQuoteFinalization(input, input.commit, signature),
        );
        metrics.recordStage("audit", auditStartedAt);
        metrics.record("success", now());
        return { signature, finalizationHash: evidence.finalizationHash };
      }
      await options.auditStore.append(event);
    } catch {
      metrics.recordStage("audit", auditStartedAt);
      metrics.recordAuditError();
      metrics.record("error", now());
      return reply.code(503).send({ error: "signer_unavailable" });
    }
    metrics.recordStage("audit", auditStartedAt);
    metrics.record("success", now());
    return { signature };
  });

  return server;
}

function renderStageHistogram(stage: SignerRequestStage, state: HistogramState): string[] {
  const labels = `stage="${stage}"`;
  return [
    ...latencyBucketsSeconds.map((bucket, index) =>
      `rfq_signer_service_stage_latency_seconds_bucket{${labels},le="${bucket}"} ${state.buckets[index]}`),
    `rfq_signer_service_stage_latency_seconds_bucket{${labels},le="+Inf"} ${state.count}`,
    `rfq_signer_service_stage_latency_seconds_sum{${labels}} ${formatMetricNumber(state.sum)}`,
    `rfq_signer_service_stage_latency_seconds_count{${labels}} ${state.count}`,
  ];
}

function formatMetricNumber(value: number): string {
  if (Number.isInteger(value)) return value.toString();
  return value.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
}

async function verifyReadiness(
  signerService: SignerService,
  auditStore: SignerAuditStore,
  quoteCommitStore: SignerQuoteCommitStore | undefined,
  readinessInput: () => SignQuoteInput,
  metrics: SignerServerMetrics,
): Promise<void> {
  try {
    await auditStore.checkHealth();
    await quoteCommitStore?.checkHealth();
  } catch (error) {
    metrics.recordAuditError();
    throw error;
  }
  const input = readinessInput();
  const signature = await signerService.signQuote(input);
  assertSignature(signature);
  if (!await signerService.verifyQuoteSignature(input.quote, signature)) {
    throw new Error("Signer readiness signature is invalid");
  }
}

function buildAuditEvent(
  input: AuthorizedSignQuoteInput,
  config: SignerServerConfig,
  quoteDigest: `0x${string}`,
  outcome: "success" | "signer_error",
  nowMs: number,
  signatureHash?: `0x${string}`,
): SignerAuditEvent {
  const event: SignerAuditEvent = {
    quoteId: input.quoteId,
    snapshotId: input.snapshotId,
    riskDecisionId: input.riskDecisionId,
    riskPolicyVersion: input.riskPolicyVersion,
    traceId: input.traceId,
    quoteDigest,
    signerAddress: config.trustedSignerAddress,
    settlementAddress: config.settlementAddress,
    chainId: input.quote.chainId,
    deadline: input.quote.deadline,
    outcome,
    occurredAt: new Date(nowMs).toISOString(),
  };
  if (signatureHash !== undefined) event.signatureHash = signatureHash;
  return event;
}

async function appendAuditBestEffort(
  auditStore: SignerAuditStore,
  event: SignerAuditEvent,
  metrics: SignerServerMetrics,
): Promise<void> {
  try {
    await auditStore.append(event);
  } catch {
    metrics.recordAuditError();
  }
}

function assertSigningEnvelope(
  input: AuthorizedSignQuoteInput,
  registry: TokenRegistry,
  enabledChains: ReadonlySet<number>,
  limits: ReadonlyMap<string, TokenRiskLimit>,
  config: SignerServerConfig,
  nowMs: number,
): void {
  if (!Number.isSafeInteger(nowMs) || nowMs <= 0) throw new Error("Signer server clock is invalid");
  const nowSeconds = Math.floor(nowMs / 1_000);
  const quote = input.quote;
  if (!enabledChains.has(quote.chainId)) throw new Error("Signer chain is disabled");
  requireTokenMetadata(registry, quote.chainId, quote.tokenIn, "Signer tokenIn");
  requireTokenMetadata(registry, quote.chainId, quote.tokenOut, "Signer tokenOut");
  if (quote.deadline <= nowSeconds - config.maxClockSkewSeconds ||
      quote.deadline > nowSeconds + config.maxQuoteTtlSeconds + config.maxClockSkewSeconds) {
    throw new Error("Signer quote deadline is outside the approved TTL window");
  }
  const inputLimit = limits.get(limitKey(quote.chainId, quote.tokenIn));
  const outputLimit = limits.get(limitKey(quote.chainId, quote.tokenOut));
  if (!inputLimit || !outputLimit) throw new Error("Signer token risk limit is missing");
  if (BigInt(quote.amountIn) > BigInt(inputLimit.maxAmountIn) ||
      BigInt(quote.amountOut) > BigInt(outputLimit.maxAmountIn) ||
      BigInt(quote.minAmountOut) < BigInt(outputLimit.minAmountOut)) {
    throw new Error("Signer quote exceeds the independent token envelope");
  }
}

function buildLimits(policy: TokenLimitRiskPolicy): Map<string, TokenRiskLimit> {
  return new Map(policy.tokenLimits.map((limit) => [limitKey(limit.chainId, limit.tokenAddress), { ...limit }]));
}

function buildReadinessInput(
  registry: TokenRegistry,
  policy: TokenLimitRiskPolicy,
  config: SignerServerConfig,
  now: () => number,
): () => SignQuoteInput {
  const limits = policy.tokenLimits.filter((limit) => {
    try {
      requireTokenMetadata(registry, limit.chainId, limit.tokenAddress, "Signer readiness token");
      return policy.enabledChainIds.includes(limit.chainId);
    } catch {
      return false;
    }
  });
  const inputLimit = limits.find((candidate) =>
    limits.some((other) => other.chainId === candidate.chainId &&
      other.tokenAddress.toLowerCase() !== candidate.tokenAddress.toLowerCase()));
  const outputLimit = inputLimit && limits.find((candidate) =>
    candidate.chainId === inputLimit.chainId &&
    candidate.tokenAddress.toLowerCase() !== inputLimit.tokenAddress.toLowerCase());
  if (!inputLimit || !outputLimit || BigInt(outputLimit.minAmountOut) > BigInt(outputLimit.maxAmountIn)) {
    throw new Error("Signer server requires two envelope-compatible tokens on one enabled chain");
  }
  const amountOut = BigInt(outputLimit.minAmountOut) > 0n ? outputLimit.minAmountOut : "1";
  return () => ({
    quote: {
      user: "0x0000000000000000000000000000000000000001",
      tokenIn: inputLimit.tokenAddress,
      tokenOut: outputLimit.tokenAddress,
      amountIn: "1",
      amountOut,
      minAmountOut: amountOut,
      nonce: "1",
      deadline: Math.floor(now() / 1_000) + Math.min(config.maxQuoteTtlSeconds, 30),
      chainId: inputLimit.chainId,
    },
    quoteId: "readiness_probe",
    snapshotId: "readiness_snapshot",
  });
}

function limitKey(chainId: number, token: string): string {
  return `${chainId}:${token.toLowerCase()}`;
}

function authorized(header: unknown, expectedDigest: Buffer): boolean {
  if (typeof header !== "string" || !header.startsWith("Bearer ")) return false;
  const token = header.slice(7);
  if (!authTokenPattern.test(token)) return false;
  return timingSafeEqual(digestToken(token), expectedDigest);
}

function digestToken(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

function assertOptions(options: SignerServerOptions): void {
  if (typeof options !== "object" || options === null || Array.isArray(options)) {
    throw new Error("Signer server options must be an object");
  }
  if (typeof options.signerService !== "object" || options.signerService === null ||
      typeof options.signerService.signQuote !== "function" ||
      typeof options.signerService.verifyQuoteSignature !== "function") {
    throw new Error("Signer server signerService is invalid");
  }
  if (options.signerService.signQuoteDigest !== undefined &&
      typeof options.signerService.signQuoteDigest !== "function") {
    throw new Error("Signer server signerService.signQuoteDigest is invalid");
  }
  if (options.signerService.signaturesSelfVerified !== undefined &&
      options.signerService.signaturesSelfVerified !== true) {
    throw new Error("Signer server signerService signaturesSelfVerified capability is invalid");
  }
  if (typeof options.auditStore !== "object" || options.auditStore === null ||
      typeof options.auditStore.append !== "function" || typeof options.auditStore.checkHealth !== "function") {
    throw new Error("Signer server auditStore is invalid");
  }
  if (options.auditMetrics !== undefined &&
      (typeof options.auditMetrics !== "object" || options.auditMetrics === null ||
       typeof options.auditMetrics.renderPrometheus !== "function")) {
    throw new Error("Signer server auditMetrics is invalid");
  }
  if (options.quoteCommitStore !== undefined &&
      (typeof options.quoteCommitStore !== "object" || options.quoteCommitStore === null ||
       typeof options.quoteCommitStore.assertAuthorized !== "function" ||
       typeof options.quoteCommitStore.commit !== "function" ||
       typeof options.quoteCommitStore.checkHealth !== "function" ||
       typeof options.quoteCommitStore.close !== "function")) {
    throw new Error("Signer server quoteCommitStore is invalid");
  }
  if (options.quoteCommitStore?.waitsForDurableAuthorization !== undefined &&
      options.quoteCommitStore.waitsForDurableAuthorization !== true) {
    throw new Error("Signer server quoteCommitStore authorization wait capability is invalid");
  }
  if (typeof options.tokenRegistry !== "object" || options.tokenRegistry === null ||
      typeof options.tokenRegistry.getToken !== "function") {
    throw new Error("Signer server tokenRegistry is invalid");
  }
  if (typeof options.riskPolicy !== "object" || options.riskPolicy === null ||
      !Array.isArray(options.riskPolicy.enabledChainIds) || !Array.isArray(options.riskPolicy.tokenLimits)) {
    throw new Error("Signer server riskPolicy is invalid");
  }
  assertConfig(options.config);
}

function assertConfig(value: unknown): asserts value is SignerServerConfig {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Signer server config must be an object");
  }
  const config = value as Record<string, unknown>;
  if (Object.keys(config).length !== signerServerConfigFields.length ||
      signerServerConfigFields.some((field) => !Object.prototype.hasOwnProperty.call(config, field))) {
    throw new Error("Signer server config fields are invalid");
  }
  if (typeof config.authToken !== "string" || !authTokenPattern.test(config.authToken)) {
    throw new Error("Signer server authToken must be 43-256 URL-safe characters");
  }
  assertAddress(config.settlementAddress, "settlementAddress");
  assertAddress(config.trustedSignerAddress, "trustedSignerAddress");
  assertInteger(config.maxQuoteTtlSeconds, "maxQuoteTtlSeconds", 1, 3_600);
  assertInteger(config.maxClockSkewSeconds, "maxClockSkewSeconds", 0, 60);
  assertInteger(config.bodyLimitBytes, "bodyLimitBytes", 1_024, 1_048_576);
}

function assertAddress(value: unknown, field: string): void {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value) || /^0x0{40}$/i.test(value)) {
    throw new Error(`Signer server ${field} must be a non-zero address`);
  }
}

function assertInteger(value: unknown, field: string, min: number, max: number): void {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) {
    throw new Error(`Signer server ${field} must be between ${min} and ${max}`);
  }
}
