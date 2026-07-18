import type { CexOrderBookCycleObservation } from "../market-data/cex-orderbook/cex-orderbook-monitor.js";
import type { OrderBookPairConfig } from "../market-data/cex-orderbook/orderbook.js";
import { cexOrderBookExchanges } from "./metrics-contract.js";
import { assertCexOrderBookCycleObservation } from "./metrics-validation.js";

const emptyCycle: CexOrderBookCycleObservation = {
  configuredSources: 0,
  readySources: 0,
  staleSources: 0,
  unavailableSources: 0,
  usablePairs: 0,
  blockedPairs: 0,
  deviationRejectedSources: 0,
  maxUpdateAgeSeconds: 0,
};

export interface CexOrderBookMetricsState {
  cexOrderBookCycle: CexOrderBookCycleObservation;
  cexOrderBookConnectorErrors: ReadonlyMap<OrderBookPairConfig["exchange"], number>;
}

export class CexOrderBookMetrics {
  private cycle = emptyCycle;
  private readonly connectorErrors = new Map<OrderBookPairConfig["exchange"], number>();

  recordCycle(observation: CexOrderBookCycleObservation): void {
    assertCexOrderBookCycleObservation(observation);
    this.cycle = { ...observation };
  }

  recordConnectorError(exchange: OrderBookPairConfig["exchange"]): void {
    if (!cexOrderBookExchanges.includes(exchange)) {
      throw new Error("Metrics CEX order book exchange must be binance or coinbase");
    }
    this.connectorErrors.set(exchange, (this.connectorErrors.get(exchange) ?? 0) + 1);
  }

  snapshot(): CexOrderBookMetricsState {
    return {
      cexOrderBookCycle: this.cycle,
      cexOrderBookConnectorErrors: this.connectorErrors,
    };
  }
}
