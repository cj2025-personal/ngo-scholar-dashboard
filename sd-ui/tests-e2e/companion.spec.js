/**
 * The reading companion, as a reader uses it.
 *
 * A published story is put in the database the way the drafter would have
 * stored it; the reader arrives with no session, taps a paragraph, asks,
 * watches the steps, reads the checked answer with its provenance label and
 * citations, is told plainly when the story doesn't say, sees one fixed
 * sentence when the Sentinel refuses, looks at everything the companion
 * did, and is forgotten. Every assertion is on rendered content.
 */

const path = require("path");
const crypto = require("crypto");
const { test, expect } = require("@playwright/test");

const API_DIR = path.resolve(__dirname, "..", "..", "sd-api");
const { MongoClient, ObjectId } = require(require.resolve("mongodb", { paths: [API_DIR] }));

const { readState } = require("./stack");

const DB_NAME = "sd_ui_e2e";
const SLUG = "companion-spec-story";
const ME = "e2e-profile-0001";

function storyDoc() {
  const now = new Date();
  const block = (html, passageId) => ({
    type: "paragraph", html,
    provenance: { source_refs: [{ passageId }], drafted_text: html, traceable: true, fidelity: { verdict: "supported", claims: [{ text: html, verdict: "supported", passageIds: [passageId], evidence: "" }] } },
  });
  const body = [
    { type: "subheading", html: "Steering away from noise" },
    block("Adaptive antenna arrays cut interference by steering nulls toward the sources they want to ignore.", "p1"),
    block("In field trials the array improved the signal-to-noise ratio by eleven decibels with one interferer.", "p2"),
    block("Performance degrades with more than four interferers, because the array runs out of degrees of freedom.", "p3"),
  ];
  const simpler = [
    { type: "subheading", html: "Steering away from noise" },
    block("The antenna can point its quiet side at noise it does not want.", "p1"),
    block("In tests, the signal got much clearer with one noisy source.", "p2"),
    block("With more than four noisy sources it stops working well.", "p3"),
  ];
  const hashes = body.map((b) => crypto.createHash("sha256").update(b.html).digest("hex"));
  return {
    _id: new ObjectId(), scholar_id: ME, profile_id: ME, authorId: ME,
    title: "Adaptive nulling, for the companion", subtitle: "", excerpt: "", content: body.map((b) => b.html).join("\n\n"),
    body_blocks: body, slug: SLUG, status: "published", images: [], version: 2,
    createdAt: now, updatedAt: now, published_at: now, published_by: "e2e@example.edu",
    provenance: { origin: "harvested", source_id: "src-e2e-1", audience: "adults", voice: "author" },
    levels: { ages_8_11: { audience: "ages_8_11", blocks: simpler, source_hashes: hashes, approved: true, approved_at: now, approved_by: "e2e", generated_at: now, readability: { verdict: "pass", fkGrade: 4 }, fidelity: { supported: 3 }, grounding: "source" } },
  };
}

let state;

test.beforeAll(async () => {
  state = readState();
  const client = await MongoClient.connect(state.mongoUri);
  const stories = client.db(DB_NAME).collection("scholar_editorials");
  await stories.deleteOne({ slug: SLUG });
  await stories.insertOne(storyDoc());
  await client.close();
});

