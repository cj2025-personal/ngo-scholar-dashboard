/**
 * Privacy and visibility, on the profile: the scholar's own say over what of
 * their record others see (sd-api /api/profile/consent).
 *
 * What is held here:
 *   - one control per layer, each saying what on and off mean, saved as it
 *     is changed and still so after a reload;
 *   - the history says what the scholar did, in words, with the day;
 *   - hiding the profile takes their published story off the public page (a
 *     404, as if it never was) and listing it again brings it back;
 *   - the panel fits a laptop window and a phone without scrolling sideways.
 * Everything the spec turns on it turns off again, so the specs after it see
 * the scholar as they were.
 */

const path = require("path");
const { test, expect } = require("@playwright/test");

const { readState } = require("./stack");

const API_DIR = path.resolve(__dirname, "..", "..", "sd-api");
const { MongoClient } = require(require.resolve("mongodb", { paths: [API_DIR] }));
const { PROFILE_ID } = require(path.join(API_DIR, "tests-e2e", "seed.js"));

const SLUG = "privacy-e2e-published";
let state;

test.beforeAll(async () => {
  state = readState();
  /* A photo on the record, so "Show my photo" has something to cover, and a
     published story, so hiding has something to take away. */
  const client = await MongoClient.connect(state.mongoUri);
  try {
    const db = client.db("sd_ui_e2e");
    await db.collection("scholars").updateOne({ _id: PROFILE_ID }, { $set: { "display.profile_image_object_key": `contemporary/${PROFILE_ID}/headshot-0123456789ab.jpg`, "about.email": "e2e.scholar@example.edu" } });
    await db.collection("scholar_editorials").updateOne(
      { slug: SLUG },
      { $setOnInsert: { profile_id: PROFILE_ID, slug: SLUG, status: "published", title: "A story the public can read", published_at: new Date(), createdAt: new Date(), updatedAt: new Date() } },
      { upsert: true },
    );
  } finally {
    await client.close();
  }
});

