/**
 * The conversations a scholar is named in.
 *
 * The admin portal's cron pairs two scholars and generates a dialogue between
 * them, grounded in quotes from both records. Nothing of that reached this
 * portal: what a scholar could see was `links_and_media.podcasts` on their
 * curated record, a catalogue entry that arrives only once the episode is
 * already public.
 *
 * ── The failure this file exists to prevent ────────────────────────────────
 * An episode is twelve turns of speech under a living person's name and, once
 * the voice draft lands, a synthesised reading of them. Two things must hold
 * or the portal is worse than absent: every living participant must be able to
 * find it, and the counts describing how much of it is theirs — and how much
 * of it nothing of theirs supports — must be right.
 *
 * ── Why this seeds the database directly ───────────────────────────────────
 * Generation jobs belong to ngo-admin-backend. This service may read them and
 * may never write them, so there is no endpoint here to create one through and
 * no fixture short of the collection itself. The documents below are the shape
 * that service writes, copied from its Mongoose schema.
 */

const path = require("path");
const { test, expect } = require("@playwright/test");

/* Resolved from the sibling API checkout, the way stack.js does it: sd-ui has
   no mongodb dependency of its own and should not grow one for a test. */
const API_DIR = path.resolve(__dirname, "..", "..", "sd-api");
const { MongoClient, ObjectId } = require(require.resolve("mongodb", { paths: [API_DIR] }));

const { readState } = require("./stack");

const DB_NAME = "sd_ui_e2e";
const JOBS = "scholar_dialogue_generation_jobs";
/* The scholar the harness seeds and signs in as. */
const ME = "e2e-profile-0001";

const person = (over) => ({
  entity_type: "scholar",
  scholar_id: ME,
  profile_id: ME,
  display_name: "Test Scholar",
  institution: "Example University",
  field_of_study: "Signal Processing",
  evidence_count: 13,
  ...over,
});

const LEGEND = person({
  entity_type: "legend",
  scholar_id: "carter-g-woodson",
  profile_id: "carter-g-woodson",
  display_name: "Carter G. Woodson",
  institution: "",
  field_of_study: "African American History",
  evidence_count: 8,
});

/**
 * @param {object} p
 * @param {string} p.status              the pipeline's own lifecycle value
 * @param {string} p.title
 * @param {boolean} [p.mineUnsourced]    leave one of the scholar's turns citing nothing
 * @param {object} [p.legacySeat]        who sits in the seat the schema calls "legacy"
 * @param {string} [p.contemporaryOwner] whose profile fills the contemporary seat
 */
