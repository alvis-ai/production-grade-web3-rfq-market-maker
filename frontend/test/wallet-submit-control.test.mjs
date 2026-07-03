import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../src/components/WalletSubmitControl.tsx", import.meta.url), "utf8");

test("WalletSubmitControl rejects expired onchain submit attempts inside the handler", () => {
  for (const expected of [
    "if (!canSubmit) {",
    'onError({ message: "Quote expired; request a new quote" });',
    "return;",
    "writeContractAsync",
  ]) {
    assert.ok(source.includes(expected), expected);
  }
});
