import { OrderBook, type OrderBookSnapshot, type PriceLevel } from "./orderbook.js";

// ─── Types ────────────────────────────────────────────────────────

interface CoinbaseSubscribeMessage {
  type: "subscribe";
  channels: Array<{ name: string; product_ids: string[] }>;
}

interface CoinbaseSnapshotMessage {
  type: "snapshot";
  product_id: string;
  time: string;
  bids: [string, string][];
  asks: [string, string][];
}

interface CoinbaseL2UpdateMessage {
  type: "l2update";
  product_id: string;
  time: string;
  changes: Array<["buy" | "sell", string, string]>;
}

type CoinbaseMessage = CoinbaseSnapshotMessage | CoinbaseL2UpdateMessage;

// ─── Constants ─────────────────────────────────────────────────────

const WS_URL = "wss://ws-feed.exchange.coinbase.com";
const MAX_RECONNECT_DELAY_MS = 30_000;
const INITIAL_RECONNECT_DELAY_MS = 1_000;

// ─── CoinbaseConnector ────────────────────────────────────────────

export type OrderBookEventHandler = (snapshot: OrderBookSnapshot) => void;

/**
 * Manages a single Coinbase WebSocket Level-2 order book stream.
 *
 * Protocol:
 * 1. Open WebSocket and subscribe to the "level2" channel.
 * 2. The first message is a full snapshot.
 * 3. Subsequent messages are l2update (side, price, quantity).
 * 4. On disconnect → reconnect with exponential backoff.
 */
export class CoinbaseConnector {
  readonly name = "coinbase";
  private readonly productId: string;
  private readonly book = new OrderBook();
  private ws: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private snapshotReceived = false;
  private stopped = false;
  private lastUpdateAtMs: number | undefined;

  constructor(
    productId: string,
    private readonly onOrderBook?: OrderBookEventHandler,
    private readonly onError?: (error: Error) => void,
  ) {
    if (typeof productId !== "string" || !/^[A-Za-z0-9._-]{3,32}$/.test(productId)) {
      throw new Error("Coinbase productId must contain 3-32 exchange symbol characters");
    }
    if (onOrderBook !== undefined && typeof onOrderBook !== "function") {
      throw new Error("Coinbase onOrderBook must be a function when provided");
    }
    if (onError !== undefined && typeof onError !== "function") {
      throw new Error("Coinbase onError must be a function when provided");
    }
    this.productId = productId;
  }

  /** Start the WebSocket connection. */
  start(): void {
    if (!this.stopped && this.ws) return;
    this.stopped = false;
    this.snapshotReceived = false;
    this.lastUpdateAtMs = undefined;
    this.connect();
  }

  /** Graceful shutdown. */
  stop(): void {
    this.stopped = true;
    this.snapshotReceived = false;
    this.book.clear();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      try { this.ws.close(); } catch { /* ignore */ }
      this.ws = null;
    }
  }

  /** Expose the internal order book for metrics. */
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
    return this.snapshotReceived && this.ws?.readyState === WebSocket.OPEN;
  }

  // ── connection lifecycle ──

  private connect(): void {
    if (this.stopped || this.ws) return;
    this.snapshotReceived = false;
    this.book.clear();

    try {
      const ws = new WebSocket(WS_URL);
      this.ws = ws;

      ws.onopen = () => {
        const subscribe: CoinbaseSubscribeMessage = {
          type: "subscribe",
          channels: [{ name: "level2", product_ids: [this.productId] }],
        };
        ws.send(JSON.stringify(subscribe));
      };

      ws.onmessage = (event: MessageEvent) => {
        try {
          const msg = parseCoinbaseMessage(event.data, this.productId);
          if (!msg) return;

          if (msg.type === "snapshot") {
            this.handleSnapshot(msg);
          } else {
            this.handleUpdate(msg);
          }
        } catch (error) {
          this.reportError(error, "Coinbase message parsing failed");
          this.reconnectNow();
        }
      };

      ws.onclose = () => {
        if (this.ws !== ws) return;
        this.ws = null;
        this.snapshotReceived = false;
        this.lastUpdateAtMs = undefined;
        this.book.clear();
        this.scheduleReconnect();
      };

      ws.onerror = () => {
        this.reportError(new Error("Coinbase WebSocket error"));
      };
    } catch (error) {
      this.reportError(error, "Coinbase WebSocket setup failed");
      this.scheduleReconnect();
    }
  }

  private handleSnapshot(msg: CoinbaseSnapshotMessage): void {
    this.book.applySnapshot({
      bids: msg.bids.map(levelToPriceLevel),
      asks: msg.asks.map(levelToPriceLevel),
    });
    this.lastUpdateAtMs = parseCoinbaseTimestamp(msg.time);
    this.snapshotReceived = true;
    this.reconnectAttempt = 0;
    this.flushOrderBook();
  }

  private handleUpdate(msg: CoinbaseL2UpdateMessage): void {
    if (!this.snapshotReceived) return;

    const bidChanges: PriceLevel[] = [];
    const askChanges: PriceLevel[] = [];

    for (const [side, price, qty] of msg.changes) {
      const level: PriceLevel = [price, qty];
      if (side === "buy") bidChanges.push(level);
      else askChanges.push(level);
    }

    this.book.applyDelta({ bids: bidChanges, asks: askChanges });
    this.lastUpdateAtMs = parseCoinbaseTimestamp(msg.time);
    this.flushOrderBook();
  }

  private flushOrderBook(): void {
    this.onOrderBook?.({
      bids: [...this.book.bids.entries()].map(([p, q]) => [p, q] as PriceLevel),
      asks: [...this.book.asks.entries()].map(([p, q]) => [p, q] as PriceLevel),
    });
  }

  private scheduleReconnect(): void {
    if (this.stopped) return;
    this.snapshotReceived = false;
    this.book.clear();
    if (this.reconnectTimer) return;

    const delay = Math.min(
      INITIAL_RECONNECT_DELAY_MS * Math.pow(2, this.reconnectAttempt),
      MAX_RECONNECT_DELAY_MS,
    );
    this.reconnectAttempt += 1;

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
    this.reconnectTimer.unref();
  }

  private reconnectNow(): void {
    this.snapshotReceived = false;
    this.lastUpdateAtMs = undefined;
    this.book.clear();
    const ws = this.ws;
    this.ws = null;
    try { ws?.close(); } catch { /* ignored before reconnect */ }
    this.scheduleReconnect();
  }

  private reportError(error: unknown, fallback?: string): void {
    const normalized = error instanceof Error ? error : new Error(fallback ?? String(error));
    this.onError?.(normalized);
  }
}

