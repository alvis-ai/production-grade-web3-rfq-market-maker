import assert from "node:assert/strict";
import test from "node:test";
import { keccak256 } from "viem";
import {
  commitSignedQuoteScript,
  RedisSignerQuoteCommitStore,
} from "../dist/modules/signer/redis-signer-quote-commit.store.js";
import {
  quoteFinalizationHash,
  quoteSigningAuthorizationHash,
} from "../dist/modules/signer/signer-quote-commit.js";

const quoteId = "q_atomic_commit";
const snapshotId = "snapshot_atomic_commit";
const principalId = "principal_atomic_commit";
const riskDecisionId = `rd_${quoteId}`;
const signature = `0x${"11".repeat(64)}1b`;
const nowMs = 1_700_000_000_000;
const quote = {
  user: "0x0000000000000000000000000000000000000033",
  tokenIn: "0x0000000000000000000000000000000000000011",
  tokenOut: "0x0000000000000000000000000000000000000022",
  amountIn: "1000000000000000000",
  amountOut: "999000000000000000",
  minAmountOut: "990000000000000000",
  nonce: "123456789",
  deadline: 1_900_000_000,
  chainId: 1,
};

test("RedisSignerQuoteCommitStore verifies the persisted authorization before signing", async () => {
  const client = clientFixture({ quoteState: authorizedQuoteState() });
  const store = buildStore(client);

  await store.assertAuthorized(signInput());
  assert.deepEqual(client.getKeys, ["rfq:{atomic-test}:ledger:quote:q_atomic_commit"]);

  await assert.rejects(
    store.assertAuthorized({ ...signInput(), commit: { ...commitContext(), riskPolicyVersion: "risk-v2" } }),
    /riskPolicyVersion|does not match/,
  );
  await assert.rejects(
    store.assertAuthorized({
      ...signInput(),
      quote: { ...quote, amountOut: "998000000000000000" },
    }),
    /does not match/,
  );
  client.quoteState = JSON.stringify({ ...authorizedQuoteState(), principalId: "principal_other" });
  await assert.rejects(store.assertAuthorized(signInput()), /preparation identity|does not match/);
});

test("RedisSignerQuoteCommitStore waits only for a missing durable authorization", async () => {
  const delayedClient = clientFixture();
  delayedClient.quoteState = undefined;
  const delayedStore = buildStore(delayedClient, undefined, { authorizationWaitMs: 20 });
  const publish = setTimeout(() => {
    delayedClient.quoteState = JSON.stringify(authorizedQuoteState());
  }, 3);
  await delayedStore.assertAuthorized(signInput());
  clearTimeout(publish);
  assert.equal(delayedClient.getKeys.length >= 2, true);
  assert.equal(delayedStore.waitsForDurableAuthorization, true);

  const missingClient = clientFixture();
  missingClient.quoteState = undefined;
  await assert.rejects(
    buildStore(missingClient, undefined, { authorizationWaitMs: 3 }).assertAuthorized(signInput()),
    /authorization is missing/,
  );
  assert.equal(missingClient.getKeys.length >= 2, true);

  const conflictingClient = clientFixture({
    quoteState: { ...authorizedQuoteState(), principalId: "principal_other" },
  });
  await assert.rejects(
    buildStore(conflictingClient, undefined, { authorizationWaitMs: 20 }).assertAuthorized(signInput()),
    /preparation identity|does not match/,
  );
  assert.equal(conflictingClient.getKeys.length, 1);
});

test("signing authorization hash is field-order independent and binds idempotency ownership", () => {
  const reservation = {
    principalId,
    key: "atomic-commit-idempotency-key",
    requestHash: "a".repeat(64),
    ownerToken: "quote_idem_atomic_owner",
    expiresAt: "2030-01-01T00:00:00.000Z",
  };
  const envelope = { quote, quoteId, snapshotId };
  const expected = quoteSigningAuthorizationHash(envelope, {
    ...commitContext(),
    idempotency: reservation,
  });
  const reordered = quoteSigningAuthorizationHash({
    snapshotId,
    quoteId,
    quote: {
      chainId: quote.chainId,
      deadline: quote.deadline,
      nonce: quote.nonce,
      minAmountOut: quote.minAmountOut,
      amountOut: quote.amountOut,
      amountIn: quote.amountIn,
      tokenOut: quote.tokenOut,
      tokenIn: quote.tokenIn,
      user: quote.user,
    },
  }, {
    riskPolicyVersion: "risk-v1",
    hedgeCostBps: 4,
    volatilityPremiumBps: 3,
    inventorySkewBps: -2,
    marketSpreadBps: 5,
    sizeImpactBps: 1,
    spreadBps: 10,
    pricingVersion: "pricing-v1",
    slippageBps: 50,
    principalId,
    idempotency: {
      expiresAt: reservation.expiresAt,
      ownerToken: reservation.ownerToken,
      requestHash: reservation.requestHash,
      key: reservation.key,
      principalId: reservation.principalId,
    },
  });
  assert.equal(reordered, expected);
  assert.notEqual(quoteSigningAuthorizationHash(envelope, {
    ...commitContext(),
    idempotency: { ...reservation, ownerToken: "quote_idem_other_owner" },
  }), expected);
});

