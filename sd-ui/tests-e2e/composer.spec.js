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

const { openAgent } = require("./agent");
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

  /* New story is a conversation. The paper is preselected from Papers. */
  await expect(page).toHaveURL(/\/editorial\/new\?source=/);
  /* The agent works under terms agreed to once; the first time, they come up at once. */
  await openAgent(page);
  await expect(page.getByLabel("Paper")).toHaveValue(/src-e2e-1$/);
  await expect(page.locator(".ch-msg.is-agent").first()).toContainText("What shall we write");
  await page.getByLabel("Reader age").selectOption("ages_15_18");
  await page.getByPlaceholder(/Describe the article you want/).fill("Keep it to what the boards did in the second drought.");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.locator(".ch-msg.is-user").first()).toContainText("second drought");

  /* The agent answers with an outline: sections and the passages behind each. */
  const outline1 = page.locator(".ch-msg.is-outline").first();
  await expect(outline1).toBeVisible({ timeout: 60_000 });
  await expect(outline1.locator(".ch-outline-title")).toHaveText(/^What the paper found/);
  const beatCount = await outline1.locator(".ch-beat").count();
  expect(beatCount).toBeGreaterThanOrEqual(2);
  await expect(outline1.locator(".ch-beat").first().locator(".block-chip").first()).toHaveText(/^p\d+$/);
  await expect(page.getByLabel("Paper")).toBeDisabled();
  await expect(page.getByLabel("Reader age")).toBeDisabled();

  /* A follow-up replans it; the first outline is superseded, the second is live. */
  await page.getByPlaceholder(/Reply with what to change/).fill("Lead with the limitations.");
  await page.getByRole("button", { name: "Send" }).click();
  const outline2 = page.locator(".ch-msg.is-outline").nth(1);
  await expect(outline2).toBeVisible({ timeout: 60_000 });
  await expect(outline1.locator(".ag-resolved")).toHaveText("Replaced by the outline below");
  await expect(outline2.locator(".ch-text")).toContainText("replanned");
  await expect(outline1.getByRole("button", { name: /Approve and draft/ })).toHaveCount(0);

  /* The scholar cuts the last section and approves. */
  await outline2.locator(".ch-beat").last().locator(".nsf-cut").click();
  await expect(outline2.locator(".ch-beat.is-cut")).toHaveCount(1);
  await outline2.getByRole("button", { name: /Approve and draft/ }).click();
  await expect(page.locator(".ch-msg.is-user").last()).toContainText("Approved");

  /* What the scholar approved lands in the page they were looking at: the
     title in the title field, a heading for every section they kept, and the
     prose under each — then the page saves it and becomes the story. Asserted
     against the outline they approved, not against a fixture, because the
     thing that can silently break is the handover from rail to page. */
  const approvedHeadings = await outline2.locator(".ch-beat:not(.is-cut) .ch-beat-heading").allInnerTexts();
  const approvedTitle = await outline2.locator(".ch-outline-title").innerText();
  await expect(page.getByPlaceholder("Title", { exact: true })).toHaveValue(approvedTitle, { timeout: 120_000 });
  for (const heading of approvedHeadings) {
    await expect(page.locator(".block-row", { hasText: heading.replace(/Beyond the paper|Your own context/g, "").trim() }).first()).toBeVisible();
  }
  await expect(page.locator(".block-row .block-editor-surface").first()).not.toBeEmpty();
  const words = Number((await page.locator(".sc-write-metatext").innerText()).match(/(\d[\d,]*) words/)?.[1].replace(/,/g, "") || 0);
  expect(words).toBeGreaterThan(100);

  /* Step 4 runs on the server; the draft is a story before the page moves. */
  await expect(page).toHaveURL(/\/editorial\/[0-9a-f]{24}$/, { timeout: 120_000 });

  /* The review workspace: status, provenance, the outline the scholar approved. */
  await expect(page.locator(".sc-write-status")).toHaveText("Machine draft · in review");
  /* Which paper it came from lives in "This draft" in the rail now, not in
     the bar: a paper title is long enough to push the buttons off the edge. */
  await page.locator(".ws-sect__head", { hasText: "This draft" }).click();
  await expect(page.locator(".ws-facts")).toContainText("Adaptive nulling in small antenna arrays");
  await expect(page.locator(".ws-facts")).toContainText("Written for");
  await expect(page.locator(".ws-outline-item")).toHaveCount(beatCount - 1);
  await expect(page.getByPlaceholder("Title", { exact: true })).toHaveValue(/^What the paper found/);
  const chips = page.locator(".block-row .block-chip");
  await expect(chips.first()).toBeVisible();
  await expect(page.locator(".block-row .block-chip.is-lost")).toHaveCount(0);

  /* The Agent console is the default rail; the composer is docked and ready. */
  await expect(page.locator(".ws-tab.on")).toHaveText("Agent");
  await expect(page.getByPlaceholder("What should change?")).toBeVisible();

  /* Source rail: the passages behind the paragraph the scholar is on. */
  const firstParagraph = page.locator(".block-row", { has: page.locator(".block-chip") }).first();
  await firstParagraph.locator(".block-editor-surface").click();
  await page.getByRole("tab", { name: "Source" }).click();
  await expect(page.locator(".sr-passage").first()).toBeVisible();
  await expect(page.locator(".sr-passage mark").first()).toBeVisible();

  /* Checks rail: nothing needs the scholar yet. */
  await page.getByRole("tab", { name: "Checks" }).click();
  await expect(page.locator(".ck-item").first()).toBeVisible();
  await expect(page.locator(".sc-write-attention")).toHaveCount(0);

  /* Inline editing: the scholar types straight into the article, the draft
     saves itself, and the agent will not act until it has. */
  await expect(page.locator(".sc-write-saved")).toHaveText(/^v\d+$/);
  await firstParagraph.locator(".block-editor-surface").click();
  await page.keyboard.press("End");
  await page.keyboard.type(" Written by hand.");
  await expect(page.locator(".sc-write-saved")).toHaveText(/Unsaved/);

  await page.getByRole("tab", { name: "Agent" }).click();
  await expect(page.getByPlaceholder(/Save your edits first/)).toBeDisabled();
  await expect(page.locator(".sc-write-saved")).toHaveText("Saved", { timeout: 25_000 });
  await expect(page.getByPlaceholder("What should change?")).toBeEnabled();
  await expect(page.locator(".block-row").filter({ hasText: "Written by hand." })).toHaveCount(1);

  /* Agent: an instruction becomes a proposal; nothing lands until Accept. */
  await page.getByRole("tab", { name: "Agent" }).click();
  await expect(page.locator(".ag-example").first()).toBeVisible();
  await expect(page.locator(".ag-ctx-chip")).toContainText("¶ 2");
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

  await expect(page.locator(".ag-step").first()).toContainText("Rewrote a block");
  await proposal.getByRole("button", { name: "Accept" }).click();
  await expect(proposal.locator(".ag-resolved")).toHaveText("Accepted");
  await expect(page.locator(".block-row").nth(1).locator(".block-editor-surface")).toHaveText(proposed);
  await expect(page.locator(".block-row").nth(1).locator(".block-chip")).not.toHaveClass(/is-lost/);

  /* Every version is on the record, and an earlier one can be put back. */
  await page.getByRole("tab", { name: "History" }).click();
  await expect(page.locator(".hist-item").first()).toBeVisible();
  const versions = await page.locator(".hist-item").count();
  expect(versions).toBeGreaterThanOrEqual(3);
  await expect(page.locator(".hist-badge.is-drafter")).toHaveCount(1);
  await expect(page.locator(".hist-badge.is-agent").first()).toBeVisible();
  await expect(page.locator(".hist-item.is-current")).toHaveCount(1);
  await page.getByRole("tab", { name: "Agent" }).click();

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

  /* Claim by claim: the Source rail shows which sentence rests on which. */
  await page.locator(".block-row", { has: page.locator(".block-chip") }).first().locator(".block-editor-surface").click();
  await page.getByRole("tab", { name: "Source" }).click();
  await expect(page.locator(".sr-claim").first()).toBeVisible();
  await expect(page.locator(".sr-claim-ev").first()).toContainText(/p\d+:/);

  /* The Evidence rail: the whole article, checked by rule and ready to be signed. */
  await page.getByRole("tab", { name: "Evidence" }).click();
  await expect(page.locator(".ev-summary")).toContainText(/claims? checked against the paper/);
  await expect(page.locator(".ev-wrap .ck-item").first()).toContainText("Every number is in the paper");
  await expect(page.locator(".ev-wrap")).toContainText("When you publish");

  /* Every reading age from one approval: write them, read one, approve it.
     The bar is folded until a level exists, so it is opened the way a scholar
     opens it — the controls above the article are the last job, not the first. */
  await expect(page.locator(".lv-bar")).toHaveCount(0, "folded before any level is written");
  await page.locator(".lv-fold").click();
  await page.locator(".lv-bar").getByRole("button", { name: "Write for every age" }).click();
  await expect(page.locator(".lv-status.is-ready")).toHaveCount(3, { timeout: 60_000 });
  await page.locator(".lv-pill", { hasText: "Ages 12–14" }).click();
  await expect(page.locator(".lv-preview .sc-kicker")).toContainText("Ages 12–14 · target grade 7");
  await expect(page.locator(".lv-block").first()).toBeVisible();
  const articleBlocks = await page.locator(".ws-outline-item").count();
  expect(await page.locator(".lv-block").count()).toBeGreaterThanOrEqual(articleBlocks);
  await page.locator(".lv-preview").getByRole("button", { name: "Approve for readers" }).click();
  await expect(page.locator(".lv-status.is-live")).toHaveCount(1, { timeout: 20_000 });
  await page.locator(".lv-pill", { hasText: "Your article" }).click();
  await expect(page.locator(".lv-preview")).toHaveCount(0);
  await expect(page.locator(".block-row").first()).toBeVisible();

  /* The record: the fake registrar says the paper was retracted. */
  await page.getByRole("tab", { name: "Checks" }).click();
  await page.locator(".ck-wrap").getByRole("button", { name: "Check now" }).click();
  await expect(page.locator(".rec-banner")).toContainText("was retracted", { timeout: 20_000 });
  await expect(page.locator(".rec-banner")).toContainText(/Paragraphs? [\d, ]+ rests? on it/);
  await page.locator(".rec-banner").getByRole("button", { name: "Have the agent draft a notice" }).click();
  await expect(page.locator(".ws-tab.on")).toHaveText("Agent");
  await expect(page.getByPlaceholder("What should change?")).toHaveValue(/was retracted/);
  await page.getByPlaceholder("What should change?").fill("");

  /* A retraction blocks publishing until the scholar has marked it as seen. */
  await page.getByRole("button", { name: "Publish check" }).click();
  await expect(page.getByRole("dialog")).toContainText("withdrawn from the record");
  await expect(page.getByRole("dialog").getByRole("button", { name: "Publish now" })).toBeDisabled();
  await page.getByRole("dialog").getByRole("button", { name: "Back to the draft" }).click();
  await page.locator(".rec-banner").getByRole("button", { name: "I have seen this" }).click();
  await expect(page.locator(".rec-banner")).toContainText("seen", { timeout: 20_000 });

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
  await expect(reader.locator(".reader-pop-claims li").first()).toBeVisible();
  await expect(reader.locator(".reader-pop-passage mark").first()).toBeVisible();

  /* The reader is told about the retraction, can read it at another age, and can verify the record. */
  await expect(reader.locator(".reader-notice")).toContainText("was retracted");
  await expect(reader.locator(".reader-level")).toHaveCount(2);
  await reader.locator(".reader-level", { hasText: "Ages 12–14" }).click();
  await expect(reader.locator(".reader-paragraph").first()).toBeVisible();
  await expect(reader.locator(".reader-evidence")).toContainText("checked against the paper");
  const verifyHref = await reader.locator(".reader-evidence a").getAttribute("href");
  expect(verifyHref).toMatch(/\/public\/slug\/.+\/evidence$/);
  const ledger = await reader.request.get(verifyHref);
  expect(ledger.status()).toBe(200);
  const ledgerBody = await ledger.json();
  expect(ledgerBody.signed).toBe(true);
  expect(ledgerBody.manifest.approval.by).toBe("e2e.scholar@example.edu");

  /* Delete it from the list: gone for the scholar, and the public link dies. */
  await page.goto("/editorial");
  const row = page.locator(".el-row", { hasText: "What the paper found" }).first();
  await expect(row).toBeVisible();
  /* A row keeps Edit, View live and Delete to itself until it is pointed at,
     so a list of twelve stories is not a list of thirty-six links. */
  await row.hover();
  await expect(row.getByRole("button", { name: "Delete" })).toBeVisible();
  await row.getByRole("button", { name: "Delete" }).click();
  await expect(row.getByRole("alertdialog")).toContainText("cannot be undone");
  await row.locator(".del-yes").click();
  await expect(page.locator(".el-row", { hasText: "What the paper found" })).toHaveCount(0, { timeout: 20_000 });
  const dead = await reader.goto(publicPath);
  expect(dead.status()).toBe(404);
  await anonymous.close();
});

test("a blank story still opens the plain editor", async ({ page }) => {
  await page.goto("/editorial/new?blank=1");
  await expect(page.getByPlaceholder("Title", { exact: true })).toBeVisible();
  /* The plain editor, not the review workspace: no outline rail, no review
     status. The agent may sit beside it; that is a different thing. */
  await expect(page.locator(".ws-left")).toHaveCount(0);
  await expect(page.locator(".sc-writer.is-review")).toHaveCount(0);
});

test("without a session the studio is not reachable", async ({ browser }) => {
  const anonymous = await browser.newContext();
  const page = await anonymous.newPage();
  await page.goto("/editorial/new");
  await expect(page).toHaveURL(/\/login/);
  await anonymous.close();
});
