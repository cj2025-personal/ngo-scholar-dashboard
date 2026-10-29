/**
 * An article from the scholar's brief alone, drawing on none of their papers.
 *
 * The scholar says not to use their papers. The agent plans from the brief:
 * every section their own account, citing nothing. The draft lands with each
 * paragraph marked as theirs and every specific it names held for them to
 * verify; the publish check holds it until they have, and asks nothing about
 * a paper there is not. Published, readers are told it is the author's own
 * account and not drawn from their research. Every assertion is on rendered
 * content.
 */

const { test, expect } = require("@playwright/test");

const { openAgent, freshConversation } = require("./agent");
const { readState } = require("./stack");

test.beforeEach(async ({ context }) => {
  const state = readState();
  await context.addCookies([{ name: "sd_session", value: state.token, domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax" }]);
  await freshConversation(context);
});

test("writing from the brief alone uses none of the papers, and holds what it names for the author", async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto("/editorial/new");
  await openAgent(page);
  /* The choice is offered beside the papers. */
  await expect(page.getByLabel("Paper", { exact: true }).locator("option", { hasText: "No paper — write from my brief" })).toHaveCount(1);

  await page.getByPlaceholder(/Describe the article you want/).fill("Without my papers: how cities can plan for heatwaves, for children");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.locator(".ch-msg.is-agent").filter({ hasText: "None of your papers will be used" })).toBeVisible({ timeout: 60_000 });

  /* The outline: every section the author's own, none citing a passage. */
  const plan = page.locator(".ws-outline-plan");
  await expect(plan).toBeVisible({ timeout: 60_000 });
  await expect(plan.locator(".ws-outline-plan__note")).toContainText("none of your papers is used");
  await expect(plan.locator(".ch-beat .block-chip")).toHaveCount(0);
  await expect(page.locator(".ch-context.is-locked")).toContainText("your brief alone, no paper");
  await plan.getByRole("button", { name: /Approve and draft/ }).click();
  await expect(page).toHaveURL(/\/editorial\/[0-9a-f]{24}$/, { timeout: 120_000 });

  /* The draft: the author's own, every paragraph; nothing drawn from a paper. */
  await expect(page.locator(".sc-write-status")).toHaveText("Machine draft · in review");
  await expect(page.locator(".block-row .block-chip.is-context").first()).toBeVisible();
  await expect(page.locator(".block-row .block-chip:not(.is-context)")).toHaveCount(0);

  /* Checks: said as the author's own, with what it names to verify; nothing about a paper. */
  await page.getByRole("tab", { name: /Checks/ }).click();
  await expect(page.locator(".ck-wrap")).toContainText("all your own account");
  await expect(page.getByText("To verify", { exact: true })).toBeVisible();
  await expect(page.locator(".ck-wrap")).not.toContainText("Numbers");
  await expect(page.locator(".ck-wrap")).not.toContainText("record");

  /* The publish check holds it until each specific is verified. */
  const publishCheck = page.getByRole("button", { name: "Publish check" });
  await expect(publishCheck).toBeEnabled({ timeout: 20_000 });
  await publishCheck.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("not yet verified");
  await expect(dialog).not.toContainText("Retraction record");
  await expect(dialog.getByRole("button", { name: "Publish now" })).toBeDisabled();
  await dialog.getByRole("button", { name: "Back to the draft" }).click();

  const boxes = page.locator(".ck-verify__row input[type=checkbox]");
  const n = await boxes.count();
  for (let i = 0; i < n; i += 1) await boxes.nth(i).check();
  await expect(page.locator(".sc-write-saved")).toHaveText("Saved", { timeout: 20_000 });
  await expect(publishCheck).toBeEnabled({ timeout: 20_000 });
  await publishCheck.click();
  await dialog.getByRole("button", { name: "Publish now" }).click();
  await expect(page.locator(".sc-write-msg.is-ok")).toContainText("published", { timeout: 60_000 });

  /* Readers are told whose account it is, and that no research is behind it. */
  const href = await page.locator("a.sc-write-live").getAttribute("href");
  await page.goto(href);
  await expect(page.locator(".public-story-provenance")).toHaveText("The author's own account, written without drawing on their research papers.");
});
