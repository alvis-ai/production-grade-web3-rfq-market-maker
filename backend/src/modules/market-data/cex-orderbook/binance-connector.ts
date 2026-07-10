import { OrderBook, type OrderBookSnapshot, type PriceLevel } from "./orderbook.js";

interface BinanceDepthSnapshot {
  lastUpdateId: number;
  bids: [string, string][];
  asks: [string, string][];
}

interface BinanceDepthUpdate {
  e: "depthUpdate";
  U: number;
  u: number;
  b: [string, string][];
  a: [string, string][];
}

const REST_BASE = "https://api.binance.com";
const WS_BASE = "wss://stream.binance.com:9443/ws";
const MAX_RECONNECT_DELAY_MS = 30_000;
const INITIAL_RECONNECT_DELAY_MS = 1_000;
const SNAPSHOT_TIMEOUT_MS = 10_000;
const MAX_BUFFERED_UPDATES = 10_000;

export type OrderBookEventHandler = (snapshot: OrderBookSnapshot) => void;

export class BinanceConnector {
  readonly name = "binance";
  private readonly symbol: string;
  private readonly book = new OrderBook();
  private ws: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private lastUpdateId = 0;
  private pendingUpdates: BinanceDepthUpdate[] = [];
  private stopped = false;
  private synchronized = false;
  private snapshotGeneration = 0;

  constructor(
    symbol: string,
    private readonly onOrderBook: OrderBookEventHandler,
    private readonly onError?: (error: Error) => void,
  ) {
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
    const ws = this.ws;
    this.ws = null;
    try { ws?.close(); } catch { /* ignored during shutdown */ }
  }

  getOrderBook(): OrderBook {
    return this.book;
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
        this.reconnectAttempt = 0;
        void this.fetchAndApplySnapshot();
      };
      ws.onmessage = (event: MessageEvent) => this.handleMessage(event.data);
      ws.onclose = () => {
        if (this.ws === ws) this.ws = null;
        this.snapshotGeneration += 1;
        this.resetState();
        this.scheduleReconnect();
      };
      ws.onerror = () => this.reportError(new Error("Binance WebSocket error"));
    } catch (error) {
      this.reportError(error, "Binance WebSocket setup failed");
      this.ws = null;
      this.scheduleReconnect();
    }
  }

  private handleMessage(raw: unknown): void {
    try {
      const update = parseDepthUpdate(raw);
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
      const snapshot = parseDepthSnapshot(await response.json());
      if (this.stopped || generation !== this.snapshotGeneration || !this.ws) return;

      this.book.applySnapshot({
        bids: snapshot.bids.map(toPriceLevel),
        asks: snapshot.asks.map(toPriceLevel),
      });
      this.lastUpdateId = snapshot.lastUpdateId;
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
    this.flushOrderBook();
  }

  private applyUpdate(update: BinanceDepthUpdate): void {
    this.book.applyDelta({
      bids: update.b.map(toPriceLevel),
      asks: update.a.map(toPriceLevel),
    });
    this.lastUpdateId = update.u;
  }

  private flushOrderBook(): void {
    this.onOrderBook({
      bids: [...this.book.bids.entries()].map(([price, quantity]) => [price, quantity] as PriceLevel),
      asks: [...this.book.asks.entries()].map(([price, quantity]) => [price, quantity] as PriceLevel),
    });
  }

  private reconnectNow(): void {
    this.snapshotGeneration += 1;
    this.resetState();
    const ws = this.ws;
    this.ws = null;
    try { ws?.close(); } catch { /* ignored before reconnect */ }
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;
    const delay = Math.min(INITIAL_RECONNECT_DELAY_MS * 2 ** this.reconnectAttempt, MAX_RECONNECT_DELAY_MS);
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connectWebSocket();
    }, delay);
    this.reconnectTimer.unref();
  }

  private resetState(): void {
    this.synchronized = false;
    this.lastUpdateId = 0;
    this.pendingUpdates = [];
    this.book.clear();
  }

  private reportError(error: unknown, fallback?: string): void {
    this.onError?.(error instanceof Error ? error : new Error(fallback ?? String(error)));
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
  const value = JSON.parse(String(raw)) as unknown;
  if (!isRecord(value) || value.e !== "depthUpdate" || !Number.isSafeInteger(value.U) || !Number.isSafeInteger(value.u)) {
    throw new Error("Binance depth update has invalid sequence fields");
  }
  const firstUpdateId = Number(value.U);
  const finalUpdateId = Number(value.u);
  if (firstUpdateId <= 0 || finalUpdateId < firstUpdateId) throw new Error("Binance depth update sequence is invalid");
  return {
    e: "depthUpdate",
    U: firstUpdateId,
    u: finalUpdateId,
    b: parseLevels(value.b, "update bids"),
    a: parseLevels(value.a, "update asks"),
  };
}

function parseLevels(value: unknown, field: string): [string, string][] {
  if (!Array.isArray(value)) throw new Error(`Binance ${field} must be an array`);
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
