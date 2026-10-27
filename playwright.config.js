import { defineConfig, devices } from "@playwright/test";
import { STATE_FILE } from "./tests/env.js";

// End-to-end tests for the deployed Pages site. Override with BASE_URL to test elsewhere.
// The "setup" project logs in once (SITE_PASSWORD from the environment or .env) and the
// "chromium" project reuses that session.
export default defineConfig({
  testDir: "tests",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  retries: 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: process.env.BASE_URL || "https://news-intelligence-f19.pages.dev",
    viewport: { width: 1280, height: 800 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.js/ },
    {
      name: "chromium",
      testIgnore: /auth\.setup\.js/,
      dependencies: ["setup"],
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 }, storageState: STATE_FILE },
    },
  ],
});
