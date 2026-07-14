import { defineConfig } from "@playwright/test";

const backendUrl = "http://127.0.0.1:3100";
const frontendUrl = "http://127.0.0.1:4173";
const browserChannel = process.env.RFQ_E2E_BROWSER_CHANNEL;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 30_000,
  expect: {
    timeout: 10_000,
  },
  reporter: process.env.CI
    ? [["line"], ["html", { open: "never" }]]
    : "list",
  use: {
    baseURL: frontendUrl,
    browserName: "chromium",
    ...(browserChannel ? { channel: browserChannel } : {}),
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: browserChannel ? "off" : "retain-on-failure",
  },
  webServer: [
    {
      command: "node ../backend/dist/main.js",
      url: `${backendUrl}/ready`,
      env: {
        ...process.env,
        HOST: "127.0.0.1",
        PORT: "3100",
        RFQ_CORS_ALLOWED_ORIGINS: frontendUrl,
      },
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: "pnpm dev --host 127.0.0.1 --port 4173 --strictPort",
      url: frontendUrl,
      env: {
        ...process.env,
        VITE_RFQ_API_BASE_URL: backendUrl,
      },
      reuseExistingServer: false,
      timeout: 30_000,
    },
  ],
});
