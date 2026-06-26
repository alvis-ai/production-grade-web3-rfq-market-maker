import type { SubmitQuoteRequest, SubmitQuoteResponse } from "../../shared/types/rfq.js";
import { toFixedHex } from "../../shared/types/hex.js";

export interface ExecutionService {
  submitQuote(request: SubmitQuoteRequest): Promise<SubmitQuoteResponse>;
}

export class SkeletonExecutionService implements ExecutionService {
  async submitQuote(request: SubmitQuoteRequest): Promise<SubmitQuoteResponse> {
    const txSeed = `${request.quote.user}:${request.quote.nonce}:${request.signature}`;
    const txHash = `0x${toFixedHex(txSeed, 64)}` as `0x${string}`;

    return {
      status: "accepted",
      txHash,
    };
  }
}
