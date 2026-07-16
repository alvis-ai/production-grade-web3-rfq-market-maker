import { OrderBook, type OrderBookSnapshot, type PriceLevel } from "./orderbook.js";
import {
  callCexCallbackBestEffort,
  exponentialReconnectDelayMs,
  parseBoundedJsonMessage,
} from "./connector-safety.js";

// ─── Types ────────────────────────────────────────────────────────

interface CoinbaseSubscribeMessage {
  type: "subscribe";
  channels: Array<{ name: string; product_ids: string[] }>;
}

interface CoinbaseSnapshotMessage {
  type: "snapshot";
  product_id: string;
  bids: [string, string][];
  asks: [string, string][];
}

interface CoinbaseL2UpdateMessage {
  type: "l2update";
  product_id: string;
  time: string;
  changes: Array<["buy" | "sell", string, string]>;
}

interface CoinbaseHeartbeatMessage {
  type: "heartbeat";
  product_id: string;
  time: string;
  sequence: number;
  last_trade_id: number;
}

type CoinbaseMessage = CoinbaseSnapshotMessage | CoinbaseL2UpdateMessage | CoinbaseHeartbeatMessage;

// ─── Constants ─────────────────────────────────────────────────────

const WS_URL = "wss://ws-feed.exchange.coinbase.com";
const MAX_RECONNECT_DELAY_MS = 30_000;
const INITIAL_RECONNECT_DELAY_MS = 1_000;
const CONNECTION_TIMEOUT_MS = 10_000;
const SNAPSHOT_TIMEOUT_MS = 10_000;

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
  private connectionTimer: ReturnType<typeof setTimeout> | null = null;
  private snapshotTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private snapshotReceived = false;
  private stopped = false;
  private lastUpdateAtMs: number | undefined;
  private lastStreamEventAtMs: number | undefined;
  private lastHeartbeatEventAtMs: number | undefined;
  private lastHeartbeatSequence: number | undefined;
  private lastHeartbeatTradeId: number | undefined;

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
    this.resetState();
    this.connect();
  }

  /** Graceful shutdown. */
  stop(): void {
    this.stopped = true;
    this.resetState();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.clearConnectionTimer();
    this.clearSnapshotTimer();
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
    this.resetState();

    try {
      const ws = new WebSocket(WS_URL);
      this.ws = ws;

      ws.onopen = () => {
        if (this.ws !== ws || this.stopped) return;
        this.clearConnectionTimer();
        try {
          const subscribe: CoinbaseSubscribeMessage = {
            type: "subscribe",
            channels: [
              { name: "level2", product_ids: [this.productId] },
              { name: "heartbeat", product_ids: [this.productId] },
            ],
          };
          ws.send(JSON.stringify(subscribe));
          this.armSnapshotTimeout(ws);
        } catch (error) {
          this.reportError(error, "Coinbase subscription failed");
          this.reconnectNow();
        }
      };

      ws.onmessage = (event: MessageEvent) => {
        if (this.ws !== ws || this.stopped) return;
        try {
          const receivedAtMs = Date.now();
          const msg = parseCoinbaseMessage(event.data, this.productId);
          if (!msg) return;

          if (msg.type === "snapshot") {
            this.handleSnapshot(msg, receivedAtMs);
          } else if (msg.type === "l2update") {
            this.handleUpdate(msg);
          } else {
            this.handleHeartbeat(msg);
          }
        } catch (error) {
          this.reportError(error, "Coinbase message parsing failed");
          this.reconnectNow();
        }
      };

      ws.onclose = () => {
        if (this.ws !== ws) return;
        this.ws = null;
        this.clearConnectionTimer();
        this.clearSnapshotTimer();
        this.resetState();
        this.scheduleReconnect();
      };

      ws.onerror = () => {
        if (this.ws !== ws || this.stopped) return;
        this.reportError(new Error("Coinbase WebSocket error"));
        this.reconnectNow();
      };
      this.armConnectionTimeout(ws);
    } catch (error) {
      this.reportError(error, "Coinbase WebSocket setup failed");
      this.ws = null;
      this.scheduleReconnect();
    }
  }

  private handleSnapshot(msg: CoinbaseSnapshotMessage, receivedAtMs: number): void {
    this.book.applySnapshot({
      bids: msg.bids.map(levelToPriceLevel),
      asks: msg.asks.map(levelToPriceLevel),
    });
    this.lastUpdateAtMs = receivedAtMs;
    this.lastStreamEventAtMs = undefined;
    this.snapshotReceived = true;
    this.clearSnapshotTimer();
    this.reconnectAttempt = 0;
    this.flushOrderBook();
  }

  private handleUpdate(msg: CoinbaseL2UpdateMessage): void {
    if (!this.snapshotReceived) return;
    const observedAtMs = parseCoinbaseTimestamp(msg.time);
    if (this.lastStreamEventAtMs !== undefined && observedAtMs < this.lastStreamEventAtMs) {
      throw new Error("Coinbase order book event time regressed");
    }

    const bidChanges: PriceLevel[] = [];
    const askChanges: PriceLevel[] = [];

    for (const [side, price, qty] of msg.changes) {
      const level: PriceLevel = [price, qty];
      if (side === "buy") bidChanges.push(level);
      else askChanges.push(level);
    }

    this.book.applyDelta({ bids: bidChanges, asks: askChanges });
    this.lastStreamEventAtMs = observedAtMs;
    this.lastUpdateAtMs = observedAtMs;
    this.flushOrderBook();
  }

  private handleHeartbeat(msg: CoinbaseHeartbeatMessage): void {
    if (!this.snapshotReceived) return;
    const observedAtMs = parseCoinbaseTimestamp(msg.time);
    if (this.lastHeartbeatEventAtMs !== undefined && observedAtMs < this.lastHeartbeatEventAtMs) {
      throw new Error("Coinbase heartbeat event time regressed");
    }
    if (this.lastHeartbeatSequence !== undefined && msg.sequence < this.lastHeartbeatSequence) {
      throw new Error("Coinbase heartbeat sequence regressed");
    }
    if (this.lastHeartbeatTradeId !== undefined && msg.last_trade_id < this.lastHeartbeatTradeId) {
      throw new Error("Coinbase heartbeat trade id regressed");
    }
    this.lastHeartbeatEventAtMs = observedAtMs;
    this.lastHeartbeatSequence = msg.sequence;
    this.lastHeartbeatTradeId = msg.last_trade_id;
    this.lastUpdateAtMs = Math.max(this.lastUpdateAtMs ?? observedAtMs, observedAtMs);
  }

  private flushOrderBook(): void {
    callCexCallbackBestEffort(this.onOrderBook, {
      bids: [...this.book.bids.entries()].map(([p, q]) => [p, q] as PriceLevel),
      asks: [...this.book.asks.entries()].map(([p, q]) => [p, q] as PriceLevel),
    });
  }

  private scheduleReconnect(): void {
    if (this.stopped) return;
    this.resetState();
    if (this.reconnectTimer) return;

    const delay = exponentialReconnectDelayMs(
      this.reconnectAttempt,
      INITIAL_RECONNECT_DELAY_MS,
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
    this.clearConnectionTimer();
    this.clearSnapshotTimer();
    this.resetState();
    const ws = this.ws;
    this.ws = null;
    try { ws?.close(); } catch { /* ignored before reconnect */ }
    this.scheduleReconnect();
  }

  private armConnectionTimeout(ws: WebSocket): void {
    this.clearConnectionTimer();
    this.connectionTimer = setTimeout(() => {
      this.connectionTimer = null;
      if (this.stopped || this.ws !== ws || ws.readyState === WebSocket.OPEN) return;
      this.reportError(new Error("Coinbase WebSocket connection timed out"));
      this.reconnectNow();
    }, CONNECTION_TIMEOUT_MS);
    this.connectionTimer.unref();
  }

  private clearConnectionTimer(): void {
    if (!this.connectionTimer) return;
    clearTimeout(this.connectionTimer);
    this.connectionTimer = null;
  }

  private armSnapshotTimeout(ws: WebSocket): void {
    this.clearSnapshotTimer();
    this.snapshotTimer = setTimeout(() => {
      this.snapshotTimer = null;
      if (this.stopped || this.ws !== ws || this.snapshotReceived) return;
      this.reportError(new Error("Coinbase initial order book snapshot timed out"));
      this.reconnectNow();
    }, SNAPSHOT_TIMEOUT_MS);
    this.snapshotTimer.unref();
  }

  private clearSnapshotTimer(): void {
    if (!this.snapshotTimer) return;
    clearTimeout(this.snapshotTimer);
    this.snapshotTimer = null;
  }

  private resetState(): void {
    this.snapshotReceived = false;
    this.lastUpdateAtMs = undefined;
    this.lastStreamEventAtMs = undefined;
    this.lastHeartbeatEventAtMs = undefined;
    this.lastHeartbeatSequence = undefined;
    this.lastHeartbeatTradeId = undefined;
    this.book.clear();
  }

  private reportError(error: unknown, fallback?: string): void {
    const normalized = error instanceof Error ? error : new Error(fallback ?? String(error));
    callCexCallbackBestEffort(this.onError, normalized);
  }
}

