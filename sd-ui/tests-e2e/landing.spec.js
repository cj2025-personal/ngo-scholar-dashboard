/**
 * The front page: someone with no session who opens the studio's address
 * sees what the studio is ("the press", chosen on the landing canvas on
 * 2026-11-17), under the same address. Signed in, the address is the Studio.
 *
 * What it keeps right:
 *   - "/" with no session is the front page, not a bounce to sign in; every
 *     other private page still sends a visitor to sign in (claim.spec).
 *   - the editions switch the cover, the steps switch the reading, and the
 *     moving titles can be paused.
 *   - the only ways onward are signing in and asking to join.
 */

const path = require("path");
const { test, expect } = require("@playwright/test");

const { readState } = require("./stack");

let state;
test.beforeAll(() => { state = readState(); });

async function anonymousPage(browser) {
  const context = await browser.newContext();
  const page = await context.newPage();
  return { context, page };
}

test("with no session, the studio's address is the front page", async ({ browser }) => {
  const { context, page } = await anonymousPage(browser);
  await page.goto("/");

  await expect(page).toHaveURL(/localhost:\d+\/$/);
  /* What it is, said first, in words a visitor can read. */
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Inkvyn");
  await expect(page.locator(".pr-subtitle")).toHaveText("Your research, written for every reading age.");
  await expect(page.locator(".pr-hero__copy .pr-lede")).toContainText("invitation-only dashboard where scholars share what they know");
  /* The product's own brand in the bar, beside its maker's. */
  await expect(page.getByRole("banner").locator(".pr-brand__name")).toHaveText("Inkvyn");
  await expect(page.getByRole("banner").locator(".pr-brand__mark")).toBeVisible();
  await expect(page.getByRole("heading", { name: /^AI podcasts about your work/ })).toBeVisible();
  await expect(page.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login");
  await expect(page.getByRole("link", { name: "Ask to join" })).toHaveAttribute("href", /^mailto:hello@projarch\.org\?subject=/);

  /* The header's links are the page's own sections, and every one exists. */
  const sections = page.getByRole("navigation", { name: "On this page" }).getByRole("link");
  await expect(sections).toHaveText(["Editions", "Meet Kivyn", "Circles", "AI podcasts", "Joining"]);
  for (const href of await sections.evaluateAll((links) => links.map((a) => a.getAttribute("href")))) {
    await expect(page.locator(href)).toHaveCount(1);
  }
  /* It stays on top as the page scrolls, and lifts once it has moved. */
  await expect(page.getByRole("banner")).toHaveCSS("position", "sticky");
  await expect(page.getByRole("banner")).not.toHaveClass(/is-stuck/);
  await page.getByRole("link", { name: "Joining" }).click();
  await expect(page.getByRole("banner")).toHaveClass(/is-stuck/);
  await expect(page.getByRole("link", { name: "Joining" })).toHaveAttribute("aria-current", "true");

  /* No drawing-board placeholder ("[PAPER TITLE]") reached the page; its own labels are "[ Like this ]". */
  expect(await page.locator("body").textContent()).not.toMatch(/\[[A-Z][A-Z ]+\]/);
  /* No sample: no made-up story, episode or waveform. */
  await expect(page.locator("body")).not.toContainText("antenna");
  await expect(page.locator(".pr-wave")).toHaveCount(0);
  await context.close();
});

test("it carries the brand: the Proj Arch lockup, and the mark as the tab's icon", async ({ browser }) => {
  const { context, page } = await anonymousPage(browser);
  await page.goto("/");
  const home = page.getByRole("banner").getByRole("link", { name: "Proj Arch Inkvyn, home" });
  await expect(home).toHaveAttribute("href", "/");
  await expect(home.getByRole("img", { name: "Proj Arch" })).toHaveAttribute("src", "/brand/archivyn-lockup-compact.svg");
  await expect(page.locator("link[rel='icon'][href*='/icon.svg']")).toHaveCount(1);
  await expect(page.locator("link[rel='icon'][href*='favicon.ico']")).toHaveCount(0);
  await context.close();
});

test("no moving edition titles above the hero (removed at review)", async ({ browser }) => {
  const { context, page } = await anonymousPage(browser);
  await page.goto("/");
  await expect(page.getByText("One paper, every reader")).toHaveCount(0);
  await expect(page.getByRole("group", { name: "Editions" })).toHaveCount(0);
  await expect(page.locator(".pr-mq")).toHaveCount(0);
  await context.close();
});

test("the picture plays each reading age in turn: the paper opens and Kivyn writes from it", async ({ browser }) => {
  const { context, page } = await anonymousPage(browser);
  await page.goto("/");
  const picture = page.getByRole("img", { name: /^Your paper/ });
  const article = page.locator(".pr-sim__art");
  await expect(picture).toHaveAttribute("aria-label", /writes the edition for young readers \(Ages 8–11\) from it/);
  await expect(page.locator(".pr-sim__face--front")).toContainText("Your paper");
  await expect(article).toContainText("Ages 8–11 · edition");
  await expect(article).toContainText("Written to grade 4");
  /* Three passages marked in the paper; three numbered lines in the edition. */
  await expect(page.locator(".pr-sim__num")).toHaveText(["1", "2", "3"]);
  await expect(page.locator(".pr-sim__mark")).toHaveText(["1", "2", "3"]);
  await expect(article).toContainText("Approved by you");
  /* It moves: the cover opens on its own loop. */
  await expect(page.locator(".pr-sim__cover")).toHaveCSS("animation-name", "pr-sim-open");

  /* At the end of a run (twelve seconds), the next reading age in the table. */
  await page.mouse.move(1, 1);
  await expect(picture).toHaveAttribute("aria-label", /writes the edition for middle school \(Ages 12–14\) from it/, { timeout: 16_000 });
  await expect(article).toContainText("Ages 12–14 · edition");
  await expect(article).toContainText("Written to grade 7");
  /* Under the picture, nothing: no caption, no links down the page. */
  await expect(page.locator(".pr-cap")).toHaveCount(0);
  await context.close();
});

test("asked for less motion, the picture is its last frame, still", async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: "reduce" });
  const page = await context.newPage();
  await page.goto("/");
  await expect(page.locator(".pr-sim__cover")).toHaveCSS("animation-name", "none");
  await expect(page.locator(".pr-sim__stamp")).toHaveCSS("opacity", "1");
  await expect(page.locator(".pr-sim__kv-3")).toHaveCSS("opacity", "1");
  await context.close();
});

