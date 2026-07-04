import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const require = createRequire(import.meta.url);
const reactJsxRuntimeUrl = pathToFileURL(require.resolve("react/jsx-runtime")).href;
const tempDir = await mkdtemp(join(tmpdir(), "rfq-wallet-submit-control-test-"));
let moduleCounter = 0;

async function transpileModule(relativePath, transformSource = (source) => source) {
  const sourceUrl = new URL(relativePath, import.meta.url);
  const source = transformSource(await readFile(sourceUrl, "utf8"));
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      isolatedModules: true,
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: sourceUrl.pathname,
  });
  const moduleText = outputText.replaceAll('"react/jsx-runtime"', JSON.stringify(reactJsxRuntimeUrl));
  const modulePath = join(tempDir, `module-${moduleCounter++}.mjs`);
  await writeFile(modulePath, moduleText);
  return pathToFileURL(modulePath).href;
}

async function importWalletSubmitControlModule() {
  const walletSubmitUrl = await transpileModule("../src/lib/wallet-submit.ts");
  const sourceUrl = await transpileModule("../src/components/WalletSubmitControl.tsx", (source) =>
    source
      .replace(
        'import { useEffect } from "react";',
        "const useEffect = (effect) => { effect(); };",
      )
      .replace(
        'import { buildSubmitQuoteWriteRequest } from "@rfq-market-maker/sdk";',
        'const buildSubmitQuoteWriteRequest = (input) => ({ kind: "submitQuoteWriteRequest", input });',
      )
      .replace(
        'import { ConnectButton } from "@rainbow-me/rainbowkit";',
        'const ConnectButton = () => "Mock Connect";',
      )
      .replace(
        'import { useAccount, useChainId, useWriteContract } from "wagmi";',
        [
          "let wagmiMock = { address: undefined, chainId: 1, writeContractAsync: async () => `0x${\"aa\".repeat(32)}`, isPending: false };",
          "export function setWagmiMock(next) { wagmiMock = { ...wagmiMock, ...next }; }",
          "const useAccount = () => ({ address: wagmiMock.address });",
          "const useChainId = () => wagmiMock.chainId;",
          "const useWriteContract = () => ({ writeContractAsync: wagmiMock.writeContractAsync, isPending: wagmiMock.isPending });",
        ].join("\n"),
      )
      .replace(
        'import { Web3Provider } from "../app/web3";',
        "const Web3Provider = ({ children }) => children;",
      )
      .replace(
        'import { rfqSettlementAddress } from "../lib/config";',
        'let rfqSettlementAddress = "0x5555555555555555555555555555555555555555";\nexport function setSettlementAddress(address) { rfqSettlementAddress = address; }',
      )
      .replace(
        'import { toUIError, type UIError } from "../lib/errors";',
        'const toUIError = (caught, fallback) => ({ message: caught instanceof Error ? caught.message : fallback });',
      )
      .replace(
        'from "../lib/wallet-submit";',
        `from ${JSON.stringify(walletSubmitUrl)};`,
      )
      .replace('import "@rainbow-me/rainbowkit/styles.css";', "")
      .replace("function WalletSubmitInner", "export function WalletSubmitInner"),
  );

  return import(sourceUrl);
}

function findElements(root, predicate, matches = []) {
  if (Array.isArray(root)) {
    for (const child of root) {
      findElements(child, predicate, matches);
    }
    return matches;
  }

  if (!isReactElement(root)) return matches;
  if (predicate(root)) matches.push(root);

  const children = root.props.children;
  if (Array.isArray(children)) {
    for (const child of children) {
      findElements(child, predicate, matches);
    }
  } else {
    findElements(children, predicate, matches);
  }

  return matches;
}

function textContent(root) {
  if (root === undefined || root === null || typeof root === "boolean") return "";
  if (typeof root === "string" || typeof root === "number") return String(root);
  if (Array.isArray(root)) return root.map(textContent).join("");
  if (!isReactElement(root)) return "";
  return textContent(root.props.children);
}

function isReactElement(value) {
  return typeof value === "object" && value !== null && "type" in value && "props" in value;
}

const wallet = Object.freeze({
  address: "0x1111111111111111111111111111111111111111",
  chainId: 1,
});

const signedQuote = Object.freeze({
  user: wallet.address,
  tokenIn: "0x2222222222222222222222222222222222222222",
  tokenOut: "0x3333333333333333333333333333333333333333",
  amountIn: "1000000000000000000",
  amountOut: "998000000000000000",
  minAmountOut: "993000000000000000",
  nonce: "42",
  deadline: 1893456000,
  chainId: wallet.chainId,
});

