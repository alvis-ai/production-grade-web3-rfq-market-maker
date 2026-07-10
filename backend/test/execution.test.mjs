import assert from "node:assert/strict";
import test from "node:test";
import { keccak256, toBytes } from "viem";
import { buildSyntheticTxHash, SkeletonExecutionService } from "../dist/modules/execution/execution.service.js";
import { HedgeService } from "../dist/modules/hedge/hedge.service.js";
import { InventoryService } from "../dist/modules/inventory/inventory.service.js";
import { hashSettlementQuote, SettlementEventService } from "../dist/modules/settlement/settlement-event.service.js";
import { LocalSettlementVerifier } from "../dist/modules/settlement/settlement-verifier.service.js";
import { LocalEIP712SignerService } from "../dist/modules/signer/signer.service.js";

const executionQuote = {
  user: "0x0000000000000000000000000000000000000001",
  tokenIn: "0x0000000000000000000000000000000000000002",
  tokenOut: "0x0000000000000000000000000000000000000003",
  amountIn: "1000000000",
  amountOut: "998400000",
  minAmountOut: "993408000",
  nonce: "42",
  deadline: 1893456000,
  chainId: 1,
};

const request = {
  quote: executionQuote,
  signature: await new LocalEIP712SignerService({
    privateKey: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
    settlementAddress: "0x0000000000000000000000000000000000000004",
  }).signQuote({
    quote: executionQuote,
    quoteId: "q_test",
    snapshotId: "snapshot_test",
  }),
};

test("buildSyntheticTxHash returns deterministic keccak256 bytes32 hashes", () => {
  const context = { quoteId: "q_test" };
  const expectedPayload = JSON.stringify({
    quoteId: context.quoteId,
    quote: request.quote,
    signature: request.signature,
  });
  const expectedHash = keccak256(toBytes(expectedPayload));

  const txHash = buildSyntheticTxHash(request, context);

  assert.match(txHash, /^0x[0-9a-f]{64}$/);
  assert.equal(txHash, expectedHash);
  assert.throws(
    () => buildSyntheticTxHash({ ...request, txHash }, context),
    /does not accept txHash/,
  );
});
test("SkeletonExecutionService suppresses duplicate settlement side effects", async () => {
  const inventoryService = new InventoryService();
  const hedgeService = new HedgeService();
  const settlementEventService = new SettlementEventService(inventoryService);
  const executionService = new SkeletonExecutionService({
    hedgeService,
    inventoryService,
    settlementEventService,
    settlementVerifier: new LocalSettlementVerifier(),
  });
  const context = { quoteId: "q_test" };

  const first = await executionService.submitQuote(request, context);
  assert.equal(first.response.status, "accepted");
  assert.equal(first.settlementEventResult.duplicate, false);
  assert.match(first.response.settlementEventId, /^se_/);
  assert.match(first.response.hedgeOrderId, /^h_/);
  assert.equal(first.hedgeResult?.record.settlementEventId, first.response.settlementEventId);
  assert.equal(first.inventoryPositions.tokenIn.balance, BigInt(request.quote.amountIn));
  assert.equal(first.inventoryPositions.tokenOut.balance, -BigInt(request.quote.amountOut));

  const replay = await executionService.submitQuote(request, context);
  assert.equal(replay.response.status, "accepted");
  assert.equal(replay.response.txHash, first.response.txHash);
  assert.equal(replay.response.settlementEventId, first.response.settlementEventId);
  assert.equal(replay.response.hedgeOrderId, undefined);
  assert.equal(replay.hedgeResult, undefined);
  assert.equal(replay.hedgeFailure, undefined);
  assert.equal(replay.settlementEventResult.duplicate, true);
  assert.equal(inventoryService.getPosition(request.quote.chainId, request.quote.tokenIn).balance, BigInt(request.quote.amountIn));
  assert.equal(inventoryService.getPosition(request.quote.chainId, request.quote.tokenOut).balance, -BigInt(request.quote.amountOut));
  const storedHedge = hedgeService.getHedgeIntent(first.response.hedgeOrderId);
  assert.deepEqual(storedHedge, first.hedgeResult?.record);
  assert.notEqual(storedHedge, first.hedgeResult?.record);
});

