import { readFile } from "node:fs/promises";

export const sdkClientSourcePaths = [
  "sdk/src/client.ts",
  "sdk/src/client-error.ts",
  "sdk/src/client-request.ts",
  "sdk/src/client-response-validation.ts",
  "sdk/src/client-trading-responses.ts",
  "sdk/src/client-accounting-responses.ts",
  "sdk/src/client-pnl-page.ts",
];

export async function readSdkClientSource() {
  return (await Promise.all(sdkClientSourcePaths.map((path) => readFile(path, "utf8")))).join("\n");
}