function job({ status, title, mineUnsourced = false, legacySeat = LEGEND, contemporaryOwner = ME }) {
  const turns = [
    { turn_index: 0, speaker_role: "contemporary_scholar", speaker_name: "Test Scholar", text: "What did the record keep of that period?", evidence_ids: ["e1"] },
    { turn_index: 1, speaker_role: "legacy_scholar", speaker_name: legacySeat.display_name, text: "The record kept the appointments and little else.", evidence_ids: ["e2"] },
    { turn_index: 2, speaker_role: "contemporary_scholar", speaker_name: "Test Scholar", text: "That absence is the finding.", evidence_ids: mineUnsourced ? [] : ["e3"] },
  ];
  return {
    _id: new ObjectId(),
    plan_id: new ObjectId(),
    run_key: `run-${title}`,
    jobType: "scholar_dialogue_generation",
    status,
    trigger: "cron",
    topic_prompt: "Institutions and the public record",
    target_turns: 12,
    max_quotes: 6,
    selected_legacy: legacySeat,
    selected_contemporary: person({ profile_id: contemporaryOwner, scholar_id: contemporaryOwner }),
    alignment: { aligned_topic_label: "institutions and public systems", aligned_topic_summary: "A bridge between the two records." },
    evidence_hash: "abc123",
    evidence_segments: [
      { evidence_id: "e1", scholar_role: "contemporary_scholar", segment_type: "quote", source_field: "publications", text: "Our measurements covered eleven institutions." },
      { evidence_id: "e2", scholar_role: "legacy_scholar", segment_type: "quote", source_field: "about", text: "Appointments were recorded; refusals were not." },
      { evidence_id: "e3", scholar_role: "contemporary_scholar", segment_type: "quote", source_field: "about", text: "Absence in a record is itself evidence." },
    ],
    generated_episode: {
      title,
      slug: title.toLowerCase().replace(/\W+/g, "-"),
      summary: "What two records keep, and what they leave out.",
      topic_tags: ["records"],
      turns,
      transcript_text: turns.map((t) => t.text).join("\n\n"),
    },
    student_variant_config: { enabled: false, required_for_publish: false, band_keys: [] },
    student_variants: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

let state;

async function seed(docs) {
  const client = await MongoClient.connect(state.mongoUri);
  const jobs = client.db(DB_NAME).collection(JOBS);
  await jobs.deleteMany({});
  if (docs.length) await jobs.insertMany(docs);
  await client.close();
}

test.beforeAll(() => {
  state = readState();
});

test.beforeEach(async ({ context }) => {
  await context.addCookies([
    { name: "sd_session", value: state.token, domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax" },
  ]);
});

test("an unreleased conversation reaches the scholar, and another scholar's does not", async ({ page }) => {
  await seed([
    job({ status: "review", title: "Institutions and the public record", mineUnsourced: true }),
    job({ status: "published", title: "What the archive kept" }),
    /* Someone else's conversation. It must appear nowhere below. */
    job({ status: "review", title: "Not yours at all", contemporaryOwner: "someone-else-0002" }),
  ]);

  const res = await page.request.get(`${state.apiUrl}/api/podcasts`, {
    headers: { cookie: `sd_session=${state.token}` },
  });
  expect(res.status()).toBe(200);
  const { episodes } = await res.json();
  expect(episodes.map((e) => e.title).sort()).toEqual([
    "Institutions and the public record",
    "What the archive kept",
  ]);

  const pending = episodes.find((e) => e.state === "pending");
  /* The counts the portal exists to show. */
  expect(pending.voice).toMatchObject({ turns: 3, myTurns: 2, myQuotes: 2, myTurnsWithoutEvidence: 1 });
  expect(pending.with).toMatchObject({ name: "Carter G. Woodson", kind: "legend" });

  /* An id belonging to someone else is a 404, not a filtered-out leak. */
  const other = await page.request.get(`${state.apiUrl}/api/podcasts/${new ObjectId().toString()}`, {
    headers: { cookie: `sd_session=${state.token}` },
  });
  expect(other.status()).toBe(404);
});

/**
 * The case the seat names do not lead you to expect.
 *
 * The admin console's pipeline lists dialogues like "Craig Johnson with
 * Bernadette Hanlon", and the scheduled path fills BOTH seats from the curated
 * archive — `legacy` means the Legacy Archive, whose members are living.
 * Matching only the contemporary seat hid those episodes from the other
 * participant entirely.
 */
test("when both seats hold a living scholar, the second one still sees it", async ({ page }) => {
  const peer = person({ profile_id: ME, scholar_id: ME, display_name: "Test Scholar" });
  await seed([
    job({
      status: "review",
      title: "Two living scholars",
      legacySeat: peer,
      contemporaryOwner: "someone-else-0002",
    }),
  ]);

  const res = await page.request.get(`${state.apiUrl}/api/podcasts`, {
    headers: { cookie: `sd_session=${state.token}` },
  });
  const { episodes } = await res.json();
  expect(episodes).toHaveLength(1);

  const episode = episodes[0];
  /* Seated in the "legacy" chair, so the one turn with that role is theirs. */
  expect(episode.me.name).toBe("Test Scholar");
  expect(episode.with.kind).toBe("scholar");
  expect(episode.voice.myTurns).toBe(1);
});

test("the podcast page separates released from not, and the transcript marks the scholar's turns", async ({ page }) => {
  await seed([
    job({ status: "review", title: "Institutions and the public record", mineUnsourced: true }),
    job({ status: "published", title: "What the archive kept" }),
  ]);

  await page.goto("/podcasts");
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("heading", { name: "Not yet released" })).toBeVisible();
  await expect(page.locator(".pod-card")).toHaveCount(2);
  await expect(page.locator(".pod-card.is-pending")).toHaveCount(1);
  /* A turn in their name with nothing behind it is the reason the page exists,
     so it is stated on the card and not only in the transcript. */
  await expect(page.locator(".pod-card__grounding.is-warn").first()).toContainText("cite nothing");

  await page.locator(".pod-card.is-pending .pod-card__title a").click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Institutions and the public record");
  await expect(page.locator(".pod-turn.is-mine")).toHaveCount(2);
  await expect(page.locator(".pod-turn.is-unsourced")).toHaveCount(1);
  await expect(page.locator(".pod-read__flag")).toContainText("no passage cited");

  /* Their own words are readable behind a turn that cited them. */
  await page.locator(".pod-turn.is-mine .pod-turn__ev summary").first().click();
  await expect(page.locator(".pod-turn__ev q").first()).toContainText("eleven institutions");
});

test("an unreleased conversation is a grave row in the Studio queue", async ({ page }) => {
  await seed([job({ status: "review", title: "Institutions and the public record", mineUnsourced: true })]);

  await page.goto("/");
  await page.waitForLoadState("networkidle");
  const row = page.locator(".st-todo", { hasText: "unsourced" }).first();
  await expect(row).toBeVisible();
  /* Grave, because it is speech attributed to a living person that nothing of
     theirs supports — the same weight as the record moving under a claim. */
  await expect(row).toHaveClass(/is-grave/);
});

test.afterAll(async () => {
  /* Leave the collection as it was found, so a later spec reading the Studio
     does not inherit this file's fixtures. */
  if (!state) return;
  const client = await MongoClient.connect(state.mongoUri);
  await client.db(DB_NAME).collection(JOBS).deleteMany({});
  await client.close();
});
