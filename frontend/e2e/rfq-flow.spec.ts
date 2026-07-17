import { expect, test, type Locator, type Page } from "@playwright/test";

const backendOrigin = "http://127.0.0.1:3100";

test("requests, submits, and renders the authoritative RFQ lifecycle", async ({ page, request }) => {
  const pageErrors: Error[] = [];
  page.on("pageerror", (error) => pageErrors.push(error));

  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Production RFQ Trading Console" })).toBeVisible();
  await expect(quoteStateValue(page, "Status")).toHaveText("not requested");
  const amountIn = await page.getByLabel("Amount In").inputValue();

  const quoteResponsePromise = page.waitForResponse((response) =>
    response.request().method() === "POST" && new URL(response.url()).pathname === "/quote"
  );
  await page.getByRole("button", { name: "Request Quote" }).click();
  const quoteResponse = await quoteResponsePromise;
  expect(quoteResponse.ok()).toBe(true);

  await expect(quoteStateValue(page, "Status")).toHaveText("signed");
  const quoteId = await quoteStateValue(page, "Quote ID").innerText();
  const amountOut = await quoteStateValue(page, "Amount Out").innerText();
  expect(quoteId).toMatch(/^[A-Za-z0-9_:-]+$/);
  expect(amountOut).toMatch(/^[1-9][0-9]*$/);
  await expect(quoteStateValue(page, "Amount Out")).not.toHaveText("-");
  await expect(page.getByRole("button", { name: "Simulate API" })).toBeEnabled();

  const submitResponsePromise = page.waitForResponse((response) =>
    response.request().method() === "POST" && new URL(response.url()).pathname === "/submit"
  );
  await page.getByRole("button", { name: "Simulate API" }).click();
  const submitResponse = await submitResponsePromise;
  expect(submitResponse.ok()).toBe(true);

  await expect(quoteStateValue(page, "Status")).toHaveText("settled");
  const txHash = await quoteStateValue(page, "Tx Hash").innerText();
  const settlementEventId = await quoteStateValue(page, "Settlement ID").innerText();
  const hedgeOrderId = await quoteStateValue(page, "Hedge ID").innerText();
  const pnlId = await quoteStateValue(page, "PnL ID").innerText();
  expect(txHash).toMatch(/^0x[0-9a-fA-F]{64}$/);
  expect(settlementEventId).toMatch(/^[A-Za-z0-9_:-]+$/);
  expect(hedgeOrderId).toMatch(/^[A-Za-z0-9_:-]+$/);
  expect(pnlId).toMatch(/^[A-Za-z0-9_:-]+$/);
  await expect(quoteStateValue(page, "Settlement Status")).toHaveText("applied");
  await expect(quoteStateValue(page, "Hedge Status")).toHaveText("queued");

  const [quoteStatusResponse, settlementResponse, hedgeResponse, pnlResponse] = await Promise.all([
    request.get(`${backendOrigin}/quote/${encodeURIComponent(quoteId)}`),
    request.get(`${backendOrigin}/settlements/${encodeURIComponent(settlementEventId)}`),
    request.get(`${backendOrigin}/hedges/${encodeURIComponent(hedgeOrderId)}`),
    request.get(`${backendOrigin}/pnl`),
  ]);
  for (const response of [quoteStatusResponse, settlementResponse, hedgeResponse, pnlResponse]) {
    expect(response.ok()).toBe(true);
  }

  const quoteStatus = await quoteStatusResponse.json() as Record<string, unknown>;
  const settlement = await settlementResponse.json() as Record<string, unknown>;
  const hedge = await hedgeResponse.json() as Record<string, unknown>;
  const pnl = await pnlResponse.json() as { trades?: Array<Record<string, unknown>> };
  const pnlTrade = pnl.trades?.find((trade) => trade.quoteId === quoteId);

  expect(quoteStatus).toMatchObject({
    quoteId,
    status: "settled",
    txHash,
    settlementEventId,
    hedgeOrderId,
    pnlId,
  });
  expect(settlement).toMatchObject({
    settlementEventId,
    status: "applied",
    quoteId,
    txHash,
    amountIn,
    amountOut,
  });
  expect(hedge).toMatchObject({ hedgeOrderId, status: "queued", settlementEventId, quoteId });
  expect(pnlTrade).toMatchObject({ pnlId, quoteId, settlementEventId, amountIn, amountOut });
  await expect(quoteStateValue(page, "Gross PnL (tokenOut)"))
    .toHaveText(String(pnlTrade?.grossPnlTokenOut));
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
