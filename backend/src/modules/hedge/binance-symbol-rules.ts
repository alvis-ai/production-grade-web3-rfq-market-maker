import type { HedgeRoute, HedgeRouteTable } from "./hedge-route.js";

export interface BinanceSymbolRulesConfig {
  baseUrl?: string;
  requestTimeoutMs?: number;
  maxAgeMs?: number;
}

export interface BinanceLimitOrderInput {
  symbol: string;
  quantity: string;
  price: string;
}

export interface BinanceSymbolRulesHealth {
  checkHealth(): Promise<void>;
}

export class BinanceSymbolRulesError extends Error {
  constructor(readonly errorCode: string, readonly retryable: boolean) {
    super(errorCode);
    this.name = "BinanceSymbolRulesError";
  }
}

interface DecimalValue {
  coefficient: bigint;
  scale: number;
}

interface BinanceSymbolRules {
  symbol: string;
  status: string;
  baseAsset: string;
  quoteAsset: string;
  isSpotTradingAllowed: boolean;
  orderTypes: readonly string[];
  minPrice: DecimalValue;
  maxPrice: DecimalValue;
  tickSize: DecimalValue;
  minQuantity: DecimalValue;
  maxQuantity: DecimalValue;
  stepSize: DecimalValue;
  minNotional?: DecimalValue;
  maxNotional?: DecimalValue;
}

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

const defaultBaseUrl = "https://api.binance.com";
const defaultRequestTimeoutMs = 10_000;
const defaultMaxAgeMs = 300_000;

export class BinanceSymbolRulesService implements BinanceSymbolRulesHealth {
  private readonly baseUrl: string;
  private readonly requestTimeoutMs: number;
  private readonly maxAgeMs: number;
  private readonly cache = new Map<string, { rules: BinanceSymbolRules; expiresAtMs: number }>();
  private readonly inFlight = new Map<string, Promise<BinanceSymbolRules>>();

  constructor(
    config: BinanceSymbolRulesConfig,
    private readonly routes: HedgeRouteTable,
    private readonly fetchFn: FetchLike = fetch,
    private readonly now: () => number = Date.now,
  ) {
    assertConfig(config);
    if (typeof fetchFn !== "function") throw new Error("Binance symbol rules fetch dependency must be a function");
    if (typeof now !== "function") throw new Error("Binance symbol rules clock dependency must be a function");
    if (typeof routes !== "object" || routes === null || typeof routes.list !== "function") {
      throw new Error("Binance symbol rules routes.list must be a function");
    }
    this.baseUrl = normalizeBaseUrl(config.baseUrl ?? defaultBaseUrl);
    this.requestTimeoutMs = config.requestTimeoutMs ?? defaultRequestTimeoutMs;
    this.maxAgeMs = config.maxAgeMs ?? defaultMaxAgeMs;
  }

  async checkHealth(): Promise<void> {
    await Promise.all(this.routes.list().map(async (route) => {
      const rules = await this.getRules(route.symbol);
      validateRoute(route, rules);
    }));
  }

  async validateLimitOrder(input: BinanceLimitOrderInput): Promise<void> {
    assertLimitOrderInput(input);
    const rules = await this.getRules(input.symbol);
    const route = this.routes.list().find(({ symbol }) => symbol === input.symbol);
    if (!route) throw new BinanceSymbolRulesError("HEDGE_ROUTE_NOT_CONFIGURED", false);
    validateRoute(route, rules);
    validateOrder(input, rules);
  }

  private async getRules(symbol: string): Promise<BinanceSymbolRules> {
    assertSymbol(symbol);
    const currentTime = this.now();
    if (!Number.isSafeInteger(currentTime) || currentTime <= 0) {
      throw new BinanceSymbolRulesError("BINANCE_SYMBOL_RULES_CLOCK_INVALID", false);
    }
    const cached = this.cache.get(symbol);
    if (cached && currentTime < cached.expiresAtMs) return cached.rules;
    const pending = this.inFlight.get(symbol);
    if (pending) return pending;
    const request = this.fetchRules(symbol);
    this.inFlight.set(symbol, request);
    try {
      const rules = await request;
      this.cache.set(symbol, { rules, expiresAtMs: currentTime + this.maxAgeMs });
      return rules;
    } finally {
      if (this.inFlight.get(symbol) === request) this.inFlight.delete(symbol);
    }
  }

