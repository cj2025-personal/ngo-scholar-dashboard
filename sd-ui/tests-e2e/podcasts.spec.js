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
  /* turn_index from 1, as the production pipeline writes it (checked on released episodes 2026-11-17). */
  const turns = [
    { turn_index: 1, speaker_role: "contemporary_scholar", speaker_name: "Test Scholar", text: "What did the record keep of that period?", evidence_ids: ["e1"] },
    { turn_index: 2, speaker_role: "legacy_scholar", speaker_name: legacySeat.display_name, text: "The record kept the appointments and little else.", evidence_ids: ["e2"] },
    { turn_index: 3, speaker_role: "contemporary_scholar", speaker_name: "Test Scholar", text: "That absence is the finding.", evidence_ids: mineUnsourced ? [] : ["e3"] },
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

/* Since 2026-11-16 a scholar sees released episodes only: the rest is the company's work (sd-api podcasts.service RELEASED). */
test("only a released conversation reaches the scholar, and another scholar's does not", async ({ page }) => {
  const unreleased = job({ status: "review", title: "Still in review" });
  await seed([
    unreleased,
    job({ status: "running", title: "Still being made" }),
    job({ status: "rejected", title: "Withdrawn" }),
    job({ status: "published", title: "What the archive kept", mineUnsourced: true }),
    /* Someone else's conversation, released. It must appear nowhere below. */
    job({ status: "published", title: "Not yours at all", contemporaryOwner: "someone-else-0002" }),
  ]);

  const res = await page.request.get(`${state.apiUrl}/api/podcasts`, {
    headers: { cookie: `sd_session=${state.token}` },
  });
  expect(res.status()).toBe(200);
  const { episodes } = await res.json();
  expect(episodes.map((e) => e.title)).toEqual(["What the archive kept"]);

  const released = episodes[0];
  expect(released.state).toBe("live");
  /* The counts the portal exists to show. */
  expect(released.voice).toMatchObject({ turns: 3, myTurns: 2, myQuotes: 2, myTurnsWithoutEvidence: 1 });
  expect(released.with).toMatchObject({ name: "Carter G. Woodson", kind: "legend" });

  /* An unreleased episode of theirs is a 404 like any id that is not theirs, not a filtered-out leak. */
  for (const id of [unreleased._id.toString(), new ObjectId().toString()]) {
    const one = await page.request.get(`${state.apiUrl}/api/podcasts/${id}`, { headers: { cookie: `sd_session=${state.token}` } });
    expect(one.status()).toBe(404);
  }
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
      status: "published",
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

test("the podcast page lists released conversations, each with a way to tell the editors, and the transcript marks the scholar's turns", async ({ page }) => {
  await seed([
    job({ status: "review", title: "Still in review" }),
    job({ status: "published", title: "Institutions and the public record", mineUnsourced: true }),
  ]);

  await page.goto("/podcasts");
  await page.waitForLoadState("networkidle");
  await expect(page.locator(".pod-ep")).toHaveCount(1);
  await expect(page.getByText("Still in review")).toHaveCount(0);
  const row = page.locator(".pod-ep", { hasText: "Institutions and the public record" });
  /* A turn in their name with nothing behind it is stated on the row, not only in the transcript. */
  await expect(row.locator(".pod-voice.is-warn")).toContainText("1 turn cites nothing of yours");
  /* One way to reach the editors, already naming the episode. */
  const report = row.getByRole("link", { name: /Something's wrong\?/ });
  await expect(report).toHaveAttribute("href", /^mailto:editors@example\.test\?subject=Something%20is%20wrong%20in%20%22Institutions%20and%20the%20public%20record%22/);
  await page.setViewportSize({ width: 1366, height: 607 });
  await page.screenshot({ path: test.info().outputPath("podcasts-1366x607.png") });

  /* The transcript opens in a side panel over the list, with an address of its own (2026-11-16). */
  await row.getByRole("link", { name: "Read the transcript of Institutions and the public record" }).click();
  const panel = page.getByRole("dialog", { name: "Institutions and the public record" });
  await expect(panel).toBeVisible();
  await expect(page).toHaveURL(/\/podcasts\?episode=[a-f0-9]{24}$/);
  /* Focus starts at the top of the read, on its title. */
  await expect(panel.getByRole("heading", { name: "Institutions and the public record" })).toBeFocused();
  await expect(panel.getByRole("link", { name: /Something's wrong\?/ })).toHaveAttribute("href", /^mailto:editors@example\.test/);
  await expect(panel.locator(".pod-turn.is-mine")).toHaveCount(2);
  await expect(panel.locator(".pod-turn.is-unsourced")).toHaveCount(1);
  /* Turns are numbered from 1 by where they fall, whatever index the pipeline gave them. */
  await expect(panel.locator(".pod-turn__n")).toHaveText(["1", "2", "3"]);
  /* The count of turns citing nothing, pinned at the top, carries the way to them. */
  await expect(panel.locator(".pod-panel__listen .pod-voice.is-warn")).toContainText("1 turn cites nothing of yours");
  await expect(panel.locator(".pod-turn.is-unsourced")).toContainText("Nothing of yours is cited for this turn.");
  /* "Go to it" lands on the turn, focus and all. */
  await panel.getByRole("button", { name: "Go to it" }).click();
  await expect(panel.locator(".pod-turn.is-unsourced")).toBeFocused();

  /* Their own words are readable behind a turn that cited them. */
  await panel.locator(".pod-turn.is-mine .pod-turn__ev summary").first().click();
  await expect(panel.locator(".pod-turn__ev q").first()).toContainText("eleven institutions");
  await page.screenshot({ path: test.info().outputPath("podcasts-transcript-1366x607.png") });

  /* Esc closes it, the address with it, and focus goes back to what opened it. */
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await expect(page).toHaveURL(/\/podcasts$/);
  await expect(row.getByRole("link", { name: "Read the transcript of Institutions and the public record" })).toBeFocused();

  /* The back button closes it too, and the old page address opens it over the list. */
  await row.getByRole("link", { name: "Read the transcript of Institutions and the public record" }).click();
  await expect(panel).toBeVisible();
  await page.goBack();
  await expect(panel).toHaveCount(0);
  const id = new URL(await row.getByRole("link", { name: /Read the transcript/ }).getAttribute("href"), "http://x").searchParams.get("episode");
  await page.goto(`/podcasts/${id}`);
  await expect(panel).toBeVisible();
  await panel.getByRole("button", { name: "Close the transcript" }).click();
  await expect(page).toHaveURL(/\/podcasts$/);
});

test("a transcript link that is not one of theirs, or not released, opens nothing and says so", async ({ page }) => {
  const unreleased = job({ status: "review", title: "Still in review" });
  await seed([unreleased, job({ status: "published", title: "What the archive kept" })]);
  for (const id of [unreleased._id.toString(), new ObjectId().toString()]) {
    await page.goto(`/podcasts?episode=${id}`);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("status").filter({ hasText: "That conversation isn’t available" })).toBeVisible();
    await expect(page.getByText("Still in review")).toHaveCount(0);
  }
});

test("an episode with audio plays where it is listed, one at a time, and says when the voices are AI", async ({ page }) => {
  /* A one-second silent WAV, as a data URL, so the test needs no network. */
  const rate = 8000;
  const wavBytes = Buffer.alloc(44 + rate);
  wavBytes.write("RIFF", 0); wavBytes.writeUInt32LE(36 + rate, 4); wavBytes.write("WAVE", 8); wavBytes.write("fmt ", 12);
  wavBytes.writeUInt32LE(16, 16); wavBytes.writeUInt16LE(1, 20); wavBytes.writeUInt16LE(1, 22); wavBytes.writeUInt32LE(rate, 24);
  wavBytes.writeUInt32LE(rate, 28); wavBytes.writeUInt16LE(1, 32); wavBytes.writeUInt16LE(8, 34); wavBytes.write("data", 36); wavBytes.writeUInt32LE(rate, 40);
  wavBytes.fill(128, 44);
  const wav = "data:audio/wav;base64," + wavBytes.toString("base64");
  /* The first: its approved AI reading published as it is. The second: a recording an editor attached instead. */
  const promoted = { ...job({ status: "published", title: "First voiced" }), voice_draft: { status: "approved", asset: { url: wav, duration_seconds: 1 } }, attached_asset: { url: wav, duration_seconds: 1 } };
  const replaced = { ...job({ status: "published", title: "Second voiced" }), voice_draft: { status: "approved", asset: { url: wav, duration_seconds: 1 } }, attached_asset: { url: `${wav}#studio`, duration_seconds: 1 } };
  await seed([promoted, replaced]);

  await page.goto("/podcasts");
  const first = page.locator(".pod-ep", { hasText: "First voiced" });
  const second = page.locator(".pod-ep", { hasText: "Second voiced" });
  await expect(first.locator(".pod-player__voice")).toHaveText("AI voices");
  /* Not claimed for a recording an editor attached, which may be real. */
  await expect(second.locator(".pod-player__voice")).toHaveCount(0);
  await expect(first.locator(".pod-player__time")).toContainText("0:01");

  await first.getByRole("button", { name: "Play First voiced" }).click();
  await expect(first.getByRole("button", { name: "Pause First voiced" })).toBeVisible();
  /* Starting the second pauses the first: one voice at a time. */
  await second.getByRole("button", { name: "Play Second voiced" }).click();
  await expect(first.getByRole("button", { name: "Play First voiced" })).toBeVisible();
});

test("an unreleased conversation is nowhere a scholar looks: not the Studio, not Podcasts", async ({ page }) => {
  await seed([job({ status: "review", title: "Institutions and the public record", mineUnsourced: true })]);

  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await expect(page.getByText("Institutions and the public record")).toHaveCount(0);
  await expect(page.locator(".st-todo", { hasText: /unsourced|not been released/ })).toHaveCount(0);

  await page.goto("/podcasts");
  await expect(page.getByRole("heading", { name: "Nothing released in your name yet" })).toBeVisible();
  await expect(page.getByText("Institutions and the public record")).toHaveCount(0);
});

test.afterAll(async () => {
  /* Leave the collection as it was found, so a later spec reading the Studio
     does not inherit this file's fixtures. */
  if (!state) return;
  const client = await MongoClient.connect(state.mongoUri);
  await client.db(DB_NAME).collection(JOBS).deleteMany({});
  await client.close();
});
