import { OrderBook, type OrderBookDelta, type OrderBookSnapshot, type PriceLevel } from "./orderbook.js";

// ─── Types ────────────────────────────────────────────────────────

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

// ─── Constants ─────────────────────────────────────────────────────

const REST_BASE = "https://api.binance.com";
const WS_BASE = "wss://stream.binance.com:9443/ws";

const MAX_RECONNECT_DELAY_MS = 30_000;
const INITIAL_RECONNECT_DELAY_MS = 1_000;
const PING_INTERVAL_MS = 15_000;

// ─── BinanceConnector ─────────────────────────────────────────────

export type OrderBookEventHandler = (snapshot: OrderBookSnapshot) => void;

/**
 * Manages a single Binance WebSocket order book stream.
 *
 * Protocol:
 * 1. Fetch REST snapshot for initial state.
 * 2. Open WebSocket and subscribe to depth updates.
 * 3. Buffer incoming updates until their sequence aligns with the snapshot.
 * 4. Apply buffered updates in order.
 * 5. On disconnect → reconnect with exponential backoff → re-fetch snapshot.
 */
export class BinanceConnector {
  readonly name = "binance";
  private readonly symbol: string;
  private readonly book = new OrderBook();
  private ws: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private snapshotUpdateId = 0;
  private pendingUpdates: BinanceDepthUpdate[] = [];
  private stopped = false;

  constructor(
    symbol: string,
    private readonly onOrderBook: OrderBookEventHandler,
    private readonly onError?: (error: Error) => void,
  ) {
    this.symbol = symbol.toLowerCase();
  }

  /** Start the connection: fetch snapshot then open WebSocket. */
  start(): void {
    this.stopped = false;
    this.fetchSnapshotAndConnect();
  }

  /** Graceful shutdown. */
  stop(): void {
    this.stopped = true;
    this.clearTimers();
    if (this.ws) {
      try { this.ws.close(); } catch { /* ignore */ }
      this.ws = null;
    }
  }

  /** Expose the internal order book for metrics. */
  getOrderBook(): OrderBook {
    return this.book;
  }

  // ── connection lifecycle ──

  private async fetchSnapshotAndConnect(): Promise<void> {
    try {
      const response = await fetch(
        `${REST_BASE}/api/v3/depth?symbol=${this.symbol.toUpperCase()}&limit=1000`,
      );
      if (!response.ok) throw new Error(`Binance REST ${response.status}`);

      const data: BinanceDepthSnapshot = await response.json();
      this.snapshotUpdateId = data.lastUpdateId;

      this.book.applySnapshot({
        bids: data.bids.map(levelToPriceLevel),
        asks: data.asks.map(levelToPriceLevel),
      });

      // Drain any buffered updates that came in during the fetch
      this.drainPendingUpdates();

      // Open WebSocket for live updates
      this.connectWebSocket();
      this.reconnectAttempt = 0;
    } catch (error) {
      this.scheduleReconnect();
    }
  }

  private connectWebSocket(): void {
    if (this.stopped) return;

    try {
      this.ws = new WebSocket(`${WS_BASE}/${this.symbol}@depth@100ms`);

      this.ws.onopen = () => {
        this.startPing();
      };

      this.ws.onmessage = (event: MessageEvent) => {
        try {
          const msg: BinanceDepthUpdate = JSON.parse(event.data as string);

          // Ignore updates older than the snapshot
          if (msg.u <= this.snapshotUpdateId) return;

          if (msg.U <= this.snapshotUpdateId + 1 && msg.u >= this.snapshotUpdateId + 1) {
            // Update is contiguous with our snapshot → apply immediately
            this.book.applyDelta({
              bids: msg.b.map(levelToPriceLevel),
              asks: msg.a.map(levelToPriceLevel),
            });
            this.snapshotUpdateId = msg.u;
            this.flushOrderBook();
          } else if (msg.U > this.snapshotUpdateId + 1) {
            // Gap detected → buffer for ordering
            this.pendingUpdates.push(msg);
            this.pendingUpdates.sort((a, b) => a.U - b.U);
          } else {
            // Past update, already applied
            this.snapshotUpdateId = Math.max(this.snapshotUpdateId, msg.u);
          }
        } catch {
          // Parse error — skip malformed message
        }
      };

      this.ws.onclose = () => {
        this.stopPing();
        this.scheduleReconnect();
      };

      this.ws.onerror = () => {
        // onclose will fire after onerror, triggering reconnect
      };
    } catch {
      this.scheduleReconnect();
    }
  }

  private drainPendingUpdates(): void {
    const remaining: BinanceDepthUpdate[] = [];
    for (const update of this.pendingUpdates) {
      if (update.U <= this.snapshotUpdateId + 1 && update.u >= this.snapshotUpdateId + 1) {
        this.book.applyDelta({
          bids: update.b.map(levelToPriceLevel),
          asks: update.a.map(levelToPriceLevel),
        });
        this.snapshotUpdateId = update.u;
      } else if (update.U > this.snapshotUpdateId + 1) {
        remaining.push(update);
      }
    }
    this.pendingUpdates = remaining;
    this.flushOrderBook();
  }

  private flushOrderBook(): void {
    this.onOrderBook({
      bids: [...this.book.bids.entries()].map(([p, q]) => [p, q] as PriceLevel),
      asks: [...this.book.asks.entries()].map(([p, q]) => [p, q] as PriceLevel),
    });
  }

  // ── timers ──

  private scheduleReconnect(): void {
    if (this.stopped) return;
    this.clearTimers();

    const delay = Math.min(
      INITIAL_RECONNECT_DELAY_MS * Math.pow(2, this.reconnectAttempt),
      MAX_RECONNECT_DELAY_MS,
    );
    this.reconnectAttempt += 1;

    this.reconnectTimer = setTimeout(() => {
      this.fetchSnapshotAndConnect();
    }, delay);
  }

  private startPing(): void {
    this.pingTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ pong: Date.now() }));
      }
    }, PING_INTERVAL_MS);
  }

  private stopPing(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private clearTimers(): void {
    this.stopPing();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}

// ─── helpers ───────────────────────────────────────────────────────

function levelToPriceLevel(level: [string, string]): PriceLevel {
  return [level[0], level[1]] as const;
}