const quote = Object.freeze({
  quoteId: "q_wallet_component",
  snapshotId: "snapshot_wallet_component",
  amountOut: signedQuote.amountOut,
  minAmountOut: signedQuote.minAmountOut,
  deadline: signedQuote.deadline,
  nonce: signedQuote.nonce,
  signature: `0x${"11".repeat(64)}1b`,
});

function baseProps(overrides = {}) {
  return {
    quote,
    signedQuote,
    canSubmit: true,
    onWalletChange: () => {},
    onTxHash: () => {},
    onError: () => {},
    ...overrides,
  };
}

test("WalletSubmitControl enables onchain submit only for matching wallet state", async () => {
  const { WalletSubmitInner, setWagmiMock } = await importWalletSubmitControlModule();
  const walletChanges = [];
  const writes = [];
  const txHashes = [];
  setWagmiMock({
    ...wallet,
    isPending: false,
    writeContractAsync: async (request) => {
      writes.push(request);
      return `0x${"aa".repeat(32)}`;
    },
  });

  const props = baseProps({
    onWalletChange: (state) => walletChanges.push(state),
    onTxHash: (txHash) => txHashes.push(txHash),
  });
  const markup = renderToStaticMarkup(createElement(WalletSubmitInner, props));
  assert.match(markup, /Mock Connect/);
  assert.match(markup, /Submit Onchain/);

  const tree = WalletSubmitInner(props);
  const button = findElements(tree, (element) => element.type === "button")
    .find((candidate) => textContent(candidate) === "Submit Onchain");
  assert.ok(button);
  assert.equal(button.props.disabled, false);
  assert.deepEqual(walletChanges.at(-1), wallet);

  await button.props.onClick();
  assert.deepEqual(txHashes, [`0x${"aa".repeat(32)}`]);
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0], {
    kind: "submitQuoteWriteRequest",
    input: {
      settlementAddress: "0x5555555555555555555555555555555555555555",
      quote: signedQuote,
      signature: quote.signature,
    },
  });
});

test("WalletSubmitControl disables onchain submit for mismatch and pending states", async () => {
  const { WalletSubmitInner, setWagmiMock } = await importWalletSubmitControlModule();

  setWagmiMock({
    address: "0x4444444444444444444444444444444444444444",
    chainId: wallet.chainId,
    isPending: false,
  });
  const mismatchTree = WalletSubmitInner(baseProps());
  const mismatchButton = findElements(mismatchTree, (element) => element.type === "button")
    .find((candidate) => textContent(candidate) === "Submit Onchain");
  assert.equal(mismatchButton.props.disabled, true);

  setWagmiMock({
    ...wallet,
    isPending: true,
  });
  const pendingTree = WalletSubmitInner(baseProps());
  const pendingButton = findElements(pendingTree, (element) => element.type === "button")
    .find((candidate) => textContent(candidate) === "Submitting Onchain...");
  assert.equal(pendingButton.props.disabled, true);
});

test("WalletSubmitControl reports expired, preparation, and write errors", async () => {
  const { WalletSubmitInner, setWagmiMock } = await importWalletSubmitControlModule();
  const errors = [];
  setWagmiMock({
    ...wallet,
    isPending: false,
    writeContractAsync: async () => {
      throw new Error("wallet rejected");
    },
  });

  const expiredTree = WalletSubmitInner(baseProps({
    canSubmit: false,
    onError: (error) => errors.push(error),
  }));
  const expiredButton = findElements(expiredTree, (element) => element.type === "button")
    .find((candidate) => textContent(candidate) === "Submit Onchain");
  assert.equal(expiredButton.props.disabled, true);
  await expiredButton.props.onClick();
  assert.deepEqual(errors.pop(), { message: "Quote expired; request a new quote" });

  const malformedTree = WalletSubmitInner(baseProps({
    signedQuote: Object.create(signedQuote),
    onError: (error) => errors.push(error),
  }));
  const malformedButton = findElements(malformedTree, (element) => element.type === "button")
    .find((candidate) => textContent(candidate) === "Submit Onchain");
  assert.equal(malformedButton.props.disabled, true);
  await malformedButton.props.onClick();
  assert.deepEqual(errors.pop(), { message: "Signed quote must provide closed own wallet submit fields" });

  const writeFailureTree = WalletSubmitInner(baseProps({
    onError: (error) => errors.push(error),
  }));
  const writeFailureButton = findElements(writeFailureTree, (element) => element.type === "button")
    .find((candidate) => textContent(candidate) === "Submit Onchain");
  assert.equal(writeFailureButton.props.disabled, false);
  await writeFailureButton.props.onClick();
  assert.deepEqual(errors.pop(), { message: "wallet rejected" });
});