test("SkeletonExecutionService snapshots dependency object at construction", async () => {
  const inventoryService = new InventoryService();
  const replacementInventoryService = new InventoryService();
  const deps = {
    hedgeService: new HedgeService(),
    inventoryService,
    settlementEventService: new SettlementEventService(inventoryService),
    settlementVerifier: new LocalSettlementVerifier(),
  };
  const executionService = new SkeletonExecutionService(deps);

  deps.hedgeService = {
    createHedgeIntent() {
      throw new Error("mutated hedge service used");
    },
    getHedgeIntent() {
      return undefined;
    },
    getHedgeIntentBySettlementEvent() {
      return undefined;
    },
  };
  deps.inventoryService = replacementInventoryService;
  deps.settlementEventService = new SettlementEventService(replacementInventoryService);
  deps.settlementVerifier = {
    async verify() {
      throw new Error("mutated settlement verifier used");
    },
  };

  const result = await executionService.submitQuote(request, { quoteId: "q_snapshot_deps" });

  assert.equal(result.settlementVerification.status, "verified");
  assert.equal(result.response.status, "accepted");
  assert.match(result.response.hedgeOrderId, /^h_/);
  assert.equal(inventoryService.getPosition(request.quote.chainId, request.quote.tokenIn).balance, BigInt(request.quote.amountIn));
  assert.equal(replacementInventoryService.getPosition(request.quote.chainId, request.quote.tokenIn).balance, 0n);
});


test("SkeletonExecutionService treats malformed hedge results as post-settlement hedge failures", async () => {
  const malformedHedgeResultBuilders = [
    () => undefined,
    (validResult) => Object.create(validResult),
    (validResult) => ({ ...validResult, internalState: "unsafe" }),
    (validResult) => ({ ...validResult, status: "submitted" }),
    (validResult) => ({ ...validResult, hedgeOrderId: "h.bad" }),
    (validResult) => ({ ...validResult, record: undefined }),
    (validResult) => ({ ...validResult, record: Object.create(validResult.record) }),
    (validResult) => ({ ...validResult, record: { ...validResult.record, internalState: "unsafe" } }),
    (validResult) => ({ ...validResult, record: { ...validResult.record, hedgeOrderId: "h_other" } }),
    (validResult) => ({ ...validResult, record: { ...validResult.record, status: "filled" } }),
    (validResult) => ({ ...validResult, record: { ...validResult.record, settlementEventId: "se_other" } }),
    (validResult) => ({ ...validResult, record: { ...validResult.record, quoteId: "q_other" } }),
    (validResult) => ({ ...validResult, record: { ...validResult.record, chainId: 2 } }),
    (validResult) => ({ ...validResult, record: { ...validResult.record, token: request.quote.tokenIn } }),
    (validResult) => ({ ...validResult, record: { ...validResult.record, side: "sell" } }),
    (validResult) => ({ ...validResult, record: { ...validResult.record, amount: "0998400000" } }),
    (validResult) => ({ ...validResult, record: { ...validResult.record, amount: "1" } }),
    (validResult) => ({ ...validResult, record: { ...validResult.record, reason: "risk_reduction" } }),
    (validResult) => ({ ...validResult, record: { ...validResult.record, createdAt: "2026-01-01T00:00:00Z" } }),
  ];

  for (let index = 0; index < malformedHedgeResultBuilders.length; index += 1) {
    const inventoryService = new InventoryService();
    const context = { quoteId: `q_bad_hedge_result_${index}` };
    let hedgeFailures = 0;
    const executionService = new SkeletonExecutionService({
      hedgeService: {
        createHedgeIntent(intent) {
          const validRecord = {
            hedgeOrderId: "h_valid",
            status: "queued",
            settlementEventId: intent.settlementEventId,
            quoteId: intent.quoteId,
            chainId: intent.chainId,
            token: intent.token,
            side: intent.side,
            amount: intent.amount,
            reason: intent.reason,
            createdAt: "2026-01-01T00:00:00.000Z",
          };
          const validResult = {
            status: "queued",
            hedgeOrderId: validRecord.hedgeOrderId,
            record: validRecord,
          };

          return malformedHedgeResultBuilders[index](validResult);
        },
        recordHedgeFailure(_intent, reasonCode) {
          assert.equal(reasonCode, "HEDGE_INTENT_FAILED");
          hedgeFailures += 1;
        },
      },
      inventoryService,
      settlementEventService: new SettlementEventService(inventoryService),
      settlementVerifier: new LocalSettlementVerifier(),
    });

    const result = await executionService.submitQuote(request, context);

    assert.equal(result.response.status, "accepted");
    assert.match(result.response.settlementEventId, /^se_/);
    assert.equal(result.response.hedgeOrderId, undefined);
    assert.equal(result.hedgeResult, undefined);
    assert.equal(result.hedgeFailure?.reasonCode, "HEDGE_INTENT_FAILED");
    assert.equal(hedgeFailures, 1);
    assert.equal(result.inventoryPositions.tokenIn.balance, BigInt(request.quote.amountIn));
    assert.equal(result.inventoryPositions.tokenOut.balance, -BigInt(request.quote.amountOut));
  }
});