  private async fetchRules(symbol: string): Promise<BinanceSymbolRules> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    timeout.unref();
    try {
      const url = new URL("/api/v3/exchangeInfo", this.baseUrl);
      url.searchParams.set("symbol", symbol);
      let response: Response;
      try {
        response = await this.fetchFn(url, { method: "GET", signal: controller.signal });
      } catch {
        throw new BinanceSymbolRulesError("BINANCE_SYMBOL_RULES_UNAVAILABLE", true);
      }
      if (!response.ok) {
        throw new BinanceSymbolRulesError(`BINANCE_SYMBOL_RULES_HTTP_${response.status}`, true);
      }
      let value: unknown;
      try {
        value = await response.json();
      } catch {
        throw new BinanceSymbolRulesError("BINANCE_SYMBOL_RULES_INVALID", true);
      }
      return parseExchangeInfo(value, symbol);
    } finally {
      clearTimeout(timeout);
    }
  }
}

function parseExchangeInfo(value: unknown, expectedSymbol: string): BinanceSymbolRules {
  if (!isRecord(value) || !Array.isArray(value.symbols) || value.symbols.length !== 1) {
    throw new BinanceSymbolRulesError("BINANCE_SYMBOL_RULES_INVALID", true);
  }
  const symbol = value.symbols[0];
  if (!isRecord(symbol) || symbol.symbol !== expectedSymbol || typeof symbol.status !== "string" ||
      typeof symbol.baseAsset !== "string" || typeof symbol.quoteAsset !== "string" ||
      typeof symbol.isSpotTradingAllowed !== "boolean" || !Array.isArray(symbol.orderTypes) ||
      !symbol.orderTypes.every((entry) => typeof entry === "string") || !Array.isArray(symbol.filters)) {
    throw new BinanceSymbolRulesError("BINANCE_SYMBOL_RULES_INVALID", true);
  }
  const price = findFilter(symbol.filters, "PRICE_FILTER");
  const lot = findFilter(symbol.filters, "LOT_SIZE");
  if (!price || !lot) throw new BinanceSymbolRulesError("BINANCE_SYMBOL_RULES_INVALID", true);
  const notional = findFilter(symbol.filters, "NOTIONAL");
  const minimumNotional = findFilter(symbol.filters, "MIN_NOTIONAL");
  const notionalMin = notional ? parseDecimalField(notional, "minNotional", false) : undefined;
  const legacyMin = minimumNotional ? parseDecimalField(minimumNotional, "minNotional", false) : undefined;
  const effectiveMin = notionalMin && legacyMin
    ? (compareDecimal(notionalMin, legacyMin) >= 0 ? notionalMin : legacyMin)
    : notionalMin ?? legacyMin;
  const maxNotional = notional ? parseDecimalField(notional, "maxNotional", false) : undefined;
  if (effectiveMin && maxNotional && compareDecimal(effectiveMin, maxNotional) > 0) {
    throw new BinanceSymbolRulesError("BINANCE_SYMBOL_RULES_INVALID", true);
  }
  return {
    symbol: expectedSymbol,
    status: symbol.status,
    baseAsset: symbol.baseAsset,
    quoteAsset: symbol.quoteAsset,
    isSpotTradingAllowed: symbol.isSpotTradingAllowed,
    orderTypes: [...symbol.orderTypes],
    minPrice: parseDecimalField(price, "minPrice", true),
    maxPrice: parseDecimalField(price, "maxPrice", true),
    tickSize: parseDecimalField(price, "tickSize", false),
    minQuantity: parseDecimalField(lot, "minQty", false),
    maxQuantity: parseDecimalField(lot, "maxQty", false),
    stepSize: parseDecimalField(lot, "stepSize", false),
    ...(effectiveMin ? { minNotional: effectiveMin } : {}),
    ...(maxNotional ? { maxNotional } : {}),
  };
}

