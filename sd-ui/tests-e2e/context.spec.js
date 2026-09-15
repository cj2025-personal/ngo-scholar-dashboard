/**
 * The author's own context, end to end.
 *
 * A brief that asks about the world today plans a context section, and the
 * outline says so. The draft lands with that paragraph marked as the
 * scholar's own, carrying one specific the agent brought in from outside the
 * paper. The publish check holds the story until the scholar has ticked it,
 * and so does the server, whatever a client sends. Ticked, the story goes,
 * and a reader sees the paragraph as the author's.
 */

const { test, expect } = require("@playwright/test");

const { openAgent } = require("./agent");
const { readState } = require("./stack");

test.beforeEach(async ({ context }) => {
  const state = readState();
  await context.addCookies([{ name: "sd_session", value: state.token, domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax" }]);
});

test("a brief about the world today gets the author's own context, held for the author to verify before it can be published", async ({ page }) => {
  test.setTimeout(240_000);
  const { apiUrl } = readState();

  await page.goto("/papers");
  /* The shelf renders after its inventory call; under load that outlasts a click's own wait. */
  await expect(page.locator(".pp-table tbody tr")).toHaveCount(4, { timeout: 60_000 });
  await page.locator(".pp-table tbody tr", { hasText: "Adaptive nulling" }).getByRole("link", { name: "Start a story" }).click();
  await openAgent(page);
  await expect(page.locator(".ch-msg.is-agent").first()).toContainText("What shall we write");
  await page.getByPlaceholder(/Describe the article you want/).fill("Where does this turn up in practice today, and who meets the problem?");
  await page.getByRole("button", { name: "Send" }).click();

  /* The outline names the section as the scholar's own context. */
  const outline = page.locator(".ch-msg.is-outline").first();
  await expect(outline).toBeVisible({ timeout: 60_000 });
  await expect(outline.locator(".ch-beat-kind.is-context")).toHaveText("Your own context");
  await outline.getByRole("button", { name: /Approve and draft/ }).click();
  await expect(page).toHaveURL(/\/editorial\/[0-9a-f]{24}$/, { timeout: 120_000 });
  const storyId = page.url().match(/\/editorial\/([0-9a-f]{24})$/)[1];

  /* The paragraph is the scholar's, with one specific to verify; the draft's
     own warning says so. */
  const chip = page.locator(".block-chip.is-context");
  await expect(chip).toHaveCount(1);
  await expect(chip).toContainText("1 to verify");
  await expect(page.locator(".block-chip.is-reach")).toHaveCount(0, "a context brief plans context, not an implication");

  /* The server holds the gate whatever a client sends. (A freshly opened
     story shows its version, not "Saved"; either means nothing is pending.) */
  await expect(page.locator(".sc-write-saved")).toHaveText(/^(Saved|v\d+)$/, { timeout: 20_000 });
  const read = await page.request.get(`${apiUrl}/api/editorial-stories/${storyId}`);
  const story = (await read.json()).story;
  const unverified = story.bodyBlocks.filter((b) => b.ownView && b.context?.toVerify?.some((v) => !v.verified));
  expect(unverified.length).toBe(1);
  const forced = await page.request.patch(`${apiUrl}/api/editorial-stories/${storyId}`, {
    multipart: { title: story.title, status: "published", bodyBlocks: JSON.stringify(story.bodyBlocks), inlineImageKeys: "[]", retainImageIds: "[]", baseVersion: String(story.version) },
  });
  expect(forced.status()).toBe(400);
  expect((await forced.json()).error).toMatch(/not yet verified/);

  /* And so does the workspace. */
  const publishCheck = page.getByRole("button", { name: "Publish check" });
  await expect(publishCheck).toBeEnabled({ timeout: 20_000 });
  await publishCheck.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("1 specific in your own context is not yet verified");
  await expect(dialog.getByRole("button", { name: "Publish now" })).toBeDisabled();
  await dialog.getByRole("button", { name: "Back to the draft" }).click();

  /* Ticked in the Checks rail, the save carries it and the gate opens. */
  await page.getByRole("tab", { name: "Checks" }).click();
  await expect(page.getByText("To verify", { exact: true })).toBeVisible();
  await page.locator(".ck-verify__row input[type=checkbox]").first().check();
  await expect(chip).toContainText("verified");
  await expect(page.locator(".sc-write-saved")).toHaveText("Saved", { timeout: 20_000 });
  await expect(publishCheck).toBeEnabled({ timeout: 20_000 });
  await publishCheck.click();
  await expect(dialog).toContainText("Every specific in your own context is verified by you (1)");
  await dialog.getByRole("button", { name: "Publish now" }).click();
  await expect(page.locator(".sc-write-msg.is-ok")).toContainText("published", { timeout: 30_000 });

  /* A reader sees the paragraph as the author's own context, not the paper's. */
  const href = await page.locator("a.sc-write-live").getAttribute("href");
  await page.goto(href);
  await page.getByRole("button", { name: "Show sources" }).click();
  await expect(page.locator(".reader-srcmark.is-author").first()).toHaveAttribute("title", /own context/);
});
