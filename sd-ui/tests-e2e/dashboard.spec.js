/**
 * The Studio as a dashboard: every number on it is one the API gives, drawn.
 *
 * Other specs in this suite draft, publish and delete stories before this one
 * runs, so nothing here asserts a fixed count. Each figure is fetched from the
 * same endpoints the page reads and compared with what the page shows — a
 * tile that drifted from its source would be a dashboard that lies, which is
 * worse than no dashboard.
 *
 * Screenshots at the sizes the page is judged at (1366 × 607 and a phone):
 *   SCREENS=1 npx playwright test tests-e2e/dashboard.spec.js
 */

const fs = require("fs");
const path = require("path");
const { test, expect } = require("@playwright/test");

const { readState } = require("./stack");

const OUT = process.env.SCREENS_OUT || path.join(__dirname, "screens");

let state;

test.beforeAll(() => {
  state = readState();
});

test.beforeEach(async ({ context }) => {
  await context.addCookies([
    { name: "sd_session", value: state.token, domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax" },
  ]);
});

async function api(page, route) {
  const res = await page.request.get(`${state.apiUrl}${route}`, { headers: { cookie: `sd_session=${state.token}` } });
  expect(res.status(), route).toBe(200);
  return res.json();
}

const n = (value) => Number(value).toLocaleString("en-US");
const tile = (page, label) => page.locator(".dash-tile").filter({ has: page.locator(".dash-tile__label", { hasText: label }) });

test("every number on the Studio is the API's", async ({ page }) => {
  const [{ stories }, { jobs }, sources] = await Promise.all([
    api(page, "/api/editorial-stories"),
    api(page, "/api/drafting/jobs?limit=10"),
    api(page, "/api/drafting/sources"),
  ]);
  const published = stories.filter((s) => s.status === "published").length;
  const scheduled = stories.filter((s) => s.status === "scheduled").length;
  const reads = stories.reduce((sum, s) => sum + (s.reads?.total || 0), 0);

  await page.goto("/");
  await page.waitForLoadState("networkidle");

  await expect(tile(page, "Papers ready").locator(".dash-tile__value")).toHaveText(n(sources.counts.draftable));
  await expect(tile(page, "Published").locator(".dash-tile__value")).toHaveText(n(published));
  await expect(tile(page, "Published")).toContainText(`${scheduled} scheduled`);
  await expect(tile(page, "Reads").locator(".dash-tile__value")).toHaveText(n(reads));
  await expect(tile(page, "Legacy").locator(".dash-tile__value")).toHaveText(`${sources.standing.met} / ${sources.standing.total}`);

  /* The side column: Legacy mark by mark, and the papers by what they may be used for. */
  const legacy = page.locator(".st-rail .st-card", { hasText: "Legacy" }).first();
  await expect(legacy.locator(".dash-gates li")).toHaveCount(sources.standing.gates.length);
  await expect(legacy.locator(".dash-gates li.is-met")).toHaveCount(sources.standing.gates.filter((g) => g.met).length);
  const papers = page.locator(".st-rail .st-card", { hasText: "Your papers" });
  await expect(papers.locator(".dash-legend")).toContainText(`${sources.counts.draftable} ready to draft`);
  /* The Kivyn card and the profile card were the bar's door and account menu, said again. */
  await expect(page.locator(".st-rail")).not.toContainText("What Archivyn says about you");
  await expect(page.locator(".st-rail")).not.toContainText("can plan your next story");

  if (stories.length === 0 && jobs.length === 0) {
    await expect(page.locator(".dash-first")).toBeVisible();
    return;
  }

  /* Needs you: the tile, the heading and the queue are one count. */
  const needs = await tile(page, "Needs you").locator(".dash-tile__value").innerText();
  await expect(page.locator("#st-queue .dash-count")).toHaveText(needs);
  /* The tile says what is waiting, by kind, never "N other". */
  await expect(tile(page, "Needs you").locator(".dash-tile__sub")).not.toContainText("other");

  /* The pipeline counts the same work the queue lists, stage by stage. */
  const stage = (label) => page.locator(".dash-stage").filter({ hasText: label }).locator(".dash-stage__count");
  const inReview = stories.filter((s) => s.status === "draft" && s.provenance).length + jobs.filter((j) => j.status === "awaiting_review" && !j.storyId).length;
  await expect(stage("Papers ready")).toHaveText(n(sources.counts.draftable));
  await expect(stage("Outlines to approve")).toHaveText(n(jobs.filter((j) => j.status === "awaiting_outline").length));
  await expect(stage("Being written")).toHaveText(n(jobs.filter((j) => j.status === "running" || j.status === "queued").length));
  await expect(stage("In review")).toHaveText(n(inReview));
  /* Published means published, on the stage as on the tile; what is scheduled is said beside it. */
  await expect(stage("Published")).toHaveText(n(published));
  await expect(tile(page, "Published").locator(".dash-tile__value")).toHaveText(n(published));

  /* Your stories: six at most, and a status chip narrows them to that status. */
  const table = page.locator(".dash-stories");
  await expect(table.locator(".dash-tr:not(.dash-th)")).toHaveCount(Math.min(6, stories.length));
  await expect(table.locator(".dash-count")).toHaveText(String(stories.length));
  const reviewChip = table.getByRole("button", { name: /^In review/ });
  if (await reviewChip.count()) {
    await reviewChip.click();
    await expect(reviewChip).toHaveAttribute("aria-pressed", "true");
    const statuses = await table.locator(".dash-status").allInnerTexts();
    expect(statuses.length).toBeGreaterThan(0);
    expect(new Set(statuses)).toEqual(new Set(["In review"]));
  }
});

test("the reads chart is the API's day by day, over the range asked for", async ({ page }) => {
  const [{ stories }, { jobs }] = await Promise.all([api(page, "/api/editorial-stories"), api(page, "/api/drafting/jobs?limit=10")]);
  const out = stories.filter((s) => s.status === "published" || s.status === "scheduled").length;

  await page.goto("/");
  await page.waitForLoadState("networkidle");
  const card = page.locator("#dash-reads");
  /* Nothing written yet: the first visit has no chart to draw, by design. */
  if (stories.length === 0 && jobs.length === 0) {
    await expect(page.locator(".dash-first")).toBeVisible();
    await expect(card).toHaveCount(0);
    return;
  }
  if (out === 0) {
    await expect(card.locator(".dash-reads-empty")).toContainText("once a story is published");
    return;
  }

  for (const days of [30, 7, 90]) {
    const timeline = await api(page, `/api/editorial-stories/reads/daily?days=${days}`);
    if (days !== 30) {
      await card.getByRole("link", { name: `${days}d` }).click();
      await expect(page).toHaveURL(new RegExp(`[?&]range=${days}\\b`));
    }
    await expect(card.getByRole("link", { name: `${days}d` })).toHaveAttribute("aria-current", "true");
    await expect(card.locator(".dash-chart__bar")).toHaveCount(days);
    await expect(card.locator(".dash-metric")).toHaveText(n(timeline.total));
    /* Today is the last bar, and it says its own count. */
    const today = timeline.series[timeline.series.length - 1];
    await expect(card.locator(".dash-chart__bar").last()).toHaveAttribute("title", new RegExp(`· ${n(today.reads)} reads?$`));
    if (timeline.top.length) await expect(card.locator(".dash-top a")).toHaveText(timeline.top[0].title);
  }

  /* Anything else in the address is the default window, not an error. */
  await page.goto("/?range=1000");
  await expect(card.locator(".dash-chart__bar")).toHaveCount(30);
});

test("writing has one door: the nudge on the Studio, the bar on Stories, and nowhere it is not needed", async ({ page }) => {
  const { stories } = await api(page, "/api/editorial-stories");
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  const nudge = page.locator(".kw-nudge");
  await expect(page.getByRole("link", { name: /Write a story with Kivyn/ })).toHaveCount(1);
  await expect(nudge).toBeVisible();
  await expect(nudge).toHaveAttribute("href", "/editorial/new");
  await expect(page.locator(".nb-write")).toHaveCount(0);

  /* Pointed at, Kivyn picks up the pencil and a sparkle rises; away, it puts it down. */
  await nudge.hover();
  await expect(nudge).toHaveClass(/is-writing/);
  await expect(nudge.locator(".kv")).toHaveAttribute("data-pose", "writing");
  await expect(nudge.locator(".kv-emote")).toBeVisible();
  await page.mouse.move(2, 400);
  await expect(nudge.locator(".kv")).toHaveAttribute("data-pose", "neutral", { timeout: 5_000 });

  /* Stories: the list of what you have written is where you start the next one. */
  await page.goto("/editorial");
  await expect(page.locator(".nb-write")).toBeVisible();
  await expect(page.getByRole("link", { name: /Write a story with Kivyn/ })).toHaveCount(1);

  /* Already writing, starting from a paper's own row, or not about writing at all. */
  const elsewhere = ["/editorial/new", "/papers", "/podcasts", "/profile", "/content", "/standing"];
  if (stories.length) elsewhere.push(`/editorial/${stories[0].id}`);
  for (const route of elsewhere) {
    await page.goto(route);
    await expect(page.locator(".nb-bar"), route).toBeVisible();
    await expect(page.getByRole("link", { name: /Write a story with Kivyn/ }), route).toHaveCount(0);
  }
});

test("the bar's logo is the vector lockup, and it draws", async ({ page }) => {
  await page.goto("/papers");
  const logo = page.locator(".nb-brand img");
  await expect(logo).toHaveAttribute("src", "/brand/archivyn-lockup-compact.svg");
  await expect(logo).toHaveAttribute("alt", "Archivyn");
  await expect.poll(() => logo.evaluate((img) => img.complete && img.naturalWidth > 0)).toBe(true);
  const box = await logo.boundingBox();
  expect(Math.round(box.height)).toBe(42);
  /* The places sit at the bar's centre on a laptop, clear of the lockup. */
  const nav = await page.locator(".nb-nav").boundingBox();
  expect(nav.x - (box.x + box.width)).toBeGreaterThanOrEqual(32);
});

test("the bar's places are the work; who you are is the account menu", async ({ page }) => {
  await page.goto("/");
  const nav = page.getByRole("navigation", { name: "Sections" });
  await expect(nav.getByRole("link")).toHaveText(["Studio", "Papers", "Stories", "Podcasts"]);
  await expect(nav.getByRole("link", { name: "Profile" })).toHaveCount(0);

  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: "Profile" }).click();
  await expect(page).toHaveURL(/\/profile$/);
  /* On the Profile, the avatar is the place you are. */
  await expect(page.getByRole("button", { name: "Account menu" })).toHaveClass(/is-active/);
  await page.getByRole("button", { name: "Account menu" }).click();
  await expect(page.getByRole("menuitem", { name: "Profile" })).toHaveAttribute("aria-current", "page");
});