test("Meet Kivyn says, for every reading age, exactly what the API holds Kivyn to", async ({ browser }) => {
  /* The API's own table: the brief the model is given, the band the editor
     judges a draft against, and whether the youngest get the suitability
     check. The page mirrors it (src/lib/readingBands.js); this holds them. */
  const { AUDIENCES } = require(path.join(__dirname, "..", "..", "sd-api", "src", "lib", "audiences.js"));
  const fmt = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

  const { context, page } = await anonymousPage(browser);
  await page.goto("/");
  const kivyn = page.locator("#kivyn");
  await expect(kivyn.getByRole("heading", { level: 2 })).toHaveText("An AI writing assistant for every grade.");

  const tabs = kivyn.getByRole("tab");
  const keys = Object.keys(AUDIENCES);
  await expect(tabs).toHaveCount(keys.length);
  for (const [i, key] of keys.entries()) {
    const a = AUDIENCES[key];
    await tabs.nth(i).click();
    await expect(tabs.nth(i)).toHaveAttribute("aria-selected", "true");
    const panel = kivyn.getByRole("tabpanel");
    const at = a.brief.indexOf(". ");
    await expect(panel).toContainText(`For ${a.brief.slice(0, at)}`);
    await expect(panel.locator("blockquote")).toHaveText(a.brief.slice(at + 2));
    await expect(panel).toContainText(`Written to grade ${a.grade}.`);
    const hi = fmt(a.grade + a.maxAbove);
    await expect(panel).toContainText(a.maxBelow == null ? `anything up to grade ${hi}` : `grades ${fmt(a.grade - a.maxBelow)} to ${hi}`);
    await expect(panel.getByText(/judged for suitability/)).toHaveCount(a.young ? 1 : 0);
  }

  /* Kivyn at work: the pipeline's steps, in order, ending with the scholar. */
  const steps = kivyn.locator(".pr-trace__step");
  await expect(steps.first()).toHaveText("Reads your paper");
  await expect(steps.last()).toHaveText("Hands it to you to approve");
  await expect(kivyn.locator(".pr-trace__step.is-now")).toHaveCount(1);
  await expect(kivyn.locator(".pr-pillar")).toHaveCount(6);
  await context.close();
});

