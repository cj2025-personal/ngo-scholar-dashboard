/**
 * Screenshots of the reading companion in each state, for design review.
 * Not a test of behaviour; skipped unless asked for:
 *   SCREENS=1 npx playwright test tests-e2e/companion-screens.spec.js
 * Writes PNGs to SCREENS_OUT (default tests-e2e/screens).
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { test, expect } = require("@playwright/test");

const API_DIR = path.resolve(__dirname, "..", "..", "sd-api");
const { MongoClient, ObjectId } = require(require.resolve("mongodb", { paths: [API_DIR] }));
const { readState } = require("./stack");

const OUT = process.env.SCREENS_OUT || path.join(__dirname, "screens");
const DB_NAME = "sd_ui_e2e";
const SLUG = "companion-screens-story";
const ME = "e2e-profile-0001";

function storyDoc() {
  const now = new Date();
  const block = (html, passageId) => ({ type: "paragraph", html, provenance: { source_refs: [{ passageId }], drafted_text: html, traceable: true, fidelity: { verdict: "supported", claims: [{ text: html, verdict: "supported", passageIds: [passageId], evidence: "" }] } } });
  const body = [
    { type: "subheading", html: "Steering away from noise" },
    block("Adaptive antenna arrays cut interference by steering nulls, the directions they listen to least, toward the sources they want to ignore. The weights that shape the pattern are updated every two milliseconds, fast enough to keep up with an interferer that does not move.", "p1"),
    block("In field trials the array improved the signal-to-noise ratio by eleven decibels with a single interferer and by seven with two. Convergence took between forty and three hundred updates.", "p2"),
    { type: "subheading", html: "Where it runs out of room" },
    block("Performance degrades with more than four interferers, because an array of four elements has only three degrees of freedom left once one is spent on the wanted direction. In seventeen of forty trials the array reduced the wanted signal by more than two decibels.", "p3"),
    block("Every trial ran in an anechoic chamber, and the array was never tested against a moving interferer, so outdoor performance is expected to fall off sooner than the chamber numbers suggest.", "p4"),
  ];
  const simpler = body.map((b) => (b.type === "paragraph" ? block(b.html.split(". ")[0] + ".", b.provenance.source_refs[0].passageId) : b));
  const hashes = body.map((b) => crypto.createHash("sha256").update(b.html).digest("hex"));
  return {
    _id: new ObjectId(), scholar_id: ME, profile_id: ME, authorId: ME,
    title: "Teaching an antenna to ignore the noise", subtitle: "What a four-element array can and cannot do", excerpt: "", content: body.map((b) => b.html).join("\n\n"),
    body_blocks: body, slug: SLUG, status: "published", images: [], version: 2,
    createdAt: now, updatedAt: now, published_at: now, published_by: "e2e@example.edu",
    provenance: { origin: "harvested", source_id: "src-e2e-1", audience: "adults", voice: "author" },
    levels: { ages_8_11: { audience: "ages_8_11", blocks: simpler, source_hashes: hashes, approved: true, approved_at: now, approved_by: "e2e", generated_at: now, readability: { verdict: "pass", fkGrade: 4 }, fidelity: { supported: 4 }, grounding: "source" } },
  };
}

test("capture the companion", async ({ page }) => {
  test.skip(!process.env.SCREENS, "screenshots are captured on demand: SCREENS=1");
  test.setTimeout(300_000);
  fs.mkdirSync(OUT, { recursive: true });
  const state = readState();
  const client = await MongoClient.connect(state.mongoUri);
  const stories = client.db(DB_NAME).collection("scholar_editorials");
  await stories.deleteOne({ slug: SLUG });
  await stories.insertOne(storyDoc());
  await client.close();

  const shot = (name, opts = {}) => page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: false, ...opts });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/stories/${SLUG}`);
  await page.waitForLoadState("networkidle").catch(() => {});
  await shot("rc-01-reader-closed");

  await page.getByRole("button", { name: "Ask about this story" }).click();
  const sheet = page.getByRole("dialog", { name: "Reading companion" });
  await expect(sheet.locator(".rc-intro-text")).toBeVisible();
  await shot("rc-02-sheet-empty");

  await page.locator(".reader-paragraph").nth(1).click();
  await sheet.getByPlaceholder("Ask about this story…").fill("Take your time: what does this mean?");
  await sheet.getByRole("button", { name: "Send" }).click();
  await expect(sheet.locator(".rc-turn.is-pending")).toBeVisible();
  await page.waitForTimeout(1200);
  await shot("rc-03-working");
  await expect(sheet.locator(".rc-turn").first().locator(".rc-answer-text")).toBeVisible({ timeout: 60_000 });
  await shot("rc-04-answered");

  await sheet.getByPlaceholder("Ask about this story…").fill("Do unicorns enjoy jumping on Jupiter?");
  await sheet.getByPlaceholder("Ask about this story…").press("Enter");
  await expect(sheet.locator(".rc-turn").nth(1).locator(".rc-answer-text")).toBeVisible({ timeout: 60_000 });
  await sheet.getByPlaceholder("Ask about this story…").fill("Make paragraph 2 scary");
  await sheet.getByPlaceholder("Ask about this story…").press("Enter");
  await expect(sheet.locator(".rc-turn").nth(2).locator(".rc-answer-text")).toBeVisible({ timeout: 60_000 });
  await sheet.getByPlaceholder("Ask about this story…").fill("What does the word interferers mean?");
  await sheet.getByPlaceholder("Ask about this story…").press("Enter");
  await expect(sheet.locator(".rc-turn").nth(3).locator(".rc-answer-text")).toBeVisible({ timeout: 60_000 });
  await shot("rc-05-thread");

  await sheet.getByRole("button", { name: "What it did" }).click();
  await expect(sheet.locator(".rc-activity-item").first()).toBeVisible();
  await shot("rc-06-activity");
  await sheet.getByRole("button", { name: "Back", exact: true }).click();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);
  await shot("rc-07-mobile-thread");
  await sheet.getByRole("button", { name: "Close the companion" }).click();
  await shot("rc-08-mobile-closed");
});
