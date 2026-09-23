/**
 * What a scholar is told about a conversation held in their name.
 *
 * The failure this file exists to prevent is a portal that reassures. An
 * episode is twelve turns of dialogue under a living person's name and, once
 * the voice draft lands, a synthesised reading of them — so the counts that
 * describe how much of it is theirs, and how much of it is grounded in their
 * own words, have to be right or they are worse than absent.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

/* Placeholders, as in contracts.test.js. Nothing here connects; the service
   module reads config at require time and refuses to load without them, so
   this file could not run at all. */
process.env.MONGODB_URI ||= "mongodb://localhost:27017/podcasts-test";
process.env.MONGODB_DB ||= "podcasts-test";

const { presentEpisode, STATE } = require("../src/services/podcasts.service");

const CONTEMPORARY = {
  entity_type: "scholar",
  scholar_id: "a688a2f0",
  profile_id: "a688a2f0",
  display_name: "Craig Johnson",
  institution: "Indiana University",
  field_of_study: "Public Finance and Economics",
};

const LEGEND = {
  entity_type: "legend",
  scholar_id: "carter-g-woodson",
  profile_id: "carter-g-woodson",
  display_name: "Carter G. Woodson",
  field_of_study: "African American History",
};

function job(overrides = {}) {
  return {
    _id: "6a3bff85e1e080ccec505cc9",
    status: "review",
    selected_legacy: LEGEND,
    selected_contemporary: CONTEMPORARY,
    generated_episode: {
      title: "Institutions and public systems",
      turns: [
        { turn_index: 0, speaker_role: "contemporary_scholar", evidence_ids: ["e1"] },
        { turn_index: 1, speaker_role: "legacy_scholar", evidence_ids: ["e2"] },
        { turn_index: 2, speaker_role: "contemporary_scholar", evidence_ids: [] },
      ],
    },
    evidence_segments: [
      { evidence_id: "e1", scholar_role: "contemporary_scholar" },
      { evidence_id: "e2", scholar_role: "legacy_scholar" },
      { evidence_id: "e3", scholar_role: "contemporary_scholar" },
    ],
    ...overrides,
  };
}

test("an episode nobody can hear yet is pending, whether or not an editor signed it", () => {
  assert.equal(presentEpisode(job({ status: "review" })).state, "pending");
  assert.equal(presentEpisode(job({ status: "approved" })).state, "pending");
  /* The distinction the scholar cares about is "has a listener reached it". */
  assert.equal(presentEpisode(job({ status: "published" })).state, "live");
  assert.equal(presentEpisode(job({ status: "running" })).state, "making");
  assert.equal(presentEpisode(job({ status: "rejected" })).state, "stopped");
  assert.equal(presentEpisode(job({ status: "failed" })).state, "stopped");
});

test("an unknown pipeline status never reads as live", () => {
  /* A status this portal has not been taught must not imply a thing has
     shipped; `making` is the safe reading, and STATE is the whole vocabulary. */
  assert.equal(presentEpisode(job({ status: "some_new_state" })).state, "making");
  assert.ok(!Object.values(STATE).includes("published"));
});

test("the counts say how much is spoken in the scholar's name", () => {
  const { voice } = presentEpisode(job());
  assert.equal(voice.turns, 3);
  assert.equal(voice.myTurns, 2);
  /* Their own passages, whether or not a turn cited them. */
  assert.equal(voice.myQuotes, 2);
  /* The one that matters most: a turn in their name with nothing behind it. */
  assert.equal(voice.myTurnsWithoutEvidence, 1);
});

test("the counterpart is named, and marked as a legend rather than a peer", () => {
  const episode = presentEpisode(job());
  assert.equal(episode.with.name, "Carter G. Woodson");
  assert.equal(episode.with.kind, "legend");
  assert.equal(episode.me.name, "Craig Johnson");
  assert.equal(episode.me.kind, "scholar");
});

