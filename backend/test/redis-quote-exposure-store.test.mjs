import assert from "node:assert/strict";
import test from "node:test";
import { ConfiguredTokenRegistry } from "../dist/modules/pricing/token-registry.js";
import { RedisQuoteExposureStore } from "../dist/modules/risk/redis-quote-exposure.store.js";
import {
  acquireAndReadQuoteExposureStateScript,
  acquireQuoteExposureLockScript,
  commitQuoteExposureReservationScript,
  getQuoteExposureReservationScript,
  initializeQuoteExposureLedgerScript,
  releaseQuoteExposureLockScript,
  releaseQuoteExposureReservationScript,
} from "../dist/modules/risk/redis-quote-exposure.scripts.js";

const tokenIn = "0x0000000000000000000000000000000000000011";
const tokenOut = "0x0000000000000000000000000000000000000022";
const now = 1_900_000_000;

test("RedisQuoteExposureStore uses two Redis round trips for a common reservation", async () => {
  const client = fakeClient();
  const observations = [];
  const store = buildStore(client, {
    recordLedgerMutation(value) { observations.push(value); },
  });

  await store.initialize();
  const input = reserveInput("q_fused_common");
  const reserved = await store.reserve(input);
  assert.equal(reserved.status, "reserved");
  assert.deepEqual(client.scriptCalls, ["initialize", "acquire-read", "commit"]);
  assert.equal(client.xlenCalls, 0);
  assert.deepEqual(observations[0], { operation: "reserve", duplicate: false, backlog: 1 });

  assert.deepEqual(await store.reserve(input), reserved);
  assert.deepEqual(client.scriptCalls.slice(3), ["acquire-read"]);
  assert.equal(client.xlenCalls, 0);

  await store.release(input.quoteId);
  assert.deepEqual(client.scriptCalls.slice(4), ["get", "lock", "release"]);
  assert.equal(client.xlenCalls, 0);
  assert.deepEqual(observations.at(-1), { operation: "release", duplicate: false, backlog: 2 });
});

test("RedisQuoteExposureStore requires replica acknowledgement for an existing replay", async () => {
  const client = fakeClient({ waitResults: [1, 0] });
  const store = buildStore(client, {}, { minReplicaAcks: 1 });
  const input = reserveInput("q_fused_replica_replay");

  await store.initialize();
  assert.equal((await store.reserve(input)).status, "reserved");
  await assert.rejects(store.reserve(input), /required replicas/);
  assert.equal(client.waitCalls, 2);
  assert.deepEqual(client.scriptCalls.slice(-1), ["acquire-read"]);
});

test("RedisQuoteExposureStore conditionally unlocks malformed fused state", async () => {
  const failures = [];
  const client = fakeClient({ malformedAcquireRead: true });
  const store = buildStore(client, {
    recordLedgerFailure(reason) { failures.push(reason); },
  });

  await store.initialize();
  await assert.rejects(store.reserve(reserveInput("q_fused_malformed")), /backlog must be/);
  assert.deepEqual(client.scriptCalls, ["initialize", "acquire-read", "unlock"]);
  assert.deepEqual(failures, ["state_invalid"]);
});

function buildStore(client, observerOverrides = {}, configOverrides = {}) {
  return new RedisQuoteExposureStore(
    client,
    { maxUserOpenNotionalUsd: "1000", maxPairOpenNotionalUsd: "1000" },
    new ConfiguredTokenRegistry({ tokens: [token(tokenIn, "IN"), token(tokenOut, "OUT")] }),
    undefined,
    {
      keyPrefix: "rfq:{fused-test}:ledger",
      ledgerEpoch: "test_v1",
      allowEpochInitialization: true,
      maxBacklog: 100,
      expiryGraceSeconds: 2,
      cleanupLimit: 10,
      lockTtlMs: 500,
      lockAcquireTimeoutMs: 100,
      minReplicaAcks: 0,
      replicaAckTimeoutMs: 10,
      requireAof: false,
      ...configOverrides,
    },
    {
      recordLedgerMutation() {},
      recordLedgerFailure() {},
      recordLedgerLockWait() {},
      recordLedgerBacklog() {},
      recordPortfolioDeltaSoftBreach() {},
      ...observerOverrides,
    },
    () => now,
  );
}

function fakeClient(options = {}) {
  let storedPayload;
  let backlog = 0;
  const waitResults = [...(options.waitResults ?? [])];
  const client = {
    status: "ready",
    scriptCalls: [],
    xlenCalls: 0,
    waitCalls: 0,
    async call() { throw new Error("unexpected Redis call"); },
    async eval(script, _numberOfKeys, ...args) {
      if (script === initializeQuoteExposureLedgerScript) {
        client.scriptCalls.push("initialize");
        return [1, "test_v1"];
      }
      if (script === acquireAndReadQuoteExposureStateScript) {
        client.scriptCalls.push("acquire-read");
        if (options.malformedAcquireRead) return [1, "", "invalid-backlog"];
        const quoteId = args[12];
        const existing = storedPayload && JSON.parse(storedPayload).quoteId === quoteId ? storedPayload : "";
        return [1, existing, backlog];
      }
      if (script === commitQuoteExposureReservationScript) {
        client.scriptCalls.push("commit");
        storedPayload = args[11];
        backlog += 1;
        return [1, storedPayload, backlog];
      }
      if (script === getQuoteExposureReservationScript) {
        client.scriptCalls.push("get");
        return storedPayload ?? "";
      }
      if (script === acquireQuoteExposureLockScript) {
        client.scriptCalls.push("lock");
        return 1;
      }
      if (script === releaseQuoteExposureReservationScript) {
        client.scriptCalls.push("release");
        const released = storedPayload ?? "";
        storedPayload = undefined;
        backlog += 1;
        return [1, released, backlog];
      }
      if (script === releaseQuoteExposureLockScript) {
        client.scriptCalls.push("unlock");
        return 1;
      }
      throw new Error("unexpected Redis script");
    },
    async ping() { return "PONG"; },
    async info() { return "aof_enabled:1\naof_last_write_status:ok\n"; },
    async xlen() {
      client.xlenCalls += 1;
      return backlog;
    },
    async wait() {
      client.waitCalls += 1;
      return waitResults.shift() ?? 1;
    },
    async quit() {},
  };
  return client;
}

function reserveInput(quoteId) {
  return {
    quoteId,
    request: {
      chainId: 1,
      user: "0x00000000000000000000000000000000000000aa",
      tokenIn,
      tokenOut,
      amountIn: "1000000000000000000",
      slippageBps: 50,
    },
    pricing: {
      amountOut: "1000000000000000000",
      minAmountOut: "990000000000000000",
      spreadBps: 10,
      sizeImpactBps: 0,
      marketSpreadBps: 10,
      inventorySkewBps: 0,
      volatilityPremiumBps: 0,
      hedgeCostBps: 0,
      pricingVersion: "fused-exposure-test-v1",
    },
    deadline: now + 30,
  };
}

function token(tokenAddress, symbol) {
  return {
    chainId: 1,
    tokenAddress,
    symbol,
    decimals: 18,
    isWhitelisted: true,
    riskTier: "low",
    usdReference: true,
  };
}
