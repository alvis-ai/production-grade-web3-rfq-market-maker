import type { SignedQuote } from "../../shared/types/rfq.js";

export interface SignQuoteInput {
  quote: SignedQuote;
  quoteId: string;
  snapshotId: string;
}

export interface SignerService {
  signQuote(input: SignQuoteInput): Promise<`0x${string}`>;
}

export class PlaceholderSignerService implements SignerService {
  async signQuote(): Promise<`0x${string}`> {
    throw new Error("SignerService is not configured. Wire EIP-712 signing before production use.");
  }
}
