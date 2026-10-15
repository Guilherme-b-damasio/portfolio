import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.E2E_PORT ?? 3199);

// Smoke tests against the real server: no LLM key, so `ask` answers with the BM25 passages alone.
// Locally E2E_CHANNEL=chrome (or msedge) reuses an installed browser instead of downloading one.
export default defineConfig({
  testDir: "e2e",
  testMatch: "*.e2e.ts",
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], channel: process.env.E2E_CHANNEL } },
    {
      name: "phone",
      use: { ...devices["Pixel 7"], viewport: { width: 375, height: 812 }, channel: process.env.E2E_CHANNEL },
    },
  ],
  webServer: {
    command: "npx tsx src/main.ts",
    url: `http://127.0.0.1:${port}/healthz`,
    // Every test asks from the same address, so the per-visitor question bucket is widened for the run.
    env: { PORT: String(port), ANTHROPIC_API_KEY: "", RESEND_API_KEY: "", ASK_RATE_PER_MINUTE: "60" },
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