test("a machine reading that no editor approved is labelled a draft", () => {
  const drafted = presentEpisode(
    job({ voice_draft: { status: "review", asset: { url: "https://x/a.mp3", duration_seconds: 610 } } }),
  );
  assert.equal(drafted.audio.isDraft, true);
  assert.equal(drafted.audio.durationSeconds, 610);

  const attached = presentEpisode(
    job({ attached_asset: { url: "https://x/final.mp3", duration_seconds: 600 } }),
  );
  assert.equal(attached.audio.isDraft, false);
});

test("no audio is null, never a broken player", () => {
  assert.equal(presentEpisode(job()).audio, null);
  /* A voice draft that failed carries a status but no asset. */
  assert.equal(presentEpisode(job({ voice_draft: { status: "failed", asset: null } })).audio, null);
});

test("age-band versions are counted the way reading levels are", () => {
  const off = presentEpisode(job());
  assert.deepEqual(off.levels, { required: false, waiting: 0, approved: 0 });

  const waiting = presentEpisode(
    job({
      student_variant_config: { enabled: true, required_for_publish: true, band_keys: ["grade_3_5", "grade_6_8"] },
      student_variants: [
        { band_key: "grade_3_5", approved_at: new Date() },
        { band_key: "grade_6_8" },
        { band_key: "grade_9_12", rejected_at: new Date() },
      ],
    }),
  );
  assert.equal(waiting.required, undefined);
  assert.equal(waiting.levels.required, true);
  assert.equal(waiting.levels.approved, 1);
  /* Rejected is not waiting: it has been dealt with. */
  assert.equal(waiting.levels.waiting, 1);
});

test("a job with no generated episode still presents a title and no crash", () => {
  const bare = presentEpisode({
    _id: "x",
    status: "queued",
    selected_legacy: LEGEND,
    selected_contemporary: CONTEMPORARY,
    alignment: { aligned_topic_label: "institutions and public systems" },
  });
  assert.equal(bare.title, "institutions and public systems");
  assert.equal(bare.voice.turns, 0);
  assert.equal(bare.voice.myTurns, 0);
  assert.equal(bare.audio, null);
});

/**
 * Two living scholars, which the seat names do not lead you to expect.
 *
 * The admin console's pipeline lists dialogues like "Craig Johnson with
 * Bernadette Hanlon" and "Dr. Early with Mo Yee Lee": both seats hold a real
 * person, and the one in the `legacy` seat carries `entity_type: "scholar"`.
 * Reading the seat name instead of the entity type hid those episodes from
 * the second scholar entirely.
 */
test("when both seats hold a living scholar, each sees it as theirs", () => {
  const peer = { ...CONTEMPORARY, scholar_id: "b1", profile_id: "b1", display_name: "Bernadette Hanlon" };
  const both = job({ selected_legacy: peer, status: "published" });

  /* Craig, in the contemporary seat. */
  const craig = presentEpisode(both, "a688a2f0");
  assert.equal(craig.me.name, "Craig Johnson");
  assert.equal(craig.with.name, "Bernadette Hanlon");
  assert.equal(craig.with.kind, "scholar");
  assert.equal(craig.voice.myTurns, 2);

  /* Bernadette, in the seat the schema calls "legacy". */
  const bernadette = presentEpisode(both, "b1");
  assert.equal(bernadette.me.name, "Bernadette Hanlon");
  assert.equal(bernadette.with.name, "Craig Johnson");
  /* Her turn is the legacy-role one, and it is the only one of hers. */
  assert.equal(bernadette.voice.myTurns, 1);
  assert.equal(bernadette.voice.myQuotes, 1);
  assert.equal(bernadette.voice.myTurnsWithoutEvidence, 0);
});

test("a legend in the legacy seat is still the counterpart, never the viewer", () => {
  /* The common case must not regress: asked from the contemporary scholar's
     side, a legend stays on the "with" side and is marked as one. */
  const episode = presentEpisode(job(), "a688a2f0");
  assert.equal(episode.me.name, "Craig Johnson");
  assert.equal(episode.with.kind, "legend");
  assert.equal(episode.voice.myTurns, 2);
});