test("SkeletonExecutionService treats malformed inventory position reads as metric-only unavailable", async () => {
  const validTokenInPosition = {
    chainId: request.quote.chainId,
    token: request.quote.tokenIn,
    balance: BigInt(request.quote.amountIn),
  };
  const validTokenOutPosition = {
    chainId: request.quote.chainId,
    token: request.quote.tokenOut,
    balance: -BigInt(request.quote.amountOut),
  };
  const malformedPositionPairs = [
    { tokenIn: undefined, tokenOut: validTokenOutPosition },
    { tokenIn: Object.create(validTokenInPosition), tokenOut: validTokenOutPosition },
    { tokenIn: { ...validTokenInPosition, internalState: "unsafe" }, tokenOut: validTokenOutPosition },
    { tokenIn: { ...validTokenInPosition, chainId: "1" }, tokenOut: validTokenOutPosition },
    { tokenIn: { ...validTokenInPosition, token: request.quote.tokenOut }, tokenOut: validTokenOutPosition },
    { tokenIn: { ...validTokenInPosition, balance: "1000000000" }, tokenOut: validTokenOutPosition },
    { tokenIn: validTokenInPosition, tokenOut: { ...validTokenOutPosition, token: request.quote.tokenIn } },
    { tokenIn: validTokenInPosition, tokenOut: { ...validTokenOutPosition, balance: "0" } },
  ];

  for (const positions of malformedPositionPairs) {
    const settlementInventory = new InventoryService();
    const hedgeService = new HedgeService();
    const executionService = new SkeletonExecutionService({
      hedgeService,
      inventoryService: {
        getPosition(_chainId, token) {
          return token.toLowerCase() === request.quote.tokenIn.toLowerCase() ? positions.tokenIn : positions.tokenOut;
        },
      },
      settlementEventService: new SettlementEventService(settlementInventory),
      settlementVerifier: new LocalSettlementVerifier(),
    });

    const result = await executionService.submitQuote(request, {
      quoteId: `q_bad_inventory_position_${malformedPositionPairs.indexOf(positions)}`,
    });

    assert.equal(result.response.status, "accepted");
    assert.match(result.response.settlementEventId, /^se_/);
    assert.match(result.response.hedgeOrderId, /^h_/);
    assert.equal(result.inventoryPositions, undefined);
    assert.equal(result.hedgeResult?.record.settlementEventId, result.response.settlementEventId);
    assert.equal(settlementInventory.getPosition(request.quote.chainId, request.quote.tokenIn).balance, BigInt(request.quote.amountIn));
    assert.equal(settlementInventory.getPosition(request.quote.chainId, request.quote.tokenOut).balance, -BigInt(request.quote.amountOut));
  }
});
