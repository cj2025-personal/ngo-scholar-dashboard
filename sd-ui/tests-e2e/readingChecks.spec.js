/**
 * Reading checks in the Checks rail: the questions learners answer after a
 * scholar's story, written and kept by the learner app, reviewed here.
 *
 * The learner app's API is stood in for on its own port: the studio calls it
 * through the same door it uses live (lib/learnerApi), with the studio token,
 * naming the scholar, and only for a story the scholar owns.
 */

const http = require("http");
const { test, expect } = require("@playwright/test");

const { readState, LEARNER_STUB_PORT, LEARNER_STUB_TOKEN } = require("./stack");

let state;
let stub;
const seen = [];
const check = {
  id: "64b0000000000000000000c1",
  band: "ages_8_11",
  status: "ready",
  textGrade: 4,
  waiting: null,
  judgedOut: 1,
  updatedAt: "2026-11-05T12:00:00.000Z",
  readers: 12,
  floor: 5,
  questions: [
    {
      question: "What do the arrays steer toward noise?", options: ["Nulls", "Beams", "Wires", "Lights"], answerIndex: 0, rationale: "The first paragraph says so.", skill: "literal_detail", dropped: false,
      results: { answered: 12, right: 12, commonWrong: null },
      passage: { quote: "Adaptive arrays steer nulls toward noise.", whole: false },
    },
    {
      question: "How much better was the signal?", options: ["Two decibels", "Eleven decibels", "Forty", "None"], answerIndex: 1, rationale: null, skill: "literal_detail", dropped: false,
      results: { answered: 12, right: 5, commonWrong: "Two decibels" },
      passage: { quote: "Field trials improved the signal by eleven decibels.", whole: false },
    },
    {
      question: "Why test in a chamber?", options: ["No echoes", "Cheaper", "Warmer", "Faster"], answerIndex: 0, rationale: null, skill: "inference", dropped: false,
      results: { answered: null, right: null, commonWrong: null },
      passage: { quote: null, whole: true },
    },
  ],
};
/* An older reading age with only a few readers so far: no numbers. */
const fewReaders = {
  id: "64b0000000000000000000c2",
  band: "ages_12_14",
  status: "ready",
  textGrade: 7,
  waiting: null,
  judgedOut: 0,
  updatedAt: "2026-11-05T12:00:00.000Z",
  readers: null,
  floor: 5,
  questions: [1, 2, 3, 4].map((n) => ({
    question: `Older readers' question ${n}?`, options: ["a", "b", "c", "d"], answerIndex: 0, rationale: null, skill: "literal_detail", dropped: false,
    results: { answered: null, right: null, commonWrong: null },
    passage: null,
  })),
};

