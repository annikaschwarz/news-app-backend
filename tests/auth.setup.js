// Logs in once with SITE_PASSWORD and saves the session for the other tests.
import { test as setup, expect } from "@playwright/test";
import { STATE_FILE, sitePassword } from "./env.js";

// Traces, screenshots and videos could capture the typed password, so keep them off here.
setup.use({ trace: "off", screenshot: "off", video: "off" });

setup("log in and check the session cookie is hardened", async ({ page, context }) => {
  await page.goto("/login");
  await page.getByLabel("Password").fill(sitePassword());
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/$/);

  const cookie = (await context.cookies()).find((c) => c.name === "__Host-session");
  expect(cookie, "session cookie should be set").toBeTruthy();
  expect(cookie.httpOnly).toBe(true);
  expect(cookie.secure).toBe(true);
  expect(cookie.sameSite).toBe("Lax");
  const days = (cookie.expires - Date.now() / 1000) / 86400;
  expect(days).toBeGreaterThan(6.9);
  expect(days).toBeLessThanOrEqual(7.01);

  await context.storageState({ path: STATE_FILE });
});
