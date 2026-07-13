import assert from "node:assert/strict";
import test from "node:test";
import { OnchainTreasuryLiquidityProvider } from "../dist/modules/risk/treasury-liquidity.provider.js";

const settlementAddress = "0x0000000000000000000000000000000000000004";
const treasuryAddress = "0x0000000000000000000000000000000000000005";
const token = "0x0000000000000000000000000000000000000006";

test("OnchainTreasuryLiquidityProvider reads treasury and token balance at one block", async () => {
  const calls = [];
  const provider = new OnchainTreasuryLiquidityProvider(config(), () => ({
    async getBlockNumber() {
      calls.push(["block"]);
      return 1234n;
    },
    async readTreasury(input) {
      calls.push(["treasury", input]);
      return treasuryAddress;
    },
    async readTokenBalance(input) {
      calls.push(["balance", input]);
      return 999n;
    },
  }));

  assert.deepEqual(await provider.getLiquidity({ chainId: 1, token }), {
    chainId: 1,
    settlementAddress,
    treasuryAddress,
    token,
    availableBalance: "999",
    blockNumber: 1234n,
  });
  assert.deepEqual(calls, [
    ["block"],
    ["treasury", { settlementAddress, blockNumber: 1234n }],
    ["balance", { token, owner: treasuryAddress, blockNumber: 1234n }],
  ]);
});

test("OnchainTreasuryLiquidityProvider fails closed on missing chains and malformed RPC values", async () => {
  const validReader = {
    async getBlockNumber() { return 1n; },
    async readTreasury() { return treasuryAddress; },
    async readTokenBalance() { return 1n; },
  };
  const provider = new OnchainTreasuryLiquidityProvider(config(), () => validReader);
  await assert.rejects(provider.getLiquidity({ chainId: 2, token }), /not configured/);
  await assert.rejects(provider.getLiquidity(Object.create({ chainId: 1, token })), /fields are invalid/);

  for (const reader of [
    { ...validReader, async getBlockNumber() { return 1; } },
    { ...validReader, async readTreasury() { return "0x1234"; } },
    { ...validReader, async readTokenBalance() { return -1n; } },
  ]) {
    const malformed = new OnchainTreasuryLiquidityProvider(config(), () => reader);
    await assert.rejects(malformed.getLiquidity({ chainId: 1, token }), /Treasury liquidity/);
  }
});

test("OnchainTreasuryLiquidityProvider health probes every configured settlement", async () => {
  let treasuryReads = 0;
  const provider = new OnchainTreasuryLiquidityProvider(config(), () => ({
    async getBlockNumber() { return 55n; },
    async readTreasury() {
      treasuryReads += 1;
      return treasuryAddress;
    },
    async readTokenBalance() { throw new Error("health must not require an arbitrary token"); },
  }));
  await provider.checkHealth();
  assert.equal(treasuryReads, 1);
});

function config() {
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