test.beforeAll(async () => {
  state = readState();
  stub = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      seen.push({ method: req.method, url: req.url, token: req.headers["x-studio-token"], scholar: req.headers["x-scholar-profile"], body });
      res.setHeader("Content-Type", "application/json");
      if (req.headers["x-studio-token"] !== LEARNER_STUB_TOKEN) {
        res.statusCode = 401;
        return res.end(JSON.stringify({ code: "STUDIO_CALLER_REFUSED" }));
      }
      if (req.method === "GET" && /\/internal\/studio\/stories\/[^/]+\/reading-checks$/.test(req.url)) {
        return res.end(JSON.stringify({ checks: [check, fewReaders] }));
      }
      if (req.method === "POST" && req.url === `/internal/studio/reading-checks/${check.id}/questions`) {
        const { question, dropped } = JSON.parse(body || "{}");
        check.questions = check.questions.map((q) => (q.question === question ? { ...q, dropped } : q));
        return res.end(JSON.stringify({ check }));
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

test("a scholar sees the questions learners answer after their story, with the keys, and leaves one out", async ({ page, context }) => {
  await context.addCookies([{ name: "sd_session", value: state.token, domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax" }]);
  const made = await page.request.fetch(`${state.apiUrl}/api/editorial-stories`, {
    method: "POST",
    headers: { cookie: `sd_session=${state.token}` },
    data: { title: "Antennas that listen", content: "Adaptive arrays steer nulls toward noise.", status: "draft" },
  });
  expect(made.status()).toBeLessThan(300);
  const storyId = (await made.json()).story.id;
  /* Drafted from the scholar's brief, as the stories that get reading checks are:
     the workspace shows its Checks rail only for a story with a provenance. */
  const { MongoClient, ObjectId } = require(require.resolve("mongodb", { paths: [require("path").resolve(__dirname, "..", "..", "sd-api")] }));
  const client = await MongoClient.connect(state.mongoUri);
  try {
    await client.db("sd_ui_e2e").collection("scholar_editorials").updateOne(
      { _id: new ObjectId(storyId) },
      { $set: { provenance: { origin: "brief", audience: "adults", voice: "first_person", drafted_at: new Date(), prompt_version: "e2e" } } }
    );
  } finally {
    await client.close();
  }

  await page.goto(`/editorial/${storyId}`);
  await page.getByRole("tab", { name: /Checks/ }).click();
  await page.getByText("Reading checks", { exact: false }).first().click();

  await expect(page.getByText("Ages 8–11")).toBeVisible();
  await expect(page.getByText("Asked after reading · 3 questions")).toBeVisible();
  await expect(page.getByText("What do the arrays steer toward noise?")).toBeVisible();
  await expect(page.locator(".rc-options li.is-key").first()).toHaveText(/Nulls/);
  await expect(page.getByText(/1 more was written and left out/)).toBeVisible();

  /* Where readers got lost: counts above the floor, the question missed most, the wrong answer they chose, and where the story answers it. */
  const card = page.locator(".rc-card").first();
  await expect(card.getByText("12 readers have answered")).toBeVisible();
  await expect(card.getByRole("list", { name: "Missed most often" })).toHaveText(/How much better was the signal\?\s*7 of 12 missed it/);
  await expect(card.getByText(/5 of 12 readers got it right · most who missed it chose “Two decibels”/)).toBeVisible();
  await expect(card.getByText(/12 of 12 readers got it right/)).toBeVisible();
  await expect(card.getByText("“Field trials improved the signal by eleven decibels.”", { exact: false })).toBeVisible();
  await expect(card.getByText("About the story as a whole")).toBeVisible();
  await expect(card.getByText("Fewer than 5 readers have answered this one")).toBeVisible();
  const older = page.locator(".rc-card").nth(1);
  await expect(older.getByText("Fewer than 5 readers have answered yet", { exact: false })).toBeVisible();
  await expect(older.locator(".rck-result")).toHaveCount(0);

  const lookup = seen.find((s) => s.method === "GET");
  expect(lookup.url).toBe(`/internal/studio/stories/${storyId}/reading-checks`);
  expect(lookup.scholar).toBe("e2e-profile-0001");

  await page.getByRole("button", { name: "Leave it out" }).first().click();
  await expect(page.getByText("Asked after reading · 2 questions")).toBeVisible();
  await expect(page.getByRole("button", { name: "Put it back" })).toBeVisible();
  const review = seen.find((s) => s.method === "POST");
  expect(JSON.parse(review.body)).toEqual({ question: "What do the arrays steer toward noise?", dropped: true });
  /* For a person to look at: the rail with how readers did, and one question left out. */
  await page.setViewportSize({ width: 1366, height: 607 });
  await page.locator(".rck-lost").first().scrollIntoViewIfNeeded();
  await page.screenshot({ path: test.info().outputPath("reading-checks-1366x607.png") });
});

test("another scholar's story answers 404 before the learner app is asked", async ({ request }) => {
  const before = seen.length;
  const res = await request.fetch(`${state.apiUrl}/api/editorial-stories/64b00000000000000000dead/reading-checks`, {
    headers: { cookie: `sd_session=${state.token}` },
  });
  expect(res.status()).toBe(404);
  expect(seen.length).toBe(before);
});