function validateRoute(route: HedgeRoute, rules: BinanceSymbolRules): void {
  if (rules.status !== "TRADING") {
    throw new BinanceSymbolRulesError("HEDGE_ROUTE_NOT_TRADING", true);
  }
  if (!rules.isSpotTradingAllowed || !rules.orderTypes.includes("LIMIT")) {
    throw new BinanceSymbolRulesError("HEDGE_ROUTE_UNSUPPORTED", false);
  }
  if (route.symbol !== rules.symbol || route.baseAsset !== rules.baseAsset || route.quoteAsset !== rules.quoteAsset) {
    throw new BinanceSymbolRulesError("HEDGE_ROUTE_ASSET_MISMATCH", false);
  }
  const venueStepRaw = decimalToRawUnits(rules.stepSize, route.tokenDecimals);
  if (venueStepRaw === undefined || venueStepRaw.toString() !== route.stepSizeRaw) {
    throw new BinanceSymbolRulesError("HEDGE_ROUTE_STEP_SIZE_MISMATCH", false);
  }
  if (compareDecimal(parseDecimal(route.priceTick), rules.tickSize) !== 0) {
    throw new BinanceSymbolRulesError("HEDGE_ROUTE_PRICE_TICK_MISMATCH", false);
  }
}

function validateOrder(input: BinanceLimitOrderInput, rules: BinanceSymbolRules): void {
  const quantity = parseDecimal(input.quantity);
  const price = parseDecimal(input.price);
  if (compareDecimal(quantity, rules.minQuantity) < 0) {
    throw new BinanceSymbolRulesError("HEDGE_ORDER_BELOW_MIN_QUANTITY", false);
  }
  if (compareDecimal(quantity, rules.maxQuantity) > 0) {
    throw new BinanceSymbolRulesError("HEDGE_ORDER_ABOVE_MAX_QUANTITY", false);
  }
  if (!isDecimalMultiple(quantity, rules.stepSize)) {
    throw new BinanceSymbolRulesError("HEDGE_ORDER_STEP_SIZE_INVALID", false);
  }
  if ((rules.minPrice.coefficient !== 0n && compareDecimal(price, rules.minPrice) < 0) ||
      (rules.maxPrice.coefficient !== 0n && compareDecimal(price, rules.maxPrice) > 0)) {
    throw new BinanceSymbolRulesError("HEDGE_ORDER_PRICE_RANGE_INVALID", false);
  }
  if (!isDecimalMultiple(price, rules.tickSize)) {
    throw new BinanceSymbolRulesError("HEDGE_ORDER_PRICE_TICK_INVALID", false);
  }
  const notional = multiplyDecimal(quantity, price);
  if (rules.minNotional && compareDecimal(notional, rules.minNotional) < 0) {
    throw new BinanceSymbolRulesError("HEDGE_ORDER_BELOW_MIN_NOTIONAL", false);
  }
  if (rules.maxNotional && compareDecimal(notional, rules.maxNotional) > 0) {
    throw new BinanceSymbolRulesError("HEDGE_ORDER_ABOVE_MAX_NOTIONAL", false);
  }
}

function findFilter(filters: unknown[], filterType: string): Record<string, unknown> | undefined {
  const matches = filters.filter((entry) => isRecord(entry) && entry.filterType === filterType);
  if (matches.length > 1) throw new BinanceSymbolRulesError("BINANCE_SYMBOL_RULES_INVALID", true);
  return matches[0] as Record<string, unknown> | undefined;
}

function parseDecimalField(record: Record<string, unknown>, field: string, allowZero: boolean): DecimalValue {
  if (typeof record[field] !== "string") {
    throw new BinanceSymbolRulesError("BINANCE_SYMBOL_RULES_INVALID", true);
  }
  const value = parseDecimal(record[field]);
  if (!allowZero && value.coefficient === 0n) {
    throw new BinanceSymbolRulesError("BINANCE_SYMBOL_RULES_INVALID", true);
  }
  return value;
}

