import { recoverTypedDataAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { PrivateKeyAccount } from "viem/accounts";
import type { SignedQuote } from "../../shared/types/rfq.js";
import { APIError } from "../../shared/errors/api-error.js";
import type { MetricsService, SignerMetricOperation } from "../metrics/metrics.service.js";

const RFQ_EIP712_DOMAIN_NAME = "ProductionGradeRFQ";
const RFQ_EIP712_DOMAIN_VERSION = "1";
const SECP256K1N_HALF = BigInt("0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0");
const maxSafeIdentifierLength = 128;
const safeIdentifierPattern = /^[A-Za-z0-9_:-]+$/;
const localEIP712SignerConfigFields = ["privateKey", "settlementAddress"] as const;
const signQuoteInputFields = ["quote", "quoteId", "snapshotId"] as const;
const signedQuoteFields = [
  "user",
  "tokenIn",
  "tokenOut",
  "amountIn",
  "amountOut",
  "minAmountOut",
  "nonce",
  "deadline",
  "chainId",
] as const;

const quoteTypes = {
  Quote: [
    { name: "user", type: "address" },
    { name: "tokenIn", type: "address" },
    { name: "tokenOut", type: "address" },
    { name: "amountIn", type: "uint256" },
    { name: "amountOut", type: "uint256" },
    { name: "minAmountOut", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
    { name: "chainId", type: "uint256" },
  ],
} as const;

export interface SignQuoteInput {
  quote: SignedQuote;
  quoteId: string;
  snapshotId: string;
}

export interface SignerService {
  signQuote(input: SignQuoteInput): Promise<`0x${string}`>;
  verifyQuoteSignature(quote: SignedQuote, signature: `0x${string}`): Promise<boolean>;
}

export interface LocalEIP712SignerConfig {
  privateKey: `0x${string}`;
  settlementAddress: `0x${string}`;
}

export class LocalEIP712SignerService implements SignerService {
  private readonly config: LocalEIP712SignerConfig;
  private readonly account: PrivateKeyAccount;

  constructor(config: LocalEIP712SignerConfig) {
    assertObject(config, "config");
    assertOwnFields(config, localEIP712SignerConfigFields, "config");
    assertPrivateKey(config.privateKey);
    assertAddress(config.settlementAddress, "settlementAddress");
    this.config = cloneLocalEIP712SignerConfig(config);
    this.account = privateKeyToAccount(this.config.privateKey);
  }

  async signQuote(input: SignQuoteInput): Promise<`0x${string}`> {
    assertSignQuoteInput(input);
    return this.account.signTypedData(buildQuoteTypedData(input.quote, this.config.settlementAddress));
  }

  async verifyQuoteSignature(quote: SignedQuote, signature: `0x${string}`): Promise<boolean> {
    let recovered: `0x${string}`;
    try {
      assertSignedQuote(quote);
      assertSignature(signature);
      recovered = await recoverTypedDataAddress({
        ...buildQuoteTypedData(quote, this.config.settlementAddress),
        signature,
      });
    } catch {
      return false;
    }

    return recovered.toLowerCase() === this.account.address.toLowerCase();
  }
}

function cloneLocalEIP712SignerConfig(config: LocalEIP712SignerConfig): LocalEIP712SignerConfig {
  return { ...config };
}

export class ObservedSignerService implements SignerService {
  constructor(
    private readonly inner: SignerService,
    private readonly metricsService: MetricsService,
  ) {
    assertObservedSignerDeps(inner, metricsService);
  }

  async signQuote(input: SignQuoteInput): Promise<`0x${string}`> {
    return this.observe("sign", async () => {
      const signature = await this.inner.signQuote(input);
      assertSignature(signature);
      return signature;
    });
  }

  async verifyQuoteSignature(quote: SignedQuote, signature: `0x${string}`): Promise<boolean> {
    return this.observe("verify", async () => {
      const result = await this.inner.verifyQuoteSignature(quote, signature);
      if (typeof result !== "boolean") {
        throw new Error("Signer verifyQuoteSignature result must be a boolean");
      }

      return result;
    });
  }

  private async observe<T>(operation: SignerMetricOperation, callback: () => Promise<T>): Promise<T> {
    const startedAt = Date.now();
    this.metricsService.recordSignerRequest(operation);
    try {
      return await callback();
    } catch (error) {
      this.metricsService.recordSignerError(operation);
      if (error instanceof APIError) {
        throw error;
      }

      throw new APIError("SIGNER_UNAVAILABLE", "Signer service unavailable", 503);
    } finally {
      this.metricsService.recordSignerLatency(operation, (Date.now() - startedAt) / 1000);
    }
  }
}

function assertObservedSignerDeps(inner: SignerService, metricsService: MetricsService): void {
  assertDependencyMethod(inner, "inner", "signQuote");
  assertDependencyMethod(inner, "inner", "verifyQuoteSignature");
  assertDependencyMethod(metricsService, "metricsService", "recordSignerRequest");
  assertDependencyMethod(metricsService, "metricsService", "recordSignerError");
  assertDependencyMethod(metricsService, "metricsService", "recordSignerLatency");
}

function assertDependencyMethod(
  dependency: unknown,
  dependencyName: "inner" | "metricsService",
  methodName: string,
): void {
  assertDependencyObject(dependency, dependencyName);
  const method = (dependency as Record<string, unknown>)[methodName];
  if (typeof method !== "function") {
    throw new Error(`Signer ${dependencyName}.${methodName} must be a function`);
  }
}

function assertDependencyObject(dependency: unknown, dependencyName: "inner" | "metricsService"): void {
  if (typeof dependency !== "object" || dependency === null || Array.isArray(dependency)) {
    throw new Error(`Signer ${dependencyName} must be an object`);
  }
}

export function buildQuoteTypedData(quote: SignedQuote, settlementAddress: `0x${string}`) {
  return {
      domain: {
        name: RFQ_EIP712_DOMAIN_NAME,
        version: RFQ_EIP712_DOMAIN_VERSION,
        chainId: quote.chainId,
        verifyingContract: settlementAddress,
      },
      types: quoteTypes,
      primaryType: "Quote",
      message: {
        user: quote.user,
        tokenIn: quote.tokenIn,
        tokenOut: quote.tokenOut,
        amountIn: BigInt(quote.amountIn),
        amountOut: BigInt(quote.amountOut),
        minAmountOut: BigInt(quote.minAmountOut),
        nonce: BigInt(quote.nonce),
        deadline: BigInt(quote.deadline),
        chainId: BigInt(quote.chainId),
      },
    } as const;
}

function assertSignQuoteInput(input: SignQuoteInput): void {
  assertObject(input, "input");
  assertOwnFields(input, signQuoteInputFields, "input");
  assertSafeIdentifier(input.quoteId, "quoteId");
  assertSafeIdentifier(input.snapshotId, "snapshotId");
  assertSignedQuote(input.quote);
}

function assertSignedQuote(quote: SignedQuote): void {
  assertObject(quote, "quote");
  assertOwnFields(quote, signedQuoteFields, "quote");
  assertPositiveSafeInteger(quote.chainId, "quote.chainId");
  assertAddress(quote.user, "quote.user");
  assertAddress(quote.tokenIn, "quote.tokenIn");
  assertAddress(quote.tokenOut, "quote.tokenOut");
  if (quote.tokenIn.toLowerCase() === quote.tokenOut.toLowerCase()) {
    throw new Error("Signer quote token pair must contain distinct tokens");
  }
  assertPositiveUIntString(quote.amountIn, "quote.amountIn");
  assertPositiveUIntString(quote.amountOut, "quote.amountOut");
  assertPositiveUIntString(quote.minAmountOut, "quote.minAmountOut");
  if (BigInt(quote.amountOut) < BigInt(quote.minAmountOut)) {
    throw new Error("Signer quote.amountOut must be greater than or equal to quote.minAmountOut");
  }
  assertPositiveUIntString(quote.nonce, "quote.nonce");
  assertPositiveSafeInteger(quote.deadline, "quote.deadline");
}

function assertObject(value: unknown, field: "config" | "input" | "quote"): void {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Signer ${field} must be an object`);
  }
}

function assertOwnFields(value: object, fields: readonly string[], path: string): void {
  for (const field of fields) {
    if (!Object.prototype.hasOwnProperty.call(value, field)) {
      throw new Error(`Signer ${path}.${field} must be an own field`);
    }
  }
}

function assertPrivateKey(value: string): void {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error("Signer privateKey must be a 32-byte hex string");
  }
}

function assertSignature(value: string): void {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{130}$/.test(value)) {
    throw new Error("Signer signature must be a 65-byte hex string");
  }

  const s = BigInt(`0x${value.slice(66, 130)}`);
  if (s > SECP256K1N_HALF) {
    throw new Error("Signer signature s value must be in the lower half order");
  }

  const v = Number.parseInt(value.slice(130, 132), 16);
  const normalizedV = v < 27 ? v + 27 : v;
  if (normalizedV !== 27 && normalizedV !== 28) {
    throw new Error("Signer signature v value must be 27 or 28");
  }
}

function assertSafeIdentifier(value: unknown, field: "quoteId" | "snapshotId"): void {
  if (typeof value !== "string") {
    throw new Error(`Signer ${field} must be a primitive string`);
  }
  if (value.trim().length === 0) {
    throw new Error(`Signer ${field} must be a non-empty string`);
  }
  if (value.length > maxSafeIdentifierLength) {
    throw new Error(`Signer ${field} must be 128 characters or fewer`);
  }
  if (!safeIdentifierPattern.test(value)) {
    throw new Error(`Signer ${field} must contain only letters, numbers, underscore, colon, or hyphen`);
  }
}

function assertAddress(value: string, field: string): void {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new Error(`Signer ${field} must be a 20-byte hex address`);
  }
}

function assertPositiveUIntString(value: string, field: string): void {
  if (typeof value !== "string" || !/^[1-9][0-9]*$/.test(value)) {
    throw new Error(`Signer ${field} must be a positive uint string`);
  }
}

function assertPositiveSafeInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`Signer ${field} must be a positive safe integer`);
  }
}
