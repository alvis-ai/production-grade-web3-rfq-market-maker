import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../src/pages/QuotePage.tsx", import.meta.url), "utf8");

test("QuotePage binds signed quotes to the quoted request snapshot", () => {
  assert.match(source, /const \[quotedRequest, setQuotedRequest\] = useState<QuoteRequest>\(\);/);
  assert.match(source, /const quoteSessionVersion = useRef\(0\);/);
  assert.match(source, /setQuotedRequest\(safeRequest\);/);
  assert.match(source, /return buildQuoteFromResponse\(quotedRequest, quote\);/);
  assert.match(source, /\}, \[quote, quotedRequest\]\);/);
});

test("QuotePage clears quote session when request changes", () => {
  for (const expected of [
    "const clearQuoteSession = useCallback(() => {",
    "quoteSessionVersion.current += 1;",
    "setQuotedRequest(undefined);",
    "setQuote(undefined);",
    "setSubmitResult(undefined);",
    "setQuoteStatus(undefined);",
    "setSettlementStatus(undefined);",
    "setHedgeStatus(undefined);",
    "setPnlSummary(undefined);",
    "setChainTxHash(undefined);",
    "const handleRequestChange = useCallback((nextRequest: QuoteRequest) => {",
    "clearQuoteSession();",
    "onChange={handleRequestChange}",
  ]) {
    assert.ok(source.includes(expected), expected);
  }
});

test("QuotePage ignores stale quote responses after request edits", () => {
  for (const expected of [
    "const quoteSession = quoteSessionVersion.current;",
    "if (quoteSessionVersion.current !== quoteSession) return;",
    "if (quoteSessionVersion.current === quoteSession) {",
    "setIsLoading(false);",
  ]) {
    assert.ok(source.includes(expected), expected);
  }
});
