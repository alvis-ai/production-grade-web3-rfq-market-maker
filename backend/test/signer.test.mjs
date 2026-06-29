import assert from "node:assert/strict";
import test from "node:test";
import { LocalEIP712SignerService } from "../dist/modules/signer/signer.service.js";

const privateKey = "0x59c6995e998f97a5a0044966f094538d9dae1ffc26a3b6d86dae8e3a0b97e6a0";
const settlementAddress = "0x0000000000000000000000000000000000000004";

const quote = {
  user: "0x0000000000000000000000000000000000000001",
  tokenIn: "0x0000000000000000000000000000000000000002",
  tokenOut: "0x0000000000000000000000000000000000000003",
  amountIn: "1000000000",
  amountOut: "998400000",
  minAmountOut: "993408000",
  nonce: "42",
  deadline: 1893456000,
  chainId: 1,
};

test("LocalEIP712SignerService signs and verifies RFQ typed quotes", async () => {
  const signer = new LocalEIP712SignerService({
    privateKey,
    settlementAddress,
  });

  const signature = await signer.signQuote({
    quote,
    quoteId: "q_test",
    snapshotId: "snapshot_test",
  });

  assert.match(signature, /^0x[0-9a-fA-F]{130}$/);
  assert.equal(await signer.verifyQuoteSignature(quote, signature), true);
});

test("LocalEIP712SignerService rejects tampered quote signatures", async () => {
  const signer = new LocalEIP712SignerService({
    privateKey,
    settlementAddress,
  });
  const signature = await signer.signQuote({
    quote,
    quoteId: "q_test",
    snapshotId: "snapshot_test",
  });

  assert.equal(
    await signer.verifyQuoteSignature(
      {
        ...quote,
        amountOut: "998300000",
      },
      signature,
    ),
    false,
  );
});

test("LocalEIP712SignerService binds signatures to the settlement contract address", async () => {
  const signer = new LocalEIP712SignerService({
    privateKey,
    settlementAddress,
  });
  const otherSettlementSigner = new LocalEIP712SignerService({
    privateKey,
    settlementAddress: "0x0000000000000000000000000000000000000005",
  });
  const signature = await signer.signQuote({
    quote,
    quoteId: "q_test",
    snapshotId: "snapshot_test",
  });

  assert.equal(await otherSettlementSigner.verifyQuoteSignature(quote, signature), false);
});

test("LocalEIP712SignerService rejects unsafe signer configuration at construction", () => {
  assert.throws(
    () =>
      new LocalEIP712SignerService({
        privateKey: "0x1234",
        settlementAddress,
      }),
    /Signer privateKey must be a 32-byte hex string/,
  );

  assert.throws(
    () =>
      new LocalEIP712SignerService({
        privateKey,
        settlementAddress: "0x1234",
      }),
    /Signer settlementAddress must be a 20-byte hex address/,
  );
});

test("LocalEIP712SignerService rejects unsafe quote inputs before signing", async () => {
  const signer = new LocalEIP712SignerService({
    privateKey,
    settlementAddress,
  });

  await assert.rejects(
    signer.signQuote({
      quote,
      quoteId: " ",
      snapshotId: "snapshot_test",
    }),
    /Signer quoteId must be a non-empty string/,
  );

  await assert.rejects(
    signer.signQuote({
      quote: {
        ...quote,
        amountOut: "900",
        minAmountOut: "901",
      },
      quoteId: "q_test",
      snapshotId: "snapshot_test",
    }),
    /Signer quote.amountOut must be greater than or equal to quote.minAmountOut/,
  );
});

test("LocalEIP712SignerService returns false for malformed verification inputs", async () => {
  const signer = new LocalEIP712SignerService({
    privateKey,
    settlementAddress,
  });

  assert.equal(await signer.verifyQuoteSignature(quote, "0x1234"), false);
  assert.equal(
    await signer.verifyQuoteSignature(
      {
        ...quote,
        tokenOut: quote.tokenIn,
      },
      `0x${"11".repeat(65)}`,
    ),
    false,
  );
});
