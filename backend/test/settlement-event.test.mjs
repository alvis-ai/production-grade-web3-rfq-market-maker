import assert from "node:assert/strict";
import test from "node:test";
import { InventoryService } from "../dist/modules/inventory/inventory.service.js";
import {
  hashSettlementQuote,
  SettlementEventService,
} from "../dist/modules/settlement/settlement-event.service.js";

const quote = {
  user: "0x0000000000000000000000000000000000000001",
  tokenIn: "0x0000000000000000000000000000000000000002",
  tokenOut: "0x0000000000000000000000000000000000000003",
  amountIn: "1000",
  amountOut: "990",
  minAmountOut: "980",
  nonce: "1",
  deadline: 1893456000,
  chainId: 1,
};

test("SettlementEventService applies each chain event idempotently", () => {
  const inventory = new InventoryService();
  const settlements = new SettlementEventService(inventory);
  const input = {
    quoteId: "q_test",
    quote,
    txHash: `0x${"22".repeat(32)}`,
    logIndex: 7,
  };

  const first = settlements.applySettlementEvent(input);
  assert.equal(first.duplicate, false);
  assert.equal(first.event.status, "applied");
  assert.equal(first.event.settlementEventId, "se_1_22222222_7");
  assert.equal(first.event.quoteId, "q_test");
  assert.equal(first.event.quoteHash, "0x4b1a6949619f6bafcefcde5376e278dd0eeff6a660a6cdccad19977866943d8e");
  assert.equal(first.event.blockNumber, 0);
  assert.equal(first.event.logIndex, 7);
  assert.equal(inventory.getPosition(quote.chainId, quote.tokenIn).balance, 1000n);
  assert.equal(inventory.getPosition(quote.chainId, quote.tokenOut).balance, -990n);

  const replay = settlements.applySettlementEvent(input);
  assert.equal(replay.duplicate, true);
  assert.equal(replay.event.settlementEventId, first.event.settlementEventId);
  assert.equal(inventory.getPosition(quote.chainId, quote.tokenIn).balance, 1000n);
  assert.equal(inventory.getPosition(quote.chainId, quote.tokenOut).balance, -990n);

  assert.deepEqual(settlements.getSettlementEvent(first.event.settlementEventId), first.event);
});

test("SettlementEventService persists explicit chain block numbers", () => {
  const inventory = new InventoryService();
  const settlements = new SettlementEventService(inventory);
  const input = {
    quoteId: "q_test",
    quote,
    txHash: `0x${"44".repeat(32)}`,
    blockNumber: 123456,
    logIndex: 3,
  };

  const first = settlements.applySettlementEvent(input);
  assert.equal(first.duplicate, false);
  assert.equal(first.event.blockNumber, 123456);

  const replay = settlements.applySettlementEvent(input);
  assert.equal(replay.duplicate, true);
  assert.equal(replay.event.blockNumber, 123456);
});

test("hashSettlementQuote matches RFQSettlement.hashQuote struct hashing", () => {
  assert.equal(
    hashSettlementQuote(quote),
    "0x4b1a6949619f6bafcefcde5376e278dd0eeff6a660a6cdccad19977866943d8e",
  );
});

test("SettlementEventService rejects conflicting payloads for an existing chain event key", () => {
  const inventory = new InventoryService();
  const settlements = new SettlementEventService(inventory);
  const input = {
    quoteId: "q_test",
    quote,
    txHash: `0x${"22".repeat(32)}`,
    logIndex: 7,
  };

  const first = settlements.applySettlementEvent(input);
  assert.equal(first.duplicate, false);

  assert.throws(
    () =>
      settlements.applySettlementEvent({
        ...input,
        quoteId: "q_conflict",
        quote: {
          ...quote,
          amountOut: "900",
        },
      }),
    /Settlement event key conflict/,
  );
  assert.equal(inventory.getPosition(quote.chainId, quote.tokenIn).balance, 1000n);
  assert.equal(inventory.getPosition(quote.chainId, quote.tokenOut).balance, -990n);
});