test.beforeEach(async ({ context }) => {
  await context.addCookies([{ name: "sd_session", value: state.token, domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax" }]);
});

test.afterAll(async ({ request }) => {
  /* Back to how the scholar started: listed, nothing else shown. */
  const headers = { cookie: `sd_session=${state.token}`, "content-type": "application/json" };
  for (const [layer, action] of [["listing", "unhide"], ["photo", "withdraw"], ["community", "withdraw"], ["contact", "withdraw"]]) {
    await request.post(`${state.apiUrl}/api/profile/consent/${layer}`, { headers, data: { action } });
  }
  const client = await MongoClient.connect(state.mongoUri);
  try {
    /* This spec's own story, in the suite's throwaway database. */
    await client.db("sd_ui_e2e").collection("scholar_editorials").deleteOne({ slug: SLUG, profile_id: PROFILE_ID });
  } finally {
    await client.close();
  }
});

const publicStatus = async (page) => (await page.request.get(`${state.apiUrl}/api/editorial-stories/public/slug/${SLUG}`)).status();

test("each layer has one control that saves, says what it means, and is remembered", async ({ page }) => {
  await page.goto("/profile");
  const panel = page.locator("#privacy");
  await expect(panel.getByRole("heading", { name: "Privacy and visibility" })).toBeVisible();
  const history = panel.locator(".prof-privacy__history");
  await expect(history).toContainText("None yet");

  /* Photo: off by default, the photo on the record shown beside it. */
  const photo = panel.getByRole("switch", { name: "Show my photo" });
  await expect(photo).toHaveAttribute("aria-checked", "false");
  await expect(panel.locator(".prof-privacy__photo .prof-avatar")).toBeVisible();
  /* The suite's stand-in bucket holds no bytes for it: initials, never a broken image. */
  await expect(panel.locator(".prof-privacy__photo .prof-avatar__initials")).toBeVisible();
  await expect(panel).toContainText("Readers see your initials.");
  await photo.click();
  await expect(photo).toHaveAttribute("aria-checked", "true");
  await expect(panel).toContainText("Readers see this photo beside your name.");
  await expect(history).toContainText(/You turned on your photo on \d{1,2} [A-Z][a-z]{2} \d{4}/);

  /* Community: optional, explained, from the registry's list. */
  await expect(panel).toContainText("It helps students find researchers who share their background");
  const black = panel.getByRole("checkbox", { name: "Black" });
  await expect(black).not.toBeChecked();
  await black.check();
  await expect(black).toBeChecked();
  await expect(history).toContainText("You shared your community: Black");

  /* Contact: what would be shown is named before it is. */
  const contact = panel.getByRole("switch", { name: "Show my contact details" });
  await expect(panel).toContainText("e2e.scholar@example.edu");
  await contact.click();
  await expect(contact).toHaveAttribute("aria-checked", "true");

  /* Remembered: the server's state, not the page's. */
  await page.reload();
  await expect(page.locator("#privacy").getByRole("switch", { name: "Show my photo" })).toHaveAttribute("aria-checked", "true");
  await expect(page.locator("#privacy").getByRole("checkbox", { name: "Black" })).toBeChecked();
  await expect(page.locator("#privacy").getByRole("switch", { name: "Show my contact details" })).toHaveAttribute("aria-checked", "true");

  /* Unticking the last community is not sharing one. */
  await page.locator("#privacy").getByRole("checkbox", { name: "Black" }).uncheck();
  await expect(page.locator("#privacy .prof-privacy__history")).toContainText("You stopped sharing your community");

  /* The record's own correction path is still where it was. */
  await expect(page.getByRole("button", { name: "Suggest an edit: Name and headline" })).toBeVisible();
  await expect(page.locator("#corrections")).toBeVisible();
});

test("hiding the profile takes the scholar's stories off the public pages, and listing brings them back", async ({ page }) => {
  expect(await publicStatus(page)).toBe(200);
  await page.goto("/profile");
  const listing = page.locator("#privacy").getByRole("switch", { name: "List my profile publicly" });
  await expect(listing).toHaveAttribute("aria-checked", "true");
  await expect(page.locator("#privacy")).toContainText("removes you from all three");

  await listing.click();
  await expect(listing).toHaveAttribute("aria-checked", "false");
  await expect(page.locator("#privacy")).toContainText("Your studio, your stories and your data are all still here");
  await expect(page.locator("#privacy .prof-privacy__history")).toContainText("You hid your profile on");
  expect(await publicStatus(page)).toBe(404);
  const shown = await page.goto(`/stories/${SLUG}`);
  expect(shown.status()).toBe(404);

  /* Still theirs in the studio. */
  await page.goto("/editorial");
  await expect(page.getByText("A story the public can read").first()).toBeVisible();

  await page.goto("/profile");
  await page.locator("#privacy").getByRole("switch", { name: "List my profile publicly" }).click();
  await expect(page.locator("#privacy").getByRole("switch", { name: "List my profile publicly" })).toHaveAttribute("aria-checked", "true");
  await expect(page.locator("#privacy .prof-privacy__history")).toContainText("You listed your profile again on");
  expect(await publicStatus(page)).toBe(200);
});

test("the panel fits a laptop window and a phone without scrolling sideways", async ({ page }, testInfo) => {
  for (const [width, height] of [[1366, 607], [390, 844]]) {
    await page.setViewportSize({ width, height });
    await page.goto("/profile");
    const panel = page.locator("#privacy");
    await expect(panel).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth), `${width}px`).toBeLessThanOrEqual(width);
    const box = await panel.boundingBox();
    expect(box.x + box.width, `${width}px: the panel stays inside the window`).toBeLessThanOrEqual(width);
    await page.screenshot({ path: testInfo.outputPath(`profile-${width}x${height}.png`) });
    await panel.scrollIntoViewIfNeeded();
    await panel.screenshot({ path: testInfo.outputPath(`privacy-panel-${width}.png`) });
  }
});
