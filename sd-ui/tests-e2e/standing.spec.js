/**
 * Legacy, as something a scholar can see and reach.
 *
 * Legacy used to be `status: "legacy"` on the curated record: it decided
 * whether a scholar could draft from their own research, and nothing in the
 * portal admitted it existed. A scholar outside it met a feature that did not
 * work; a scholar inside it was never told why it did.
 *
 * ── What these assert, and what they deliberately do not ───────────────────
 * The counts move: other specs in this suite publish stories and approve
 * levels, and the Archivyn half of the benchmark counts exactly those things.
 * So nothing here asserts a number. What is asserted is the shape a benchmark
 * has to have to be one — every mark accounted for, every unmet mark carrying
 * the sentence that would move it, and the standing itself consistent with the
 * marks — because those hold whatever the suite did beforehand.
 */

const { test, expect } = require("@playwright/test");

const { readState } = require("./stack");

let state;

test.beforeAll(() => {
  state = readState();
});

test.beforeEach(async ({ context }) => {
  await context.addCookies([
    { name: "sd_session", value: state.token, domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax" },
  ]);
});

async function standingOf(page) {
  const res = await page.request.get(`${state.apiUrl}/api/standing/me`, {
    headers: { cookie: `sd_session=${state.token}` },
  });
  expect(res.status()).toBe(200);
  return (await res.json()).standing;
}

test("every mark is accounted for, and an unmet one says what would move it", async ({ page }) => {
  const standing = await standingOf(page);

  expect(standing.gates.map((g) => g.key).sort()).toEqual(["archivyn", "sources", "work"]);
  expect(standing.met).toBe(standing.gates.filter((g) => g.met).length);
  expect(standing.total).toBe(standing.gates.length);

  for (const gate of standing.gates) {
    /* A gate that returns only `false` produces a support ticket. */
    expect(gate.summary.length).toBeGreaterThan(20);
    expect(gate.measured).toBeTruthy();
    if (gate.met) expect(gate.blockers).toHaveLength(0);
    else expect(gate.blockers.length).toBeGreaterThan(0);
  }

  /* Eligible means every mark holds — never more, never less. */
  expect(standing.eligible).toBe(standing.met === standing.total);
});

test("the seeded scholar holds Legacy from the record, and is told the marks anyway", async ({ page }) => {
  const standing = await standingOf(page);

  /* The harness seeds `status: "legacy"`, which is what the 65 curated
     scholars carry. Turning the benchmark on must not demote them. */
  expect(standing.standing).toBe("legacy");
  expect(standing.mayDraft).toBe(true);

  /* Held by the record rather than earned by the marks — and the two are
     mutually exclusive, which is the distinction the page turns on. */
  expect(standing.grandfathered).toBe(!standing.eligible);
});

test("drafting is open, and the inventory carries the same standing the page shows", async ({ page }) => {
  const res = await page.request.get(`${state.apiUrl}/api/drafting/sources`, {
    headers: { cookie: `sd_session=${state.token}` },
  });
  expect(res.status()).toBe(200);
  const inventory = await res.json();

  expect(inventory.eligible).toBe(true);
  /* Computed once and shared. Assessing twice is how the two disagreed: the
     second pass had no access to the curated record's flag, so it reported a
     scholar as not grandfathered while reconciliation kept their Legacy for
     exactly that reason. */
  const standing = await standingOf(page);
  expect(inventory.standing.standing).toBe(standing.standing);
  expect(inventory.standing.met).toBe(standing.met);
  expect(inventory.standing.grandfathered).toBe(standing.grandfathered);
});

test("the page renders every mark, and the rail agrees with it", async ({ page }) => {
  const standing = await standingOf(page);

  await page.goto("/standing");
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("heading", { name: "Where you stand" })).toBeVisible();
  await expect(page.locator(".sd-gate")).toHaveCount(standing.total);
  await expect(page.locator(".sd-stand__label")).toContainText("Legacy");
  await expect(page.locator(".sd-stand__count")).toContainText(`${standing.met} of ${standing.total}`);

  /* Holding Legacy is not a reason to be told less about your own record. */
  if (!standing.eligible) {
    await expect(page.locator(".sd-gate__blockers li").first()).toBeVisible();
  }

  /* The page states the boundary the whole access model rests on. */
  await expect(page.locator(".sd-stand__foot")).toContainText("does not affect reading levels");

  await page.goto("/");
  await page.waitForLoadState("networkidle");
  const rail = page.locator(".st-rail .st-card", { hasText: "Legacy" }).first();
  await expect(rail).toBeVisible();
  await expect(rail).toContainText(`${standing.met} of ${standing.total} marks met`);
});

