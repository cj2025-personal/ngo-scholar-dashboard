/**
 * Kivyn writes for a learning circle (2026-11-06).
 *
 * From a circle's page the scholar opens Kivyn to write for it: Kivyn greets
 * them for that circle, the reader can be only one of the circle's ages, the
 * draft is planned for it, and once published the story joins the circle -
 * the learner app is asked to add it, naming the scholar and the story. The
 * circles live in the learner app, stood in for on its own port. Every
 * assertion is on rendered content, or on what the learner app was asked.
 */

const http = require("http");
const { test, expect } = require("@playwright/test");

const { openAgent, freshConversation } = require("./agent");
const { readState, LEARNER_STUB_PORT, LEARNER_STUB_TOKEN } = require("./stack");

const CIRCLE_ID = "64b0000000000000000000d1";
const circle = {
  id: CIRCLE_ID,
  name: "Listening machines",
  purpose: "Classes read how antennas pick one voice out of a crowd.",
  bands: ["ages_8_11", "ages_12_14"],
  featuredEditorialIds: [],
  classCode: "KQRT-4821",
  classCodeActive: true,
  status: "open",
  review: { fit: true, unreachable: false, findings: [] },
  suspendedReason: null,
  classes: { active: 1, pending: 0 },
  placement: null,
  portals: [{ community: "black", name: "Black", framing: "Do not use trauma as the default frame." }],
  createdAt: new Date().toISOString(),
  minReport: 5,
  members: 23,
  connections: [],
  stories: [],
};

let stub;
const seen = [];

test.beforeAll(async () => {
  stub = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", () => {
      res.setHeader("Content-Type", "application/json");
      if (req.headers["x-studio-token"] !== LEARNER_STUB_TOKEN) {
        res.statusCode = 401;
        return res.end("{}");
      }
      const body = raw ? JSON.parse(raw) : {};
      seen.push({ method: req.method, url: req.url, scholar: req.headers["x-scholar-profile"], body });
      if (req.method === "GET" && req.url === "/internal/studio/circles") return res.end(JSON.stringify({ circles: [circle] }));
      if (req.method === "GET" && req.url === `/internal/studio/circles/${CIRCLE_ID}`) return res.end(JSON.stringify({ circle }));
      if (req.method === "POST" && req.url === `/internal/studio/circles/${CIRCLE_ID}/stories`) {
        circle.featuredEditorialIds = [...circle.featuredEditorialIds, body.editorialId];
        return res.end(JSON.stringify({ circle, added: true }));
      }
      res.statusCode = 404;
      return res.end(JSON.stringify({ message: "Not found." }));
    });
  });
  await new Promise((resolve) => stub.listen(LEARNER_STUB_PORT, "localhost", resolve));
});

test.afterAll(async () => {
  await new Promise((resolve) => stub.close(resolve));
});

test.beforeEach(async ({ context }) => {
  const state = readState();
  await context.addCookies([{ name: "sd_session", value: state.token, domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax" }]);
  await freshConversation(context);
});

test("from a circle's page Kivyn writes for the circle, and the published story joins it", async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1366, height: 607 });
  await page.goto(`/circles/${CIRCLE_ID}`);
  await page.getByRole("link", { name: "Write a story for this circle" }).click();
  await expect(page).toHaveURL(new RegExp(`/editorial/new\\?circle=${CIRCLE_ID}$`));
  await openAgent(page);

  /* Kivyn greets them for the circle; the reader is one of the circle's ages. */
  await expect(page.locator(".ch-msg.is-agent").filter({ hasText: "What shall we write for your circle “Listening machines”" })).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".ns-circle-line")).toContainText("For your circle “Listening machines”");
  const reader = page.getByLabel("Reader age");
  await expect(reader.locator("option")).toHaveText(["Ages 8–11", "Ages 12–14"]);
  await expect(reader).toHaveValue("ages_8_11");
  await page.screenshot({ path: test.info().outputPath("kivyn-for-circle-1366x607.png") });

  await page.getByPlaceholder(/Describe the article you want/).fill("Without my papers: how antennas pick one voice out of a crowd");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.locator(".ch-msg.is-agent").filter({ hasText: "for your circle “Listening machines”" }).last()).toBeVisible({ timeout: 60_000 });

  const plan = page.locator(".ws-outline-plan");
  await expect(plan).toBeVisible({ timeout: 60_000 });
  await expect(page.locator(".ch-context.is-locked")).toContainText("for your circle “Listening machines”");
  await expect(page.locator(".ch-context.is-locked")).toContainText("for ages 8–11");
  await plan.getByRole("button", { name: /Approve and draft/ }).click();
  await expect(page).toHaveURL(/\/editorial\/[0-9a-f]{24}$/, { timeout: 120_000 });
  const storyId = page.url().split("/").pop();

  /* Publish: the specifics verified, as for any story from the brief alone. */
  await page.getByRole("tab", { name: /Checks/ }).click();
  const boxes = page.locator(".ck-verify__row input[type=checkbox]");
  await expect(boxes.first()).toBeVisible({ timeout: 20_000 });
  const n = await boxes.count();
  for (let i = 0; i < n; i += 1) await boxes.nth(i).check();
  await expect(page.locator(".sc-write-saved")).toHaveText("Saved", { timeout: 20_000 });
  const publishCheck = page.getByRole("button", { name: "Publish check" });
  await expect(publishCheck).toBeEnabled({ timeout: 20_000 });
  await publishCheck.click();
  await page.getByRole("dialog").getByRole("button", { name: "Publish now" }).click();
  await expect(page.locator(".sc-write-msg.is-ok")).toContainText("It joins your circle “Listening machines”", { timeout: 60_000 });

  /* What the learner app was asked: this story, into this circle, for this scholar. */
  const joined = seen.filter((s) => s.method === "POST" && s.url === `/internal/studio/circles/${CIRCLE_ID}/stories`);
  expect(joined).toHaveLength(1);
  expect(joined[0].body).toEqual({ editorialId: storyId });
  expect(joined[0].scholar).toBe("e2e-profile-0001");

  /* Leave the studio as it was found: the story, and the level written with it, would sit in the
     Studio queue of every spec after this one (queue.spec counts on its own rows being on top). */
  const removed = await page.request.delete(`${readState().apiUrl}/api/editorial-stories/${storyId}`);
  expect(removed.status()).toBe(200);
});

test("a circle that is not theirs is not written for, and Kivyn says so", async ({ page }) => {
  await page.goto("/editorial/new?circle=64b0000000000000000000ff");
  await openAgent(page);
  await expect(page.locator(".ch-msg.is-agent").filter({ hasText: "That circle is closed or isn't one of yours" })).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".ns-circle-line")).toHaveCount(0);
  await expect(page.getByLabel("Reader age").locator("option")).toHaveCount(4);
});
