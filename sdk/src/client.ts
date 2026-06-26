import type { QuoteRequest, QuoteResponse } from "./types.js";

export class RFQClient {
  constructor(private readonly baseUrl: string) {}

  async quote(request: QuoteRequest): Promise<QuoteResponse> {
    const response = await fetch(`${this.baseUrl}/quote`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      throw new Error(`RFQ quote failed: ${response.status}`);
    }

    return (await response.json()) as QuoteResponse;
  }
}
