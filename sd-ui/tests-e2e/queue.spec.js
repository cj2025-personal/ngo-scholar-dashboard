/**
 * Every row in the Studio queue can be got rid of.
 *
 * The queue nags: an outline waiting, a draft in review, reading levels
 * waiting for approval. Only the outline could ever be dismissed, so a draft
 * the scholar did not want, or levels they never asked for, sat on the list
 * for as long as they existed. This asserts each row offers the way out and
 * that taking it actually clears the row — and that the two rows belonging
 * to the Documents portal offer none, because this page has no business
 * deleting a scholar's paper.
 */

const path = require("path");
const { test, expect } = require("@playwright/test");

const { openAgent } = require("./agent");
const { readState } = require("./stack");

/** The queue row whose lead line contains `text`, hero card included. */
const row = (page, text) => page.locator(".st-todo, .st-next").filter({ hasText: text }).first();

test.beforeEach(async ({ context }) => {
  const state = readState();
  await context.addCookies([{ name: "sd_session", value: state.token, domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax" }]);
});

test("a draft in review and reading levels waiting can each be removed from the Studio queue", async ({ page }) => {
  test.setTimeout(240_000);
  const { apiUrl } = readState();

  /* A story in review, with levels written and unapproved: the two rows the
     queue could not clear. Drafted through the product, not seeded, so the
     rows are the ones a scholar would really see. */
  await page.goto("/papers");
  await expect(page.locator(".pp-table tbody tr")).toHaveCount(4, { timeout: 60_000 });
  await page.locator(".pp-table tbody tr", { hasText: "Adaptive nulling" }).getByRole("link", { name: "Start a story" }).click();
  await openAgent(page);
  await page.getByPlaceholder(/Describe the article you want/).fill("Keep it short.");
  await page.getByRole("button", { name: "Send" }).click();
  const outline = page.locator(".ch-msg.is-outline").first();
  await expect(outline).toBeVisible({ timeout: 60_000 });
  await outline.getByRole("button", { name: /Approve and draft/ }).click();
  await expect(page).toHaveURL(/\/editorial\/[0-9a-f]{24}$/, { timeout: 120_000 });
  const storyId = page.url().match(/\/editorial\/([0-9a-f]{24})$/)[1];

  const version = (await (await page.request.get(`${apiUrl}/api/editorial-stories/${storyId}`)).json()).story.version;
  const wrote = await page.request.post(`${apiUrl}/api/editorial-stories/${storyId}/levels`, {
    data: { audiences: ["ages_8_11", "ages_12_14"], baseVersion: version },
  });
  expect(wrote.status()).toBe(200);

  /* The queue. Both rows carry a way out; the paper row does not, because the
     paper is the Documents portal's. */
  await page.goto("/");
  const levelsRow = row(page, "waiting for your approval");
  const draftRow = row(page, "A draft is waiting for your review");
  await expect(levelsRow).toBeVisible();
  await expect(draftRow).toBeVisible();
  await expect(levelsRow.locator(".del-btn")).toBeVisible();
  await expect(draftRow.locator(".del-btn")).toBeVisible();
  const paperRow = page.locator(".st-todo").filter({ hasText: "A paper is ready to draft from" });
  if (await paperRow.count()) await expect(paperRow.first().locator(".del-btn")).toHaveCount(0);
  /* For a look at the row with its controls: SCREENS=1 npx playwright test tests-e2e/queue.spec.js */
  if (process.env.SCREENS) {
    await page.screenshot({ path: path.join(process.env.SCREENS_OUT || path.join(__dirname, "screens"), "18-queue-removable.png"), fullPage: true });
  }

  /* Discarding the levels asks once, says the article is untouched, and
     clears the row. The story stays. */
  await levelsRow.locator(".del-btn").click();
  await expect(page.locator(".del-confirm")).toContainText("The article itself is not touched");
  await page.locator(".del-confirm").getByRole("button", { name: "Discard" }).click();
  await expect(row(page, "waiting for your approval")).toHaveCount(0, { timeout: 30_000 });
  const after = await page.request.get(`${apiUrl}/api/editorial-stories/${storyId}`);
  expect(after.status()).toBe(200);
  expect((await after.json()).story.levels).toEqual([]);

  /* Deleting the draft asks by name and takes the story with it. */
  const draft = row(page, "A draft is waiting for your review");
  await draft.locator(".del-btn").click();
  await expect(page.locator(".del-confirm")).toContainText("cannot be undone");
  await page.locator(".del-confirm").getByRole("button", { name: "Delete" }).click();
  await expect(page.locator(".st-todo, .st-next").filter({ hasText: "A draft is waiting for your review" })).toHaveCount(0, { timeout: 30_000 });
  expect((await page.request.get(`${apiUrl}/api/editorial-stories/${storyId}`)).status()).toBe(404);
});
