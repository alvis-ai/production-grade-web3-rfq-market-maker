import assert from "node:assert/strict";
import test from "node:test";
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

test("SkeletonExecutionService rejects malformed settlement verifier results before side effects", async () => {
  const scenarios = [
    {
      name: "non_object",
      result: undefined,
      message: /Execution service settlement verification result must be an object/,
    },
    {
      name: "inherited_fields",
      result: Object.create({
        status: "verified",
        verifierVersion: "bad-verifier",
        amountOut: request.quote.amountOut,
      }),
      message: /Execution service settlement verification result\.status must be an own field/,
    },
    {
      name: "unknown_field",
      result: {
        status: "verified",
        verifierVersion: "bad-verifier",
        amountOut: request.quote.amountOut,
        internalRoute: "bypass",
      },
      message: /Execution service settlement verification result must not include unknown field internalRoute/,
    },
    {
      name: "bad_status",
      result: {
        status: "pending",
        verifierVersion: "bad-verifier",
        amountOut: request.quote.amountOut,
      },
      message: /Execution service settlement verification status must be verified/,
    },
    {
      name: "blank_version",
      result: {
        status: "verified",
        verifierVersion: " ",
        amountOut: request.quote.amountOut,
      },
      message: /Execution service settlement verification verifierVersion must be a non-empty string/,
    },
    {
      name: "noncanonical_amount",
      result: {
        status: "verified",
        verifierVersion: "bad-verifier",
        amountOut: "0998400000",
      },
      message: /Execution service settlement verification amountOut must be a positive uint string/,
    },
    {
      name: "amount_mismatch",
      result: {
        status: "verified",
        verifierVersion: "bad-verifier",
        amountOut: "1",
      },
      message: /Execution service settlement verification amountOut must match quote amountOut/,
    },
  ];

  for (const scenario of scenarios) {
    const inventoryService = new InventoryService();
    const settlementEventService = new SettlementEventService(inventoryService);
    const executionService = new SkeletonExecutionService({
      hedgeService: new HedgeService(),
      inventoryService,
      settlementEventService,
      settlementVerifier: {
        async verify() {
          return scenario.result;
        },
      },
    });

    await assert.rejects(
      executionService.submitQuote(request, { quoteId: `q_bad_verifier_${scenario.name}` }),
      (error) => {
        assert.equal(error.code, "SETTLEMENT_UNAVAILABLE");
        assert.equal(error.statusCode, 503);
        assert.match(error.message, scenario.message);
        return true;
      },
    );
    assert.equal(inventoryService.getPosition(request.quote.chainId, request.quote.tokenIn).balance, 0n);
    assert.equal(inventoryService.getPosition(request.quote.chainId, request.quote.tokenOut).balance, 0n);
    assert.deepEqual(settlementEventService.listSettlementEvents(), []);
  }
});

test("SkeletonExecutionService rejects malformed settlement event results before follow-up side effects", async () => {
  const context = { quoteId: "q_bad_settlement_event_result" };
  const txHash = buildSyntheticTxHash(request, context);
  const validSettlementEvent = {
    settlementEventId: `se_${request.quote.chainId}_${txHash.slice(2)}_0`,
    status: "applied",
    quoteId: context.quoteId,
    chainId: request.quote.chainId,
    txHash,
    quoteHash: hashSettlementQuote(request.quote),
    blockNumber: 0,
    logIndex: 0,
    user: request.quote.user,
    tokenIn: request.quote.tokenIn,
    tokenOut: request.quote.tokenOut,
    amountIn: request.quote.amountIn,
    amountOut: request.quote.amountOut,
    nonce: request.quote.nonce,
    observedAt: "2026-01-01T00:00:00.000Z",
  };
  const validResult = {
    event: validSettlementEvent,
    duplicate: false,
  };
  const malformedResults = [
    undefined,
    Object.create(validResult),
    { ...validResult, internalState: "unsafe" },
    { event: validSettlementEvent, duplicate: "false" },
    { duplicate: false },
    { event: Object.create(validSettlementEvent), duplicate: false },
    { event: { ...validSettlementEvent, internalState: "unsafe" }, duplicate: false },
    { event: { ...validSettlementEvent, status: "pending" }, duplicate: false },
    { event: { ...validSettlementEvent, settlementEventId: "bad.event" }, duplicate: false },
    { event: { ...validSettlementEvent, settlementEventId: `se_${request.quote.chainId}_${txHash.slice(2)}_1` }, duplicate: false },
    { event: { ...validSettlementEvent, quoteId: "q_other" }, duplicate: false },
    { event: { ...validSettlementEvent, chainId: 2 }, duplicate: false },
    { event: { ...validSettlementEvent, txHash: `0x${"22".repeat(32)}` }, duplicate: false },
    { event: { ...validSettlementEvent, quoteHash: `0x${"33".repeat(32)}` }, duplicate: false },
    { event: { ...validSettlementEvent, blockNumber: "0" }, duplicate: false },
    { event: { ...validSettlementEvent, logIndex: 1 }, duplicate: false },
    { event: { ...validSettlementEvent, user: request.quote.tokenIn }, duplicate: false },
    { event: { ...validSettlementEvent, amountOut: "0998400000" }, duplicate: false },
    { event: { ...validSettlementEvent, amountOut: "1" }, duplicate: false },
    { event: { ...validSettlementEvent, nonce: "43" }, duplicate: false },
    { event: { ...validSettlementEvent, observedAt: "2026-01-01T00:00:00Z" }, duplicate: false },
  ];

  for (const malformedResult of malformedResults) {
    let inventoryReads = 0;
    let hedgeAttempts = 0;
    const executionService = new SkeletonExecutionService({
      hedgeService: {
        createHedgeIntent() {
          hedgeAttempts += 1;
          throw new Error("hedge should not be called for malformed settlement event results");
        },
      },
      inventoryService: {
        getPosition() {
          inventoryReads += 1;
          throw new Error("inventory should not be read for malformed settlement event results");
        },
      },
      settlementEventService: {
        applySettlementEvent() {
          return malformedResult;
        },
      },
      settlementVerifier: new LocalSettlementVerifier(),
    });

    await assert.rejects(
      executionService.submitQuote(request, context),
      (error) => {
        assert.equal(error.code, "SETTLEMENT_EVENT_STORE_UNAVAILABLE");
        assert.equal(error.statusCode, 503);
        return true;
      },
    );
    assert.equal(inventoryReads, 0);
    assert.equal(hedgeAttempts, 0);
  }
});
