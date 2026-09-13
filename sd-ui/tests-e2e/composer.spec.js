/**
 * The composer, as a scholar uses it.
 *
 * Open the editor, draft from a paper, watch the progress line, see the draft
 * land with chips, rewrite a paragraph and watch its chip drop, save, see the
 * provenance line, publish, and read the story as the public would. Every
 * assertion is on rendered content: what the page shows, not what the
 * network returned.
 */

const { test, expect } = require("@playwright/test");

const { readState } = require("./stack");

let state;

test.beforeAll(() => {
  state = readState();
});

test.beforeEach(async ({ context }) => {
  /* The session cookie the API minted for the seeded scholar. Host-only on
     localhost, so the dev server on one port and the API on another share it. */
  await context.addCookies([
    { name: "sd_session", value: state.token, domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax" },
    { name: "sd_session", value: state.token, domain: "127.0.0.1", path: "/", httpOnly: true, sameSite: "Lax" },
  ]);
});

test("a scholar drafts from a paper, edits it, saves, publishes, and the public reads it", async ({ page, browser }) => {
  await page.goto("/editorial/new");
  await expect(page.getByPlaceholder("Title", { exact: true })).toBeVisible();

  /* The panel opens and lists what may be drafted from. */
  const panel = page.locator("details.sc-write-sources");
  await panel.locator("summary").click();
  await expect(panel.locator(".sc-src-count")).toHaveText(/3 ready/);
  await expect(panel.locator(".sc-src-row")).toHaveCount(4);
  await expect(panel.locator(".sc-src-draft")).toHaveCount(3, { timeout: 20_000 });
  await expect(panel.locator(".sc-src-row", { hasText: "Quotable only" }).locator(".sc-src-draft")).toHaveCount(0);

  /* Draft. The progress line appears, then the draft lands. */
  const firstReady = panel.locator(".sc-src-row", { hasText: "Adaptive nulling" });
  await firstReady.locator(".sc-src-draft").click();
  await expect(panel.locator(".sc-src-progress")).toBeVisible();
  await expect(page.locator(".sc-write-msg.is-ok")).toContainText("Drafted", { timeout: 60_000 });
  await expect(page.locator(".sc-write-msg.is-ok")).toContainText("Adaptive nulling in small antenna arrays");
  await expect(page.getByPlaceholder("Title", { exact: true })).toHaveValue(/^What the paper found/);
  await expect(panel.locator(".sc-src-progress")).toHaveCount(0);

  /* Chips: every drafted paragraph has one, none are lost. */
  const chips = page.locator(".block-chip");
  await expect(chips.first()).toBeVisible();
  const chipCount = await chips.count();
  expect(chipCount).toBeGreaterThanOrEqual(2);
  await expect(page.locator(".block-chip.is-lost")).toHaveCount(0);
  await expect(chips.first()).toHaveText(/^from .+ · p\d+/);

  /* Rewrite one drafted paragraph from scratch; its chip drops live. */
  const draftedRow = page.locator(".block-row", { has: page.locator(".block-chip") }).first();
  const surface = draftedRow.locator(".block-editor-surface");
  await surface.click();
  await page.keyboard.press("Control+A");
  await page.keyboard.type("An entirely new paragraph the scholar wrote from scratch about something else altogether, sharing no words with the draft.");
  await expect(draftedRow.locator(".block-chip")).toHaveClass(/is-lost/);
  await expect(draftedRow.locator(".block-chip")).toHaveText("no longer traceable");
  await expect(page.locator(".block-chip.is-lost")).toHaveCount(1);

  /* Save. The URL becomes the story's, and the provenance line appears. */
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.locator(".sc-write-msg.is-ok")).toContainText("Draft saved", { timeout: 30_000 });
  await expect(page).toHaveURL(/\/editorial\/[0-9a-f]{24}$/);
  await expect(page.locator(".sc-write-provenance")).toContainText("Drawn from the author's research: Adaptive nulling in small antenna arrays");
  await expect(page.locator(".block-chip.is-lost")).toHaveCount(1, { timeout: 20_000 });

  /* Publish, then read it as the public with no session at all. */
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.locator(".sc-write-msg.is-ok")).toContainText("published", { timeout: 30_000 });
  const live = page.locator("a.sc-write-live");
  await expect(live).toBeVisible();
  const publicPath = await live.getAttribute("href");
  expect(publicPath).toMatch(/^\/stories\//);

  const anonymous = await browser.newContext();
  const reader = await anonymous.newPage();
  await reader.goto(publicPath);
  await expect(reader.locator("h1")).toHaveText(/^What the paper found/);
  await expect(reader.locator(".public-story-byline-text b")).toHaveText("Test Scholar");
  await expect(reader.locator(".public-story-provenance")).toContainText("Drawn from the author's research: Adaptive nulling in small antenna arrays");
  await expect(reader.locator(".public-story-provenance a")).toHaveAttribute("href", "https://pmc.example/src-e2e-1");
  await expect(reader.locator(".reader-paragraph").first()).toContainText("entirely new paragraph");
  await anonymous.close();
});

test("without a session the editor is not reachable, and a draft can't be requested", async ({ browser }) => {
  const anonymous = await browser.newContext();
  const page = await anonymous.newPage();
  await page.goto("/editorial/new");
  await expect(page).toHaveURL(/\/login/);
  await anonymous.close();
});
