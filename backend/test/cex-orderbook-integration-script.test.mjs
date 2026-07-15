import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

test("live CEX integration script requires dual-source production quorum", async () => {
  const { stdout, stderr } = await execFileAsync(process.execPath, [
    "--import",
    "./backend/test/fixtures/cex-orderbook-live-globals.mjs",
    "./scripts/cex-orderbook-integration-check.mjs",
  ], {
    cwd: new URL("../..", import.meta.url),
    env: {
      ...process.env,
      RFQ_CEX_INTEGRATION_CONFIRM: "yes",
      RFQ_CEX_INTEGRATION_TIMEOUT_MS: "5000",
    },
    timeout: 10_000,
  });

  assert.equal(stderr, "");
  const result = JSON.parse(stdout);
  assert.equal(result.status, "ok");
  assert.deepEqual(result.symbols, { binance: "ETHUSDT", coinbase: "ETH-USD" });
  assert.equal(result.quorum.configuredSources, 2);
  assert.equal(result.quorum.readySources, 2);
  assert.equal(result.quorum.usablePairs, 2);
  assert.equal(result.quorum.blockedPairs, 0);
  assert.equal(result.quorum.deviationRejectedSources, 0);
  assert.equal(result.sources.binance.deviationBps, 0);
  assert.equal(result.sources.coinbase.deviationBps, 0);
  assert.equal(result.aggregate.source, "cex:binance+coinbase");
  assert.equal(result.aggregate.forward.liquidityUsd, result.sources.binance.bidLiquidityUsd);
  assert.equal(result.aggregate.reverse.liquidityUsd, result.sources.binance.askLiquidityUsd);
  assert.equal(result.aggregate.reciprocalDeviationBps, 0);
  assert.equal(result.connectorErrors, 0);
});
