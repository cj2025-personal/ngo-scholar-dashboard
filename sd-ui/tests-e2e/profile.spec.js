/**
 * Profile: the record as Proj Arch holds it, and the numbers beside it.
 *
 * What it used to get wrong, and this keeps right:
 *   - a deleted story was counted, and listed as "deleted";
 *   - "Podcasts 0" while the Podcasts page listed the scholar's conversations;
 *   - "Write an editorial", a third name for the door the Studio already has.
 * Nothing here asserts a fixed number: other specs write and delete stories
 * first, so every figure is compared with the endpoint the page reads.
 */

const { test, expect } = require("@playwright/test");

const { readState } = require("./stack");

let state;
test.beforeAll(() => { state = readState(); });
test.beforeEach(async ({ context }) => {
  await context.addCookies([{ name: "sd_session", value: state.token, domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax" }]);
});

async function api(page, route, init = {}) {
  const res = await page.request.fetch(`${state.apiUrl}${route}`, { headers: { cookie: `sd_session=${state.token}` }, ...init });
  expect(res.status(), route).toBeLessThan(300);
  return res.json();
}

const tile = (page, label) => page.locator(".prof-kpis .dash-tile").filter({ has: page.locator(".dash-tile__label", { hasText: label }) });

test("the profile's numbers are the API's, and a deleted story is gone from it", async ({ page }) => {
  /* A story written, then deleted: it must not be counted or listed. */
  const made = await api(page, "/api/editorial-stories", { method: "POST", data: { title: "Written, then removed", content: "A paragraph that will not last.", status: "draft" } });
  await api(page, `/api/editorial-stories/${made.story.id}`, { method: "DELETE" });

  const [{ stories }, { episodes }, corrections] = await Promise.all([
    api(page, "/api/editorial-stories"),
    api(page, "/api/podcasts"),
    api(page, "/api/profile/suggestions"),
  ]);
  const published = stories.filter((s) => s.status === "published").length;

  await page.goto("/profile");
  await expect(page.locator(".prof-head h1")).toContainText("Test Scholar");

  await expect(tile(page, "Stories published").locator(".dash-tile__value")).toHaveText(String(published));
  await expect(tile(page, "Conversations").locator(".dash-tile__value")).toHaveText(String(episodes.length));
  const open = (corrections.suggestions || []).filter((c) => c.status === "open").length;
  await expect(tile(page, "Corrections").locator(".dash-tile__value")).toHaveText(new RegExp(`^${open}`));

  const yours = page.locator("section", { has: page.getByRole("heading", { name: "Your stories" }) });
  await expect(yours.locator(".dash-count")).toHaveText(String(stories.length));
  await expect(yours).not.toContainText("Written, then removed");
  await expect(yours).not.toContainText(/deleted/i);

  /* One door to writing, and it is not here; stories are stories. */
  await expect(page.getByRole("link", { name: /Write an editorial/i })).toHaveCount(0);
  await expect(page.getByText(/Editorials/)).toHaveCount(0);
});

test("every part of the record says how to correct it, in words, and the answers sit at its foot", async ({ page }) => {
  await page.goto("/profile");
  /* The header's own, and one per card: named for what they are about. */
  const suggest = page.getByRole("button", { name: /^(Suggest an edit|Tell us what is missing): / });
  expect(await suggest.count()).toBeGreaterThanOrEqual(2);
  await expect(page.getByRole("button", { name: "Suggest an edit: Name and headline" })).toBeVisible();
  await expect(page.locator("#corrections")).toBeVisible();
  await expect(page.getByRole("link", { name: /What Proj Arch says about you/ })).toHaveAttribute("href", "/content");

  /* The seeded scholar's record is thin: the page says so, and offers the one useful thing. */
  const { about, researchFocus, education, milestones, featuredPublications } = await api(page, "/api/profile/me");
  const thin = !(about?.detailedBio || about?.shortBio || about?.summary || about?.longSummary) && !researchFocus?.length && !education?.length && !milestones?.length && !featuredPublications?.length;
  if (thin) {
    await expect(page.getByRole("heading", { name: "Your record is still being assembled" })).toBeVisible();
    await page.getByRole("button", { name: /Tell us what is missing/ }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
  }
});

test("the profile fits a laptop and a phone without scrolling sideways", async ({ page }) => {
  for (const [width, height] of [[1366, 607], [390, 844]]) {
    await page.setViewportSize({ width, height });
    await page.goto("/profile");
    await expect(page.locator(".prof-head")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth), `${width}px`).toBeLessThanOrEqual(width);
  }
});