test("asked for less motion, Kivyn's run is shown finished, still", async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: "reduce" });
  const page = await context.newPage();
  await page.goto("/");
  const steps = page.locator("#kivyn .pr-trace__step");
  await expect(page.locator("#kivyn .pr-trace__step.is-done")).toHaveCount(await steps.count());
  await expect(page.locator("#kivyn .pr-trace__step[aria-current]")).toHaveCount(0);
  await context.close();
});

test("learning circles: who joins, the circle, and where it is read, linked by light", async ({ browser }) => {
  const { context, page } = await anonymousPage(browser);
  await page.goto("/");
  const circles = page.locator("#circles");
  await expect(circles.getByRole("heading", { level: 2 })).toHaveText("Your stories, read together.");
  await expect(circles.locator(".pr-circles__head .pr-lede")).toContainText("Kivyn can write for it.");
  /* As it works: classes join once their school says yes; no code a scholar
     hands out, no invented number, no caption under it (removed at review). */
  await expect(circles).not.toContainText(/code/i);
  expect(await circles.textContent()).not.toMatch(/\b\d+ (readers|students|classes)\b/i);
  await expect(circles.locator("figcaption")).toHaveCount(0);

  const diagram = circles.getByRole("img", { name: /Users of every reading age join your circle/ });
  await expect(diagram.locator(".pr-beams__title")).toHaveText(["Users", "Users", "Users", "User dashboards", "A community’s portal"]);
  await expect(diagram.locator(".pr-beams__sub").first()).toHaveText("Ages 8–11");
  /* Said at a high level: users, never tied to schools or classes (the
     platform has institutional and retail users alike). */
  expect(await circles.textContent()).not.toMatch(/\b(school|class(es)?|teacher|student)s?\b/i);
  /* A beam from each group to the circle, and from the circle to each place it is read. */
  await expect(diagram.locator(".pr-beams__light")).toHaveCount(5);
  /* The light runs once it is on screen. */
  await diagram.scrollIntoViewIfNeeded();
  await expect(diagram).toHaveClass(/is-on/);
  await expect.poll(() => diagram.evaluate((el) => el.getAnimations({ subtree: true }).filter((a) => a.playState === "running").length)).toBeGreaterThan(4);
  await context.close();
});

test("asked for less motion, the circle's links are plain lines, still", async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: "reduce" });
  const page = await context.newPage();
  await page.goto("/");
  const diagram = page.locator(".pr-beams");
  await diagram.scrollIntoViewIfNeeded();
  await expect(diagram.locator(".pr-beams__track")).toHaveCount(5);
  expect(await diagram.evaluate((el) => el.getAnimations({ subtree: true }).length)).toBe(0);
  await context.close();
});

test("signed in, the same address is the Studio", async ({ browser }) => {
  const context = await browser.newContext();
  await context.addCookies([
    { name: "sd_session", value: state.token, domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax" },
  ]);
  const page = await context.newPage();
  await page.goto("/");
  await expect(page.locator(".pr")).toHaveCount(0);
  await expect(page.locator(".nb-bar")).toBeVisible();
  await context.close();
});