// ─── helpers ───────────────────────────────────────────────────────

function levelToPriceLevel(level: [string, string]): PriceLevel {
  return [level[0], level[1]] as const;
}

function parseCoinbaseMessage(raw: unknown, productId: string): CoinbaseMessage | undefined {
  const value = JSON.parse(String(raw)) as unknown;
  if (!isRecord(value) || typeof value.type !== "string") {
    throw new Error("Coinbase message must be an object with a type");
  }
  if (value.type === "error") {
    const reason = typeof value.message === "string" && value.message.length <= 256
      ? value.message
      : "unknown exchange error";
    throw new Error(`Coinbase subscription error: ${reason}`);
  }
  if (value.type !== "snapshot" && value.type !== "l2update") return undefined;
  if (value.product_id !== productId) return undefined;
  if (typeof value.time !== "string") throw new Error("Coinbase order book message time is invalid");
  parseCoinbaseTimestamp(value.time);

  if (value.type === "snapshot") {
    return {
      type: "snapshot",
      product_id: productId,
      time: value.time,
      bids: parseCoinbaseLevels(value.bids, "snapshot bids"),
      asks: parseCoinbaseLevels(value.asks, "snapshot asks"),
    };
  }
  if (!Array.isArray(value.changes) || value.changes.length > 10_000) {
    throw new Error("Coinbase l2update changes must contain at most 10000 levels");
  }
  return {
    type: "l2update",
    product_id: productId,
    time: value.time,
    changes: value.changes.map((change, index) => {
      if (!Array.isArray(change) || change.length !== 3 ||
          (change[0] !== "buy" && change[0] !== "sell") ||
          typeof change[1] !== "string" || typeof change[2] !== "string") {
        throw new Error(`Coinbase l2update change ${index} is invalid`);
      }
      return [change[0], change[1], change[2]];
    }),
  };
}

function parseCoinbaseLevels(value: unknown, field: string): [string, string][] {
  if (!Array.isArray(value) || value.length > 5_000) {
    throw new Error(`Coinbase ${field} must contain at most 5000 levels`);
  }
  return value.map((level, index) => {
    if (!Array.isArray(level) || level.length !== 2 ||
        typeof level[0] !== "string" || typeof level[1] !== "string") {
      throw new Error(`Coinbase ${field} level ${index} is invalid`);
    }
    return [level[0], level[1]];
  });
}

function parseCoinbaseTimestamp(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(value)) {
    throw new Error("Coinbase order book timestamp is invalid");
  }
  const timestamp = Date.parse(value);
  if (!Number.isSafeInteger(timestamp) || timestamp <= 0) {
    throw new Error("Coinbase order book timestamp is invalid");
  }
  return timestamp;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
