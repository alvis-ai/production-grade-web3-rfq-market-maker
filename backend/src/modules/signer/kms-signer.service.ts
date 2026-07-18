import { hashTypedData, recoverTypedDataAddress, toBytes } from "viem";
import type { SignedQuote } from "../../shared/types/rfq.js";
import { APIError } from "../../shared/errors/api-error.js";
import {
  assertSignQuoteInput,
  assertSignature,
  assertSignedQuote,
  buildQuoteTypedData,
  type SignQuoteInput,
  type SignerService,
} from "./signer.service.js";

const SECP256K1N = BigInt("0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141");
const SECP256K1N_HALF = BigInt("0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0");
const kmsSignerConfigFields = ["settlementAddress", "trustedSignerAddress"] as const;
const maxKmsKeyIdLength = 2_048;
const kmsKeyIdPattern = /^[A-Za-z0-9_./:=@+-]+$/;

export interface KmsSignerProvider {
  readonly keyId: string;
  signDigest(digest: Uint8Array): Promise<Uint8Array>;
  close?(): void | Promise<void>;
}

export interface KmsSignerConfig {
  settlementAddress: `0x${string}`;
  trustedSignerAddress: `0x${string}`;
}

export class KmsSignerService implements SignerService {
  readonly signaturesSelfVerified = true as const;
  private readonly keyId: string;
  private readonly signDigest: (digest: Uint8Array) => Promise<Uint8Array>;
  private readonly closeProvider?: () => void | Promise<void>;
  private readonly settlementAddress: `0x${string}`;
  private readonly trustedSignerAddress: `0x${string}`;

  constructor(provider: KmsSignerProvider, config: KmsSignerConfig) {
    assertKmsSignerProvider(provider);
    assertKmsSignerConfig(config);
    this.keyId = provider.keyId;
    this.signDigest = provider.signDigest.bind(provider);
    this.closeProvider = provider.close?.bind(provider);
    this.settlementAddress = normalizeAddress(config.settlementAddress, "settlementAddress");
    this.trustedSignerAddress = normalizeAddress(config.trustedSignerAddress, "trustedSignerAddress");
  }

  async signQuote(input: SignQuoteInput): Promise<`0x${string}`> {
    assertSignQuoteInput(input);
    const typedData = buildQuoteTypedData(input.quote, this.settlementAddress);
    const digest = toBytes(hashTypedData(typedData));

    let derSignature: Uint8Array;
    try {
      derSignature = await this.signDigest(Uint8Array.from(digest));
    } catch {
      throw signerUnavailable(`KMS signing failed for ${this.keyId}`);
    }

    const { r, s } = decodeDERSignature(derSignature);
    const canonicalS = s > SECP256K1N_HALF ? SECP256K1N - s : s;
    const rHex = r.toString(16).padStart(64, "0");
    const sHex = canonicalS.toString(16).padStart(64, "0");
    let matchingSignature: `0x${string}` | undefined;

    for (const v of ["1b", "1c"] as const) {
      const candidate = `0x${rHex}${sHex}${v}` as `0x${string}`;
      let recovered: `0x${string}`;
      try {
        recovered = await recoverTypedDataAddress({ ...typedData, signature: candidate });
      } catch {
        continue;
      }
      if (recovered.toLowerCase() !== this.trustedSignerAddress) continue;
      if (matchingSignature) {
        throw signerUnavailable("KMS signature recovery is ambiguous");
      }
      matchingSignature = candidate;
    }

    if (!matchingSignature) {
      throw signerUnavailable("KMS signature did not recover to the configured trusted signer");
    }
    assertSignature(matchingSignature);
    return matchingSignature;
  }

  async verifyQuoteSignature(quote: SignedQuote, signature: `0x${string}`): Promise<boolean> {
    let recovered: `0x${string}`;
    try {
      assertSignedQuote(quote);
      assertSignature(signature);
      recovered = await recoverTypedDataAddress({
        ...buildQuoteTypedData(quote, this.settlementAddress),
        signature,
      });
    } catch {
      return false;
    }

    return recovered.toLowerCase() === this.trustedSignerAddress;
  }

  async close(): Promise<void> {
    await this.closeProvider?.();
  }
}

