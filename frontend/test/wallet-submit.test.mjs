import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

async function importWalletSubmitModule() {
  const source = await readFile(new URL("../src/lib/wallet-submit.ts", import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      isolatedModules: true,
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: "wallet-submit.ts",
  });

  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);
}

const { prepareWalletSubmit, walletMatchesQuote } = await importWalletSubmitModule();

const wallet = Object.freeze({
  address: "0x1111111111111111111111111111111111111111",
  chainId: 1,
});

const signedQuote = Object.freeze({
  user: "0x1111111111111111111111111111111111111111",
  tokenIn: "0x2222222222222222222222222222222222222222",
  tokenOut: "0x3333333333333333333333333333333333333333",
  amountIn: "1000000000000000000",
  amountOut: "998000000000000000",
  minAmountOut: "993000000000000000",
  nonce: "42",
  deadline: 1893456000,
  chainId: 1,
});

const quoteResponse = Object.freeze({
  quoteId: "q_test",
  snapshotId: "snapshot_test",
  amountOut: "998000000000000000",
  minAmountOut: "993000000000000000",
  deadline: 1893456000,
  nonce: "42",
  signature: `0x${"11".repeat(64)}1b`,
});

test("walletMatchesQuote accepts only closed own signed quote fields", () => {
  assert.equal(walletMatchesQuote(signedQuote, wallet), true);
  assert.equal(
    walletMatchesQuote(signedQuote, {
      address: "0x1111111111111111111111111111111111111111".toUpperCase(),
      chainId: 1,
    }),
    true,
  );
  assert.equal(walletMatchesQuote(Object.create(signedQuote), wallet), false);
  assert.equal(walletMatchesQuote({ ...signedQuote, routeHint: "internal" }, wallet), false);
});

test("prepareWalletSubmit returns own quote and signature for the wallet call", () => {
  assert.deepEqual(prepareWalletSubmit({ quote: quoteResponse, signedQuote, wallet }), {
    ok: true,
    quote: signedQuote,
    signature: quoteResponse.signature,
  });
});

test("prepareWalletSubmit rejects inherited submit payload fields", () => {
  assert.deepEqual(prepareWalletSubmit({ quote: quoteResponse, signedQuote: Object.create(signedQuote), wallet }), {
    ok: false,
    error: "Signed quote must provide closed own wallet submit fields",
  });
  assert.deepEqual(prepareWalletSubmit({ quote: Object.create(quoteResponse), signedQuote, wallet }), {
    ok: false,
    error: "Quote response must provide closed own wallet submit fields",
  });
});

test("prepareWalletSubmit preserves wallet mismatch guard messages", () => {
  assert.deepEqual(
    prepareWalletSubmit({
      quote: quoteResponse,
      signedQuote,
      wallet: { address: "0x4444444444444444444444444444444444444444", chainId: 1 },
    }),
    {
      ok: false,
      error: "Connected wallet must match quote user",
    },
  );
  assert.deepEqual(prepareWalletSubmit({ quote: quoteResponse, signedQuote, wallet: { ...wallet, chainId: 5 } }), {
    ok: false,
    error: "Connected wallet network must match quote chainId",
  });
});