function parseDecimal(value: string): DecimalValue {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(value) || value.length > 80) {
    throw new BinanceSymbolRulesError("BINANCE_SYMBOL_RULES_INVALID", true);
  }
  const [integer, fraction = ""] = value.split(".");
  return { coefficient: BigInt(`${integer}${fraction}`), scale: fraction.length };
}

function compareDecimal(left: DecimalValue, right: DecimalValue): number {
  const scale = Math.max(left.scale, right.scale);
  const leftValue = left.coefficient * 10n ** BigInt(scale - left.scale);
  const rightValue = right.coefficient * 10n ** BigInt(scale - right.scale);
  return leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0;
}

function isDecimalMultiple(value: DecimalValue, step: DecimalValue): boolean {
  const scale = Math.max(value.scale, step.scale);
  const normalizedValue = value.coefficient * 10n ** BigInt(scale - value.scale);
  const normalizedStep = step.coefficient * 10n ** BigInt(scale - step.scale);
  return normalizedStep !== 0n && normalizedValue % normalizedStep === 0n;
}

function multiplyDecimal(left: DecimalValue, right: DecimalValue): DecimalValue {
  return { coefficient: left.coefficient * right.coefficient, scale: left.scale + right.scale };
}

function decimalToRawUnits(value: DecimalValue, decimals: number): bigint | undefined {
  if (value.scale <= decimals) return value.coefficient * 10n ** BigInt(decimals - value.scale);
  const divisor = 10n ** BigInt(value.scale - decimals);
  return value.coefficient % divisor === 0n ? value.coefficient / divisor : undefined;
}

function assertConfig(config: BinanceSymbolRulesConfig): void {
  if (typeof config !== "object" || config === null || Array.isArray(config)) {
    throw new Error("Binance symbol rules config must be an object");
  }
  const fields = ["baseUrl", "requestTimeoutMs", "maxAgeMs"];
  if (Object.keys(config).some((field) => !fields.includes(field))) {
    throw new Error("Binance symbol rules config fields are invalid");
  }
  if (config.requestTimeoutMs !== undefined && (!Number.isSafeInteger(config.requestTimeoutMs) ||
      config.requestTimeoutMs < 100 || config.requestTimeoutMs > 60_000)) {
    throw new Error("Binance symbol rules requestTimeoutMs must be between 100 and 60000");
  }
  if (config.maxAgeMs !== undefined && (!Number.isSafeInteger(config.maxAgeMs) ||
      config.maxAgeMs < 10_000 || config.maxAgeMs > 3_600_000)) {
    throw new Error("Binance symbol rules maxAgeMs must be between 10000 and 3600000");
  }
  if (config.baseUrl !== undefined) normalizeBaseUrl(config.baseUrl);
}

function normalizeBaseUrl(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("Binance symbol rules baseUrl must be a valid URL"); }
  const loopback = url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "::1";
  if ((url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) ||
      url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error("Binance symbol rules baseUrl must be an HTTPS origin or loopback HTTP origin");
  }
  return url.origin;
}

function assertLimitOrderInput(input: BinanceLimitOrderInput): void {
  if (typeof input !== "object" || input === null || Array.isArray(input) || Object.keys(input).length !== 3 ||
      !Object.prototype.hasOwnProperty.call(input, "symbol") ||
      !Object.prototype.hasOwnProperty.call(input, "quantity") ||
      !Object.prototype.hasOwnProperty.call(input, "price")) {
    throw new Error("Binance symbol rules order input fields are invalid");
  }
  assertSymbol(input.symbol);
  parseDecimal(input.quantity);
  parseDecimal(input.price);
}

function assertSymbol(value: unknown): asserts value is string {
  if (typeof value !== "string" || !/^[A-Z0-9._-]{3,32}$/.test(value)) {
    throw new Error("Binance symbol rules symbol is invalid");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
