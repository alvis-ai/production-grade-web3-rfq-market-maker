import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const requireFromBackend = createRequire(new URL("../../backend/package.json", import.meta.url));
const {
  decodeAbiParameters,
  encodeAbiParameters,
  keccak256,
  toBytes,
  toFunctionSelector,
} = await import(pathToFileURL(requireFromBackend.resolve("viem")).href);

const addresses = {
  settlement: "0x1000000000000000000000000000000000000001",
  treasury: "0x1000000000000000000000000000000000000002",
  factory: "0x1000000000000000000000000000000000000003",
  admin: "0x1000000000000000000000000000000000000004",
  signer: "0x1000000000000000000000000000000000000005",
  tokenA: "0x1000000000000000000000000000000000000006",
  tokenB: "0x1000000000000000000000000000000000000007",
};
const chainId = 31_337;
const runtimeBytecode = new Map([
  [addresses.settlement, readRuntime("contracts/out/RFQSettlement.sol/RFQSettlement.json")],
  [addresses.treasury, readRuntime("contracts/out/Treasury.sol/Treasury.json")],
  [addresses.factory, readRuntime("contracts/out/Deploy.s.sol/RFQDeploymentFactory.json")],
  [addresses.tokenA, "0x60006000"],
  [addresses.tokenB, "0x60016000"],
]);
if (process.env.RFQ_TEST_SETTLEMENT_BYTECODE_MISMATCH === "yes") {
  const code = runtimeBytecode.get(addresses.settlement);
  runtimeBytecode.set(addresses.settlement, `${code.slice(0, 22)}${code.slice(22, 24) === "00" ? "01" : "00"}${code.slice(24)}`);
}

globalThis.fetch = async (input, init) => {
  assert.equal(String(input), "https://rpc.example.test/");
  assert.equal(typeof init?.body, "string");
  const request = JSON.parse(init.body);
  const requests = Array.isArray(request) ? request : [request];
  const responses = requests.map((entry) => ({
    jsonrpc: "2.0",
    id: entry.id,
    result: handleRpc(entry.method, entry.params),
  }));
  return new Response(JSON.stringify(Array.isArray(request) ? responses : responses[0]), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
};

function handleRpc(method, params) {
  if (method === "eth_chainId") return "0x7a69";
  if (method === "eth_getBlockByNumber") return latestBlock();
  if (method === "eth_getCode") {
    const address = String(params[0]).toLowerCase();
    return runtimeBytecode.get(address) ?? "0x";
  }
  if (method === "eth_call") return handleCall(params[0]);
  throw new Error(`Unexpected JSON-RPC method ${method}`);
}

function handleCall(call) {
  const to = String(call.to).toLowerCase();
  const data = String(call.data);
  const selector = data.slice(0, 10);
  if (selector === toFunctionSelector("owner()")) {
    return addressResult(addresses.admin);
  }
  if (selector === toFunctionSelector("treasury()")) {
    assert.equal(to, addresses.settlement);
    return addressResult(addresses.treasury);
  }
  if (selector === toFunctionSelector("settlement()")) {
    assert.equal(to, addresses.treasury);
    return addressResult(addresses.settlement);
  }
  if (selector === toFunctionSelector("trustedSigner()")) return addressResult(addresses.signer);
  if (selector === toFunctionSelector("trustedSignerCount()")) {
    return uintResult(process.env.RFQ_TEST_SIGNER_COUNT === "2" ? 2n : 1n);
  }
  if (selector === toFunctionSelector("tokenWhitelistCount()")) return uintResult(2n);
  if (selector === toFunctionSelector("paused()")) return boolResult(false);
  if (selector === toFunctionSelector("domainSeparator()")) return bytes32Result(domainSeparator());
  if (selector === toFunctionSelector("trustedSigners(address)")) {
    const [signer] = decodeAbiParameters([{ type: "address" }], `0x${data.slice(10)}`);
    return boolResult(signer.toLowerCase() === addresses.signer);
  }
  if (selector === toFunctionSelector("tokenWhitelist(address)")) {
    const [token] = decodeAbiParameters([{ type: "address" }], `0x${data.slice(10)}`);
    return boolResult([addresses.tokenA, addresses.tokenB].includes(token.toLowerCase()));
  }
  if (selector === toFunctionSelector("hasRole(bytes32,address)")) {
    const [, account] = decodeAbiParameters(
      [{ type: "bytes32" }, { type: "address" }],
      `0x${data.slice(10)}`,
    );
    return boolResult(account.toLowerCase() === addresses.admin);
  }
  if (selector === toFunctionSelector("roleMemberCount(bytes32)")) return uintResult(1n);
  throw new Error(`Unexpected eth_call selector ${selector}`);
}

function latestBlock() {
  const hash = `0x${"11".repeat(32)}`;
  return {
    number: "0x100",
    hash,
    parentHash: `0x${"22".repeat(32)}`,
    nonce: "0x0000000000000000",
    sha3Uncles: `0x${"33".repeat(32)}`,
    logsBloom: `0x${"00".repeat(256)}`,
    transactionsRoot: `0x${"44".repeat(32)}`,
    stateRoot: `0x${"55".repeat(32)}`,
    receiptsRoot: `0x${"66".repeat(32)}`,
    miner: "0x0000000000000000000000000000000000000000",
    difficulty: "0x0",
    totalDifficulty: "0x0",
    extraData: "0x",
    size: "0x1",
    gasLimit: "0x1c9c380",
    gasUsed: "0x0",
    timestamp: `0x${Math.floor(Date.now() / 1_000).toString(16)}`,
    transactions: [],
    uncles: [],
    mixHash: `0x${"77".repeat(32)}`,
    baseFeePerGas: "0x1",
  };
}

function domainSeparator() {
  return keccak256(encodeAbiParameters(
    [
      { type: "bytes32" },
      { type: "bytes32" },
      { type: "bytes32" },
      { type: "uint256" },
      { type: "address" },
    ],
    [
      keccak256(toBytes("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)")),
      keccak256(toBytes("ProductionGradeRFQ")),
      keccak256(toBytes("1")),
      BigInt(chainId),
      addresses.settlement,
    ],
  ));
}

function addressResult(value) {
  return encodeAbiParameters([{ type: "address" }], [value]);
}

function uintResult(value) {
  return encodeAbiParameters([{ type: "uint256" }], [value]);
}

function boolResult(value) {
  return encodeAbiParameters([{ type: "bool" }], [value]);
}

function bytes32Result(value) {
  return encodeAbiParameters([{ type: "bytes32" }], [value]);
}

function readRuntime(path) {
  const artifact = JSON.parse(readFileSync(path, "utf8"));
  return artifact.deployedBytecode.object.toLowerCase();
}
