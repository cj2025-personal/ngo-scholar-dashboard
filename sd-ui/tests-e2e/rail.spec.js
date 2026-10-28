/**
 * The agent's pane on a new story: closed by default, opened from a nudge
 * in the bottom-left corner, sliding in from the left and pushing the
 * editor over; closed again, the editor comes back and the conversation
 * is still there when the pane is reopened.
 */

const { test, expect } = require("@playwright/test");

const { openAgent, freshConversation } = require("./agent");
const { readState } = require("./stack");

test.beforeEach(async ({ context }) => {
  const state = readState();
  await context.addCookies([{ name: "sd_session", value: state.token, domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax" }]);
  await freshConversation(context);
});

test("on a wide screen a new story opens beside Kivyn; closed, the pane leaves a strip, and that is remembered", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/editorial/new");
  const rail = page.locator(".ws-right.is-agent");
  const grid = page.locator(".ws-grid.is-two");
  const strip = page.locator(".ws-strip");
  const nudge = page.locator(".ag-nudge");

  /* Open on arrival: the pane against the left edge, the editor leaving it exactly its width. */
  await openAgent(page);
  await expect.poll(async () => (await rail.boundingBox()).x).toBe(0);
  const railWidth = await rail.evaluate((el) => getComputedStyle(el).width);
  await expect.poll(async () => grid.evaluate((el) => getComputedStyle(el).paddingLeft)).toBe(railWidth);
  await expect(strip).toHaveCount(0);
  await expect(nudge).toHaveCount(0);

  /* Something said, then closed: the editor is back in the middle, and the pane leaves its strip on the edge. */
  const box = page.getByPlaceholder(/Describe the article you want/);
  await box.fill("I want to write from one of my papers");
  await box.press("Enter");
  await expect(page.locator(".ch-msg.is-papers .ch-paper")).toHaveCount(3);
  await page.getByRole("button", { name: "Close Kivyn" }).click();
  await expect(rail).toBeHidden();
  await expect.poll(async () => grid.evaluate((el) => getComputedStyle(el).paddingLeft)).toBe("0px");
  await expect(strip).toBeVisible();
  const sb = await strip.boundingBox();
  expect(sb.x).toBe(0);
  expect(sb.width).toBe(56);
  await expect(nudge).toBeHidden();

  /* The strip opens it again, and the conversation is where it was. */
  await strip.getByRole("button", { name: "Open Kivyn" }).click();
  await expect(rail).toBeVisible();
  await expect(page.locator(".ch-msg.is-papers .ch-paper")).toHaveCount(3);

  /* Closed is remembered: a reload leaves the page to the scholar, with the strip. */
  await page.getByRole("button", { name: "Close Kivyn" }).click();
  await page.reload();
  await expect(strip).toBeVisible();
  await expect(rail).toBeHidden();
  /* The strip's Ideas opens the pane on Ideas, and open is remembered as well. */
  await strip.getByRole("button", { name: "Kivyn: Ideas" }).click();
  await expect(rail).toBeVisible();
  await expect(page.getByRole("tab", { name: "Ideas" })).toHaveAttribute("aria-selected", "true");
  await page.reload();
  await expect(rail).toBeVisible();
  await expect(strip).toHaveCount(0);
});

test("on a narrow screen the pane starts closed behind the nudge, and never covers the editor", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto("/editorial/new");
  const nudge = page.locator(".ag-nudge");
  await expect(nudge).toBeVisible();
  await expect(page.locator(".ws-right.is-agent")).toBeHidden();
  await expect(page.locator(".ws-strip")).toBeHidden();
  const nb = await nudge.boundingBox();
  expect(nb.x).toBeLessThan(60);
  expect(nb.y + nb.height).toBeGreaterThan(768 - 60);
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
