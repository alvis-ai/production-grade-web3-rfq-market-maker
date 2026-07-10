import { hashTypedData, recoverTypedDataAddress, toBytes } from "viem";
import type { SignedQuote } from "../../shared/types/rfq.js";
import { APIError } from "../../shared/errors/api-error.js";
import { buildQuoteTypedData, type SignQuoteInput, type SignerService } from "./signer.service.js";

const SECP256K1N = BigInt("0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141");
const SECP256K1N_HALF = BigInt("0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0");

// ─── Types ────────────────────────────────────────────────────────

/**
 * Interface for an external KMS provider that can produce ECDSA signatures.
 *
 * The `sign` method receives a 32-byte hash (the EIP-712 typed data digest)
 * and must return the raw signature bytes in DER-encoded format as returned
 * by AWS KMS / GCP Cloud KMS / Azure Key Vault.
 *
 * The implementor is responsible for:
 *   - Key access / IAM authentication
 *   - Retry logic on transient failures
 *   - Auditing / logging
 */
export interface KmsSignerProvider {
  /** Key identifier (ARN, resource name, or URI) for diagnostics. */
  readonly keyId: string;
  /**
   * Sign a 32-byte digest using ECDSA with secp256k1.
   * Returns the DER-encoded ASN.1 signature.
   */
  signDigest(digest: Uint8Array): Promise<Uint8Array>;
}

// ─── KMS Signer Service ───────────────────────────────────────────

/**
 * Signer service backed by an external KMS provider.
 *
 * 1. Computes the EIP-712 typed data hash locally (via viem).
 * 2. Sends the 32-byte digest to KMS for signing.
 * 3. Decodes the DER-encoded ECDSA signature into Ethereum r, s, v format.
 * 4. Validates the signature format.
 *
 * Verification uses viem's recoverTypedDataAddress — no KMS round-trip.
 */
export class KmsSignerService implements SignerService {
  private readonly signerProvider: KmsSignerProvider;
  private readonly settlementAddress: `0x${string}`;
  private trustedSignerAddress: `0x${string}` | undefined;

  constructor(
    signerProvider: KmsSignerProvider,
    settlementAddress: `0x${string}`,
    trustedSignerAddress?: `0x${string}`,
  ) {
    this.signerProvider = signerProvider;
    this.settlementAddress = assertAddress(settlementAddress, "settlementAddress");
    this.trustedSignerAddress = trustedSignerAddress
      ? assertAddress(trustedSignerAddress, "trustedSignerAddress")
      : undefined;
  }

  async signQuote(input: SignQuoteInput): Promise<`0x${string}`> {
    assertSignQuoteInput(input);
    const typedData = buildQuoteTypedData(input.quote, this.settlementAddress);

    // 1. Compute EIP-712 digest using viem
    const digestHex = hashTypedData(typedData);
    const digest = toBytes(digestHex);

    // 2. Ask KMS to sign the 32-byte digest
    const derSignature = await this.signerProvider.signDigest(digest);

    // 3. Decode DER → r, s
    const { r, s } = decodeDERSignature(derSignature);

    // 4. Ensure s is in the lower half (EIP-2)
    const sBigInt = BigInt(`0x${s}`);
    const canonicalS = sBigInt > SECP256K1N_HALF
      ? (SECP256K1N - sBigInt)
          .toString(16)
          .padStart(64, "0")
      : s.padStart(64, "0");

    // 5. KMS DER signatures do not include an Ethereum recovery id.
    //    Try both valid ids and select the one matching the trusted signer
    //    when configured. Without a trusted signer address, the first
    //    recoverable signature bootstraps the verifier address.
    return this.selectRecoverableSignature(typedData, r.padStart(64, "0"), canonicalS);
  }

  async verifyQuoteSignature(quote: SignedQuote, signature: `0x${string}`): Promise<boolean> {
    if (!this.trustedSignerAddress) {
      return this.recoverAndCacheSigner(quote, signature);
    }

    let recovered: `0x${string}`;
    try {
      recovered = await recoverTypedDataAddress({
        ...buildQuoteTypedData(quote, this.settlementAddress),
        signature,
      });
    } catch {
      return false;
    }

    return recovered.toLowerCase() === this.trustedSignerAddress;
  }

  private async recoverAndCacheSigner(quote: SignedQuote, signature: `0x${string}`): Promise<boolean> {
    try {
      const recovered = await recoverTypedDataAddress({
        ...buildQuoteTypedData(quote, this.settlementAddress),
        signature,
      });
      this.trustedSignerAddress = recovered.toLowerCase() as `0x${string}`;
      return true;
    } catch {
      return false;
    }
  }

