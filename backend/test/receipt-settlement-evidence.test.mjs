import assert from "node:assert/strict";
import test from "node:test";
import { encodeAbiParameters, encodeEventTopics, encodeFunctionData, parseAbiItem } from "viem";
import {
  parseReceiptExecutionConfig,
  ReceiptSettlementEvidenceProvider,
  RuntimeSettlementEvidenceProvider,
} from "../dist/modules/execution/receipt-settlement-evidence.provider.js";
import { hashSettlementQuote } from "../dist/modules/settlement/settlement-event.service.js";

const user = "0x0000000000000000000000000000000000000001";
const tokenIn = "0x0000000000000000000000000000000000000002";
const tokenOut = "0x0000000000000000000000000000000000000003";
const settlementAddress = "0x0000000000000000000000000000000000000004";
const txHash = `0x${"ab".repeat(32)}`;
const signature = `0x${"11".repeat(32)}${"22".repeat(32)}1b`;
const quoteSettledEventAbi = [parseAbiItem(
  "event QuoteSettled(bytes32 indexed quoteHash, address indexed user, address indexed tokenIn, address tokenOut, uint256 amountIn, uint256 amountOut, uint256 nonce)",
)];
const submitQuoteFunctionAbi = [parseAbiItem(
  "function submitQuote((address user, address tokenIn, address tokenOut, uint256 amountIn, uint256 amountOut, uint256 minAmountOut, uint256 nonce, uint256 deadline, uint256 chainId) quote, bytes signature) returns (uint256 amountOut)",
)];
const quote = {
  user,
  tokenIn,
  tokenOut,
  amountIn: "1000",
  amountOut: "990",
  minAmountOut: "980",
  nonce: "7",
  deadline: 4_102_444_800,
  chainId: 1,
};
const request = { quote, signature, txHash };

test("ReceiptSettlementEvidenceProvider verifies sender, target, receipt, and QuoteSettled event", async () => {
  const reader = new FakeReceiptReader(validReceipt(), validTransaction());
  const provider = new ReceiptSettlementEvidenceProvider(validConfig(), () => reader);
  const evidence = await provider.resolve(request);

  assert.deepEqual(evidence, { txHash, blockNumber: 123, logIndex: 4 });
  assert.deepEqual(reader.waitInput, { txHash, confirmations: 2, timeoutMs: 30_000 });
});

test("ReceiptSettlementEvidenceProvider rejects untrusted or conflicting chain evidence", async () => {
  const cases = [
    [validReceipt({ status: "reverted" }), validTransaction(), /transaction reverted/],
    [validReceipt(), validTransaction({ from: tokenOut }), /sender does not match/],
    [validReceipt(), validTransaction({ to: tokenOut }), /target does not match/],
    [validReceipt(), validTransaction({ input: "0x1234" }), /calldata does not match/],
    [validReceipt({ logs: [] }), validTransaction(), /event was not found/],
    [validReceipt({ logs: [quoteSettledLog({ quoteHash: `0x${"cd".repeat(32)}` })] }), validTransaction(), /event was not found/],
  ];

  for (const [receipt, transaction, expected] of cases) {
    const provider = new ReceiptSettlementEvidenceProvider(
      validConfig(),
      () => new FakeReceiptReader(receipt, transaction),
    );
    await assert.rejects(provider.resolve(request), expected);
  }
});

test("ReceiptSettlementEvidenceProvider maps RPC failures to settlement unavailable", async () => {
  const provider = new ReceiptSettlementEvidenceProvider(validConfig(), () => ({
    async waitForTransactionReceipt() { throw new Error("rpc offline"); },
    async getTransaction() { throw new Error("not reached"); },
  }));

  await assert.rejects(
    provider.resolve(request),
    (error) => error.code === "SETTLEMENT_UNAVAILABLE" && error.statusCode === 503,
  );
});

test("RuntimeSettlementEvidenceProvider requires txHash when simulation is disabled", async () => {
  const simulated = new RuntimeSettlementEvidenceProvider({ chains: [] }, true);
  const evidence = await simulated.resolve({ quote, signature }, { quoteId: "q_receipt_1" });
  assert.match(evidence.txHash, /^0x[0-9a-f]{64}$/);
  assert.equal(evidence.blockNumber, 0);

  const confirmedOnly = new RuntimeSettlementEvidenceProvider({ chains: [] }, false);
  await assert.rejects(
    confirmedOnly.resolve({ quote, signature }, { quoteId: "q_receipt_1" }),
    /txHash is required/,
  );
});

test("receipt execution config rejects malformed, duplicate, or unsafe chains", () => {
  assert.deepEqual(parseReceiptExecutionConfig(undefined), { chains: [] });
  assert.throws(() => parseReceiptExecutionConfig("{"), /valid JSON/);
  assert.throws(
    () => parseReceiptExecutionConfig(JSON.stringify({ chains: [{ ...validConfig().chains[0], confirmations: 0 }] })),
    /confirmations/,
  );
  assert.throws(
    () => parseReceiptExecutionConfig(JSON.stringify({ chains: [validConfig().chains[0], validConfig().chains[0]] })),
    /duplicate chain IDs/,
  );
  assert.throws(
    () => parseReceiptExecutionConfig(JSON.stringify({ chains: [{ ...validConfig().chains[0], rpcUrl: "https://user:secret@rpc.example.com" }] })),
    /absolute HTTP/,
  );
});

function validConfig() {
  return {
    chains: [{
      chainId: 1,
      rpcUrl: "https://rpc.example.com/v1/key",
      settlementAddress,
      confirmations: 2,
      receiptTimeoutMs: 30_000,
    }],
  };
}

function validReceipt(overrides = {}) {
  return {
    status: "success",
    transactionHash: txHash,
    blockNumber: 123n,
    logs: [quoteSettledLog()],
    ...overrides,
  };
}

function validTransaction(overrides = {}) {
  return {
    hash: txHash,
    from: user,
    to: settlementAddress,
    input: encodeFunctionData({
      abi: submitQuoteFunctionAbi,
      functionName: "submitQuote",
      args: [{
        user,
        tokenIn,
        tokenOut,
        amountIn: 1000n,
        amountOut: 990n,
        minAmountOut: 980n,
        nonce: 7n,
        deadline: 4_102_444_800n,
        chainId: 1n,
      }, signature],
    }),
    ...overrides,
  };
}

function quoteSettledLog(overrides = {}) {
  const args = {
    quoteHash: hashSettlementQuote(quote),
    user,
    tokenIn,
    tokenOut,
    amountIn: 1000n,
    amountOut: 990n,
    nonce: 7n,
    ...overrides,
  };
  return {
    address: settlementAddress,
    topics: encodeEventTopics({
      abi: quoteSettledEventAbi,
      eventName: "QuoteSettled",
      args: { quoteHash: args.quoteHash, user: args.user, tokenIn: args.tokenIn },
    }),
    data: encodeAbiParameters(
      [
        { type: "address" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "uint256" },
      ],
      [args.tokenOut, args.amountIn, args.amountOut, args.nonce],
    ),
    logIndex: 4,
  };
}

class FakeReceiptReader {
  waitInput;

  constructor(receipt, transaction) {
    this.receipt = receipt;
    this.transaction = transaction;
  }

  async waitForTransactionReceipt(input) {
    this.waitInput = {
      txHash: input.hash,
      confirmations: input.confirmations,
      timeoutMs: input.timeoutMs,
    };
    return this.receipt;
  }

  async getTransaction() {
    return this.transaction;
  }
}
