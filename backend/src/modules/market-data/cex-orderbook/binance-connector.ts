import { OrderBook, type OrderBookSnapshot, type PriceLevel } from "./orderbook.js";
import {
  callCexCallbackBestEffort,
  exponentialReconnectDelayMs,
  parseBoundedJsonMessage,
  readBoundedJsonResponse,
} from "./connector-safety.js";

interface BinanceDepthSnapshot {
  lastUpdateId: number;
  bids: [string, string][];
  asks: [string, string][];
}

interface BinanceDepthUpdate {
  e: "depthUpdate";
  E: number;
  s: string;
  U: number;
  u: number;
  b: [string, string][];
  a: [string, string][];
}

const REST_BASE = "https://api.binance.com";
const WS_BASE = "wss://stream.binance.com:9443/ws";
const MAX_RECONNECT_DELAY_MS = 30_000;
const INITIAL_RECONNECT_DELAY_MS = 1_000;
const CONNECTION_TIMEOUT_MS = 10_000;
const SNAPSHOT_TIMEOUT_MS = 10_000;
const MAX_BUFFERED_UPDATES = 10_000;

export type OrderBookEventHandler = (snapshot: OrderBookSnapshot) => void;

export class BinanceConnector {
  readonly name = "binance";
  private readonly symbol: string;
  private readonly book = new OrderBook();
  private ws: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private connectionTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private lastUpdateId = 0;
  private pendingUpdates: BinanceDepthUpdate[] = [];
  private stopped = false;
  private synchronized = false;
  private snapshotGeneration = 0;
  private lastUpdateAtMs: number | undefined;
  private lastStreamEventAtMs: number | undefined;

  constructor(
    symbol: string,
    private readonly onOrderBook?: OrderBookEventHandler,
    private readonly onError?: (error: Error) => void,
  ) {
    if (typeof symbol !== "string" || !/^[A-Za-z0-9._-]{3,32}$/.test(symbol)) {
      throw new Error("Binance symbol must contain 3-32 exchange symbol characters");
    }
    if (onOrderBook !== undefined && typeof onOrderBook !== "function") {
      throw new Error("Binance onOrderBook must be a function when provided");
    }
    if (onError !== undefined && typeof onError !== "function") {
      throw new Error("Binance onError must be a function when provided");
    }
    this.symbol = symbol.toLowerCase();
  }

  start(): void {
    if (!this.stopped && this.ws) return;
    this.stopped = false;
    this.connectWebSocket();
  }

  stop(): void {
    this.stopped = true;
    this.snapshotGeneration += 1;
    this.resetState();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.clearConnectionTimer();
    const ws = this.ws;
    this.ws = null;
    try { ws?.close(); } catch { /* ignored during shutdown */ }
  }

  getOrderBook(): OrderBook {
    return this.book;
  }

  getLastUpdateAtMs(): number | undefined {
    return this.lastUpdateAtMs;
  }

  restart(): void {
    if (this.stopped) return;
    this.reconnectNow();
  }

  isReady(): boolean {
    return this.synchronized && this.ws?.readyState === WebSocket.OPEN;
  }

  private connectWebSocket(): void {
    if (this.stopped || this.ws) return;
    this.resetState();

    try {
      const ws = new WebSocket(`${WS_BASE}/${this.symbol}@depth@100ms`);
      this.ws = ws;
      ws.onopen = () => {
        if (this.ws !== ws || this.stopped) return;
        this.clearConnectionTimer();
        void this.fetchAndApplySnapshot();
      };
      ws.onmessage = (event: MessageEvent) => {
        if (this.ws !== ws || this.stopped) return;
        this.handleMessage(event.data);
      };
      ws.onclose = () => {
        if (this.ws !== ws) return;
        this.ws = null;
        this.clearConnectionTimer();
        this.snapshotGeneration += 1;
        this.resetState();
        this.scheduleReconnect();
      };
      ws.onerror = () => {
        if (this.ws !== ws || this.stopped) return;
        this.reportError(new Error("Binance WebSocket error"));
        this.reconnectNow();
      };
      this.armConnectionTimeout(ws);
    } catch (error) {
      this.reportError(error, "Binance WebSocket setup failed");
      this.ws = null;
      this.scheduleReconnect();
    }
  }

