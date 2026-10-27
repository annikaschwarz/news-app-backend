// Access-control tests. No real chat calls, never touches /agent or Refresh.
import { test, expect } from "@playwright/test";

const WORKER = "https://news-app-backend.annika-schwarz-co.workers.dev";
const signedOut = { cookies: [], origins: [] };

test.describe("signed out", () => {
  test.use({ storageState: signedOut });

  test("a. an unauthenticated visit redirects to /login and /api routes are closed", async ({ page, request }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByLabel("Password")).toBeVisible();
    await expect(page.locator("#chat-input")).toHaveCount(0); // none of the app is served

    // `{}` is rejected by the Worker before any model call, even if the guard ever failed.
    const articles = await request.get("/api/articles", { maxRedirects: 0 });
    expect(articles.status()).toBe(401);
    const chat = await request.post("/api/chat", { data: {}, maxRedirects: 0 });
    expect(chat.status()).toBe(401);
  });

  test("b. a wrong password is rejected and sets no session", async ({ page, context }) => {
    await page.goto("/login");
    await page.getByLabel("Password").fill("definitely-not-the-password-" + Date.now());
    await page.getByRole("button", { name: "Log in" }).click();

    await expect(page.getByRole("alert")).toHaveText("Wrong password.");
    await expect(page).toHaveURL(/\/login$/);
    expect((await context.cookies()).some((c) => c.name === "__Host-session")).toBe(false);
    await page.goto("/");
    await expect(page).toHaveURL(/\/login$/); // still locked out
  });

  test("c. the Worker's /chat and /articles return 401 without the internal key", async ({ request }) => {
    const bad = { "X-Internal-Key": "not-the-key" };
    expect((await request.get(`${WORKER}/articles`)).status()).toBe(401);
    expect((await request.get(`${WORKER}/articles`, { headers: bad })).status()).toBe(401);
    expect((await request.post(`${WORKER}/chat`, { data: { question: "hi", model: "haiku" } })).status()).toBe(401);
    expect((await request.post(`${WORKER}/chat`, { data: { question: "hi" }, headers: bad })).status()).toBe(401);
    expect((await request.get(`${WORKER}/health`)).status()).toBe(200); // still public
  });
});

test("log out ends the session", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#chat-input")).toBeVisible();
  await page.getByRole("link", { name: "Log out" }).click();
  await expect(page).toHaveURL(/\/login$/);

  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
  expect((await page.request.get("/api/articles", { maxRedirects: 0 })).status()).toBe(401);
});