test("RedisSignerQuoteCommitStore commits quote, idempotency, issuance, and audit in one hash slot", async () => {
  const observations = [];
  const client = clientFixture({
    evalResult(script, numberOfKeys, args) {
      assert.equal(script, commitSignedQuoteScript);
      assert.equal(numberOfKeys, 7);
      const keys = args.slice(0, numberOfKeys);
      assert.equal(keys.every((key) => key.includes("{atomic-test}")), true);
      assert.equal(new Set(keys).size, 7);
      return [1, args[numberOfKeys + 2], 3, 4, "10-0", "11-0"];
    },
  });
  const store = buildStore(client, {
    recordQuoteCommit(value) { observations.push(value); },
    recordQuoteCommitFailure() {},
  });
  const finalization = finalizationFixture();

  const evidence = await store.commit(auditEvent(), finalization);
  assert.deepEqual(evidence, {
    finalizationHash: quoteFinalizationHash(finalization),
    duplicate: false,
  });
  assert.deepEqual(observations, [{ duplicate: false, issuanceBacklog: 3, auditBacklog: 4 }]);
  assert.equal(client.evalCalls, 1);
});

test("RedisSignerQuoteCommitStore accepts exact duplicate evidence and rejects conflicts", async () => {
  const finalization = finalizationFixture();
  const duplicate = buildStore(clientFixture({
    evalResult(_script, numberOfKeys, args) {
      return [2, args[numberOfKeys + 2], 2, 2, "", ""];
    },
  }));
  assert.deepEqual(await duplicate.commit(auditEvent(), finalization), {
    finalizationHash: quoteFinalizationHash(finalization),
    duplicate: true,
  });

  const conflict = buildStore(clientFixture({ evalResult: () => [1, "0".repeat(64), 1, 1, "1-0", "2-0"] }));
  await assert.rejects(conflict.commit(auditEvent(), finalization), /conflicting finalization evidence/);

  const malformed = buildStore(clientFixture({ evalResult: () => [1, "bad"] }));
  await assert.rejects(malformed.commit(auditEvent(), finalization), /malformed evidence/);
});

test("RedisSignerQuoteCommitStore rejects mismatched audit input before calling Redis", async () => {
  const client = clientFixture();
  const store = buildStore(client);
  await assert.rejects(
    store.commit({ ...auditEvent(), snapshotId: "snapshot_other" }, finalizationFixture()),
    /does not match quote finalization/,
  );
  assert.equal(client.evalCalls, 0);
});

test("RedisSignerQuoteCommitStore fails closed when the atomic commit lacks replica acknowledgements", async () => {
  const failures = [];
  const client = clientFixture({ waitAcks: 0 });
  const store = buildStore(client, {
    recordQuoteCommit() {},
    recordQuoteCommitFailure(reason) { failures.push(reason); },
  }, { minReplicaAcks: 1 });

  await assert.rejects(
    store.commit(auditEvent(), finalizationFixture()),
    /required replicas/,
  );
  assert.equal(client.evalCalls, 1);
  assert.equal(client.waitCalls, 1);
  assert.deepEqual(failures, ["replica_ack"]);
});

test("RedisSignerQuoteCommitStore health enforces ledger epoch, AOF, and bounded streams", async () => {
  await buildStore(clientFixture()).checkHealth();
  await assert.rejects(
    buildStore(clientFixture({ epoch: "other_v1" })).checkHealth(),
    /ledger epoch/,
  );
  await assert.rejects(
    buildStore(clientFixture({ info: "aof_enabled:0\naof_last_write_status:ok\n" })).checkHealth(),
    /healthy AOF/,
  );
  await assert.rejects(
    buildStore(clientFixture({ issuanceBacklog: 100 })).checkHealth(),
    /backlog reached/,
  );
  assert.throws(
    () => buildStore(clientFixture(), undefined, { auditStreamKey: "rfq:{other}:audit-events" }),
    /one Redis Cluster hash tag/,
  );
});

function buildStore(client, observer = undefined, overrides = {}) {
  return new RedisSignerQuoteCommitStore(client, {
    quoteKeyPrefix: "rfq:{atomic-test}:ledger",
    ledgerEpoch: "atomic_v1",
    issuanceMaxBacklog: 100,
    hotStateTtlMs: 60_000,
    idempotencyTtlMs: 60_000,
    auditStreamKey: "rfq:{atomic-test}:signer-audit-events:v1",
    auditMaxBacklog: 100,
    auditDedupeTtlMs: 60_000,
    minReplicaAcks: 0,
    replicaAckTimeoutMs: 10,
    requireAof: true,
    authorizationWaitMs: 0,
    ...overrides,
  }, observer, () => nowMs);
}

