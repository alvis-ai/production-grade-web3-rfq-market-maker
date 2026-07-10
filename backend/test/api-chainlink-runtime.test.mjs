import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { encodeAbiParameters, toFunctionSelector } from "viem";
import { buildServer } from "../dist/main.js";
import { InMemoryMarketSnapshotRepository } from "../dist/modules/market-data/market-snapshot.repository.js";

const tokenIn = "0x0000000000000000000000000000000000000002";
const tokenOut = "0x0000000000000000000000000000000000000003";
const aggregator = "0x0000000000000000000000000000000000000004";
const decimalsSelector = toFunctionSelector("decimals()");
const latestRoundSelector = toFunctionSelector("latestRoundData()");

test("RFQ API uses configured Chainlink rounds through quote, persistence, and readiness", async () => {
  const rpc = createRpcServer();
  await listen(rpc.server);
  const rpcAddress = rpc.server.address();
  const originalProvider = process.env.RFQ_MARKET_DATA_PROVIDER;
  const originalConfig = process.env.RFQ_CHAINLINK_CONFIG_JSON;
  const originalPairs = process.env.RFQ_MARKET_PAIRS;
  const snapshotStore = new InMemoryMarketSnapshotRepository();
  process.env.RFQ_MARKET_DATA_PROVIDER = "chainlink";
  process.env.RFQ_CHAINLINK_CONFIG_JSON = JSON.stringify({
    networks: [{
      chainId: 1,
      networkType: "l1",
      rpcUrl: `http://127.0.0.1:${rpcAddress.port}`,
      feeds: [{ tokenIn, tokenOut, aggregator, decimals: 8, invert: false }],
    }],
    referenceLiquidityUsd: "50000000",
    referenceVolatilityBps: 25,
    maxPriceAgeMs: 60_000,
  });
  delete process.env.RFQ_MARKET_PAIRS;

  const server = buildServer({ logger: false, marketSnapshotStore: snapshotStore });
  await server.ready();
  try {
    const quote = await server.inject({
      method: "POST",
      url: "/quote",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({
        chainId: 1,
        user: "0x0000000000000000000000000000000000000001",
        tokenIn,
        tokenOut,
        amountIn: "1000000000",
        slippageBps: 50,
      }),
    });

    assert.equal(quote.statusCode, 200, quote.payload);
    const quoteBody = JSON.parse(quote.payload);
    const stored = await snapshotStore.findBySnapshotId(quoteBody.snapshotId);
    assert.equal(stored.source, "chainlink-aggregator-v3");
    assert.equal(stored.midPrice, "1");
    assert.equal(stored.liquidityUsd, "50000000");

    const readiness = await server.inject({ method: "GET", url: "/ready" });
    assert.equal(readiness.statusCode, 200, readiness.payload);
    assert.equal(JSON.parse(readiness.payload).components.marketData, "ok");
    assert.ok(rpc.calls.latestRoundData >= 1);
    assert.ok(rpc.calls.decimals >= 1);
  } finally {
    await server.close();
    await close(rpc.server);
    restoreEnv("RFQ_MARKET_DATA_PROVIDER", originalProvider);
    restoreEnv("RFQ_CHAINLINK_CONFIG_JSON", originalConfig);
    restoreEnv("RFQ_MARKET_PAIRS", originalPairs);
  }
});

function createRpcServer() {
  const calls = { decimals: 0, latestRoundData: 0 };
  const server = http.createServer(async (request, response) => {
    try {
      const payload = JSON.parse(await readBody(request));
      const result = Array.isArray(payload)
        ? payload.map((entry) => rpcResponse(entry, calls))
        : rpcResponse(payload, calls);
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(result));
    } catch (error) {
      response.writeHead(500, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: String(error) }));
    }
  });
  return { server, calls };
}

function rpcResponse(request, calls) {
  if (request.method === "eth_chainId") return success(request.id, "0x1");
  if (request.method !== "eth_call") return success(request.id, "0x0");
  const data = request.params?.[0]?.data?.slice(0, 10);
  if (data === decimalsSelector) {
    calls.decimals += 1;
    return success(request.id, encodeAbiParameters([{ type: "uint8" }], [8]));
  }
  if (data === latestRoundSelector) {
    calls.latestRoundData += 1;
    const timestamp = BigInt(Math.floor(Date.now() / 1_000) - 1);
    return success(request.id, encodeAbiParameters(
      [
        { type: "uint80" },
        { type: "int256" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "uint80" },
      ],
      [1n, 100_000_000n, timestamp, timestamp, 1n],
    ));
  }
  throw new Error(`Unexpected eth_call selector ${data}`);
}

function success(id, result) {
  return { jsonrpc: "2.0", id, result };
}

async function readBody(request) {
  let body = "";
  for await (const chunk of request) body += chunk;
  return body;
}

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
}

async function close(server) {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

function restoreEnv(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
