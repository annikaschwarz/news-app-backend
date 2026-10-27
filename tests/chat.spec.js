// End-to-end tests for the chat feature on the live site.
//
// Rules: never click Refresh or hit /agent (costs credits, has a cooldown, needs a secret),
// and make exactly ONE real /chat call (scenario 4, Haiku, short question). Everything else
// is free: page checks, or /chat mocked in the browser.
import { test, expect } from "@playwright/test";

const QUESTION = "Top AI funding news?";

// Safety net: any request to the paid/secret endpoints is blocked and fails the test.
let forbidden;
test.beforeEach(async ({ context }) => {
  forbidden = [];
  await context.route(/\/(agent|api\/refresh)(\?|$)/, (route) => {
    forbidden.push(route.request().url());
    return route.abort();
  });
});
test.afterEach(() => {
  expect(forbidden, "tests must never call /agent or /api/refresh").toEqual([]);
});

// Fake Worker response for mocked scenarios (with CORS so the browser accepts it).
const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "*" };
function mockChat(page, status, body) {
  return page.route("**/chat", (route) =>
    route.request().method() === "OPTIONS"
      ? route.fulfill({ status: 204, headers: CORS })
      : route.fulfill({ status, headers: CORS, contentType: "application/json", body: JSON.stringify(body) }),
  );
}
const okBody = (over = {}) => ({
  answer: "**Takeaway:** Test answer [1].\n\n**Why it matters:** It is mocked.\n\n**What to watch:** Nothing.",
  model: "claude-haiku-5-5",
  articles_used: 1,
  context_tokens_estimate: 150,
  sources: [{ n: 1, headline: "Mock headline", source: "Mock Source", url: "https://example.com/a" }],
  web_search: { enabled: false, used: false, searches: 0, max_searches: 2, sources: [] },
  usage: { input_tokens: 500, output_tokens: 80 },
  truncated: false,
  ...over,
});

async function ask(page, text) {
  await page.locator("#chat-input").fill(text);
  await page.locator("#chat-send").click();
}
const lastBot = (page) => page.locator("#chat-log .msg.bot").last();

// 1 ---------------------------------------------------------------------------------------
test("1. page loads with the right title and the chat visible without scrolling", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

  await page.goto("/");
  await expect(page).toHaveTitle("AI Investment News");
  await expect(page.getByRole("heading", { name: "Ask about the news" })).toBeVisible();
  await expect(page.locator("#chat-input")).toBeInViewport();
  await expect(page.locator("#chat-send")).toBeInViewport();
  await expect(page.locator(".card").first()).toBeVisible(); // articles load from the public /articles
  expect(errors).toEqual([]);
});

// 2 ---------------------------------------------------------------------------------------
test("2. model selector offers Haiku and Sonnet, no Opus, Haiku by default", async ({ page }) => {
  await page.goto("/");
  const select = page.locator("#chat-model");
  const labels = await select.locator("option").allTextContents();
  expect(labels.length).toBeGreaterThanOrEqual(2);
  expect(labels.join("|")).toMatch(/Haiku/);
  expect(labels.join("|")).toMatch(/Sonnet/);
  expect(labels.join("|")).not.toMatch(/Opus/i);
  await expect(select).toHaveValue("haiku");
});

// 3 ---------------------------------------------------------------------------------------
test("3. Under the Hood expands and has a web search toggle that is remembered", async ({ page }) => {
  await page.goto("/");
  const hood = page.locator("#hood");
  const toggle = page.locator("#web-toggle");

  await expect(hood).not.toHaveAttribute("open", /.*/); // collapsed by default
  await expect(toggle).toBeHidden();

  await page.getByText("Under the Hood", { exact: true }).click();
  await expect(hood).toHaveAttribute("open", /.*/);
  await expect(toggle).toBeVisible();
  await expect(toggle).not.toBeChecked(); // off by default
  for (const id of ["st-articles", "st-context", "st-in", "st-out", "st-web"]) {
    await expect(page.locator("#" + id)).toHaveText("–"); // empty before any question
  }

  await toggle.check();
  await page.reload();
  await page.getByText("Under the Hood", { exact: true }).click();
  await expect(toggle).toBeChecked(); // remembered across reloads
  await toggle.uncheck(); // leave no state behind
  await expect(toggle).not.toBeChecked();
});

