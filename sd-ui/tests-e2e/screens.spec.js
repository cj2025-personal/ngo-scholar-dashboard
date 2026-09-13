/**
 * Screenshots of the current scholar dashboard, for design review.
 * Not a test of behaviour; skipped unless asked for:
 *   SCREENS=1 npx playwright test tests-e2e/screens.spec.js
 * Writes PNGs to the directory in SCREENS_OUT (default tests-e2e/screens).
 */

const fs = require("fs");
const path = require("path");
const { test, expect } = require("@playwright/test");

const { readState } = require("./stack");

const OUT = process.env.SCREENS_OUT || path.join(__dirname, "screens");

test("capture the current screens", async ({ page, context, browser }) => {
  test.skip(!process.env.SCREENS, "screenshots are captured on demand: SCREENS=1");
  test.setTimeout(300_000);
  fs.mkdirSync(OUT, { recursive: true });
  const state = readState();
  await context.addCookies([{ name: "sd_session", value: state.token, domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax" }]);
  await page.setViewportSize({ width: 1440, height: 900 });
  const shot = (name) => page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });

  const anon = await browser.newPage();
  await anon.setViewportSize({ width: 1440, height: 900 });
  await anon.goto("/login");
  await anon.screenshot({ path: path.join(OUT, "00-login.png"), fullPage: true });
  await anon.close();

  for (const [name, url] of [["01-studio", "/"], ["02-content", "/content"], ["03-editorial-list", "/editorial"], ["04-profile", "/profile"]]) {
    await page.goto(url);
    await page.waitForLoadState("networkidle");
    await shot(name);
  }

  await page.goto("/papers");
  await page.waitForLoadState("networkidle");
  await shot("05-papers");
  await page.locator(".pp-table tbody tr", { hasText: "Adaptive nulling" }).getByRole("link", { name: "Start a story" }).click();
  await expect(page.locator(".nsf-source.on")).toBeVisible();
  await shot("06-new-story-source");
  await page.locator(".nsf-actions").getByRole("button", { name: "Next" }).click();
  await shot("07-new-story-reader");
  await page.getByRole("button", { name: "Propose an outline" }).click();
  await expect(page.getByRole("heading", { name: "Here is how the article would go" })).toBeVisible({ timeout: 60_000 });
  await shot("08-new-story-outline");
  await page.getByRole("button", { name: "Approve and draft" }).click();
  await expect(page).toHaveURL(/\/editorial\/[0-9a-f]{24}$/, { timeout: 120_000 });
  await expect(page.locator(".sc-write-status")).toHaveText("Machine draft · in review");
  await page.locator(".block-row", { has: page.locator(".block-chip") }).first().locator(".block-editor-surface").click();
  await shot("09-workspace-source");
  await page.getByRole("tab", { name: "Checks" }).click();
  await shot("10-workspace-checks");
  await page.getByRole("tab", { name: "Agent" }).click();
  await page.getByPlaceholder("What should change?").fill("Shorten paragraph 2 to one sentence");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.locator(".ag-proposal").first().locator(".ag-change").first()).toBeVisible({ timeout: 60_000 });
  await shot("11-workspace-agent-proposal");
  await page.locator(".ag-proposal").first().getByRole("button", { name: "Accept" }).click();
  await page.getByRole("button", { name: "Publish check" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await shot("12-publish-check");
  await page.getByRole("dialog").getByRole("button", { name: "Publish now" }).click();
  await expect(page.locator(".sc-write-msg.is-ok")).toContainText("published", { timeout: 30_000 });
  const href = await page.locator("a.sc-write-live").getAttribute("href");
  const reader = await browser.newPage();
  await reader.setViewportSize({ width: 1440, height: 900 });
  await reader.goto(href);
  await reader.waitForLoadState("networkidle");
  await reader.getByRole("button", { name: "Show sources" }).click();
  await reader.locator(".reader-srcmark").first().click();
  await reader.screenshot({ path: path.join(OUT, "13-public-story-sources.png"), fullPage: true });
  await reader.setViewportSize({ width: 400, height: 860 });
  await reader.screenshot({ path: path.join(OUT, "14-public-story-mobile.png"), fullPage: true });
  await reader.close();

  await page.setViewportSize({ width: 400, height: 860 });
  await page.goto("/editorial/new");
  await shot("15-new-story-mobile");
});