  private handleMessage(raw: unknown): void {
    try {
      const update = parseDepthUpdate(raw);
      if (update.s.toLowerCase() !== this.symbol) {
        throw new Error("Binance depth update symbol does not match subscription");
      }
      if (!this.synchronized) {
        this.pendingUpdates.push(update);
        if (this.pendingUpdates.length > MAX_BUFFERED_UPDATES) {
          this.reportError(new Error("Binance depth update buffer overflow"));
          this.reconnectNow();
        }
        return;
      }

      if (update.u <= this.lastUpdateId) return;
      if (!bridgesUpdateId(update, this.lastUpdateId)) {
        this.reportError(new Error("Binance depth update sequence gap"));
        this.synchronized = false;
        this.pendingUpdates = [update];
        this.book.clear();
        void this.fetchAndApplySnapshot();
        return;
      }

      this.applyUpdate(update);
      this.flushOrderBook();
    } catch (error) {
      this.reportError(error, "Binance message parsing failed");
      this.reconnectNow();
    }
  }

  private async fetchAndApplySnapshot(): Promise<void> {
    const generation = ++this.snapshotGeneration;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), SNAPSHOT_TIMEOUT_MS);
    timeout.unref();

    try {
      const response = await fetch(
        `${REST_BASE}/api/v3/depth?symbol=${this.symbol.toUpperCase()}&limit=1000`,
        { signal: controller.signal },
      );
      if (!response.ok) throw new Error(`Binance REST ${response.status}`);
      const snapshot = parseDepthSnapshot(
        await readBoundedJsonResponse(response, "Binance depth snapshot"),
      );
      if (this.stopped || generation !== this.snapshotGeneration || !this.ws) return;

      this.book.applySnapshot({
        bids: snapshot.bids.map(toPriceLevel),
        asks: snapshot.asks.map(toPriceLevel),
      });
      this.lastUpdateId = snapshot.lastUpdateId;
      this.lastUpdateAtMs = Date.now();
      this.applyBufferedUpdates();
    } catch (error) {
      if (generation !== this.snapshotGeneration || this.stopped) return;
      this.reportError(error, "Binance snapshot fetch failed");
      this.reconnectNow();
    } finally {
      clearTimeout(timeout);
    }
  }

  private applyBufferedUpdates(): void {
    const updates = this.pendingUpdates
      .filter((update) => update.u > this.lastUpdateId)
      .sort((left, right) => left.U - right.U || left.u - right.u);
    this.pendingUpdates = [];

    for (const update of updates) {
      if (update.u <= this.lastUpdateId) continue;
      if (!bridgesUpdateId(update, this.lastUpdateId)) {
        this.reportError(new Error("Binance buffered depth update sequence gap"));
        this.reconnectNow();
        return;
      }
      this.applyUpdate(update);
    }

    this.synchronized = true;
    this.reconnectAttempt = 0;
    this.flushOrderBook();
  }

  private applyUpdate(update: BinanceDepthUpdate): void {
    if (this.lastStreamEventAtMs !== undefined && update.E < this.lastStreamEventAtMs) {
      throw new Error("Binance depth update event time regressed");
    }
    this.book.applyDelta({
      bids: update.b.map(toPriceLevel),
      asks: update.a.map(toPriceLevel),
    });
    this.lastUpdateId = update.u;
    this.lastStreamEventAtMs = update.E;
    this.lastUpdateAtMs = update.E;
  }

  private flushOrderBook(): void {
    callCexCallbackBestEffort(this.onOrderBook, {
      bids: [...this.book.bids.entries()].map(([price, quantity]) => [price, quantity] as PriceLevel),
      asks: [...this.book.asks.entries()].map(([price, quantity]) => [price, quantity] as PriceLevel),
    });
  }

  private reconnectNow(): void {
    this.clearConnectionTimer();
    this.snapshotGeneration += 1;
    this.resetState();
    const ws = this.ws;
    this.ws = null;
    try { ws?.close(); } catch { /* ignored before reconnect */ }
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;
    const delay = exponentialReconnectDelayMs(
      this.reconnectAttempt,
      INITIAL_RECONNECT_DELAY_MS,
      MAX_RECONNECT_DELAY_MS,
    );
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connectWebSocket();
    }, delay);
    this.reconnectTimer.unref();
  }

  private armConnectionTimeout(ws: WebSocket): void {
    this.clearConnectionTimer();
    this.connectionTimer = setTimeout(() => {
      this.connectionTimer = null;
      if (this.stopped || this.ws !== ws || ws.readyState === WebSocket.OPEN) return;
      this.reportError(new Error("Binance WebSocket connection timed out"));
      this.reconnectNow();
    }, CONNECTION_TIMEOUT_MS);
    this.connectionTimer.unref();
  }

  private clearConnectionTimer(): void {
    if (!this.connectionTimer) return;
    clearTimeout(this.connectionTimer);
    this.connectionTimer = null;
  }

  private resetState(): void {
    this.synchronized = false;
    this.lastUpdateId = 0;
    this.lastUpdateAtMs = undefined;
    this.lastStreamEventAtMs = undefined;
    this.pendingUpdates = [];
    this.book.clear();
  }

  private reportError(error: unknown, fallback?: string): void {
    callCexCallbackBestEffort(
      this.onError,
      error instanceof Error ? error : new Error(fallback ?? String(error)),
    );
  }
}