export function decodeDERSignature(value: unknown): { r: bigint; s: bigint } {
  if (!(value instanceof Uint8Array)) {
    throw signerUnavailable("KMS signature must be DER-encoded bytes");
  }
  const der = Uint8Array.from(value);
  if (der.length < 8 || der.length > 72 || der[0] !== 0x30) {
    throw signerUnavailable("KMS returned an invalid DER sequence");
  }
  const sequenceLength = readShortLength(der, 1, "sequence");
  if (sequenceLength !== der.length - 2) {
    throw signerUnavailable("KMS DER sequence length is invalid");
  }

  const rResult = readDerInteger(der, 2, "r");
  const sResult = readDerInteger(der, rResult.nextOffset, "s");
  if (sResult.nextOffset !== der.length) {
    throw signerUnavailable("KMS DER signature contains trailing bytes");
  }

  return { r: rResult.value, s: sResult.value };
}

function readDerInteger(
  der: Uint8Array,
  offset: number,
  field: "r" | "s",
): { value: bigint; nextOffset: number } {
  if (offset + 2 > der.length || der[offset] !== 0x02) {
    throw signerUnavailable(`KMS DER ${field} integer tag is invalid`);
  }
  const length = readShortLength(der, offset + 1, field);
  const start = offset + 2;
  const end = start + length;
  if (length < 1 || length > 33 || end > der.length) {
    throw signerUnavailable(`KMS DER ${field} integer length is invalid`);
  }

  const first = der[start];
  if ((first & 0x80) !== 0) {
    throw signerUnavailable(`KMS DER ${field} integer must be unsigned`);
  }
  let valueStart = start;
  if (first === 0) {
    if (length === 1 || (der[start + 1] & 0x80) === 0) {
      throw signerUnavailable(`KMS DER ${field} integer has non-canonical padding`);
    }
    valueStart += 1;
  }
  if (end - valueStart > 32) {
    throw signerUnavailable(`KMS DER ${field} integer exceeds secp256k1 width`);
  }

  const hex = Buffer.from(der.slice(valueStart, end)).toString("hex");
  const parsed = hex.length > 0 ? BigInt(`0x${hex}`) : 0n;
  if (parsed <= 0n || parsed >= SECP256K1N) {
    throw signerUnavailable(`KMS DER ${field} integer is outside secp256k1 order`);
  }
  return { value: parsed, nextOffset: end };
}

function readShortLength(der: Uint8Array, offset: number, field: "sequence" | "r" | "s"): number {
  if (offset >= der.length) {
    throw signerUnavailable(`KMS DER ${field} length is missing`);
  }
  const length = der[offset];
  if ((length & 0x80) !== 0) {
    throw signerUnavailable(`KMS DER ${field} must use canonical short-form length`);
  }
  return length;
}

function assertKmsSignerProvider(value: unknown): asserts value is KmsSignerProvider {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("KMS signer provider must be an object");
  }
  const provider = value as Record<string, unknown>;
  if (
    typeof provider.keyId !== "string" ||
    provider.keyId.length === 0 ||
    provider.keyId.length > maxKmsKeyIdLength ||
    !kmsKeyIdPattern.test(provider.keyId)
  ) {
    throw new Error("KMS signer provider.keyId must be a safe non-empty identifier up to 2048 characters");
  }
  if (typeof provider.signDigest !== "function") {
    throw new Error("KMS signer provider.signDigest must be a function");
  }
  if (provider.close !== undefined && typeof provider.close !== "function") {
    throw new Error("KMS signer provider.close must be a function when provided");
  }
}

function assertKmsSignerConfig(value: unknown): asserts value is KmsSignerConfig {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("KMS signer config must be an object");
  }
  const config = value as Record<string, unknown>;
  assertExactOwnFields(config, kmsSignerConfigFields, "config");
  normalizeAddress(config.settlementAddress, "settlementAddress");
  normalizeAddress(config.trustedSignerAddress, "trustedSignerAddress");
}

function assertExactOwnFields(value: Record<string, unknown>, fields: readonly string[], path: string): void {
  const allowed = new Set(fields);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`KMS signer ${path} must not include unknown field ${key}`);
  }
  for (const field of fields) {
    if (!Object.prototype.hasOwnProperty.call(value, field)) {
      throw new Error(`KMS signer ${path}.${field} must be an own field`);
    }
  }
}

function normalizeAddress(value: unknown, field: "settlementAddress" | "trustedSignerAddress"): `0x${string}` {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new Error(`KMS signer ${field} must be a 20-byte hex address`);
  }
  if (/^0x0{40}$/i.test(value)) {
    throw new Error(`KMS signer ${field} must not be the zero address`);
  }
  return value.toLowerCase() as `0x${string}`;
}

function signerUnavailable(message: string): APIError {
  return new APIError("SIGNER_UNAVAILABLE", message, 503);
}
