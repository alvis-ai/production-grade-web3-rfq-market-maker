import type {
  QuoteExposureReservationResult,
  QuoteExposureStore,
  ReserveQuoteExposureInput,
} from "./quote-exposure.store.js";

export interface QuoteExposureAdmissionHealthGate {
  assertHealthy(): void;
}

export class HealthGatedQuoteExposureStore implements QuoteExposureStore {
  constructor(
    private readonly store: QuoteExposureStore,
    private readonly healthGate: QuoteExposureAdmissionHealthGate,
  ) {
    if (typeof store !== "object" || store === null ||
        typeof store.reserve !== "function" || typeof store.release !== "function") {
      throw new Error("Health-gated quote exposure store delegate is invalid");
    }
    if (typeof healthGate !== "object" || healthGate === null ||
        typeof healthGate.assertHealthy !== "function") {
      throw new Error("Health-gated quote exposure admission gate is invalid");
    }
  }

  async checkHealth(): Promise<void> {
    this.healthGate.assertHealthy();
    await this.store.checkHealth?.();
  }

  async reserve(input: ReserveQuoteExposureInput): Promise<QuoteExposureReservationResult> {
    this.healthGate.assertHealthy();
    return this.store.reserve(input);
  }

  async release(quoteId: string): Promise<void> {
    await this.store.release(quoteId);
  }
}
