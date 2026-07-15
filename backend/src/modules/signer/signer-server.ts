import { createHash, timingSafeEqual } from "node:crypto";
import type { ServerOptions as HttpsServerOptions } from "node:https";
import Fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";
import type { TokenRegistry } from "../pricing/token-registry.js";
import { requireTokenMetadata } from "../pricing/token-registry.js";
import type { TokenLimitRiskPolicy, TokenRiskLimit } from "../risk/token-limit-risk.engine.js";
import {
  assertSignQuoteInput,
  assertSignature,
  type SignQuoteInput,
  type SignerService,
} from "./signer.service.js";

export interface SignerServerConfig {
  authToken: string;
  maxQuoteTtlSeconds: number;
  maxClockSkewSeconds: number;
  bodyLimitBytes: number;
}

export interface SignerServerOptions {
  signerService: SignerService;
  tokenRegistry: TokenRegistry;
  riskPolicy: TokenLimitRiskPolicy;
  config: SignerServerConfig;
  logger?: FastifyServerOptions["logger"];
  https?: HttpsServerOptions;
  now?: () => number;
}

type SignerRequestOutcome = "success" | "auth_rejected" | "invalid" | "error";

export class SignerServerMetrics {
  private readonly requests = new Map<SignerRequestOutcome, number>([
    ["success", 0],
    ["auth_rejected", 0],
    ["invalid", 0],
    ["error", 0],
  ]);
  private lastSuccessTimestampSeconds = 0;

  record(outcome: SignerRequestOutcome, nowMs = Date.now()): void {
    this.requests.set(outcome, this.requests.get(outcome)! + 1);
    if (outcome === "success") this.lastSuccessTimestampSeconds = Math.floor(nowMs / 1_000);
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
      "",
    ].join("\n");
  }
}

const authTokenPattern = /^[A-Za-z0-9._~-]{43,256}$/;
const signerServerConfigFields = ["authToken", "maxQuoteTtlSeconds", "maxClockSkewSeconds", "bodyLimitBytes"];
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
        readinessCheck ??= verifyReadiness(options.signerService, readinessInput)
          .then(() => { readinessValidUntilMs = now() + readinessCacheMs; })
          .finally(() => { readinessCheck = undefined; });
        await readinessCheck;
      }
      return { status: "ok" };
    } catch {
      return reply.code(503).send({ status: "degraded" });
    }
  });
  server.get("/metrics", async (_request, reply) =>
    reply.type("text/plain; version=0.0.4; charset=utf-8").send(metrics.renderPrometheus()));

  server.post("/internal/sign", async (request, reply) => {
    if (!authorized(request.headers.authorization, tokenDigest)) {
      metrics.record("auth_rejected", now());
      return reply.code(401).send({ error: "unauthorized" });
    }
    let input: SignQuoteInput;
    try {
      input = request.body as SignQuoteInput;
      assertSignQuoteInput(input);
      assertSigningEnvelope(input, options.tokenRegistry, enabledChains, limits, config, now());
    } catch {
      metrics.record("invalid", now());
      return reply.code(400).send({ error: "invalid_signing_request" });
    }

    try {
      const signature = await options.signerService.signQuote(input);
      assertSignature(signature);
      if (!await options.signerService.verifyQuoteSignature(input.quote, signature)) {
        throw new Error("Signer returned an unverifiable signature");
      }
      metrics.record("success", now());
      return { signature };
    } catch {
      metrics.record("error", now());
      return reply.code(503).send({ error: "signer_unavailable" });
    }
  });

  return server;
}

async function verifyReadiness(signerService: SignerService, readinessInput: () => SignQuoteInput): Promise<void> {
  const input = readinessInput();
  const signature = await signerService.signQuote(input);
  assertSignature(signature);
  if (!await signerService.verifyQuoteSignature(input.quote, signature)) {
    throw new Error("Signer readiness signature is invalid");
  }
}

function assertSigningEnvelope(
  input: SignQuoteInput,
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
  assertInteger(config.maxQuoteTtlSeconds, "maxQuoteTtlSeconds", 1, 3_600);
  assertInteger(config.maxClockSkewSeconds, "maxClockSkewSeconds", 0, 60);
  assertInteger(config.bodyLimitBytes, "bodyLimitBytes", 1_024, 1_048_576);
}

function assertInteger(value: unknown, field: string, min: number, max: number): void {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) {
    throw new Error(`Signer server ${field} must be between ${min} and ${max}`);
  }
}
