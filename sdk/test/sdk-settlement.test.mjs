import assert from "node:assert/strict";
import test from "node:test";
import { recoverTypedDataAddress, verifyTypedData } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  buildErc20AllowanceReadRequest,
  buildErc20ApprovalWriteRequest,
  buildQuoteTypedData,
  buildRFQDomain,
  buildSubmitQuoteArgs,
  buildSubmitQuoteWriteRequest,
  buildTreasuryTransferArgs,
  erc20Abi,
  hashSettlementQuote,
  quoteTypes,
  rfqSettlementAbi,
  treasuryAbi,
} from "../dist/index.js";

const quote = {
  user: "0x0000000000000000000000000000000000000001",
  tokenIn: "0x0000000000000000000000000000000000000002",
  tokenOut: "0x0000000000000000000000000000000000000003",
  amountIn: "1000000000",
  amountOut: "1000000000",
  minAmountOut: "995000000",
  nonce: "42",
  deadline: 1893456000,
  chainId: 1,
};

const verifyingContract = "0x0000000000000000000000000000000000000004";
const signature = `0x${"11".repeat(64)}1b`;
const signerPrivateKey = "0x59c6995e998f97a5a0044966f094538d9dae1ffc26a3b6d86dae8e3a0b97e6a0";

test("buildRFQDomain and buildQuoteTypedData preserve EIP-712 quote schema", () => {
  assert.deepEqual(buildRFQDomain(quote.chainId, verifyingContract), {
    name: "ProductionGradeRFQ",
    version: "1",
    chainId: quote.chainId,
    verifyingContract,
  });

  const typedData = buildQuoteTypedData(quote, verifyingContract);

  assert.equal(typedData.primaryType, "Quote");
  assert.deepEqual(typedData.message, quote);
  assert.deepEqual(typedData.types, quoteTypes);
  assert.deepEqual(
    typedData.types.Quote.map((field) => `${field.name}:${field.type}`),
    [
      "user:address",
      "tokenIn:address",
      "tokenOut:address",
      "amountIn:uint256",
      "amountOut:uint256",
      "minAmountOut:uint256",
      "nonce:uint256",
      "deadline:uint256",
      "chainId:uint256",
    ],
  );
});

test("buildQuoteTypedData produces viem-verifiable EIP-712 payloads", async () => {
  const account = privateKeyToAccount(signerPrivateKey);
  const typedData = buildQuoteTypedData(quote, verifyingContract);
  const signed = await account.signTypedData(typedData);

  assert.match(signed, /^0x[0-9a-fA-F]{130}$/);
  assert.equal(
    (await recoverTypedDataAddress({
      ...typedData,
      signature: signed,
    })).toLowerCase(),
    account.address.toLowerCase(),
  );
  assert.equal(
    await verifyTypedData({
      ...typedData,
      address: account.address,
      signature: signed,
    }),
    true,
  );
});

test("buildSubmitQuoteArgs converts string integer fields to settlement bigint fields", () => {
  const args = buildSubmitQuoteArgs(quote, signature);

  assert.equal(args[1], signature);
  assert.deepEqual(args[0], {
    user: quote.user,
    tokenIn: quote.tokenIn,
    tokenOut: quote.tokenOut,
    amountIn: 1000000000n,
    amountOut: 1000000000n,
    minAmountOut: 995000000n,
    nonce: 42n,
    deadline: 1893456000n,
    chainId: 1n,
  });
  assert.ok(rfqSettlementAbi.some((item) => item.type === "function" && item.name === "hashQuote"));
});

test("buildSubmitQuoteWriteRequest builds a wagmi and viem compatible contract request", () => {
  const request = buildSubmitQuoteWriteRequest({
    settlementAddress: verifyingContract,
    quote,
    signature,
  });

  assert.equal(request.address, verifyingContract);
  assert.equal(request.abi, rfqSettlementAbi);
  assert.equal(request.functionName, "submitQuote");
  assert.deepEqual(request.args, buildSubmitQuoteArgs(quote, signature));
});

test("ERC-20 helpers build exact allowance and approval requests", () => {
  const allowance = buildErc20AllowanceReadRequest({
    token: quote.tokenIn,
    owner: quote.user,
    spender: verifyingContract,
  });
  assert.deepEqual(allowance, {
    address: quote.tokenIn,
    abi: erc20Abi,
    functionName: "allowance",
    args: [quote.user, verifyingContract],
  });

  const approval = buildErc20ApprovalWriteRequest({
    token: quote.tokenIn,
    spender: verifyingContract,
    amount: quote.amountIn,
  });
  assert.deepEqual(approval, {
    address: quote.tokenIn,
    abi: erc20Abi,
    functionName: "approve",
    args: [verifyingContract, 1000000000n],
  });
  assert.ok(erc20Abi.some((item) => item.type === "function" && item.name === "allowance"));
  assert.ok(erc20Abi.some((item) => item.type === "function" && item.name === "approve"));
});

