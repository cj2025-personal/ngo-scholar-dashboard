/**
 * Screenshots of the current scholar dashboard, for design review.
 * Not a test of behaviour; skipped unless asked for:
 *   SCREENS=1 npx playwright test tests-e2e/screens.spec.js
 * Writes PNGs to the directory in SCREENS_OUT (default tests-e2e/screens).
 */

const fs = require("fs");
const path = require("path");
const { test, expect } = require("@playwright/test");

const { openAgent } = require("./agent");
const { readState } = require("./stack");

const OUT = process.env.SCREENS_OUT || path.join(__dirname, "screens");

test("capture the current screens", async ({ page, context, browser }) => {
  test.skip(!process.env.SCREENS, "screenshots are captured on demand: SCREENS=1");
  test.setTimeout(300_000);
  fs.mkdirSync(OUT, { recursive: true });
  const state = readState();
  await context.addCookies([{ name: "sd_session", value: state.token, domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax" }]);
  const [vw, vh] = (process.env.SCREENS_VIEWPORT || "1440x900").split("x").map(Number);
  await page.setViewportSize({ width: vw, height: vh });
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
  await openAgent(page);
  await expect(page.locator(".ch-msg.is-agent").first()).toBeVisible();
  await shot("06-new-story-chat");
  await page.getByPlaceholder(/Describe the article you want/).fill("Focus on what the field trials showed, and be honest about the limits.");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.locator(".ch-msg.is-outline").first()).toBeVisible({ timeout: 60_000 });
  await shot("07-new-story-outline");
  await page.getByPlaceholder(/Reply with what to change/).fill("Lead with the limitations.");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.locator(".ch-msg.is-outline").nth(1)).toBeVisible({ timeout: 60_000 });
  await shot("08-new-story-replanned");
  await page.locator(".ch-msg.is-outline").nth(1).getByRole("button", { name: /Approve and draft/ }).click();
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
  /* A first compile of the reader route under load can outlast the idle
     wait; the click below waits for the page itself. */
  await reader.waitForLoadState("networkidle").catch(() => {});
  await reader.getByRole("button", { name: "Show sources" }).click();
  await reader.locator(".reader-srcmark").first().click();
  await reader.screenshot({ path: path.join(OUT, "13-public-story-sources.png"), fullPage: true });
  await reader.setViewportSize({ width: 400, height: 860 });
  await reader.screenshot({ path: path.join(OUT, "14-public-story-mobile.png"), fullPage: true });
  await reader.close();

  await page.setViewportSize({ width: 400, height: 860 });
  await page.goto("/editorial/new");
  await openAgent(page);
  await shot("15-new-story-mobile");

  /* The story list with something in it. The capture near the top of this run
     is taken before anything has been drafted, so it only ever shows the empty
     state — which is the one state that needs the least design work. */
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/editorial");
  await page.waitForLoadState("networkidle").catch(() => {});
  await shot("16-editorial-list-populated");

  /* A row's actions are revealed on hover, so a still of the resting state
     cannot show whether they are there at all. */
  await page.locator(".el-row").first().hover();
  await page.waitForTimeout(400);
  await shot("17-editorial-row-hover");
});
