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

const tx22 = `0x${"22".repeat(32)}`;
const tx44 = `0x${"44".repeat(32)}`;
const txAA = `0x${"aa".repeat(32)}`;

test("SettlementEventService applies each chain event idempotently", () => {
  const inventory = new InventoryService();
  const settlements = new SettlementEventService(inventory);
  const input = {
    quoteId: "q_test",
    quote,
    txHash: tx22,
    logIndex: 7,
  };

  const first = settlements.applySettlementEvent(input);
  assert.equal(first.duplicate, false);
  assert.equal(first.event.status, "applied");
  assert.equal(first.event.settlementEventId, `se_1_${tx22.slice(2)}_7`);
  assert.equal(first.event.quoteId, "q_test");
  assert.equal(first.event.quoteHash, "0x4b1a6949619f6bafcefcde5376e278dd0eeff6a660a6cdccad19977866943d8e");
  assert.equal(first.event.blockNumber, 0);
  assert.equal(first.event.logIndex, 7);
  assert.equal(first.event.nonce, quote.nonce);
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
    txHash: tx44,
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

test("SettlementEventService lists settlement events in chain order", () => {
  const inventory = new InventoryService();
  const settlements = new SettlementEventService(inventory);

  const later = settlements.applySettlementEvent({
    quoteId: "q_later",
    quote: {
      ...quote,
      nonce: "2",
    },
    txHash: `0x${"77".repeat(32)}`,
    blockNumber: 12,
    logIndex: 0,
  });
  const earlier = settlements.applySettlementEvent({
    quoteId: "q_earlier",
    quote,
    txHash: `0x${"88".repeat(32)}`,
    blockNumber: 11,
    logIndex: 5,
  });
  const sameBlockNextLog = settlements.applySettlementEvent({
    quoteId: "q_same_block",
    quote: {
      ...quote,
      nonce: "3",
    },
    txHash: `0x${"99".repeat(32)}`,
    blockNumber: 11,
    logIndex: 6,
  });

  assert.deepEqual(
    settlements.listSettlementEvents().map((event) => event.settlementEventId),
    [
      earlier.event.settlementEventId,
      sameBlockNextLog.event.settlementEventId,
      later.event.settlementEventId,
    ],
  );
});

test("SettlementEventService finds settlement events by chain-scoped quote hash", () => {
  const inventory = new InventoryService();
  const settlements = new SettlementEventService(inventory);

  const later = settlements.applySettlementEvent({
    quoteId: "q_hash_later",
    quote,
    txHash: `0x${"71".repeat(32)}`,
    blockNumber: 12,
    logIndex: 0,
  });
  const earlier = settlements.applySettlementEvent({
    quoteId: "q_hash_earlier",
    quote,
    txHash: `0x${"72".repeat(32)}`,
    blockNumber: 11,
    logIndex: 5,
  });
  const unrelated = settlements.applySettlementEvent({
    quoteId: "q_hash_unrelated",
    quote: {
      ...quote,
      nonce: "2",
    },
    txHash: `0x${"73".repeat(32)}`,
    blockNumber: 10,
    logIndex: 0,
  });

  const uppercaseQuoteHash = `0x${later.event.quoteHash.slice(2).toUpperCase()}`;
  const matches = settlements.getSettlementEventsByQuoteHash({
    chainId: quote.chainId,
    quoteHash: uppercaseQuoteHash,
  });

  assert.deepEqual(
    matches.map((event) => event.settlementEventId),
    [earlier.event.settlementEventId, later.event.settlementEventId],
  );
  assert.deepEqual(
    settlements.getSettlementEventsByQuoteHash({
      chainId: quote.chainId,
      quoteHash: unrelated.event.quoteHash,
    }).map((event) => event.settlementEventId),
    [unrelated.event.settlementEventId],
  );
  assert.deepEqual(
    settlements.getSettlementEventsByQuoteHash({
      chainId: 2,
      quoteHash: later.event.quoteHash,
    }),
    [],
  );

  matches[0].quoteId = "q_mutated";
  assert.equal(settlements.getSettlementEvent(earlier.event.settlementEventId).quoteId, "q_hash_earlier");
});

test("SettlementEventService returns defensive copies of settlement events", () => {
  const inventory = new InventoryService();
  const settlements = new SettlementEventService(inventory);
  const applied = settlements.applySettlementEvent({
    quoteId: "q_defensive_copy",
    quote,
    txHash: `0x${"15".repeat(32)}`,
    blockNumber: 20,
    logIndex: 4,
  });

  applied.event.status = "removed";
  applied.event.txHash = `0x${"16".repeat(32)}`;
  applied.event.amountOut = "1";

  const loaded = settlements.getSettlementEvent(applied.event.settlementEventId);
  assert.equal(loaded.status, "applied");
  assert.equal(loaded.txHash, `0x${"15".repeat(32)}`);
  assert.equal(loaded.amountOut, quote.amountOut);

  loaded.status = "removed";
  const listed = settlements.listSettlementEvents();
  listed[0].txHash = `0x${"17".repeat(32)}`;

  const reloaded = settlements.getSettlementEvent(applied.event.settlementEventId);
  assert.equal(reloaded.status, "applied");
  assert.equal(reloaded.txHash, `0x${"15".repeat(32)}`);
});

test("SettlementEventService normalizes transaction hashes for idempotency", () => {
  const inventory = new InventoryService();
  const settlements = new SettlementEventService(inventory);
  const input = {
    quoteId: "q_test",
    quote,
    txHash: `0x${"AA".repeat(32)}`,
    logIndex: 1,
  };

  const first = settlements.applySettlementEvent(input);
  assert.equal(first.duplicate, false);
  assert.equal(first.event.txHash, txAA);
  assert.equal(first.event.settlementEventId, `se_1_${txAA.slice(2)}_1`);

  const replay = settlements.applySettlementEvent({
    ...input,
    txHash: `0x${"aa".repeat(32)}`,
  });
  assert.equal(replay.duplicate, true);
  assert.equal(replay.event.settlementEventId, first.event.settlementEventId);
  assert.equal(inventory.getPosition(quote.chainId, quote.tokenIn).balance, 1000n);
  assert.equal(inventory.getPosition(quote.chainId, quote.tokenOut).balance, -990n);
});

test("SettlementEventService keeps distinct events with the same tx hash prefix", () => {
  const inventory = new InventoryService();
  const settlements = new SettlementEventService(inventory);
  const firstTxHash = `0xabcdef12${"11".repeat(28)}`;
  const secondTxHash = `0xabcdef12${"22".repeat(28)}`;
  const secondQuote = {
    ...quote,
    amountIn: "2000",
    amountOut: "1980",
    minAmountOut: "1900",
    nonce: "2",
  };

  const first = settlements.applySettlementEvent({
    quoteId: "q_prefix_1",
    quote,
    txHash: firstTxHash,
    logIndex: 0,
  });
  const second = settlements.applySettlementEvent({
    quoteId: "q_prefix_2",
    quote: secondQuote,
    txHash: secondTxHash,
    logIndex: 0,
  });

  assert.equal(first.duplicate, false);
  assert.equal(second.duplicate, false);
  assert.notEqual(first.event.settlementEventId, second.event.settlementEventId);
  assert.equal(first.event.settlementEventId, `se_1_${firstTxHash.slice(2)}_0`);
  assert.equal(second.event.settlementEventId, `se_1_${secondTxHash.slice(2)}_0`);
  assert.deepEqual(settlements.getSettlementEvent(first.event.settlementEventId), first.event);
  assert.deepEqual(settlements.getSettlementEvent(second.event.settlementEventId), second.event);
  assert.equal(inventory.getPosition(quote.chainId, quote.tokenIn).balance, 3000n);
  assert.equal(inventory.getPosition(quote.chainId, quote.tokenOut).balance, -2970n);
});

test("hashSettlementQuote matches RFQSettlement.hashQuote struct hashing", () => {
  assert.equal(
    hashSettlementQuote(quote),
    "0x4b1a6949619f6bafcefcde5376e278dd0eeff6a660a6cdccad19977866943d8e",
  );
});