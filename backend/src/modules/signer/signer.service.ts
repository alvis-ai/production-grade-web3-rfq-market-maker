import type { SignedQuote } from "../../shared/types/rfq.js";
import { toFixedHex } from "../../shared/types/hex.js";

export interface SignQuoteInput {
  quote: SignedQuote;
  quoteId: string;
  snapshotId: string;
}

export interface SignerService {
  signQuote(input: SignQuoteInput): Promise<`0x${string}`>;
}

export class PlaceholderSignerService implements SignerService {
  async signQuote(input: SignQuoteInput): Promise<`0x${string}`> {
    const seed = `${input.quoteId}:${input.snapshotId}:${input.quote.nonce}`;
    const hex = toFixedHex(seed, 130);
    return `0x${hex}`;
  }
}
