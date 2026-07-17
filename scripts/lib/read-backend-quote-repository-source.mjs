import { readFile } from "node:fs/promises";

export const backendQuoteRepositorySourcePaths = [
  "backend/src/modules/quote/quote.repository.ts",
  "backend/src/modules/quote/quote-repository-contract.ts",
  "backend/src/modules/quote/quote-repository-invariants.ts",
  "backend/src/modules/quote/in-memory-quote.repository.ts",
  "backend/src/modules/quote/postgres-quote-row.ts",
  "backend/src/modules/quote/postgres-quote.repository.ts",
];

export async function readBackendQuoteRepositorySource() {
  return (await Promise.all(backendQuoteRepositorySourcePaths.map((path) => readFile(path, "utf8")))).join("\n");
}
