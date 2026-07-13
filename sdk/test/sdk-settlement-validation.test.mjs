import assert from "node:assert/strict";
import test from "node:test";
import { privateKeyToAccount } from "viem/accounts";
import {
  buildErc20AllowanceReadRequest,
  buildErc20ApprovalWriteRequest,
  buildQuoteTypedData,
  buildRFQDomain,
  buildSubmitQuoteArgs,
  buildSubmitQuoteWriteRequest,
  buildTreasuryTransferArgs,
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

test("buildSubmitQuoteWriteRequest rejects unsafe request inputs", () => {

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

test("ERC-20 helpers reject inherited, unknown, and malformed approval inputs", () => {
  assert.throws(
    () => buildErc20AllowanceReadRequest(undefined),
    /ERC-20 allowance read request input must be an object/,
  );
  assert.throws(
    () => buildErc20AllowanceReadRequest(Object.create({
      token: quote.tokenIn,
      owner: quote.user,
      spender: verifyingContract,
    })),
    /ERC-20 allowance read request input\.token must be an own field/,
  );
  assert.throws(
    () => buildErc20AllowanceReadRequest({
      token: quote.tokenIn,
      owner: quote.user,
      spender: verifyingContract,
      blockTag: "latest",
    }),
    /must not include unknown field blockTag/,
  );
  assert.throws(
    () => buildErc20ApprovalWriteRequest({
      token: "0x1234",
      spender: verifyingContract,
      amount: quote.amountIn,
    }),
    /token must be a 20-byte hex address/,
  );
  assert.throws(
    () => buildErc20ApprovalWriteRequest({
      token: quote.tokenIn,
      spender: verifyingContract,
      amount: -1n,
    }),
    /amount must be a uint/,
  );
  assert.throws(
    () => buildErc20ApprovalWriteRequest({
      token: quote.tokenIn,
      spender: verifyingContract,
      amount: quote.amountIn,
      unlimited: true,
    }),
    /must not include unknown field unlimited/,
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

function malleateSignature(value) {
  const r = value.slice(2, 66);
  const s = BigInt(`0x${value.slice(66, 130)}`);
  const v = Number.parseInt(value.slice(130, 132), 16);
  const highS = (secp256k1n - s).toString(16).padStart(64, "0");
  const flippedV = v === 27 ? 28 : 27;

  return `0x${r}${highS}${flippedV.toString(16).padStart(2, "0")}`;
}