function clientFixture(options = {}) {
  const client = {
    status: "ready",
    quoteState: JSON.stringify(options.quoteState ?? authorizedQuoteState()),
    getKeys: [],
    evalCalls: 0,
    waitCalls: 0,
    async eval(script, numberOfKeys, ...args) {
      client.evalCalls += 1;
      if (options.evalResult) return options.evalResult(script, numberOfKeys, args);
      return [1, args[numberOfKeys + 2], 1, 1, "1-0", "2-0"];
    },
    async get(key) {
      client.getKeys.push(key);
      if (key.endsWith(":epoch")) return options.epoch ?? "atomic_v1";
      return client.quoteState;
    },
    async ping() { return "PONG"; },
    async info() { return options.info ?? "aof_enabled:1\naof_last_write_status:ok\n"; },
    async xlen(key) {
      return key.endsWith(":events")
        ? options.issuanceBacklog ?? 0
        : options.auditBacklog ?? 0;
    },
    async wait() {
      client.waitCalls += 1;
      return options.waitAcks ?? 1;
    },
    async quit() {},
  };
  return client;
}

function signInput() {
  return {
    quote,
    quoteId,
    snapshotId,
    riskDecisionId,
    riskPolicyVersion: "risk-v1",
    traceId: "tr_atomic_commit",
    commit: commitContext(),
  };
}

function commitContext() {
  return {
    principalId,
    slippageBps: 50,
    pricingVersion: "pricing-v1",
    spreadBps: 10,
    sizeImpactBps: 1,
    marketSpreadBps: 5,
    inventorySkewBps: -2,
    volatilityPremiumBps: 3,
    hedgeCostBps: 4,
    riskPolicyVersion: "risk-v1",
  };
}

function finalizationFixture() {
  return {
    signedQuote: {
      quoteId,
      principalId,
      snapshotId,
      slippageBps: 50,
      quote,
      pricingVersion: "pricing-v1",
      spreadBps: 10,
      sizeImpactBps: 1,
      marketSpreadBps: 5,
      inventorySkewBps: -2,
      volatilityPremiumBps: 3,
      hedgeCostBps: 4,
      riskPolicyVersion: "risk-v1",
      signature,
    },
    response: {
      quoteId,
      snapshotId,
      amountOut: quote.amountOut,
      minAmountOut: quote.minAmountOut,
      deadline: quote.deadline,
      nonce: quote.nonce,
      signature,
    },
  };
}

function auditEvent() {
  return {
    quoteId,
    snapshotId,
    riskDecisionId,
    riskPolicyVersion: "risk-v1",
    traceId: "tr_atomic_commit",
    quoteDigest: `0x${"22".repeat(32)}`,
    signatureHash: keccak256(signature),
    signerAddress: "0x0000000000000000000000000000000000000044",
    settlementAddress: "0x0000000000000000000000000000000000000055",
    chainId: quote.chainId,
    deadline: quote.deadline,
    outcome: "success",
    occurredAt: new Date(nowMs).toISOString(),
  };
}

function authorizedQuoteState() {
  const request = {
    chainId: quote.chainId,
    user: quote.user,
    tokenIn: quote.tokenIn,
    tokenOut: quote.tokenOut,
    amountIn: quote.amountIn,
    slippageBps: 50,
  };
  const signingAuthorization = {
    quote,
    quoteId,
    snapshotId,
    commit: commitContext(),
  };
  return {
    schemaVersion: 1,
    quoteId,
    principalId,
    stage: "authorized",
    preparationHash: "a".repeat(64),
    preparation: {
      marketSnapshot: {
        request,
        snapshot: {
          snapshotId,
          midPrice: "1.000000000000000000",
          liquidityUsd: "10000000",
          marketSpreadBps: 10,
          volatilityBps: 20,
          observedAt: new Date(nowMs).toISOString(),
        },
        source: "atomic-test",
      },
      requestedQuote: { quoteId, principalId, snapshotId, request },
      routeDecision: {
        quoteId,
        principalId,
        snapshotId,
        routePlan: {
          routeId: "route_atomic_test",
          venue: "internal_inventory",
          tokenIn: quote.tokenIn,
          tokenOut: quote.tokenOut,
          expectedLiquidityUsd: "10000000",
        },
      },
    },
    preparedAtMs: nowMs,
    updatedAtMs: nowMs,
    authorizationHash: "b".repeat(64),
    authorization: {
      input: { quoteId, decision: { status: "approved", policyVersion: "risk-v1" } },
      record: {
        riskDecisionId,
        quoteId,
        decision: "approved",
        policyVersion: "risk-v1",
        createdAt: new Date(nowMs).toISOString(),
      },
      signingAuthorization,
      signingAuthorizationHash: quoteSigningAuthorizationHash(
        signingAuthorization,
        signingAuthorization.commit,
      ),
    },
  };
}
