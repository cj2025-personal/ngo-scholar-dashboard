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

test("on a narrow screen the nudge waits bottom-left, and Kivyn's card gives way to it", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto("/editorial/new");
  const nudge = page.locator(".ag-nudge");
  await expect(nudge).toBeVisible();
  const nb = await nudge.boundingBox();
  expect(nb.x).toBeLessThan(60);
  expect(nb.y + nb.height).toBeGreaterThan(768 - 60);
  await expect(page.locator(".kv-companion")).toBeHidden();
  /* The editor is a sheet that reaches the foot of the window. */
  const sheet = await page.locator(".ws-grid.is-two > .ws-center").boundingBox();
  expect(sheet.y + sheet.height).toBeGreaterThan(768 - 40);
});

test("on a wide screen Kivyn stands beside the sheet; the pane opens in its place, moves the editor over, and closes back", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/editorial/new");
  /* Kivyn's card on the left, where the pane opens; the sheet beside it; no nudge. */
  const card = page.locator(".kv-companion");
  await expect(card).toBeVisible();
  await expect(page.locator(".ag-nudge")).toBeHidden();
  const cb = await card.boundingBox();
  const sb = await page.locator(".ws-grid.is-two > .ws-center").boundingBox();
  expect(cb.x + cb.width).toBeLessThan(sb.x);
  expect(Math.abs(cb.y - sb.y)).toBeLessThan(4);
  /* The pair is centred on the desk rather than pinned to one side. */
  expect(Math.abs(cb.x - (1440 - (sb.x + sb.width)))).toBeLessThan(40);
  await expect(page.locator(".ws-right.is-agent")).toBeHidden();
  const grid = page.locator(".ws-grid.is-two");
  const paddingBefore = await grid.evaluate((el) => getComputedStyle(el).paddingLeft);
  expect(paddingBefore).toBe("0px");

  /* Open: the pane sits against the left edge and the editor leaves it room. */
  await openAgent(page);
  const rail = page.locator(".ws-right.is-agent");
  await expect(rail).toBeVisible();
  await expect.poll(async () => (await rail.boundingBox()).x).toBe(0);
  /* The editor leaves exactly the pane's width free. */
  const railWidth = await rail.evaluate((el) => getComputedStyle(el).width);
  await expect.poll(async () => grid.evaluate((el) => getComputedStyle(el).paddingLeft)).toBe(railWidth);
  await expect(card).toHaveCount(0);

  /* Something said, then closed: the editor is back where it was. */
  const box = page.getByPlaceholder(/Describe the article you want/);
  await box.fill("I want to write from one of my papers");
  await box.press("Enter");
  await expect(page.locator(".ch-msg.is-papers .ch-paper")).toHaveCount(3);
  await page.getByRole("button", { name: "Close Kivyn" }).click();
  await expect(rail).toBeHidden();
  await expect.poll(async () => grid.evaluate((el) => getComputedStyle(el).paddingLeft)).toBe("0px");
  await expect(card).toBeVisible();

  /* Reopened: the conversation is where it was. */
  await card.getByRole("button", { name: "Tell Kivyn what to write" }).click();
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
