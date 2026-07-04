import assert from "node:assert/strict";
import test from "node:test";
import { recoverTypedDataAddress, verifyTypedData } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  buildQuoteTypedData,
  buildRFQDomain,
  buildSubmitQuoteArgs,
  buildSubmitQuoteWriteRequest,
  buildTreasuryTransferArgs,
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
const secp256k1n = BigInt("0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141");

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

test("buildQuoteTypedData rejects invalid EIP-712 domain and quote fields", () => {
  assert.throws(
    () => buildRFQDomain(quote.chainId, "0x1234"),
    /verifyingContract must be a 20-byte hex address/,
  );
  assert.throws(
    () => buildRFQDomain(quote.chainId, new String(verifyingContract)),
    /verifyingContract must be a 20-byte hex address/,
  );

  assert.throws(
    () => buildQuoteTypedData(undefined, verifyingContract),
    /quote must be an object/,
  );

  assert.throws(
    () =>
      buildQuoteTypedData(
        {
          ...quote,
          routeHint: "internal",
        },
        verifyingContract,
      ),
    /quote must not include unknown field routeHint/,
  );

  assert.throws(
    () => buildQuoteTypedData(Object.create(quote), verifyingContract),
    /quote\.user must be an own field/,
  );

  assert.throws(
    () =>
      buildQuoteTypedData(
        {
          ...quote,
          tokenIn: "0x1234",
        },
        verifyingContract,
      ),
    /quote\.tokenIn must be a 20-byte hex address/,
  );
  assert.throws(
    () =>
      buildQuoteTypedData(
        {
          ...quote,
          user: new String(quote.user),
        },
        verifyingContract,
      ),
    /quote\.user must be a 20-byte hex address/,
  );

  assert.throws(
    () =>
      buildQuoteTypedData(
        {
          ...quote,
          amountOut: "0",
        },
        verifyingContract,
    ),
    /quote\.amountOut must be a positive uint string/,
  );
  assert.throws(
    () =>
      buildQuoteTypedData(
        {
          ...quote,
          amountIn: 1000000000,
        },
        verifyingContract,
      ),
    /quote\.amountIn must be a positive uint string/,
  );

  assert.throws(
    () =>
      buildQuoteTypedData(
        {
          ...quote,
          amountOut: "0998400000",
        },
        verifyingContract,
      ),
    /quote\.amountOut must be a positive uint string/,
  );

  assert.throws(
    () =>
      buildQuoteTypedData(
        {
          ...quote,
          nonce: "0",
        },
        verifyingContract,
      ),
    /quote\.nonce must be a positive uint string/,
  );

  assert.throws(
    () =>
      buildQuoteTypedData(
        {
          ...quote,
          tokenOut: quote.tokenIn,
        },
        verifyingContract,
      ),
    /quote\.tokenIn and quote\.tokenOut must be different/,
  );

  assert.throws(
    () =>
      buildQuoteTypedData(
        {
          ...quote,
          amountOut: "100",
          minAmountOut: "101",
        },
        verifyingContract,
      ),
    /quote\.amountOut must be greater than or equal to quote\.minAmountOut/,
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

  assert.throws(
    () => buildSubmitQuoteWriteRequest(undefined),
    /submit quote write request input must be an object/,
  );
  assert.throws(
    () => buildSubmitQuoteWriteRequest(Object.create({ settlementAddress: verifyingContract, quote, signature })),
    /submit quote write request input\.settlementAddress must be an own field/,
  );
  assert.throws(
    () =>
      buildSubmitQuoteWriteRequest({
        settlementAddress: verifyingContract,
        quote,
        signature,
        relayer: quote.user,
      }),
    /submit quote write request input must not include unknown field relayer/,
  );
  assert.throws(
    () =>
      buildSubmitQuoteWriteRequest({
        settlementAddress: verifyingContract,
        quote: Object.create(quote),
        signature,
      }),
    /quote\.user must be an own field/,
  );
  assert.throws(
    () =>
      buildSubmitQuoteWriteRequest({
        settlementAddress: "0x1234",
        quote,
        signature,
      }),
    /settlementAddress must be a 20-byte hex address/,
  );
});

test("Settlement helpers reject invalid uint inputs before contract calls", () => {
  assert.throws(
    () => buildSubmitQuoteArgs(undefined, signature),
    /quote must be an object/,
  );

  assert.throws(
    () => buildSubmitQuoteArgs(Object.create(quote), signature),
    /quote\.user must be an own field/,
  );

  assert.throws(
    () =>
      buildSubmitQuoteArgs(
        {
          ...quote,
          routeHint: "internal",
        },
        signature,
      ),
    /quote must not include unknown field routeHint/,
  );

  assert.throws(
    () =>
      buildSubmitQuoteArgs(
        {
          ...quote,
          user: "0x1234",
        },
        signature,
      ),
    /quote\.user must be a 20-byte hex address/,
  );

  assert.throws(
    () => buildSubmitQuoteArgs(quote, "0x1234"),
    /signature must be a 65-byte hex signature/,
  );
  assert.throws(
    () => buildSubmitQuoteArgs(quote, new String(signature)),
    /signature must be a 65-byte hex signature/,
  );

  assert.throws(
    () => buildSubmitQuoteArgs(quote, `0x${"11".repeat(64)}02`),
    /signature v value must be 27 or 28/,
  );

  assert.throws(
    () =>
      buildSubmitQuoteArgs(
        {
          ...quote,
          amountIn: "-1",
        },
        signature,
      ),
    /quote\.amountIn must be a positive uint string/,
  );
  assert.throws(
    () =>
      buildSubmitQuoteArgs(
        {
          ...quote,
          user: new String(quote.user),
        },
        signature,
      ),
    /quote\.user must be a 20-byte hex address/,
  );
  assert.throws(
    () =>
      buildSubmitQuoteArgs(
        {
          ...quote,
          amountIn: 1000000000,
        },
        signature,
      ),
    /quote\.amountIn must be a positive uint string/,
  );

  assert.throws(
    () =>
      buildSubmitQuoteArgs(
        {
          ...quote,
          nonce: "0",
        },
        signature,
      ),
    /quote\.nonce must be a positive uint string/,
  );

  assert.throws(
    () =>
      buildSubmitQuoteArgs(
        {
          ...quote,
          nonce: "042",
        },
        signature,
      ),
    /quote\.nonce must be a positive uint string/,
  );

  assert.throws(
    () =>
      buildSubmitQuoteArgs(
        {
          ...quote,
          deadline: -1,
        },
        signature,
      ),
    /quote\.deadline must be a positive safe integer/,
  );

  assert.throws(
    () =>
      buildSubmitQuoteArgs(
        {
          ...quote,
          tokenOut: quote.tokenIn,
        },
        signature,
      ),
    /quote\.tokenIn and quote\.tokenOut must be different/,
  );

  assert.throws(
    () =>
      buildSubmitQuoteArgs(
        {
          ...quote,
          amountOut: "100",
          minAmountOut: "101",
        },
        signature,
      ),
    /quote\.amountOut must be greater than or equal to quote\.minAmountOut/,
  );

  assert.throws(
    () =>
      buildTreasuryTransferArgs({
        token: quote.tokenOut,
        to: quote.user,
        amount: -1n,
      }),
    /amount must be a uint/,
  );
  assert.throws(
    () =>
      buildTreasuryTransferArgs({
        token: quote.tokenOut,
        to: quote.user,
        amount: new String(quote.amountOut),
      }),
    /amount must be a uint string/,
  );

  assert.throws(
    () => buildTreasuryTransferArgs(undefined),
    /treasury transfer input must be an object/,
  );

  assert.throws(
    () => buildTreasuryTransferArgs(Object.create({ token: quote.tokenOut, to: quote.user, amount: quote.amountOut })),
    /treasury transfer input\.token must be an own field/,
  );

  assert.throws(
    () =>
      buildTreasuryTransferArgs({
        token: quote.tokenOut,
        to: quote.user,
        amount: quote.amountOut,
        memo: "release",
      }),
    /treasury transfer input must not include unknown field memo/,
  );

  assert.throws(
    () =>
      buildTreasuryTransferArgs({
        token: "0x1234",
        to: quote.user,
        amount: quote.amountOut,
      }),
    /token must be a 20-byte hex address/,
  );
});

test("Settlement helpers reject high-s signatures before contract calls", async () => {
  const account = privateKeyToAccount(signerPrivateKey);
  const signed = await account.signTypedData(buildQuoteTypedData(quote, verifyingContract));

  assert.throws(
    () => buildSubmitQuoteArgs(quote, malleateSignature(signed)),
    /signature s value must be in the lower half order/,
  );
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

function malleateSignature(value) {
  const r = value.slice(2, 66);
  const s = BigInt(`0x${value.slice(66, 130)}`);
  const v = Number.parseInt(value.slice(130, 132), 16);
  const highS = (secp256k1n - s).toString(16).padStart(64, "0");
  const flippedV = v === 27 ? 28 : 27;

  return `0x${r}${highS}${flippedV.toString(16).padStart(2, "0")}`;
}
