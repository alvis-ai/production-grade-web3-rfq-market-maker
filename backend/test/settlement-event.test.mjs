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

test("SettlementEventService rejects unsafe quote hash lookup envelopes", () => {
  const inventory = new InventoryService();
  const settlements = new SettlementEventService(inventory);
  const quoteHash = hashSettlementQuote(quote);

  assert.throws(
    () => settlements.getSettlementEventsByQuoteHash([]),
    /Settlement event quote hash lookup input must be an object/,
  );
  assert.throws(
    () =>
      settlements.getSettlementEventsByQuoteHash(
        Object.create({
          chainId: quote.chainId,
          quoteHash,
        }),
      ),
    /Settlement event quote hash lookup input.chainId must be an own field/,
  );

  const inheritedQuoteHashInput = Object.create({ quoteHash });
  Object.assign(inheritedQuoteHashInput, { chainId: quote.chainId });
  assert.throws(
    () => settlements.getSettlementEventsByQuoteHash(inheritedQuoteHashInput),
    /Settlement event quote hash lookup input.quoteHash must be an own field/,
  );

  assert.throws(
    () =>
      settlements.getSettlementEventsByQuoteHash({
        chainId: 0,
        quoteHash,
      }),
    /Settlement event lookup.chainId must be a positive safe integer/,
  );
  assert.throws(
    () =>
      settlements.getSettlementEventsByQuoteHash({
        chainId: quote.chainId,
        quoteHash: "0x1234",
      }),
    /Settlement event quoteHash must be a 32-byte hex string/,
  );
  assert.throws(
    () =>
      settlements.getSettlementEventsByQuoteHash({
        chainId: quote.chainId,
        quoteHash: new String(quoteHash),
      }),
    /Settlement event quoteHash must be a 32-byte hex string/,
  );
});

test("SettlementEventService rejects unsafe settlement event lookup identifiers", () => {
  const inventory = new InventoryService();
  const settlements = new SettlementEventService(inventory);

  assert.throws(
    () => settlements.getSettlementEvent(" "),
    /Settlement event settlementEventId must be a non-empty string/,
  );
  assert.throws(
    () => settlements.getSettlementEvent(new String("se_lookup")),
    /Settlement event settlementEventId must be a primitive string/,
  );
  assert.throws(
    () => settlements.getSettlementEvent("se/bad"),
    /Settlement event settlementEventId must contain only letters, numbers, underscore, colon, or hyphen/,
  );
  assert.throws(
    () => settlements.getSettlementEvent("s".repeat(129)),
    /Settlement event settlementEventId must be 128 characters or fewer/,
  );

  const applied = settlements.applySettlementEvent({
    quoteId: "q_lookup",
    quote,
    txHash: `0x${"21".repeat(32)}`,
  });
  assert.deepEqual(settlements.getSettlementEvent(applied.event.settlementEventId), applied.event);
});

test("SettlementEventService rejects unsafe inventory dependency at construction", () => {
  assert.throws(
    () => new SettlementEventService(undefined),
    /Settlement event inventoryService must be an object/,
  );
  assert.throws(
    () => new SettlementEventService([]),
    /Settlement event inventoryService must be an object/,
  );
  assert.throws(
    () =>
      new SettlementEventService({
        rebuildFromSettlements() {},
      }),
    /Settlement event inventoryService.applySettlement must be a function/,
  );
  assert.throws(
    () =>
      new SettlementEventService({
        applySettlement() {},
      }),
    /Settlement event inventoryService.rebuildFromSettlements must be a function/,
  );
});

