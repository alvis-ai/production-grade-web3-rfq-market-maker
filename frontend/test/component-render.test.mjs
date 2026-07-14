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
const reactUrl = pathToFileURL(require.resolve("react")).href;
const reactJsxRuntimeUrl = pathToFileURL(require.resolve("react/jsx-runtime")).href;
const tempDir = await mkdtemp(join(tmpdir(), "rfq-frontend-component-test-"));
let transpiledModuleCounter = 0;

async function transpileFrontendModule(relativePath, transformSource = (source) => source) {
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
  const moduleText = outputText
    .replaceAll('"react/jsx-runtime"', JSON.stringify(reactJsxRuntimeUrl))
    .replaceAll('"react"', JSON.stringify(reactUrl));
  const modulePath = join(tempDir, `module-${transpiledModuleCounter++}.mjs`);
  await writeFile(modulePath, moduleText);
  return pathToFileURL(modulePath).href;
}

async function transpileQuoteFormModule() {
  const integerInputUrl = await transpileFrontendModule("../src/lib/integer-input.ts");
  return transpileFrontendModule("../src/components/QuoteForm.tsx", (source) =>
    source.replace(
      'import { parseIntegerInput } from "../lib/integer-input";',
      `import { parseIntegerInput } from ${JSON.stringify(integerInputUrl)};`,
    ),
  );
}

async function importQuoteFormModule() {
  return import(await transpileQuoteFormModule());
}

async function transpileQuoteStatusPanelModule() {
  return transpileFrontendModule("../src/components/QuoteStatusPanel.tsx");
}

async function importQuoteStatusPanelModule() {
  return import(await transpileQuoteStatusPanelModule());
}

