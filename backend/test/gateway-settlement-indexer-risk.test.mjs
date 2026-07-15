import assert from "node:assert/strict";
import test from "node:test";
import {
  defaultSettlementIndexerMaxBlockLag,
  defaultSettlementIndexerMaxCursorAgeMs,
  readGatewaySettlementIndexerRiskConfig,
} from "../dist/runtime/gateway-settlement-indexer-risk.js";

const receiptConfig = JSON.stringify({
  chains: [{
    chainId: 1,
    rpcUrl: "http://127.0.0.1:8545",
    settlementAddress: "0x0000000000000000000000000000000000000044",
    confirmations: 12,
    receiptTimeoutMs: 10_000,
  }],
});

test("gateway settlement indexer risk config is disabled without receipt chains", () => {
  assert.equal(readGatewaySettlementIndexerRiskConfig({}), undefined);
});

test("gateway settlement indexer risk config uses bounded defaults and overrides", () => {
  const defaults = readGatewaySettlementIndexerRiskConfig({ RFQ_RECEIPT_CONFIG_JSON: receiptConfig });
  assert.equal(defaults.maxCursorAgeMs, defaultSettlementIndexerMaxCursorAgeMs);
  assert.equal(defaults.maxBlockLag, defaultSettlementIndexerMaxBlockLag);
  assert.equal(defaults.receiptConfig.chains[0].confirmations, 12);

  const configured = readGatewaySettlementIndexerRiskConfig({
    RFQ_RECEIPT_CONFIG_JSON: receiptConfig,
    RFQ_SETTLEMENT_INDEXER_MAX_CURSOR_AGE_MS: "30000",
    RFQ_SETTLEMENT_INDEXER_MAX_BLOCK_LAG: "5",
  });
  assert.equal(configured.maxCursorAgeMs, 30_000);
  assert.equal(configured.maxBlockLag, 5);
});

test("gateway settlement indexer risk config rejects unsafe and inherited values", () => {
  for (const [name, value, pattern] of [
    ["RFQ_SETTLEMENT_INDEXER_MAX_CURSOR_AGE_MS", "999", /between 1000 and 600000/],
    ["RFQ_SETTLEMENT_INDEXER_MAX_CURSOR_AGE_MS", "60001ms", /between 1000 and 600000/],
    ["RFQ_SETTLEMENT_INDEXER_MAX_BLOCK_LAG", "10001", /between 0 and 10000/],
    ["RFQ_SETTLEMENT_INDEXER_MAX_BLOCK_LAG", "+2", /between 0 and 10000/],
  ]) {
    assert.throws(
      () => readGatewaySettlementIndexerRiskConfig({ RFQ_RECEIPT_CONFIG_JSON: receiptConfig, [name]: value }),
      pattern,
    );
  }

  const inherited = Object.create({
    RFQ_RECEIPT_CONFIG_JSON: receiptConfig,
    RFQ_SETTLEMENT_INDEXER_MAX_CURSOR_AGE_MS: "30000",
    RFQ_SETTLEMENT_INDEXER_MAX_BLOCK_LAG: "5",
  });
  assert.equal(readGatewaySettlementIndexerRiskConfig(inherited), undefined);
});

test("gateway settlement indexer risk config requires TLS outside local environments", () => {
  assert.throws(
    () => readGatewaySettlementIndexerRiskConfig({
      NODE_ENV: "production",
      RFQ_RECEIPT_CONFIG_JSON: receiptConfig,
    }),
    /must use a bounded HTTPS URL/,
  );
});