// 4 ---------------------------------------------------------------------------------------
test("4. a chat question gets a sourced reply within 15 seconds (the one real API call)", async ({ page }) => {
  await page.goto("/");
  await page.locator("#chat-model").selectOption("haiku");
  await expect(page.locator("#web-toggle")).not.toBeChecked();

  const started = Date.now();
  await ask(page, QUESTION);
  const badge = page.locator("#chat-log .web-badge"); // only rendered once an answer arrives
  await expect(badge).toBeVisible({ timeout: 15_000 });
  expect(Date.now() - started).toBeLessThan(15_000);

  const reply = lastBot(page);
  await expect(reply).not.toHaveClass(/error/);
  expect(((await reply.locator("p, li").first().textContent()) ?? "").trim().length).toBeGreaterThan(0);
  expect(await reply.locator(".sources a").count()).toBeGreaterThanOrEqual(1);
  await expect(badge).toHaveText("Database only");

  const usage = (await reply.locator(".usage").textContent()) ?? "";
  const m = usage.match(/^Haiku · ([\d,]+) tokens in · ([\d,]+) tokens out/);
  expect(m, `usage line was: ${usage}`).not.toBeNull();
  expect(Number(m[1].replace(/,/g, ""))).toBeGreaterThan(0);
  expect(Number(m[2].replace(/,/g, ""))).toBeGreaterThan(0);

  // Under the Hood stats are filled in
  const articles = Number(await page.locator("#st-articles").textContent());
  expect(articles).toBeGreaterThanOrEqual(1);
  expect(articles).toBeLessThanOrEqual(8);
  await expect(page.locator("#st-context")).toHaveText(/^~[\d,]+$/);
  await expect(page.locator("#st-web")).toHaveText("Off");
  await expect(page.locator("#chat-send")).toBeEnabled();

  // Soft check only: exact wording is up to the model.
  for (const label of ["Takeaway:", "Why it matters:", "What to watch:"]) {
    expect.soft(await reply.textContent(), `answer should contain "${label}"`).toContain(label);
  }
});

// 5 (all mocked: no API cost) ---------------------------------------------------------------
test.describe("5. limits, failures and display (mocked /chat)", () => {
  test("5a. question box stops at 500 characters", async ({ page }) => {
    await page.goto("/");
    await page.locator("#chat-input").click();
    await page.keyboard.type("x".repeat(600), { delay: 0 });
    await expect(page.locator("#chat-input")).toHaveValue("x".repeat(500));
    await expect(page.locator("#chat-count")).toHaveText("500/500");
  });

  test("5b. server errors and network failures show a friendly message", async ({ page }) => {
    await page.goto("/");

    await mockChat(page, 500, { error: "Internal error", detail: "TypeError: secret stack trace at foo.js:1" });
    await ask(page, QUESTION);
    await expect(lastBot(page)).toHaveClass(/error/);
    await expect(lastBot(page)).toHaveText("Internal error");
    await expect(lastBot(page)).not.toContainText("stack trace");
    await expect(page.locator("#chat-send")).toBeEnabled();

    await page.unroute("**/chat");
    await mockChat(page, 429, { error: 'Model "haiku" is unavailable right now; try another model or retry later.' });
    await ask(page, QUESTION);
    await expect(lastBot(page)).toHaveClass(/error/);
    await expect(lastBot(page)).toContainText("try another model");
    await expect(page.locator("#chat-send")).toBeEnabled();

    await page.unroute("**/chat");
    await page.route("**/chat", (route) => route.abort());
    await ask(page, QUESTION);
    await expect(lastBot(page)).toContainText("Couldn't reach the server");
    await expect(page.locator("#chat-send")).toBeEnabled();
  });

  test("5c. truncated answers get a note; web search use is shown", async ({ page }) => {
    await page.goto("/");

    await mockChat(page, 200, okBody({ truncated: true }));
    await ask(page, QUESTION);
    await expect(lastBot(page).locator(".warn")).toContainText("cut short");
    await expect(lastBot(page).locator(".web-badge")).toHaveText("Database only");

    await page.unroute("**/chat");
    await mockChat(
      page,
      200,
      okBody({
        web_search: {
          enabled: true,
          used: true,
          searches: 1,
          max_searches: 2,
          sources: [{ title: "Mock web page", url: "https://example.com/web" }],
        },
      }),
    );
    await ask(page, QUESTION);
    await expect(lastBot(page).locator(".web-badge")).toHaveText("🌐 Web search used (1 search)");
    await expect(lastBot(page).locator(".sources.web a")).toHaveAttribute("href", "https://example.com/web");
    await expect(page.locator("#st-web")).toHaveText("Used (1 of max 2)");
    await expect(lastBot(page).locator(".usage")).toContainText("500 tokens in · 80 tokens out");
  });
});
