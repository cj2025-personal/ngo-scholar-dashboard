/**
 * Papers: what we hold, what each may be used for, and the one thing to do with it.
 *
 * Kept here: the tabs count what the inventory says; a paper that may only be
 * quoted never offers a story; the stories drawn from a paper open under its
 * own row (the old "Selected paper" panel, chosen for the scholar and repeating
 * the row, is gone); and on a phone every row is a card that fits the screen.
 */

const { test, expect } = require("@playwright/test");

const { readState } = require("./stack");

let state;
test.beforeAll(() => { state = readState(); });
test.beforeEach(async ({ context }) => {
  await context.addCookies([{ name: "sd_session", value: state.token, domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax" }]);
});

async function api(page, route) {
  const res = await page.request.get(`${state.apiUrl}${route}`, { headers: { cookie: `sd_session=${state.token}` } });
  expect(res.status(), route).toBe(200);
  return res.json();
}

test("each paper says what it may be used for, offers only what applies, and opens its stories in place", async ({ page }) => {
  const inventory = await api(page, "/api/drafting/sources");
  const { stories } = await api(page, "/api/editorial-stories?limit=500");
  await page.goto("/papers");
  const rows = page.locator(".pp-table tbody tr:not(.pp-sub)");
  await expect(rows).toHaveCount(inventory.draftable.length + inventory.citable.length + inventory.unusable.length);
  await expect(page.getByText("Selected paper")).toHaveCount(0);

  /* The tabs count what the inventory says. */
  await expect(page.getByRole("button", { name: /^Ready to draft from / })).toContainText(String(inventory.draftable.length));

  /* Quote only: never a story, always the way to change that. */
  for (const p of inventory.citable) {
    const row = rows.filter({ hasText: p.title });
    await expect(row.getByRole("link", { name: "Start a story" })).toHaveCount(0);
    await expect(row.getByRole("link", { name: /Add a version you own/ })).toBeVisible();
  }

  /* A paper with stories drawn from it opens them under its own row, linked. */
  const drawn = inventory.draftable.find((p) => stories.some((s) => s.provenance?.sourceId === p.id));
  if (drawn) {
    const row = rows.filter({ hasText: drawn.title });
    const toggle = row.locator(".pp-stories-btn");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    const first = stories.find((s) => s.provenance?.sourceId === drawn.id);
    await expect(page.locator(".pp-sub").getByRole("link", { name: first.title })).toHaveAttribute("href", `/editorial/${first.id}`);
  }
});

test("on a phone every paper is a card that fits the screen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/papers");
  await expect(page.locator(".pp-table tbody tr").first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  /* Every action is inside the screen, not cut off at its edge. */
  for (const box of await page.locator(".pp-cell-act a").evaluateAll((els) => els.map((e) => e.getBoundingClientRect().right))) {
    expect(box).toBeLessThanOrEqual(390);
  }
});
