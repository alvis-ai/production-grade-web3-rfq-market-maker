import { OrderBook, type OrderBookSnapshot, type PriceLevel } from "./orderbook.js";

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

  constructor(
    productId: string,
    private readonly onOrderBook: OrderBookEventHandler,
    private readonly onError?: (error: Error) => void,
  ) {
    this.productId = productId;
  }

  /** Start the WebSocket connection. */
  start(): void {
    this.stopped = false;
    this.snapshotReceived = false;
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

  isReady(): boolean {
    return this.snapshotReceived && this.ws?.readyState === WebSocket.OPEN;
  }

  // ── connection lifecycle ──

  private connect(): void {
    if (this.stopped) return;
    this.snapshotReceived = false;
    this.book.clear();

    try {
      this.ws = new WebSocket(WS_URL);

      this.ws.onopen = () => {
        const subscribe: CoinbaseSubscribeMessage = {
          type: "subscribe",
          channels: [{ name: "level2", product_ids: [this.productId] }],
        };
        this.ws!.send(JSON.stringify(subscribe));
      };

      this.ws.onmessage = (event: MessageEvent) => {
        try {
          const msg = JSON.parse(event.data as string) as CoinbaseMessage;

          if (msg.type === "snapshot" && "bids" in msg && msg.product_id === this.productId) {
            this.handleSnapshot(msg);
          } else if (msg.type === "l2update" && "changes" in msg && msg.product_id === this.productId) {
            this.handleUpdate(msg);
          }
        } catch (error) {
          this.reportError(error, "Coinbase message parsing failed");
        }
      };

      this.ws.onclose = () => {
        this.ws = null;
        this.snapshotReceived = false;
        this.book.clear();
        this.scheduleReconnect();
      };

      this.ws.onerror = () => {
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
    this.flushOrderBook();
  }

  private flushOrderBook(): void {
    this.onOrderBook({
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

  private reportError(error: unknown, fallback?: string): void {
    const normalized = error instanceof Error ? error : new Error(fallback ?? String(error));
    this.onError?.(normalized);
  }
}

// ─── helpers ───────────────────────────────────────────────────────

function levelToPriceLevel(level: [string, string]): PriceLevel {
  return [level[0], level[1]] as const;
}
