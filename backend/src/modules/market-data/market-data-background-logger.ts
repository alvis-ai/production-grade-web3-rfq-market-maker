export interface MarketDataBackgroundLogger {
  info(fields: Readonly<Record<string, unknown>>, message: string): void;
  warn(fields: Readonly<Record<string, unknown>>, message: string): void;
}

export type MarketDataBackgroundLogCode =
  | "MARKET_DATA_REFRESH_FAILED"
  | "MARKET_DATA_REFRESH_RECOVERED"
  | "MARKET_SNAPSHOT_PERSIST_FAILED"
  | "MARKET_SNAPSHOT_PERSIST_RECOVERED";

export interface MarketDataBackgroundPair {
  chainId: number;
  tokenIn: string;
  tokenOut: string;
}

export const noOpMarketDataBackgroundLogger: MarketDataBackgroundLogger = {
  info() {},
  warn() {},
};

export function assertMarketDataBackgroundLogger(
  value: unknown,
): asserts value is MarketDataBackgroundLogger {
  if (typeof value !== "object" || value === null || Array.isArray(value) ||
      typeof (value as MarketDataBackgroundLogger).info !== "function" ||
      typeof (value as MarketDataBackgroundLogger).warn !== "function") {
    throw new Error("Market data background logger must expose info and warn methods");
  }
}

export function logMarketDataBackgroundTransition(
  logger: MarketDataBackgroundLogger,
  level: "info" | "warn",
  fields: Readonly<Record<string, unknown>>,
  message: string,
): void {
  try {
    logger[level](fields, message);
  } catch {}
}

export function marketDataBackgroundLogFields(
  pair: MarketDataBackgroundPair,
  errorCode: MarketDataBackgroundLogCode,
): Readonly<Record<string, unknown>> {
  return {
    chainId: pair.chainId,
    tokenIn: pair.tokenIn.toLowerCase(),
    tokenOut: pair.tokenOut.toLowerCase(),
    errorCode,
  };
}
