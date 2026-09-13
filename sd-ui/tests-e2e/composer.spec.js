/**
 * The studio, as a scholar uses it.
 *
 * Start from Papers, pick a paper, choose the reader, approve the outline
 * the agent proposes, land in the review workspace with the draft already
 * a story, read the passages behind a paragraph, instruct the agent to
 * change and to illustrate, accept one and reject the other, run the publish
 * check, publish, and read the story as the public would with the sources
 * open. Every assertion is on rendered content: what the page shows, not
 * what the network returned.
 */

const { test, expect } = require("@playwright/test");

const { readState } = require("./stack");

let state;

test.beforeAll(() => {
  state = readState();
});

test.beforeEach(async ({ context }) => {
  /* The session cookie the API minted for the seeded scholar. Host-only on
     localhost, so the dev server on one port and the API on another share it. */
  await context.addCookies([
    { name: "sd_session", value: state.token, domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax" },
    { name: "sd_session", value: state.token, domain: "127.0.0.1", path: "/", httpOnly: true, sameSite: "Lax" },
  ]);
});

test("from a paper to a published story, with the agent editing by instruction", async ({ page, browser }) => {
  test.setTimeout(240_000);

  /* Studio: the front door names the next step and the Papers shelf. */
  await page.goto("/");
  await expect(page.getByRole("link", { name: "New story" }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Papers", exact: true })).toBeVisible();

  /* Papers: every paper with what it may be used for; only the ones we hold in full can start a story. */
  await page.goto("/papers");
  await expect(page.locator(".pp-table tbody tr")).toHaveCount(4);
  await expect(page.locator(".pp-table tbody tr", { hasText: "Quote only" })).toHaveCount(1);
  await expect(page.locator(".pp-table tbody tr", { hasText: "Quote only" }).getByRole("link", { name: "Start a story" })).toHaveCount(0);
  const paperRow = page.locator(".pp-table tbody tr", { hasText: "Adaptive nulling" });
  await paperRow.getByRole("link", { name: "Start a story" }).click();

  /* New story, step 1: the paper is preselected. */
  await expect(page).toHaveURL(/\/editorial\/new\?source=/);
  await expect(page.locator(".nsf-source.on")).toContainText("Adaptive nulling");
  await page.locator(".nsf-actions").getByRole("button", { name: "Next" }).click();

  /* Step 2: the reader and a brief. */
  await expect(page.locator(".nsf-choice.on")).toContainText("General");
  await page.getByPlaceholder(/Focus on why/).fill("Keep it to what the boards did in the second drought.");
  await page.getByRole("button", { name: "Propose an outline" }).click();

  /* Step 3: the outline, with the passages behind each section; the scholar cuts one. */
  await expect(page.getByRole("heading", { name: "Here is how the article would go" })).toBeVisible({ timeout: 60_000 });
  await expect(page.locator(".nsf-brief-text")).toContainText("second drought");
  await expect(page.getByLabel("Working title")).toHaveValue(/^What the paper found/);
  const beats = page.locator(".nsf-beat");
  const beatCount = await beats.count();
  expect(beatCount).toBeGreaterThanOrEqual(2);
  await expect(beats.first().locator(".block-chip").first()).toHaveText(/^p\d+$/);
  await beats.last().locator(".nsf-cut").click();
  await expect(page.locator(".nsf-beat.is-cut")).toHaveCount(1);
  await expect(page.locator(".nsf-actions .st-todo-detail")).toContainText(`${beatCount - 1} section`);
  await page.getByRole("button", { name: "Approve and draft" }).click();

  /* Step 4 runs on the server; the draft is a story before the page moves. */
  await expect(page).toHaveURL(/\/editorial\/[0-9a-f]{24}$/, { timeout: 120_000 });

  /* The review workspace: status, provenance, the outline the scholar approved. */
  await expect(page.locator(".sc-write-status")).toHaveText("Machine draft · in review");
  await expect(page.locator(".sc-write-metatext")).toContainText("Drawn from “Adaptive nulling in small antenna arrays”");
  await expect(page.locator(".ws-outline-item")).toHaveCount(beatCount - 1);
  await expect(page.getByPlaceholder("Title", { exact: true })).toHaveValue(/^What the paper found/);
  const chips = page.locator(".block-row .block-chip");
  await expect(chips.first()).toBeVisible();
  await expect(page.locator(".block-row .block-chip.is-lost")).toHaveCount(0);

  /* Source rail: the passages behind the paragraph the scholar is on. */
  const firstParagraph = page.locator(".block-row", { has: page.locator(".block-chip") }).first();
  await firstParagraph.locator(".block-editor-surface").click();
  await expect(page.locator(".sr-passage").first()).toBeVisible();
  await expect(page.locator(".sr-passage mark").first()).toBeVisible();

  /* Checks rail: nothing needs the scholar yet. */
  await page.getByRole("tab", { name: "Checks" }).click();
  await expect(page.locator(".ck-item").first()).toBeVisible();
  await expect(page.locator(".sc-write-attention")).toHaveCount(0);

  /* Agent: an instruction becomes a proposal; nothing lands until Accept. */
  await page.getByRole("tab", { name: "Agent" }).click();
  await expect(page.locator(".ag-example").first()).toBeVisible();
  const secondBlock = page.locator(".block-row").nth(1).locator(".block-editor-surface");
  const secondBefore = (await secondBlock.innerText()).trim();
  await page.getByPlaceholder("What should change?").fill("Shorten paragraph 2 to one sentence");
  await page.getByRole("button", { name: "Send" }).click();
  const proposal = page.locator(".ag-proposal").first();
  await expect(proposal.locator(".ag-change.is-changed")).toContainText("block 2", { timeout: 60_000 });
  const proposed = (await proposal.locator(".ag-after").innerText()).trim();
  expect(proposed.length).toBeGreaterThan(0);
  expect(proposed.length).toBeLessThan(secondBefore.length);
  await expect(proposal.locator(".ag-checks .block-chip").first()).toHaveText("1 of 1 written paragraph supported by the paper");
  await expect(page.getByPlaceholder("Accept or reject the proposal above first")).toBeDisabled();
  await expect(page.getByRole("button", { name: "Publish check" })).toBeDisabled();
  expect((await secondBlock.innerText()).trim()).toBe(secondBefore);

  await proposal.getByRole("button", { name: "Accept" }).click();
  await expect(proposal.locator(".ag-resolved")).toHaveText("Accepted");
  await expect(page.locator(".block-row").nth(1).locator(".block-editor-surface")).toHaveText(proposed);
  await expect(page.locator(".block-row").nth(1).locator(".block-chip")).not.toHaveClass(/is-lost/);

  /* An illustration by instruction, then rejected: it never touches the story. */
  const rowsBefore = await page.locator(".block-row").count();
  await page.getByPlaceholder("What should change?").fill("Add an illustration of a four-element antenna array on a mast after paragraph 1");
  await page.getByRole("button", { name: "Send" }).click();
  const second = page.locator(".ag-proposal").nth(1);
  await expect(second.locator(".ag-change.is-added")).toContainText("image", { timeout: 60_000 });
  await expect(second.locator(".ag-checks .block-chip", { hasText: "illustration generated" })).toBeVisible();
  await second.getByRole("button", { name: "Reject" }).click();
  await expect(second.locator(".ag-resolved")).toHaveText("Rejected");
  await expect(page.locator(".block-row")).toHaveCount(rowsBefore);

  /* The publish check, then publish. */
  await page.getByRole("button", { name: "Publish check" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "Publish check" })).toBeVisible();
  await expect(dialog.locator(".pc-item").first()).toContainText("Every drafted paragraph is supported, or is yours");
  await expect(dialog.locator(".pc-prov")).toContainText("Drawn from the author's research");
  await dialog.getByRole("button", { name: "Publish now" }).click();
  await expect(page.locator(".sc-write-msg.is-ok")).toContainText("published", { timeout: 30_000 });
  const live = page.locator("a.sc-write-live");
  await expect(live).toBeVisible();
  const publicPath = await live.getAttribute("href");
  expect(publicPath).toMatch(/^\/stories\//);

  /* Read it as the public, with no session, and open the passage behind a paragraph. */
  const anonymous = await browser.newContext();
  const reader = await anonymous.newPage();
  await reader.goto(publicPath);
  await expect(reader.locator("h1")).toHaveText(/^What the paper found/);
  await expect(reader.locator(".public-story-byline-text b")).toHaveText("Test Scholar");
  await expect(reader.locator(".public-story-provenance")).toContainText("Drawn from the author's research: Adaptive nulling in small antenna arrays");
  await expect(reader.locator(".public-story-provenance a")).toHaveAttribute("href", "https://pmc.example/src-e2e-1");
  await expect(reader.locator(".reader-paragraph", { hasText: proposed.slice(0, 40) })).toHaveCount(1);
  await reader.getByRole("button", { name: "Show sources" }).click();
  const mark = reader.locator(".reader-srcmark").first();
  await expect(mark).toHaveText(/^p\d+/);
  await mark.click();
  await expect(reader.locator(".reader-pop-passage p").first()).not.toHaveText(/^\s*$/);
  await expect(reader.locator(".reader-pop-link")).toHaveAttribute("href", "https://pmc.example/src-e2e-1");
  await anonymous.close();
});

test("a blank story still opens the plain editor", async ({ page }) => {
  await page.goto("/editorial/new?blank=1");
  await expect(page.getByPlaceholder("Title", { exact: true })).toBeVisible();
  await expect(page.locator(".ws-grid")).toHaveCount(0);
});

test("without a session the studio is not reachable", async ({ browser }) => {
  const anonymous = await browser.newContext();
  const page = await anonymous.newPage();
  await page.goto("/editorial/new");
  await expect(page).toHaveURL(/\/login/);
  await anonymous.close();
});
