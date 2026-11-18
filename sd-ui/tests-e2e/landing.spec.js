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
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/^Inkvyn:/);
  await expect(page.getByRole("heading", { name: "Conversations:" })).toBeVisible();
  await expect(page.getByRole("link", { name: "[ Sign in ]" })).toHaveAttribute("href", "/login");
  await expect(page.getByRole("link", { name: "[ Ask to join ]" })).toHaveAttribute("href", /^mailto:hello@projarch\.org\?subject=/);

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

test("the editions are the paper and every reading age in the table", async ({ browser }) => {
  const { context, page } = await anonymousPage(browser);
  await page.goto("/");
  /* The table today: four ages, so five editions and four written for readers. */
  await expect(page.getByText("[ One finding, five editions ]")).toBeVisible();
  for (const label of ["The paper", "Ages 8–11", "Ages 12–14", "Ages 15–18", "Adults"]) {
    await expect(page.getByRole("button", { name: new RegExp(`^${label}`) })).toHaveCount(1);
  }
  await expect(page.getByRole("button", { name: /Four editions, every sentence sourced/ })).toBeVisible();
  await context.close();
});

test("choosing an edition sets its cover", async ({ browser }) => {
  const { context, page } = await anonymousPage(browser);
  await page.goto("/");
  const cover = page.getByRole("img", { name: /^Cover:/ });
  await expect(cover).toHaveAttribute("aria-label", "Cover: Your research, Ages 8–11 · edition");
  await expect(cover).toContainText("Written to grade 4 · approved by you");

  /* The titles move; paused, they hold still to be read and chosen. */
  await page.getByRole("button", { name: "[ Pause titles ]" }).click();
  await expect(page.getByRole("button", { name: "[ Play titles ]" })).toBeVisible();

  await page.getByRole("button", { name: /^Ages 12–14/ }).click();
  await expect(cover).toHaveAttribute("aria-label", "Cover: Your research, Ages 12–14 · edition");
  await expect(cover).toContainText("Written to grade 7 · approved by you");
  await expect(page.getByRole("button", { name: /^Ages 12–14/ })).toHaveAttribute("aria-pressed", "true");

  await page.getByRole("button", { name: /^The paper/ }).click();
  await expect(cover).toHaveAttribute("aria-label", "Cover: Your paper, The paper · original");
  await expect(cover).toContainText("By you");
  /* Under the cover, nothing: no caption, no links down the page. */
  await expect(page.locator(".pr-cap")).toHaveCount(0);
  await context.close();
});

test("the six steps open one at a time", async ({ browser }) => {
  const { context, page } = await anonymousPage(browser);
  await page.goto("/");
  const steps = page.locator(".pr-row");
  await expect(steps).toHaveCount(6);
  await expect(page.locator("#pr-step")).toContainText("Step 1 of 6");

  await page.getByRole("button", { name: /You approve, or not/ }).click();
  await expect(page.locator("#pr-step")).toContainText("Step 4 of 6");
  await expect(page.locator("#pr-step")).toContainText("Nothing reaches readers until you do.");
  await expect(page.locator(".pr-row[aria-pressed='true']")).toHaveCount(1);
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
