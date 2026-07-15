import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const baseEnvironment = {
  ...process.env,
  RFQ_CHAIN_INTEGRATION_CONFIRM: "yes",
  RFQ_CHAIN_INTEGRATION_RPC_URL: "https://rpc.example.test",
  RFQ_CHAIN_INTEGRATION_CHAIN_ID: "31337",
  RFQ_CHAIN_INTEGRATION_SETTLEMENT_ADDRESS: "0x1000000000000000000000000000000000000001",
  RFQ_CHAIN_INTEGRATION_TREASURY_ADDRESS: "0x1000000000000000000000000000000000000002",
  RFQ_CHAIN_INTEGRATION_FACTORY_ADDRESS: "0x1000000000000000000000000000000000000003",
  RFQ_CHAIN_INTEGRATION_ADMIN_ADDRESS: "0x1000000000000000000000000000000000000004",
  RFQ_CHAIN_INTEGRATION_TRUSTED_SIGNERS_JSON:
    '{"primary":"0x1000000000000000000000000000000000000005","authorized":["0x1000000000000000000000000000000000000005"]}',
  RFQ_CHAIN_INTEGRATION_TOKEN_WHITELIST_JSON:
    '{"tokens":["0x1000000000000000000000000000000000000006","0x1000000000000000000000000000000000000007"]}',
};
const command = [
  "--import",
  "./scripts/fixtures/contract-deployment-live-rpc.mjs",
  "./scripts/contract-deployment-integration-check.mjs",
];

test("target-chain deployment check proves complete contract invariants at one block", async () => {
  const { stdout, stderr } = await execFileAsync(process.execPath, command, {
    cwd: new URL("..", import.meta.url),
    env: baseEnvironment,
    timeout: 10_000,
  });

  assert.equal(stderr, "");
  const result = JSON.parse(stdout);
  assert.equal(result.status, "ok");
  assert.equal(result.chainId, 31_337);
  assert.equal(result.block.number, "256");
  assert.equal(result.contracts.runtime.RFQSettlement.artifactMatched, true);
  assert.equal(result.contracts.runtime.Treasury.artifactMatched, true);
  assert.equal(result.contracts.runtime.RFQDeploymentFactory.artifactMatched, true);
  assert.equal(result.administration.roleMemberCount, 1);
  assert.equal(result.administration.factoryRetainsRoles, false);
  assert.equal(result.signing.authorizedCount, 1);
  assert.equal(result.tokenWhitelistCount, 2);
  assert.equal(result.paused, false);
});

test("target-chain deployment check rejects hidden signer membership", async () => {
  await assert.rejects(
    execFileAsync(process.execPath, command, {
      cwd: new URL("..", import.meta.url),
      env: { ...baseEnvironment, RFQ_TEST_SIGNER_COUNT: "2" },
      timeout: 10_000,
    }),
    (error) => {
      assert.match(error.stderr, /trusted signer count does not match the expected complete set/);
      return true;
    },
  );
});

test("target-chain deployment check rejects runtime bytecode drift", async () => {
  await assert.rejects(
    execFileAsync(process.execPath, command, {
      cwd: new URL("..", import.meta.url),
      env: { ...baseEnvironment, RFQ_TEST_SETTLEMENT_BYTECODE_MISMATCH: "yes" },
      timeout: 10_000,
    }),
    (error) => {
      assert.match(error.stderr, /runtime bytecode does not match the local artifact outside immutable fields/);
      return true;
    },
  );
});
