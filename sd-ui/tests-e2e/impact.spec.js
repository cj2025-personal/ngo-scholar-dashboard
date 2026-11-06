/**
 * Impact: a scholar's signed record of what their work reached, theirs to
 * share (sd-api services/impact.service), 2026-11-06.
 *
 * The learner app's counts are stood in for on its own port, through the
 * same door the studio uses live. The scholar sees their record, makes a link,
 * and someone without an account opens it: the record shows, and its
 * signature is checked on that page against the published key. The scholar
 * turns the link off, and it shows nothing.
 */

const http = require("http");
const { test, expect } = require("@playwright/test");

const { readState, LEARNER_STUB_PORT, LEARNER_STUB_TOKEN } = require("./stack");

let state;
let stub;
let storyId = null;
const seen = [];

test.beforeAll(async () => {
  state = readState();
  stub = http.createServer((req, res) => {
    seen.push({ method: req.method, url: req.url, scholar: req.headers["x-scholar-profile"] });
    res.setHeader("Content-Type", "application/json");
    if (req.headers["x-studio-token"] !== LEARNER_STUB_TOKEN) {
      res.statusCode = 401;
      return res.end(JSON.stringify({ code: "STUDIO_CALLER_REFUSED" }));
    }
    if (req.method === "GET" && req.url === "/internal/studio/impact") {
      return res.end(JSON.stringify({
        impact: {
          floor: 5,
          understoodShare: 0.75,
          readers: 12,
          understood: 9,
          stories: storyId ? [{ editorialId: storyId, readers: 12, understood: 9, bands: ["adults"] }] : [],
          circles: { led: 1, classes: 2, schools: 1 },
          contributions: {},
        },
      }));
    }
    if (req.method === "GET" && req.url === "/internal/studio/asks") return res.end(JSON.stringify({ stories: [] }));
    res.statusCode = 404;
    return res.end(JSON.stringify({ message: "Not found." }));
  });
  await new Promise((resolve) => stub.listen(LEARNER_STUB_PORT, "localhost", resolve));
});

test.afterAll(async () => {
  await new Promise((resolve) => stub.close(resolve));
});

test("a scholar's record, shared by link, checked by whoever opens it, and turned off", async ({ page, context, browser }) => {
  await context.addCookies([{ name: "sd_session", value: state.token, domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax" }]);
  const made = await page.request.fetch(`${state.apiUrl}/api/editorial-stories`, {
    method: "POST",
    headers: { cookie: `sd_session=${state.token}` },
    data: { title: "Antennas that listen for impact", content: "Adaptive arrays steer nulls toward noise.", status: "draft" },
  });
  storyId = (await made.json()).story.id;
  const { MongoClient, ObjectId } = require(require.resolve("mongodb", { paths: [require("path").resolve(__dirname, "..", "..", "sd-api")] }));
  const client = await MongoClient.connect(state.mongoUri);
  try {
    await client.db("sd_ui_e2e").collection("scholar_editorials").updateOne(
      { _id: new ObjectId(storyId) },
      { $set: { status: "published", published_at: new Date("2026-11-01T00:00:00Z"), provenance: { origin: "brief", audience: "adults", voice: "first_person", drafted_at: new Date(), prompt_version: "e2e" } } }
    );
  } finally {
    await client.close();
  }

  await page.goto("/impact");
  await expect(page.getByRole("heading", { name: "What your work reached" })).toBeVisible();
  const totals = page.getByRole("region", { name: "Totals" });
  await expect(totals.getByText("12", { exact: true })).toBeVisible();
  await expect(totals.getByText("9", { exact: true })).toBeVisible();
  await expect(totals.getByText("75% of readers")).toBeVisible();
  const story = page.locator(".imp-story").filter({ hasText: "Antennas that listen for impact" });
  await expect(story).toContainText("12 readers · 9 understood");
  await expect(page.getByText(/Signed .* · key ed25519-/)).toBeVisible();
  expect(seen.find((s) => s.url === "/internal/studio/impact").scholar).toBe("e2e-profile-0001");
  /* For a person to look at. */
  await page.setViewportSize({ width: 1366, height: 607 });
  await page.screenshot({ path: test.info().outputPath("impact-1366x607.png") });

  await page.getByLabel("Who it is for (only you see this)").fill("Grant panel");
  await page.getByRole("button", { name: "Make a link" }).click();
  const url = (await page.locator(".imp-fresh__url").textContent()).trim();
  expect(url).toMatch(/\/record\/[A-Za-z0-9_-]{32}$/);

  /* Someone with no account opens it: the record, and its signature checked on the page. */
  const stranger = await browser.newContext();
  const theirs = await stranger.newPage();
  await theirs.goto(url);
  await expect(theirs.getByRole("heading", { name: "Test Scholar" })).toBeVisible();
  await expect(theirs.getByRole("status")).toHaveText(/Signature checks out: issued by Proj Arch on .* and not changed since\./);
  await expect(theirs.locator(".imp-story").filter({ hasText: "Antennas that listen for impact" })).toContainText("12 readers · 9 understood");
  await theirs.setViewportSize({ width: 1366, height: 607 });
  await theirs.screenshot({ path: test.info().outputPath("impact-shared-1366x607.png") });

  /* The scholar sees it was opened, and turns it off. */
  await page.reload();
  const row = page.locator(".imp-shares li").filter({ hasText: "Grant panel" });
  await expect(row).toContainText("opened 1 time");
  await row.getByRole("button", { name: "Turn off" }).click();
  await expect(row).toContainText("turned off");
  await theirs.reload();
  await expect(theirs.getByRole("heading", { name: "This link is not open" })).toBeVisible();
  await stranger.close();
});

test("a made-up link shows nothing, and asks for no sign-in", async ({ browser }) => {
  const stranger = await browser.newContext();
  const page = await stranger.newPage();
  await page.goto("/record/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
  await expect(page).toHaveURL(/\/record\//);
  await expect(page.getByRole("heading", { name: "This link is not open" })).toBeVisible();
  await stranger.close();
});
