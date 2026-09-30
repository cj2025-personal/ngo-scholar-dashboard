/**
 * The agent's pane on a new story: closed by default, opened from a nudge
 * in the bottom-left corner, sliding in from the left and pushing the
 * editor over; closed again, the editor comes back and the conversation
 * is still there when the pane is reopened.
 */

const { test, expect } = require("@playwright/test");

const { openAgent } = require("./agent");
const { readState } = require("./stack");

test.beforeEach(async ({ context }) => {
  const state = readState();
  await context.addCookies([{ name: "sd_session", value: state.token, domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax" }]);
});

test("the pane opens from the bottom-left nudge, moves the editor over, and closes back", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/editorial/new");
  /* The editor is the page; the nudge waits bottom-left. */
  const nudge = page.locator(".ag-nudge");
  await expect(nudge).toBeVisible();
  const nb = await nudge.boundingBox();
  expect(nb.x).toBeLessThan(60);
  expect(nb.y + nb.height).toBeGreaterThan(900 - 60);
  await expect(page.locator(".ws-right.is-agent")).toBeHidden();
  const grid = page.locator(".ws-grid.is-two");
  const paddingBefore = await grid.evaluate((el) => getComputedStyle(el).paddingLeft);
  expect(paddingBefore).toBe("0px");

  /* Open: the pane sits against the left edge and the editor leaves it room. */
  await openAgent(page);
  const rail = page.locator(".ws-right.is-agent");
  await expect(rail).toBeVisible();
  await expect.poll(async () => (await rail.boundingBox()).x).toBe(0);
  await expect.poll(async () => grid.evaluate((el) => getComputedStyle(el).paddingLeft)).toBe("400px");
  await expect(nudge).toHaveCount(0);

  /* Something said, then closed: the editor is back where it was. */
  const box = page.getByPlaceholder(/Describe the article you want/);
  await box.fill("I want to write from one of my papers");
  await box.press("Enter");
  await expect(page.locator(".ch-msg.is-papers .ch-paper")).toHaveCount(3);
  await page.getByRole("button", { name: "Close the agent" }).click();
  await expect(rail).toBeHidden();
  await expect.poll(async () => grid.evaluate((el) => getComputedStyle(el).paddingLeft)).toBe("0px");
  await expect(nudge).toBeVisible();

  /* Reopened: the conversation is where it was. */
  await nudge.click();
  await expect(rail).toBeVisible();
  await expect(page.locator(".ch-msg.is-papers .ch-paper")).toHaveCount(3);
});

test("on a phone the pane is a sheet from the bottom", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 820 });
  await page.goto("/editorial/new");
  await expect(page.locator(".ws-right.is-agent")).toBeHidden();
  await openAgent(page);
  const rail = page.locator(".ws-right.is-agent");
  const rb = await rail.boundingBox();
  expect(rb.x).toBe(0);
  expect(rb.width).toBe(390);
  expect(rb.y + rb.height).toBeGreaterThanOrEqual(820 - 1);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
