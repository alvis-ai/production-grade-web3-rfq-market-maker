import { expect, test, type Locator, type Page } from "@playwright/test";

const backendOrigin = "http://127.0.0.1:3100";

test("requests, submits, and renders the authoritative RFQ lifecycle", async ({ page }) => {
  const pageErrors: Error[] = [];
  page.on("pageerror", (error) => pageErrors.push(error));

  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Production RFQ Trading Console" })).toBeVisible();
  await expect(quoteStateValue(page, "Status")).toHaveText("not requested");

  const quoteResponsePromise = page.waitForResponse((response) =>
    response.request().method() === "POST" && new URL(response.url()).pathname === "/quote"
  );
  await page.getByRole("button", { name: "Request Quote" }).click();
  const quoteResponse = await quoteResponsePromise;
  expect(quoteResponse.ok()).toBe(true);
  const quote = await quoteResponse.json() as Record<string, unknown>;
  expect(quote.quoteId).toEqual(expect.any(String));

  await expect(quoteStateValue(page, "Status")).toHaveText("signed");
  await expect(quoteStateValue(page, "Quote ID")).toHaveText(String(quote.quoteId));
  await expect(quoteStateValue(page, "Amount Out")).not.toHaveText("-");
  await expect(page.getByRole("button", { name: "Simulate API" })).toBeEnabled();

  const submitResponsePromise = page.waitForResponse((response) =>
    response.request().method() === "POST" && new URL(response.url()).pathname === "/submit"
  );
  await page.getByRole("button", { name: "Simulate API" }).click();
  const submitResponse = await submitResponsePromise;
  expect(submitResponse.ok()).toBe(true);
  const submit = await submitResponse.json() as Record<string, unknown>;
  expect(submit.status).toBe("accepted");

  await expect(quoteStateValue(page, "Status")).toHaveText("settled");
  await expect(quoteStateValue(page, "Tx Hash")).toHaveText(String(submit.txHash));
  await expect(quoteStateValue(page, "Settlement ID")).toHaveText(String(submit.settlementEventId));
  await expect(quoteStateValue(page, "Settlement Status")).toHaveText("applied");
  await expect(quoteStateValue(page, "Hedge ID")).toHaveText(String(submit.hedgeOrderId));
  await expect(quoteStateValue(page, "Hedge Status")).toHaveText("queued");
  await expect(quoteStateValue(page, "PnL ID")).toHaveText(String(submit.pnlId));
  await expect(quoteStateValue(page, "Gross PnL (tokenOut)")).toHaveText("1600000");
  expect(pageErrors).toEqual([]);
});

test("rejects an invalid pair before sending a quote request", async ({ page }) => {
  let quoteRequestCount = 0;
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.origin === backendOrigin && url.pathname === "/quote") quoteRequestCount += 1;
  });

  await page.goto("/");
  const tokenIn = await page.getByLabel("Token In").inputValue();
  await page.getByLabel("Token Out").fill(tokenIn);
  await page.getByRole("button", { name: "Request Quote" }).click();

  await expect(page.getByRole("alert")).toContainText("tokenIn and tokenOut must be different");
  expect(quoteRequestCount).toBe(0);
  await expect(quoteStateValue(page, "Status")).toHaveText("not requested");
});

function quoteStateValue(page: Page, label: string): Locator {
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return page
    .locator(".quote-state > div")
    .filter({ has: page.locator("dt", { hasText: new RegExp(`^${escapedLabel}$`) }) })
    .locator("dd");
}