test("the search opens below the bar, never over its places", async ({ page }) => {
  for (const [width, height] of [[1366, 607], [390, 844]]) {
    await page.setViewportSize({ width, height });
    for (const route of ["/editorial/new", "/editorial"]) {
      await page.goto(route);
      await page.locator(".nb-search__trigger").click();
      await expect(page.locator(".nb-search__pop input")).toBeFocused();
      const [pop, bar, nav] = await Promise.all([".nb-search__pop", ".nb-bar", ".nb-nav"].map((s) => page.locator(s).boundingBox()));
      const where = `${route} at ${width}px`;
      expect(pop.y, where).toBeGreaterThanOrEqual(bar.y + bar.height);
      const overNav = pop.x < nav.x + nav.width && pop.x + pop.width > nav.x && pop.y < nav.y + nav.height && pop.y + pop.height > nav.y;
      expect(overNav, where).toBe(false);
      expect(pop.x, where).toBeGreaterThanOrEqual(0);
      expect(pop.x + pop.width, where).toBeLessThanOrEqual(width);
      await page.keyboard.press("Escape");
      await expect(page.locator(".nb-search__pop")).toHaveCount(0);
    }
  }
});

test("the Studio at the sizes it is judged at", async ({ page }) => {
  test.skip(!process.env.SCREENS, "screenshots are captured on demand: SCREENS=1");
  fs.mkdirSync(OUT, { recursive: true });
  for (const [name, width, height] of [["20-studio-laptop", 1366, 607], ["21-studio-phone", 390, 844]]) {
    await page.setViewportSize({ width, height });
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2600);
    await page.screenshot({ path: path.join(OUT, `${name}.png`) });
    await page.screenshot({ path: path.join(OUT, `${name}-full.png`), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  }
});