test("SettlementEventService rejects malformed event payload envelopes before side effects", () => {
  const inventory = new InventoryService();
  const settlements = new SettlementEventService(inventory);

  assert.throws(
    () => settlements.applySettlementEvent([]),
    /Settlement event input must be an object/,
  );
  assert.throws(
    () =>
      settlements.applySettlementEvent({
        quoteId: "q_array_quote",
        quote: [],
        txHash: `0x${"18".repeat(32)}`,
      }),
    /Settlement event quote must be an object/,
  );

  assert.throws(
    () =>
      settlements.applySettlementEvent(
        Object.create({
          quoteId: "q_inherited_root",
          quote,
          txHash: `0x${"18".repeat(32)}`,
        }),
      ),
    /Settlement event input.quoteId must be an own field/,
  );

  assert.throws(
    () =>
      settlements.applySettlementEvent({
        quoteId: "q_inherited_quote",
        quote: Object.create(quote),
        txHash: `0x${"18".repeat(32)}`,
      }),
    /Settlement event quote.user must be an own field/,
  );

  const inheritedLogIndexInput = Object.create({ logIndex: 1 });
  Object.assign(inheritedLogIndexInput, {
    quoteId: "q_inherited_log_index",
    quote,
    txHash: `0x${"18".repeat(32)}`,
  });
  assert.throws(
    () => settlements.applySettlementEvent(inheritedLogIndexInput),
    /Settlement event input.logIndex must be an own field when provided/,
  );

  assert.equal(inventory.getPosition(quote.chainId, quote.tokenIn).balance, 0n);
  assert.equal(inventory.getPosition(quote.chainId, quote.tokenOut).balance, 0n);

  const applied = settlements.applySettlementEvent({
    quoteId: "q_reorg_array",
    quote,
    txHash: `0x${"19".repeat(32)}`,
    blockNumber: 40,
    logIndex: 0,
  });

  assert.throws(
    () => settlements.removeSettlementEvent([]),
    /Settlement event reorg input must be an object/,
  );

  const inheritedReorgInput = Object.create({ txHash: applied.event.txHash });
  Object.assign(inheritedReorgInput, {
    chainId: quote.chainId,
    blockNumber: applied.event.blockNumber,
    logIndex: applied.event.logIndex,
  });
  assert.throws(
    () => settlements.removeSettlementEvent(inheritedReorgInput),
    /Settlement event reorg input.txHash must be an own field/,
  );

  assert.deepEqual(settlements.getSettlementEvent(applied.event.settlementEventId), applied.event);
  assert.equal(inventory.getPosition(quote.chainId, quote.tokenIn).balance, 1000n);
  assert.equal(inventory.getPosition(quote.chainId, quote.tokenOut).balance, -990n);
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

test("SettlementEventService rejects conflicting events for an already settled quote", () => {
  const inventory = new InventoryService();
  const settlements = new SettlementEventService(inventory);
  const first = settlements.applySettlementEvent({
    quoteId: "q_single_settlement",
    quote,
    txHash: `0x${"13".repeat(32)}`,
    logIndex: 0,
  });

  assert.throws(
    () =>
      settlements.applySettlementEvent({
        quoteId: "q_single_settlement",
        quote,
        txHash: `0x${"14".repeat(32)}`,
        logIndex: 1,
      }),
    /Settlement event quote conflict/,
  );
  assert.equal(inventory.getPosition(quote.chainId, quote.tokenIn).balance, 1000n);
  assert.equal(inventory.getPosition(quote.chainId, quote.tokenOut).balance, -990n);
  assert.deepEqual(settlements.getSettlementEvent(first.event.settlementEventId), first.event);
});

test("SettlementEventService rejects invalid transaction hashes before side effects", () => {
  for (const txHash of ["0x1234", `0x${"gg".repeat(32)}`, new String(`0x${"55".repeat(32)}`)]) {
    const inventory = new InventoryService();
    const settlements = new SettlementEventService(inventory);

    assert.throws(
      () =>
        settlements.applySettlementEvent({
          quoteId: "q_test",
          quote,
          txHash,
        }),
      /Settlement event txHash must be a 32-byte hex string/,
    );
    assert.equal(inventory.getPosition(quote.chainId, quote.tokenIn).balance, 0n);
    assert.equal(inventory.getPosition(quote.chainId, quote.tokenOut).balance, 0n);
  }
});

test("SettlementEventService rejects invalid chain event ordinals before side effects", () => {
  for (const invalidInput of [
    { logIndex: -1 },
    { logIndex: 1.5 },
    { blockNumber: -1 },
    { blockNumber: Number.MAX_SAFE_INTEGER + 1 },
  ]) {
    const inventory = new InventoryService();
    const settlements = new SettlementEventService(inventory);

    assert.throws(
      () =>
        settlements.applySettlementEvent({
          quoteId: "q_test",
          quote,
          txHash: `0x${"55".repeat(32)}`,
          ...invalidInput,
        }),
      /Settlement event (logIndex|blockNumber) must be a non-negative safe integer/,
    );
    assert.equal(inventory.getPosition(quote.chainId, quote.tokenIn).balance, 0n);
    assert.equal(inventory.getPosition(quote.chainId, quote.tokenOut).balance, 0n);
  }
});

test("SettlementEventService rejects unsafe settlement quote inputs before side effects", () => {
  const invalidInputs = [
    [undefined, /Settlement event input must be an object/],
    [{ quoteId: " " }, /Settlement event quoteId must be a non-empty string/],
    [{ quoteId: new String("q_test") }, /Settlement event quoteId must be a primitive string/],
    [
      { quoteId: "q.bad" },
      /Settlement event quoteId must contain only letters, numbers, underscore, colon, or hyphen/,
    ],
    [{ quoteId: "q".repeat(129) }, /Settlement event quoteId must be 128 characters or fewer/],
    [{ quote: undefined }, /Settlement event quote must be an object/],
    [{ quote: { ...quote, chainId: 0 } }, /Settlement event quote.chainId must be a positive safe integer/],
    [{ quote: { ...quote, user: "0x1234" } }, /Settlement event quote.user must be a 20-byte hex address/],
    [{ quote: { ...quote, tokenOut: quote.tokenIn } }, /Settlement event quote token pair must contain distinct tokens/],
    [{ quote: { ...quote, amountIn: "0" } }, /Settlement event quote.amountIn must be a positive uint string/],
    [{ quote: { ...quote, amountIn: "01000" } }, /Settlement event quote.amountIn must be a positive uint string/],
    [{ quote: { ...quote, amountOut: "0990" } }, /Settlement event quote.amountOut must be a positive uint string/],
    [{ quote: { ...quote, minAmountOut: "0980" } }, /Settlement event quote.minAmountOut must be a positive uint string/],
    [{ quote: { ...quote, amountOut: "979" } }, /Settlement event quote.amountOut must be greater than or equal to quote.minAmountOut/],
    [{ quote: { ...quote, nonce: "not-a-uint" } }, /Settlement event quote.nonce must be a uint string/],
    [{ quote: { ...quote, nonce: "0" } }, /Settlement event quote.nonce must be a positive uint string/],
    [{ quote: { ...quote, nonce: "01" } }, /Settlement event quote.nonce must be a positive uint string/],
    [{ quote: { ...quote, deadline: Number.MAX_SAFE_INTEGER + 1 } }, /Settlement event quote.deadline must be a positive safe integer/],
  ];

  for (const [invalidInput, expectedError] of invalidInputs) {
    const inventory = new InventoryService();
    const settlements = new SettlementEventService(inventory);

    assert.throws(
      () =>
        settlements.applySettlementEvent(
          invalidInput === undefined
            ? undefined
            : {
                quoteId: "q_test",
                quote,
                txHash: `0x${"66".repeat(32)}`,
                ...invalidInput,
              },
        ),
      expectedError,
    );
    assert.equal(inventory.getPosition(quote.chainId, quote.tokenIn).balance, 0n);
    assert.equal(inventory.getPosition(quote.chainId, quote.tokenOut).balance, 0n);
  }
});

test("hashSettlementQuote matches RFQSettlement.hashQuote struct hashing", () => {
  assert.equal(
    hashSettlementQuote(quote),
    "0x4b1a6949619f6bafcefcde5376e278dd0eeff6a660a6cdccad19977866943d8e",
  );
});

test("hashSettlementQuote rejects malformed quote fields before ABI encoding", () => {
  assert.throws(
    () => hashSettlementQuote([]),
    /Settlement event quote must be an object/,
  );
  assert.throws(
    () =>
      hashSettlementQuote({
        ...quote,
        tokenOut: "0x1234",
      }),
    /Settlement event quote.tokenOut must be a 20-byte hex address/,
  );
  assert.throws(
    () => hashSettlementQuote(Object.create(quote)),
    /Settlement event quote.user must be an own field/,
  );
});

test("SettlementEventService rejects conflicting payloads for an existing chain event key", () => {
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

  assert.throws(
    () =>
      settlements.applySettlementEvent({
        ...input,
        quoteId: "q_conflict",
        quote: {
          ...quote,
          amountOut: "985",
        },
      }),
    /Settlement event key conflict/,
  );
  assert.equal(inventory.getPosition(quote.chainId, quote.tokenIn).balance, 1000n);
  assert.equal(inventory.getPosition(quote.chainId, quote.tokenOut).balance, -990n);
});