// ─── helpers ───────────────────────────────────────────────────────

function levelToPriceLevel(level: [string, string]): PriceLevel {
  return [level[0], level[1]] as const;
}

function parseCoinbaseMessage(raw: unknown, productId: string): CoinbaseMessage | undefined {
  const value = parseBoundedJsonMessage(raw, "Coinbase WebSocket message");
  if (!isRecord(value) || typeof value.type !== "string") {
    throw new Error("Coinbase message must be an object with a type");
  }
  if (value.type === "error") {
    const reason = typeof value.message === "string" && value.message.length <= 256
      ? value.message
      : "unknown exchange error";
    throw new Error(`Coinbase subscription error: ${reason}`);
  }
  if (value.type !== "snapshot" && value.type !== "l2update" && value.type !== "heartbeat") return undefined;
  if (value.product_id !== productId) return undefined;
  if (value.type === "snapshot") {
    return {
      type: "snapshot",
      product_id: productId,
      bids: parseCoinbaseLevels(value.bids, "snapshot bids"),
      asks: parseCoinbaseLevels(value.asks, "snapshot asks"),
    };
  }
  if (typeof value.time !== "string") throw new Error("Coinbase order book message time is invalid");
  parseCoinbaseTimestamp(value.time);
  if (value.type === "heartbeat") {
    if (!Number.isSafeInteger(value.sequence) || Number(value.sequence) < 0 ||
        !Number.isSafeInteger(value.last_trade_id) || Number(value.last_trade_id) < 0) {
      throw new Error("Coinbase heartbeat sequence fields are invalid");
    }
    return {
      type: "heartbeat",
      product_id: productId,
      time: value.time,
      sequence: Number(value.sequence),
      last_trade_id: Number(value.last_trade_id),
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