test("hashSettlementQuote matches RFQSettlement.hashQuote struct hashing", () => {
  assert.equal(
    hashSettlementQuote(quote),
    "0xcc2f7c4203c4d5bc133de16a899dadcc348ccdf7222093307bc2cc522493503d",
  );
});

test("Treasury helpers expose release and emergency withdrawal contract calls", () => {
  const args = buildTreasuryTransferArgs({
    token: quote.tokenOut,
    to: quote.user,
    amount: quote.amountOut,
  });

  assert.deepEqual(args, [quote.tokenOut, quote.user, 1000000000n]);
  assert.ok(treasuryAbi.some((item) => item.type === "function" && item.name === "release"));
  assert.ok(treasuryAbi.some((item) => item.type === "function" && item.name === "emergencyWithdraw"));
  assert.ok(treasuryAbi.some((item) => item.type === "event" && item.name === "FundsReleased"));
});

test("RFQSettlement ABI exposes treasury custody controls", () => {
  assert.ok(rfqSettlementAbi.some((item) => item.type === "function" && item.name === "treasury"));
  assert.ok(rfqSettlementAbi.some((item) => item.type === "function" && item.name === "setTreasury"));
  assert.ok(rfqSettlementAbi.some((item) => item.type === "event" && item.name === "TreasuryUpdated"));
});

test("RFQSettlement ABI exposes public state getters for operations", () => {
  for (const name of ["owner", "trustedSigner", "paused", "tokenWhitelist", "usedNonces"]) {
    assert.ok(
      rfqSettlementAbi.some((item) => item.type === "function" && item.name === name),
      `missing RFQSettlement getter ${name}`,
    );
  }

  const tokenWhitelistGetter = rfqSettlementAbi.find(
    (item) => item.type === "function" && item.name === "tokenWhitelist",
  );
  assert.ok(tokenWhitelistGetter, "missing RFQSettlement getter tokenWhitelist");
  assert.deepEqual(
    tokenWhitelistGetter.inputs.map((input) => `${input.name}:${input.type}`),
    ["token:address"],
  );
  assert.deepEqual(
    tokenWhitelistGetter.outputs.map((output) => `${output.name}:${output.type}`),
    ["whitelisted:bool"],
  );

  const usedNoncesGetter = rfqSettlementAbi.find(
    (item) => item.type === "function" && item.name === "usedNonces",
  );
  assert.ok(usedNoncesGetter, "missing RFQSettlement getter usedNonces");
  assert.deepEqual(
    usedNoncesGetter.inputs.map((input) => `${input.name}:${input.type}`),
    ["user:address", "nonce:uint256"],
  );
  assert.deepEqual(
    usedNoncesGetter.outputs.map((output) => `${output.name}:${output.type}`),
    ["used:bool"],
  );
});

test("RFQSettlement ABI exposes role-based admin controls", () => {
  for (const name of [
    "DEFAULT_ADMIN_ROLE",
    "PAUSER_ROLE",
    "SIGNER_ADMIN_ROLE",
    "TOKEN_ADMIN_ROLE",
    "TREASURY_ADMIN_ROLE",
    "grantRole",
    "revokeRole",
    "hasRole",
    "setTrustedSigner",
    "setTokenWhitelist",
  ]) {
    assert.ok(
      rfqSettlementAbi.some((item) => item.type === "function" && item.name === name),
      `missing RFQSettlement function ${name}`,
    );
  }

  assert.ok(rfqSettlementAbi.some((item) => item.type === "event" && item.name === "RoleGranted"));
  assert.ok(rfqSettlementAbi.some((item) => item.type === "event" && item.name === "RoleRevoked"));
});

test("Contract ABIs expose custom errors for revert decoding", () => {
  for (const name of [
    "InvalidSigner",
    "InvalidSignatureLength",
    "InvalidSignatureS",
    "InvalidSignatureV",
    "NonceAlreadyUsed",
    "QuoteExpired",
    "TokenNotWhitelisted",
    "AmountOutBelowMinimum",
    "CannotRevokeLastAdmin",
  ]) {
    assert.ok(
      rfqSettlementAbi.some((item) => item.type === "error" && item.name === name),
      `missing RFQSettlement error ${name}`,
    );
  }

  const missingRoleError = rfqSettlementAbi.find(
    (item) => item.type === "error" && item.name === "MissingRole",
  );
  assert.ok(missingRoleError, "missing RFQSettlement error MissingRole");
  assert.deepEqual(
    missingRoleError.inputs.map((input) => `${input.name}:${input.type}`),
    ["role:bytes32", "account:address"],
  );

  for (const name of ["NotOwner", "NotSettlement", "ReentrantCall", "InvalidAddress", "TransferFailed"]) {
    assert.ok(
      treasuryAbi.some((item) => item.type === "error" && item.name === name),
      `missing Treasury error ${name}`,
    );
  }
});