  private async selectRecoverableSignature(
    typedData: ReturnType<typeof buildQuoteTypedData>,
    r: string,
    s: string,
  ): Promise<`0x${string}`> {
    const candidates = [
      `0x${r}${s}1b` as `0x${string}`,
      `0x${r}${s}1c` as `0x${string}`,
    ];
    const trustedSignerAddress = this.trustedSignerAddress?.toLowerCase();
    let firstRecoverable: { signature: `0x${string}`; recovered: `0x${string}` } | undefined;

    for (const signature of candidates) {
      let recovered: `0x${string}`;
      try {
        recovered = await recoverTypedDataAddress({ ...typedData, signature });
      } catch {
        continue;
      }

      if (!firstRecoverable) {
        firstRecoverable = { signature, recovered };
      }
      if (trustedSignerAddress && recovered.toLowerCase() === trustedSignerAddress) {
        return signature;
      }
    }

    if (trustedSignerAddress) {
      throw new APIError("SIGNER_UNAVAILABLE", "KMS signature did not recover to trusted signer", 503);
    }
    if (!firstRecoverable) {
      throw new APIError("SIGNER_UNAVAILABLE", "KMS signature could not be recovered", 503);
    }

    this.trustedSignerAddress = firstRecoverable.recovered.toLowerCase() as `0x${string}`;
    return firstRecoverable.signature;
  }
}

// ─── DER Decoding ─────────────────────────────────────────────────

/**
 * Decode a DER-encoded ECDSA signature into {r, s, v} hex strings.
 *
 * DER format (PKCS#7 / AWS KMS Sign output):
 *   0x30 ── totalLen ── 0x02 ── rLen ── r ── 0x02 ── sLen ── s
 *
 * Both r and s are unsigned integers that may include a leading 0x00 byte.
 */
function decodeDERSignature(der: Uint8Array): {
  r: string;
  s: string;
} {
  if (der.length < 8 || der[0] !== 0x30) {
    throw new APIError("SIGNER_UNAVAILABLE", "KMS returned invalid DER signature", 503);
  }

  let offset = 2; // skip 0x30 + length byte

  // Read r
  if (der[offset] !== 0x02) {
    throw new APIError("SIGNER_UNAVAILABLE", "KMS DER: expected integer tag for r", 503);
  }
  offset += 1;
  const rLen = der[offset];
  offset += 1;
  const rBytes = der.slice(offset, offset + rLen);
  offset += rLen;

  // Read s
  if (offset >= der.length || der[offset] !== 0x02) {
    throw new APIError("SIGNER_UNAVAILABLE", "KMS DER: expected integer tag for s", 503);
  }
  offset += 1;
  const sLen = der[offset];
  offset += 1;
  const sBytes = der.slice(offset, offset + sLen);

  return {
    r: bytesToHexUnsigned(rBytes),
    s: bytesToHexUnsigned(sBytes),
  };
}

function bytesToHexUnsigned(bytes: Uint8Array): string {
  // Strip leading zero byte if present (DER unsigned integer encoding)
  const start = bytes.length > 32 && bytes[0] === 0 ? 1 : 0;
  const slice = bytes.slice(start, start + 32);
  return Array.from(slice)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ─── Input assertions ─────────────────────────────────────────────

function assertSignQuoteInput(input: SignQuoteInput): void {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new APIError("INVALID_REQUEST", "KMS signer input must be an object", 400);
  }
  if (typeof input.quote !== "object" || input.quote === null) {
    throw new APIError("INVALID_REQUEST", "KMS signer quote must be an object", 400);
  }
  if (typeof input.quoteId !== "string" || input.quoteId.trim().length === 0) {
    throw new APIError("INVALID_REQUEST", "KMS signer quoteId must be a non-empty string", 400);
  }
  if (typeof input.snapshotId !== "string" || input.snapshotId.trim().length === 0) {
    throw new APIError("INVALID_REQUEST", "KMS signer snapshotId must be a non-empty string", 400);
  }
}

function assertAddress(value: string, field: "settlementAddress" | "trustedSignerAddress"): `0x${string}` {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new APIError("INVALID_REQUEST", `KMS signer ${field} must be a 20-byte hex address`, 400);
  }

  return value.toLowerCase() as `0x${string}`;
}
