/**
 * The new-story composer, measured rather than eyeballed.
 *
 * The complaint this guards against: the composer read as a white panel with
 * its sides cut off, and it ran past the bottom of a short window. So this
 * asserts the geometry at the window sizes a scholar actually has: the typing
 * box is inside the page, the whole composer sits above the fold, and the
 * page never scrolls sideways.
 */

const { test, expect } = require("@playwright/test");

const { readState } = require("./stack");

const SIZES = [
  { name: "short laptop", width: 1366, height: 580 },
  { name: "laptop", width: 1440, height: 780 },
  { name: "phone", width: 400, height: 760 },
];

test.beforeEach(async ({ context }) => {
  const state = readState();
  await context.addCookies([{ name: "sd_session", value: state.token, domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax" }]);
});

for (const size of SIZES) {
  test(`the composer fits the window on a ${size.name}`, async ({ page }) => {
    await page.setViewportSize({ width: size.width, height: size.height });
    await page.goto("/editorial/new");
    await expect(page.getByLabel("Reader age")).toBeVisible();

    const composer = page.locator(".ch-composer");
    const box = page.locator(".ch-composer .ag-box");
    const hint = page.locator(".ch-composer .ag-hint");
    const c = await composer.boundingBox();
    const b = await box.boundingBox();
    const h = await hint.boundingBox();

    /* Nothing of the composer is below the fold. The keyboard hints are hidden
       on a touch screen, where there is no keyboard to hint at, so they are
       checked only where they are shown. */
    expect(Math.round(c.y + c.height)).toBeLessThanOrEqual(size.height);
    if (h) expect(Math.round(h.y + h.height)).toBeLessThanOrEqual(size.height);

    /* The typing box keeps a real gutter on both sides of the window. */
    expect(b.x).toBeGreaterThanOrEqual(12);
    expect(Math.round(b.x + b.width)).toBeLessThanOrEqual(size.width - 12);

    /* The complaint was a slab of white with its sides sliced off. So the
       composer must either carry the page's own colour, in which case it has
       no edges at all, or be an obvious card with rounded corners. What it
       may not be is a flat rectangle whose edges look like a mistake. */
    const look = await composer.evaluate((el) => {
      const s = getComputedStyle(el);
      return { bg: s.backgroundColor, radius: parseFloat(s.borderTopLeftRadius) || 0 };
    });
    const pageBg = await page.evaluate(() => getComputedStyle(document.querySelector(".sc-shell")).backgroundColor);
    expect(look.bg === pageBg || look.radius >= 8).toBe(true);

    /* And the page never scrolls sideways. */
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
}

test("the agent rail's typing box stays distinct from the rail behind it", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/editorial/new?blank=1");
  await expect(page.getByPlaceholder("Title", { exact: true })).toBeVisible();
  /* The blank editor has no agent rail; the colours are asserted from the tokens. */
  const [railBg, boxBg] = await page.evaluate(() => {
    const probe = document.createElement("div");
    probe.className = "ws-right";
    const inner = document.createElement("div");
    inner.className = "ag-box";
    probe.appendChild(inner);
    document.body.appendChild(probe);
    const out = [getComputedStyle(probe).backgroundColor, getComputedStyle(inner).backgroundColor];
    probe.remove();
    return out;
  });
  expect(boxBg).not.toBe(railBg);
});