async function importQuotePageModule() {
  const quoteFormUrl = await transpileQuoteFormModule();
  const quoteStatusPanelUrl = await transpileQuoteStatusPanelModule();
  const quotePageUrl = await transpileFrontendModule("../src/pages/QuotePage.tsx", (source) =>
    source
      .replace(
        'import { QuoteForm } from "../components/QuoteForm";',
        `import { QuoteForm } from ${JSON.stringify(quoteFormUrl)};`,
      )
      .replace(
        'import { QuoteStatusPanel } from "../components/QuoteStatusPanel";',
        `import { QuoteStatusPanel } from ${JSON.stringify(quoteStatusPanelUrl)};`,
      )
      .replace(
        'import { useQuoteLifecyclePolling } from "../hooks/useQuoteLifecyclePolling";',
        "const useQuoteLifecyclePolling = () => ({ isPolling: false, pollingError: undefined });",
      )
      .replace(
        'import { toUIError, type UIError } from "../lib/errors";',
        'const toUIError = (caught, fallback) => ({ message: caught instanceof Error ? caught.message : fallback });',
      )
      .replace(
        'import { rfqApiBaseUrl, rfqSettlementAddress } from "../lib/config";',
        'const rfqApiBaseUrl = "http://localhost:3000";\nconst rfqSettlementAddress = "0x0000000000000000000000000000000000000004";',
      )
      .replace(
        /import \{\s*loadQuoteLifecycle,\s*type QuoteLifecycleSnapshot,\s*\} from "\.\.\/lib\/quote-lifecycle";/,
        "const loadQuoteLifecycle = async () => { throw new Error('mock lifecycle should not be called during server render'); };",
      )
      .replace(
        'import { buildQuoteFromResponse, rfqClient } from "../lib/rfq";',
        [
          "const buildQuoteFromResponse = (request, response) => ({",
          "  user: request.user,",
          "  tokenIn: request.tokenIn,",
          "  tokenOut: request.tokenOut,",
          "  amountIn: request.amountIn,",
          "  amountOut: response.amountOut,",
          "  minAmountOut: response.minAmountOut,",
          "  nonce: response.nonce,",
          "  deadline: response.deadline,",
          "  chainId: request.chainId,",
          "});",
          "const rfqClient = {",
          "  quote: async () => { throw new Error('mock quote should not be called during server render'); },",
          "  submit: async () => { throw new Error('mock submit should not be called during server render'); },",
          "  getQuote: async () => { throw new Error('mock getQuote should not be called during server render'); },",
          "  getSettlement: async () => { throw new Error('mock getSettlement should not be called during server render'); },",
          "  getHedge: async () => { throw new Error('mock getHedge should not be called during server render'); },",
          "  pnl: async () => { throw new Error('mock pnl should not be called during server render'); },",
          "};",
        ].join("\n"),
      )
      .replace(
        'import { validateQuoteFormRequest } from "../lib/quote-request";',
        "const validateQuoteFormRequest = (request) => request;",
      ),
  );
  return import(quotePageUrl);
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

function findElement(root, predicate) {
  const [match] = findElements(root, predicate);
  assert.ok(match, "expected React element to exist");
  return match;
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

const request = Object.freeze({
  chainId: 1,
  user: "0x1111111111111111111111111111111111111111",
  tokenIn: "0x2222222222222222222222222222222222222222",
  tokenOut: "0x3333333333333333333333333333333333333333",
  amountIn: "1000000000000000000",
  slippageBps: 50,
});

test("QuotePage component renders the initial trading workspace", async () => {
  const { QuotePage } = await importQuotePageModule();
  const markup = renderToStaticMarkup(createElement(QuotePage));

  for (const expected of [
    "RFQ / Prop AMM",
    "Production RFQ Trading Console",
    "API http://localhost:3000",
    "Request Quote",
    "Quote State",
    "not requested",
    "Enable Wallet",
    "Simulate API",
    "Refresh",
    "0x0000000000000000000000000000000000000002",
    "0x0000000000000000000000000000000000000003",
    "0x0000000000000000000000000000000000000004",
    "1000000000",
  ]) {
    assert.ok(markup.includes(expected), expected);
  }

  assert.match(markup, /aria-label="RFQ trading workspace"/);
  assert.match(markup, /value="1"/);
  assert.match(markup, /value="50"/);
  assert.match(markup, /disabled="">Simulate API<\/button>/);
  assert.match(markup, /class="secondary-button" disabled="">Refresh<\/button>/);
});

test("QuoteForm component invokes controlled field changes and submit handlers", async () => {
  const { QuoteForm } = await importQuoteFormModule();
  const changes = [];
  let submitCount = 0;
  const props = {
    request,
    isLoading: false,
    onChange: (nextRequest) => changes.push(nextRequest),
    onSubmit: () => {
      submitCount += 1;
    },
  };

  const markup = renderToStaticMarkup(createElement(QuoteForm, props));
  assert.match(markup, /<form class="panel">/);
  assert.match(markup, /Request Quote/);

  const tree = QuoteForm(props);
  const inputs = findElements(tree, (element) => element.type === "input");
  assert.deepEqual(
    inputs.map((input) => input.props.value),
    [request.chainId, request.tokenIn, request.tokenOut, request.amountIn, request.slippageBps],
  );

  inputs[1].props.onChange({ target: { value: "0x4444444444444444444444444444444444444444" } });
  assert.deepEqual(changes.pop(), {
    ...request,
    tokenIn: "0x4444444444444444444444444444444444444444",
  });

  inputs[0].props.onChange({ target: { value: "1e3" } });
  assert.equal(changes.length, 0);
  inputs[0].props.onChange({ target: { value: "8453" } });
  assert.deepEqual(changes.pop(), { ...request, chainId: 8453 });

  inputs[4].props.onChange({ target: { value: "10001" } });
  assert.equal(changes.length, 0);
  inputs[4].props.onChange({ target: { value: "0" } });
  assert.deepEqual(changes.pop(), { ...request, slippageBps: 0 });

  const form = findElement(tree, (element) => element.type === "form");
  let defaultPrevented = false;
  form.props.onSubmit({
    preventDefault() {
      defaultPrevented = true;
    },
  });
  assert.equal(defaultPrevented, true);
  assert.equal(submitCount, 1);

  const loadingTree = QuoteForm({ ...props, isLoading: true });
  const loadingButton = findElement(loadingTree, (element) => element.type === "button");
  assert.equal(loadingButton.props.disabled, true);
  assert.equal(textContent(loadingButton), "Requesting...");
});

test("QuoteStatusPanel component renders post-trade state and wires actions", async () => {
  const { QuoteStatusPanel } = await importQuoteStatusPanelModule();
  let submitCount = 0;
  let refreshCount = 0;
  let onchainCount = 0;
  const props = {
    quote: {
      quoteId: "q_component",
      snapshotId: "snapshot_component",
      amountOut: "990000000000000000",
      minAmountOut: "980000000000000000",
      deadline: 1893456000,
      nonce: "77",
      signature: `0x${"11".repeat(64)}1b`,
    },
    quoteStatus: {
      quoteId: "q_component",
      status: "settled",
      txHash: `0x${"22".repeat(32)}`,
      settlementEventId: "se_component",
      hedgeOrderId: "h_component",
      pnlId: "pnl_component",
    },
    settlementStatus: {
      settlementEventId: "se_component",
      status: "applied",
      quoteHash: `0x${"33".repeat(32)}`,
      blockNumber: 12345,
      nonce: "77",
    },
    hedgeStatus: {
      hedgeOrderId: "h_component",
      status: "filled",
      externalOrderId: "cex_order_component",
      updatedAt: "2026-07-04T00:00:01.000Z",
    },
    pnlSummary: {
      trades: [{
        pnlId: "pnl_component",
        grossPnlTokenOut: "123456",
      }],
    },
    submitResult: {
      status: "accepted",
      txHash: `0x${"44".repeat(32)}`,
      settlementEventId: "se_fallback",
      hedgeOrderId: "h_fallback",
      pnlId: "pnl_fallback",
    },
    error: {
      message: "Rate limited",
      code: "RATE_LIMITED",
      status: 429,
      traceId: "trace_component",
      retryAfterSeconds: 12,
    },
    canSubmit: true,
    isStatusPolling: true,
    expiresInSeconds: 42,
    walletAddress: request.user,
    activeChainId: request.chainId,
    settlementAddress: "0x5555555555555555555555555555555555555555",
    onSubmit: () => {
      submitCount += 1;
    },
    onRefresh: () => {
      refreshCount += 1;
    },
    onchainAction: createElement(
      "button",
      {
        type: "button",
        onClick: () => {
          onchainCount += 1;
        },
      },
      "Mock Onchain",
    ),
  };

  const markup = renderToStaticMarkup(createElement(QuoteStatusPanel, props));
  for (const expected of [
    "q_component",
    "snapshot_component",
    "Status Tracking",
    "active",
    "42s",
    "se_component",
    "applied",
    "77",
    "h_component",
    "filled",
    "cex_order_component",
    "2026-07-04T00:00:01.000Z",
    "pnl_component",
    "123456",
    "Rate limited",
    "RATE_LIMITED",
    "trace_component",
    "12s",
    "submitQuote(Quote, signature)",
    "Mock Onchain",
  ]) {
    assert.ok(markup.includes(expected), expected);
  }

  const tree = QuoteStatusPanel(props);
  const buttons = findElements(tree, (element) => element.type === "button");
  const submitButton = buttons.find((button) => textContent(button) === "Simulate API");
  const onchainButton = buttons.find((button) => textContent(button) === "Mock Onchain");
  const refreshButton = buttons.find((button) => textContent(button) === "Refresh");
  assert.ok(submitButton);
  assert.ok(onchainButton);
  assert.ok(refreshButton);
  assert.equal(submitButton.props.disabled, false);
  assert.equal(refreshButton.props.disabled, false);

  submitButton.props.onClick();
  onchainButton.props.onClick();
  refreshButton.props.onClick();
  assert.equal(submitCount, 1);
  assert.equal(onchainCount, 1);
  assert.equal(refreshCount, 1);

  const emptyTree = QuoteStatusPanel({
    canSubmit: false,
    isStatusPolling: false,
    onSubmit: () => {
      throw new Error("submit should be disabled");
    },
    onRefresh: () => {
      throw new Error("refresh should be disabled without quote");
    },
  });
  const emptyButtons = findElements(emptyTree, (element) => element.type === "button");
  assert.equal(emptyButtons.find((button) => textContent(button) === "Simulate API")?.props.disabled, true);
  assert.equal(emptyButtons.find((button) => textContent(button) === "Refresh")?.props.disabled, true);
});
