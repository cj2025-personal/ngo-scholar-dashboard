/**
 * The way past a paragraph the judge will not pass.
 *
 * The publish check has always held a story on a paragraph short of
 * supported, and named three ways out: rewrite it, remove it, or mark it as
 * your own view. Two of the three did nothing. Rewriting left the old verdict
 * in place, because a verdict is stored on the block and describes the text
 * as drafted; and no control anywhere in the workspace could mark a paragraph
 * as the author's own. A scholar who did the right thing — rewrote the
 * paragraph to fix it — stayed blocked with no explanation, and deleting
 * their own paragraph was the only exit. It landed on five of ten real drafts.
 *
 * One story, two flagged paragraphs, one resolved each way. The gate stays
 * shut until both are dealt with, then opens.
 */

const { test, expect } = require("@playwright/test");

const { openAgent } = require("./agent");
const { readState } = require("./stack");

let state;

test.beforeAll(() => { state = readState(); });

test.beforeEach(async ({ context }) => {
  await context.addCookies([
    { name: "sd_session", value: state.token, domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax" },
    { name: "sd_session", value: state.token, domain: "127.0.0.1", path: "/", httpOnly: true, sameSite: "Lax" },
  ]);
});

const OFF_TOPIC = "Mahogany cabinetry and the price of saffron in the fourteenth century have nothing to do with this work at all.";

test("a flagged paragraph can be taken on as the author's own or rewritten and judged again, and only then does the gate open", async ({ page }) => {
  test.setTimeout(240_000);
  const { apiUrl } = state;

  /* A real draft, by the road a scholar takes. */
  await page.goto("/papers");
  await expect(page.locator(".pp-table tbody tr")).toHaveCount(4, { timeout: 60_000 });
  await page.locator(".pp-table tbody tr", { hasText: "Adaptive nulling" }).getByRole("link", { name: "Start a story" }).click();
  await openAgent(page);
  await page.getByPlaceholder(/Describe the article you want/).fill("What does this work show about weak signals?");
  await page.getByRole("button", { name: "Send" }).click();
  const outline = page.locator(".ch-msg.is-outline").first();
  await expect(outline).toBeVisible({ timeout: 120_000 });
  await outline.getByRole("button", { name: /Approve and draft/ }).click();
  await expect(page).toHaveURL(/\/editorial\/[0-9a-f]{24}$/, { timeout: 180_000 });
  const storyId = page.url().match(/\/editorial\/([0-9a-f]{24})$/)[1];
  await expect(page.locator(".sc-write-saved")).toHaveText(/^(Saved|v\d+)$/, { timeout: 30_000 });

  /* Two paragraphs drawn from the paper, rewritten into something it does not
     support, and judged as they now read — the corner, reached deliberately
     so the test is about the way out and not about the model. */
  const read = async () => (await (await page.request.get(`${apiUrl}/api/editorial-stories/${storyId}`)).json()).story;
  let story = await read();
  /* Paragraphs specifically. A quote drawn from the paper carries source refs
     exactly as a paragraph does, so filtering on those alone picks quotes too —
     and a quote is not checked against the paper, because its words are the
     paper's rather than the scholar's. */
  const paper = story.bodyBlocks
    .map((b, i) => ({ b, i }))
    .filter(({ b }) => b.type === "paragraph" && b.sourceRefs?.length && !b.extension);
  expect(paper.length, "the draft has at least two paragraphs drawn from the paper").toBeGreaterThanOrEqual(2);
  const [own, fix] = [paper[0].i, paper[1].i];
  const drafted = story.bodyBlocks[fix].draftedText;

  const saved = await page.request.patch(`${apiUrl}/api/editorial-stories/${storyId}`, {
    multipart: {
      title: story.title,
      status: "draft",
      bodyBlocks: JSON.stringify(story.bodyBlocks.map((b, i) => ({
        type: b.type,
        html: i === own || i === fix ? OFF_TOPIC : b.html,
        ...(b.sourceRefs ? { sourceRefs: b.sourceRefs, draftedText: b.draftedText, fidelity: b.fidelity } : {}),
        ...(b.sourceRefs && b.extension ? { extension: true, reach: b.reach } : {}),
        ...(b.ownView ? { ownView: true, ...(b.context ? { context: b.context } : {}) } : {}),
      }))),
      inlineImageKeys: "[]", retainImageIds: "[]", baseVersion: String(story.version),
    },
  });
  expect(saved.status()).toBe(200);

  /* Find the two blocks again by what they now say, not by where they were.
   *
   * A block is addressed by its position in an array that both the save and
   * the read can filter — an empty paragraph is not stored, and an image whose
   * file is missing is not presented. Neither happens here, but re-deriving the
   * positions after the save costs nothing and removes the assumption. */
  story = await read();
  const flagged = story.bodyBlocks
    .map((b, i) => ({ b, i }))
    .filter(({ b }) => (b.html || "").includes(OFF_TOPIC))
    .map(({ i }) => i);
  expect(flagged, "both rewritten paragraphs survived the save").toHaveLength(2);
  /* Document order, so these line up with `own` and `fix` as chosen above. */
  const [, fixAt] = flagged;

  for (const at of flagged) {
    story = await read();
    const judged = await page.request.post(`${apiUrl}/api/editorial-stories/${storyId}/blocks/${at}/recheck`, {
      data: { baseVersion: story.version },
    });
    expect(judged.status(), await judged.text()).toBe(200);
    expect((await judged.json()).verdict).toBe("unsupported");
  }

  await page.reload();
  await expect(page.locator(".block-row").first()).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".sc-write-attention")).toContainText("2 paragraphs");

  /* The publish check holds the story and sends the scholar to the paragraph. */
  const publishCheck = page.getByRole("button", { name: "Publish check" });
  await expect(publishCheck).toBeEnabled({ timeout: 20_000 });
  await publishCheck.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("still need a look");
  await expect(dialog.getByRole("button", { name: "Publish now" })).toBeDisabled();
  /* One "Go to it" per flagged paragraph, so this is two buttons while two
     are flagged and one after the first is resolved. Taking the first is
     what a scholar does; naming it keeps the locator unambiguous either
     way rather than passing only while the count happens to be one. */
  await dialog.getByRole("button", { name: "Go to it" }).first().click();

  /* One: the author takes it on. It stops being a claim about the paper. */
  const resolve = page.locator(".sr-resolve");
  await expect(resolve).toBeVisible();
  await expect(resolve.getByRole("button", { name: "Check it again" })).toBeVisible();
  await expect(resolve.getByRole("button", { name: "Mark as my own view" })).toBeVisible();
  await resolve.getByRole("button", { name: "Mark as my own view" }).click();
  await expect(page.locator(".block-row .block-chip.is-own")).toHaveCount(1);
  await expect(page.locator(".sc-write-attention")).toContainText("1 paragraph");
  /* "Saved" is the moment; a version number is that moment settled. Either
     means the edit reached the server, and asserting only the first races
     the indicator — the same tolerant form the first wait uses. */
  await expect(page.locator(".sc-write-saved")).toHaveText(/^(Saved|v\d+)$/, { timeout: 30_000 });

  /* One is still flagged, so the gate is still shut. */
  await publishCheck.click();
  await expect(dialog.getByRole("button", { name: "Publish now" })).toBeDisabled();
  /* One "Go to it" per flagged paragraph, so this is two buttons while two
     are flagged and one after the first is resolved. Taking the first is
     what a scholar does; naming it keeps the locator unambiguous either
     way rather than passing only while the count happens to be one. */
  await dialog.getByRole("button", { name: "Go to it" }).first().click();

  /* Two: the author puts the paragraph right and asks for a fresh verdict.
     The stored verdict is about the old words; this is what earns a new one. */
  await page.locator(".block-row").nth(fixAt).locator("[contenteditable=true]").first().click();
  await page.keyboard.press("Control+A");
  await page.keyboard.type(drafted);
  /* "Saved" is the moment; a version number is that moment settled. Either
     means the edit reached the server, and asserting only the first races
     the indicator — the same tolerant form the first wait uses. */
  await expect(page.locator(".sc-write-saved")).toHaveText(/^(Saved|v\d+)$/, { timeout: 30_000 });

  const recheck = page.locator(".sr-resolve").getByRole("button", { name: "Check it again" });
  await expect(recheck).toBeEnabled({ timeout: 20_000 });
  await recheck.click();
  await expect(page.locator(".sc-write-msg")).toContainText("Checked again", { timeout: 60_000 });

  /* Both dealt with: nothing needs attention and the gate opens. */
  await expect(page.locator(".sc-write-attention")).toHaveCount(0, { timeout: 20_000 });
  await expect(publishCheck).toBeEnabled({ timeout: 20_000 });
  await publishCheck.click();
  await expect(dialog).toContainText("marked as your view");
  await expect(dialog.getByRole("button", { name: "Publish now" })).toBeEnabled();
});
