/**
 * Stories: every story, with what came of it, as the API has it.
 *
 * The page used to say less about each story than the Studio's own table did.
 * It is now that table at full length, so these hold it to the API: every
 * story listed, the tabs counting what they filter, the sums in the header,
 * search and sort doing what they say. Other specs write and delete stories
 * first, so nothing here assumes a fixed count.
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

const groupOf = (s) => (s.status === "published" ? "published" : s.status === "scheduled" ? "scheduled" : s.provenance ? "review" : "draft");

test("every story is listed, the tabs count what they filter, and the sums are the API's", async ({ page }) => {
  /* Two published stories, one read more than the other, and a draft by hand. */
  const make = async (title, status) => (await api(page, "/api/editorial-stories", { method: "POST", data: { title, content: "A paragraph about antenna arrays and what the trials showed.", status } })).story;
  const most = await make(`Most read ${Date.now()}`, "published");
  await make(`Less read ${Date.now()}`, "published");
  await make(`By hand ${Date.now()}`, "draft");
  await page.request.post(`${state.apiUrl}/api/editorial-stories/public/slug/${most.slug}/read`, { data: {} });

  const { stories } = await api(page, "/api/editorial-stories?limit=500");
  await page.goto("/editorial");
  const table = page.locator(".dash-stories");
  const rows = table.locator(".dash-tr:not(.dash-th)");
  await expect(rows).toHaveCount(stories.length);

  /* The tabs: each count is the API's for that group, and choosing one shows exactly those. */
  const groups = { "In review": "review", Drafts: "draft", Scheduled: "scheduled", Published: "published" };
  for (const [label, group] of Object.entries(groups)) {
    const n = stories.filter((s) => groupOf(s) === group).length;
    const chip = table.getByRole("button", { name: new RegExp(`^${label} `) });
    if (!n) { await expect(chip).toHaveCount(0); continue; }
    await expect(chip).toContainText(String(n));
    await chip.click();
    await expect(rows).toHaveCount(n);
  }
  await table.getByRole("button", { name: /^All / }).click();

  /* The header's sums. */
  const sum = (dt) => page.locator(".stories-sum div", { has: page.locator("dt", { hasText: dt }) }).locator("dd");
  await expect(sum("Published")).toHaveText(String(stories.filter((s) => s.status === "published").length));
  await expect(sum("Reads")).toHaveText(String(stories.reduce((n, s) => n + (s.reads?.total || 0), 0)));

  /* Sort by reads: the most-read story leads. */
  await page.getByLabel("Sort").selectOption({ label: "Most read" });
  const top = [...stories].sort((a, b) => (b.reads?.total ?? -1) - (a.reads?.total ?? -1))[0];
  await expect(rows.first().locator(".dash-story-title")).toHaveText(top.title);

  /* Search narrows to what matches, and says so when nothing does. */
  await page.getByPlaceholder("Search by title or paper").fill(most.title);
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText(most.title);
  await page.getByPlaceholder("Search by title or paper").fill("zzzz no such story");
  await expect(page.locator(".stories-none")).toContainText("No story matches");
  await page.getByRole("button", { name: "Show every story" }).click();
  await expect(rows).toHaveCount(stories.length);
});

test("a link to a tab opens on it, including the old ?tab=drafts", async ({ page }) => {
  const { stories } = await api(page, "/api/editorial-stories?limit=500");
  const drafts = stories.filter((s) => groupOf(s) === "draft").length;
  await page.goto("/editorial?tab=drafts");
  if (drafts) {
    await expect(page.locator(".dash-stories").getByRole("button", { name: /^Drafts / })).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".dash-stories .dash-tr:not(.dash-th)")).toHaveCount(drafts);
  }
  await page.goto("/editorial?tab=nonsense");
  await expect(page.locator(".dash-stories").getByRole("button", { name: /^All / })).toHaveAttribute("aria-pressed", "true");
});

test("the stories page fits a laptop and a phone without scrolling sideways", async ({ page }) => {
  for (const [width, height] of [[1366, 607], [390, 844]]) {
    await page.setViewportSize({ width, height });
    await page.goto("/editorial");
    await expect(page.getByRole("heading", { name: "Your stories", level: 1 })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth), `${width}px`).toBeLessThanOrEqual(width);
  }
});