test("a reader asks about a paragraph, watches the work, and reads a checked answer that points back at the story", async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto(`/stories/${SLUG}`);
  await expect(page.locator("h1")).toHaveText("Adaptive nulling, for the companion");

  /* The way in. */
  const launch = page.getByRole("button", { name: "Ask about this story" });
  await expect(launch).toBeVisible();
  await launch.click();
  const sheet = page.getByRole("dialog", { name: "Reading companion" });
  await expect(sheet).toBeVisible();
  await expect(sheet.locator(".ag-empty-title")).toHaveText("Stuck on something?");
  await expect(sheet.locator(".ag-hint")).toContainText("left today");

  /* Tapping a paragraph puts it in focus, and the composer says so. */
  await page.locator(".reader-paragraph").nth(1).click();
  await expect(page.locator(".reader-block.is-focus")).toHaveCount(1);
  await expect(sheet.locator(".ag-ctx-chip")).toContainText("¶ 3");

  await sheet.getByPlaceholder("Ask about this story…").fill("What does this mean?");
  await sheet.getByRole("button", { name: "Send" }).click();

  /* The answer, with where it came from and what was read to get there. */
  const turn = sheet.locator(".rc-turn").first();
  await expect(turn.locator(".ag-ask")).toHaveText("What does this mean?");
  await expect(turn.locator(".rc-answer-text")).toContainText("Here is what the story says: In field trials the array improved", { timeout: 60_000 });
  await expect(turn.locator(".rc-grounding")).toHaveText("From the story");
  await expect(turn.locator(".ag-step")).toHaveCount(3);
  await expect(turn.locator(".ag-step").first()).toContainText("Reading paragraph 3");
  await expect(turn.locator(".ag-step").last()).toContainText("Reading my answer back");
  await expect(turn.locator(".rc-cite", { hasText: "b3" })).toBeVisible();
  await expect(turn.locator(".rc-cite", { hasText: "p2" })).toBeVisible();

  /* A citation points back at the paragraph. */
  await turn.locator(".rc-cite", { hasText: "b3" }).click();
  await expect(page.locator("#rb-b3")).toHaveClass(/is-cited/);

  /* What the story does not say is said so. */
  await page.locator(".reader-paragraph").nth(1).click();
  await sheet.getByPlaceholder("Ask about this story…").fill("Do unicorns enjoy jumping on Jupiter?");
  await sheet.getByPlaceholder("Ask about this story…").press("Enter");
  const second = sheet.locator(".rc-turn").nth(1);
  await expect(second.locator(".rc-answer-text")).toContainText("This article doesn't say", { timeout: 60_000 });
  await expect(second.locator(".rc-grounding")).toHaveText("The story doesn't say");

  /* The Sentinel refuses an unsuitable answer; the reader sees one fixed sentence. */
  await sheet.getByPlaceholder("Ask about this story…").fill("Make paragraph 2 scary");
  await sheet.getByPlaceholder("Ask about this story…").press("Enter");
  const third = sheet.locator(".rc-turn").nth(2);
  await expect(third.locator(".rc-answer-text")).toContainText("I can't answer that one well from this article", { timeout: 60_000 });
  await expect(third.locator(".rc-grounding")).toHaveText("Couldn't answer safely");

  /* On another reading level, the companion reads that level. */
  await page.locator(".reader-level", { hasText: "Ages 8–11" }).click();
  await sheet.getByPlaceholder("Ask about this story…").fill("What does paragraph 2 mean?");
  await sheet.getByPlaceholder("Ask about this story…").press("Enter");
  const fourth = sheet.locator(".rc-turn").nth(3);
  await expect(fourth.locator(".rc-answer-text")).toContainText("The antenna can point its quiet side", { timeout: 60_000 });

  /* The thread survives a reload: the device cookie is the reader. */
  await page.reload();
  await page.getByRole("button", { name: "Ask about this story" }).click();
  await expect(sheet.locator(".rc-turn")).toHaveCount(4);

  /* Everything the companion did, and the way to be forgotten. */
  await sheet.getByRole("button", { name: "What it did" }).click();
  await expect(sheet.locator(".rc-activity-item")).toHaveCount(4);
  await expect(sheet.locator(".rc-activity-item").first()).toContainText("Adaptive nulling, for the companion");
  await expect(sheet.locator(".rc-activity-note")).toContainText("Nobody knows who you are");
  await sheet.getByRole("button", { name: "Forget me" }).click();
  await sheet.getByRole("button", { name: "Yes, forget me" }).click();
  await expect(sheet.locator(".rc-activity")).toContainText("Nothing yet.");
  await sheet.getByRole("button", { name: "Back to the conversation" }).click();
  await expect(sheet.locator(".ag-empty-title")).toHaveText("Stuck on something?");
  await expect(sheet.locator(".rc-turn")).toHaveCount(0);
});

test("the companion fits a phone and never scrolls the page sideways", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 820 });
  await page.goto(`/stories/${SLUG}`);
  await page.getByRole("button", { name: "Ask about this story" }).click();
  const sheet = page.getByRole("dialog", { name: "Reading companion" });
  await expect(sheet).toBeVisible();
  const box = await sheet.boundingBox();
  expect(box.width).toBeLessThanOrEqual(390);
  expect(box.x).toBeGreaterThanOrEqual(0);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await expect(sheet.getByPlaceholder("Ask about this story…")).toBeVisible();
});