test("a request without a session is refused", async ({ request }) => {
  /* The `request` fixture, not `page.request`: the latter carries the browser
     context's cookies, so it would have been signed in and this would have
     asserted nothing. */
  const res = await request.get(`${state.apiUrl}/api/standing/me`);
  expect(res.status()).toBe(401);
});

/**
 * The invitation in the Studio queue.
 *
 * The seeded scholar carries `status: "legacy"` on the curated record, so they
 * hold Legacy however the marks read and no invitation belongs on their queue.
 * Dropping that flag for the length of this test is what produces the state
 * the row exists for — one mark short, earned rather than inherited — and it
 * is the only way to reach it without a second seeded scholar.
 */
test("one mark short puts an invitation in the queue, and holding Legacy does not", async ({ page }) => {
  const path = require("path");
  const API_DIR = path.resolve(__dirname, "..", "..", "sd-api");
  const { MongoClient } = require(require.resolve("mongodb", { paths: [API_DIR] }));

  const client = await MongoClient.connect(state.mongoUri);
  const scholars = client.db("sd_ui_e2e").collection("scholars");
  const standings = client.db("sd_ui_e2e").collection("scholar_standing");
  const me = { profile_id: "e2e-profile-0001" };

  /* Holding it: no invitation, because there is no mark to finish. */
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await expect(page.locator(".st-todo", { hasText: "One mark left before Legacy" })).toHaveCount(0);

  try {
    await scholars.updateOne(me, { $set: { status: "contemporary" } });
    /* The stored standing is not losable, so a scholar who reached Legacy keeps
       it. Clearing the row is what lets this measure the gates afresh. */
    await standings.deleteMany(me);

    const res = await page.request.get(`${state.apiUrl}/api/standing/me`, {
      headers: { cookie: `sd_session=${state.token}` },
    });
    const { standing } = await res.json();

    /* Asserted, not branched on. The seed gives this scholar four papers with
       three licensed in full, so the two scholarship marks hold and only the
       Archivyn one is short — exactly one mark. Branching here instead would
       let a seed change turn this into a test that quietly checks nothing. */
    expect(standing.standing, `expected one mark short, got ${standing.met}/${standing.total}`).toBe("approaching");
    expect(standing.grandfathered).toBe(false);

    await page.goto("/");
    await page.waitForLoadState("networkidle");

    /* The invitation is the lowest-priority row there is, so once the queue
       holds enough real obligations it sits behind the display cap. That is
       the right order — an invitation must never push an obligation out of
       view — and it means this test has to open the queue before looking,
       exactly as a scholar would. */
    const more = page.locator(".st-more");
    if (await more.count()) await more.first().click();

    const row = page.locator(".st-todo", { hasText: "One mark left before Legacy" });

    {
      await expect(row).toHaveCount(1);
      /* An invitation, not an obligation: it must never wear the tone the
         record alerts and unreleased episodes use. */
      await expect(row).toHaveClass(/is-info/);
      await expect(row).not.toHaveClass(/is-grave|is-warn/);
      /* The queue says what the standing page says, because both read the
         engine's own `nextStep`. */
      await expect(row).toContainText(standing.nextStep.title.toLowerCase());
      await expect(row.locator(".st-todo-detail")).toContainText(standing.nextStep.blockers[0]);
      await row.getByRole("link", { name: "Where you stand" }).click();
      await expect(page.getByRole("heading", { name: "Where you stand" })).toBeVisible();
    }
  } finally {
    await scholars.updateOne(me, { $set: { status: "legacy" } });
    await standings.deleteMany(me);
    await client.close();
  }
});