function parseDepthSnapshot(value: unknown): BinanceDepthSnapshot {
  if (!isRecord(value) || !Number.isSafeInteger(value.lastUpdateId) || Number(value.lastUpdateId) <= 0) {
    throw new Error("Binance snapshot has invalid lastUpdateId");
  }
  return {
    lastUpdateId: Number(value.lastUpdateId),
    bids: parseLevels(value.bids, "snapshot bids"),
    asks: parseLevels(value.asks, "snapshot asks"),
  };
}

function parseDepthUpdate(raw: unknown): BinanceDepthUpdate {
  const value = parseBoundedJsonMessage(raw, "Binance WebSocket message");
  if (!isRecord(value) || value.e !== "depthUpdate" ||
      !Number.isSafeInteger(value.E) || Number(value.E) <= 0 ||
      typeof value.s !== "string" || !/^[A-Z0-9._-]{3,32}$/.test(value.s) ||
      !Number.isSafeInteger(value.U) || !Number.isSafeInteger(value.u)) {
    throw new Error("Binance depth update has invalid sequence fields");
  }
  const firstUpdateId = Number(value.U);
  const finalUpdateId = Number(value.u);
  if (firstUpdateId <= 0 || finalUpdateId < firstUpdateId) throw new Error("Binance depth update sequence is invalid");
  return {
    e: "depthUpdate",
    E: Number(value.E),
    s: value.s,
    U: firstUpdateId,
    u: finalUpdateId,
    b: parseLevels(value.b, "update bids"),
    a: parseLevels(value.a, "update asks"),
  };
}

function parseLevels(value: unknown, field: string): [string, string][] {
  if (!Array.isArray(value) || value.length > 5_000) {
    throw new Error(`Binance ${field} must be an array with at most 5000 levels`);
  }
  return value.map((level) => {
    if (!Array.isArray(level) || level.length !== 2 || typeof level[0] !== "string" || typeof level[1] !== "string") {
      throw new Error(`Binance ${field} contains an invalid level`);
    }
    return [level[0], level[1]];
  });
}

function bridgesUpdateId(update: BinanceDepthUpdate, previousUpdateId: number): boolean {
  const nextUpdateId = previousUpdateId + 1;
  return update.U <= nextUpdateId && update.u >= nextUpdateId;
}

function toPriceLevel(level: [string, string]): PriceLevel {
  return [level[0], level[1]];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
