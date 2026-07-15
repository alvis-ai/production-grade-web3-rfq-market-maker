import assert from "node:assert/strict";

globalThis.WebSocket = class FakeWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  constructor(url) {
    this.url = String(url);
    this.readyState = FakeWebSocket.CONNECTING;
    queueMicrotask(() => {
      if (this.readyState !== FakeWebSocket.CONNECTING) return;
      this.readyState = FakeWebSocket.OPEN;
      this.onopen?.();
    });
  }

  send(raw) {
    const request = JSON.parse(String(raw));
    assert.equal(this.url, "wss://ws-feed.exchange.coinbase.com");
    assert.deepEqual(request, {
      type: "subscribe",
      channels: [
        { name: "level2", product_ids: ["ETH-USD"] },
        { name: "heartbeat", product_ids: ["ETH-USD"] },
      ],
    });
    queueMicrotask(() => {
      if (this.readyState !== FakeWebSocket.OPEN) return;
      this.onmessage?.({
        data: JSON.stringify({
          type: "snapshot",
          product_id: "ETH-USD",
          bids: [["1999", "100"], ["1990", "50"]],
          asks: [["2001", "120"], ["2010", "60"]],
        }),
      });
    });
  }

  close() {
    if (this.readyState === FakeWebSocket.CLOSED) return;
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.();
  }
};

globalThis.fetch = async (input) => {
  assert.match(String(input), /^https:\/\/api\.binance\.com\/api\/v3\/depth\?symbol=ETHUSDT&limit=1000$/);
  return new Response(JSON.stringify({
    lastUpdateId: 100,
    bids: [["1999", "20"], ["1990", "5"]],
    asks: [["2001", "21"], ["2010", "6"]],
  }), {
    headers: { "content-type": "application/json" },
  });
};
