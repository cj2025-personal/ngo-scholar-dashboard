/**
 * A new story asked for in words, with nothing chosen up front.
 *
 * The scholar says they want to write from a paper; the agent shows the
 * papers as cards in the thread. They tap one, describe the article, and
 * the agent plans it. Said the other way round, the brief comes first, the
 * agent asks which paper, then who it is for, then plans. A reader named
 * in the brief is understood without being asked. Every assertion is on
 * rendered content.
 */

const { test, expect } = require("@playwright/test");

const { openAgent, freshConversation } = require("./agent");
const { readState } = require("./stack");

test.beforeEach(async ({ context }) => {
  const state = readState();
  await context.addCookies([{ name: "sd_session", value: state.token, domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax" }]);
  await freshConversation(context);
});

test("asking to write from a paper brings the papers as cards; a reader named in the brief is understood", async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto("/editorial/new");
  await openAgent(page);
  const box = page.getByPlaceholder(/Describe the article you want/);
  await expect(page.locator(".ch-msg.is-agent").first()).toContainText("What shall we write");
  /* The pickers are there from the start, with no paper chosen yet. */
  await expect(page.getByLabel("Paper", { exact: true })).toHaveValue("");

  await box.fill("I want to write from one of my papers");
  await page.getByRole("button", { name: "Send" }).click();
  const cards = page.locator(".ch-msg.is-papers .ch-paper:not(.is-brief)");
  await expect(cards).toHaveCount(3);
  await cards.filter({ hasText: "Adaptive nulling" }).click();
  await expect(page.locator(".ch-msg.is-user").last()).toContainText("Use “Adaptive nulling");
  await expect(page.locator(".ch-msg.is-agent").last()).toContainText("Working from");
  await expect(page.getByLabel("Paper", { exact: true }).locator("option:checked")).toContainText("Adaptive nulling");
  await expect(page.getByLabel("Reader age")).toHaveValue("adults");

  /* The brief names the reader; no question is asked. */
  await box.fill("Focus on what the field trials showed, written for teenagers");
  await box.press("Enter");
  await expect(page.locator(".ch-msg.is-outline").first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator(".ch-context")).toContainText("for ages 15–18");
  await expect(page.locator(".ch-context.is-locked")).toContainText("Set for this draft");
});

test("a brief said first is kept; the agent asks which paper, then who it is for, then plans", async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto("/editorial/new");
  await openAgent(page);
  const box = page.getByPlaceholder(/Describe the article you want/);
  await box.fill("Explain how the experiment was actually done, step by step, and be honest about its limits");
  await box.press("Enter");
  await expect(page.locator(".ch-msg.is-papers .ch-paper:not(.is-brief)")).toHaveCount(3);
  await page.locator(".ch-msg.is-papers .ch-paper").filter({ hasText: "Second paper" }).click();

  /* One question left, with the answer one tap away. */
  const chips = page.locator(".ch-msg.is-audience .ch-chip");
  await expect(chips).toHaveCount(4);
  await expect(page.getByPlaceholder(/Tap an age above/)).toBeVisible();
  await chips.filter({ hasText: "Ages 12–14" }).click();
  await expect(page.locator(".ch-msg.is-user").last()).toContainText("For ages 12–14.");
  await expect(page.locator(".ch-msg.is-outline").first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator(".ch-context")).toContainText("Second paper");
  await expect(page.locator(".ch-context")).toContainText("for ages 12–14");
  /* The outline is planned from the brief said first. */
  await expect(page.locator(".ch-outline-title")).toBeVisible();
});

test("a paper named in the first message is matched without a question", async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto("/editorial/new");
  await openAgent(page);
  const box = page.getByPlaceholder(/Describe the article you want/);
  await box.fill("From my adaptive nulling antenna arrays paper: why the four-interferer limit matters");
  await box.press("Enter");
  await expect(page.locator(".ch-msg.is-papers")).toHaveCount(0);
  await expect(page.locator(".ch-msg.is-audience .ch-chip")).toHaveCount(4);
  await page.locator(".ch-msg.is-audience .ch-chip").filter({ hasText: "Adults" }).click();
  await expect(page.locator(".ch-msg.is-outline").first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator(".ch-context")).toContainText("Adaptive nulling");
});
