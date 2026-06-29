import type { UIntString } from "../../shared/types/rfq.js";

const SEQUENCE_BITS = 20n;
const INSTANCE_BITS = 64n;
const SEQUENCE_MASK = (1n << SEQUENCE_BITS) - 1n;

export interface QuoteIdentity {
  quoteId: string;
  nonce: UIntString;
}

export class QuoteIdentityGenerator {
  private readonly instanceId = randomUint64();
  private sequence = 0n;
  private lastTimestampMs = 0n;

  next(): QuoteIdentity {
    let timestampMs = BigInt(Date.now());
    if (timestampMs < this.lastTimestampMs) {
      timestampMs = this.lastTimestampMs;
    }

    if (timestampMs === this.lastTimestampMs) {
      this.sequence = (this.sequence + 1n) & SEQUENCE_MASK;
      if (this.sequence === 0n) {
        timestampMs = this.lastTimestampMs + 1n;
        this.sequence = 1n;
      }
    } else {
      this.sequence = 1n;
    }

    this.lastTimestampMs = timestampMs;
    const nonce =
      (timestampMs << (INSTANCE_BITS + SEQUENCE_BITS)) |
      (this.instanceId << SEQUENCE_BITS) |
      this.sequence;
    const nonceText = nonce.toString();

    return {
      quoteId: `q_${nonceText}`,
      nonce: nonceText,
    };
  }
}

function randomUint64(): bigint {
  const cryptoLike = globalThis.crypto;
  if (cryptoLike) {
    const values = new Uint32Array(2);
    cryptoLike.getRandomValues(values);
    return (BigInt(values[0] ?? 0) << 32n) | BigInt(values[1] ?? 0);
  }

  const high = Math.floor(Math.random() * 0x100000000);
  const low = Math.floor(Math.random() * 0x100000000);
  return (BigInt(high) << 32n) | BigInt(low);
}
