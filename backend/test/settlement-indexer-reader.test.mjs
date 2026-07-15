import assert from "node:assert/strict";
import test from "node:test";
import {
  parseSettlementIndexerConfig,
} from "../dist/modules/indexer/settlement-indexer.reader.js";

test("settlement indexer config parses bounded confirmed chain ranges", () => {
  const parsed = parseSettlementIndexerConfig(JSON.stringify({ chains: [chainConfig()] }));
  assert.deepEqual(parsed, { chains: [chainConfig()] });
  assert.notEqual(parsed.chains[0], chainConfig());
});

test("settlement indexer config rejects missing, unknown, duplicate, and unsafe fields", () => {
  assert.throws(() => parseSettlementIndexerConfig(), /is required/);
  assert.throws(() => parseSettlementIndexerConfig("{"), /valid JSON/);
  assert.throws(() => parseSettlementIndexerConfig(JSON.stringify({ chains: [] })), /between 1 and 32/);
  assert.throws(
    () => parseSettlementIndexerConfig(JSON.stringify({ chains: [{ ...chainConfig(), unknown: true }] })),
    /unknown field unknown/,
  );
  assert.throws(
    () => parseSettlementIndexerConfig(JSON.stringify({ chains: [chainConfig(), chainConfig()] })),
    /duplicate chain IDs/,
  );
  assert.throws(
    () => parseSettlementIndexerConfig(JSON.stringify({ chains: [{ ...chainConfig(), rpcUrl: "https://user:secret@rpc.example" }] })),
    /without credentials/,
  );
  assert.throws(
    () => parseSettlementIndexerConfig(JSON.stringify({ chains: [{ ...chainConfig(), settlementAddress: zeroAddress() }] })),
    /must not be zero/,
  );
  assert.throws(
    () => parseSettlementIndexerConfig(JSON.stringify({ chains: [{ ...chainConfig(), reorgLookbackBlocks: 4 }] })),
    /cover at least one maxBlockRange/,
  );
  assert.throws(
    () => parseSettlementIndexerConfig(
      JSON.stringify({ chains: [{ ...chainConfig(), rpcUrl: "http://rpc.example/project-token" }] }),
      { requireTls: true },
    ),
    /must use a bounded HTTPS URL/,
  );
  assert.throws(
    () => parseSettlementIndexerConfig(
      JSON.stringify({ chains: [{ ...chainConfig(), rpcUrl: "https://*.example/#token" }] }),
      { requireTls: true },
    ),
    /wildcard hosts, or fragments/,
  );
  assert.equal(
    parseSettlementIndexerConfig(JSON.stringify({
      chains: [{ ...chainConfig(), rpcUrl: "http://host.docker.internal:8545" }],
    })).chains[0].rpcUrl,
    "http://host.docker.internal:8545",
  );
});

function chainConfig() {
  return {
    chainId: 1,
    rpcUrl: "https://rpc.example/v1/project-token",
    settlementAddress: "0x0000000000000000000000000000000000000004",
    startBlock: 100,
    confirmations: 2,
    maxBlockRange: 5,
    reorgLookbackBlocks: 100,
    requestTimeoutMs: 5_000,
  };
}

function zeroAddress() {
  return "0x0000000000000000000000000000000000000000";
}
