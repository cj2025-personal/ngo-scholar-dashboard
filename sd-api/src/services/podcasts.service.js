"use strict";

/**
 * The dialogues a scholar is in.
 *
 * ── What this maps ─────────────────────────────────────────────────────────
 * The admin portal runs a cron that pairs a legacy scholar with a contemporary
 * one and generates a conversation between them, grounded in quotes from both
 * records. It writes `scholar_dialogue_generation_jobs` — the plan, the pair,
 * the evidence, the turns, the audio. Nothing of that reached this portal.
 *
 * What a scholar could see here was `links_and_media.podcasts` on their curated
 * record: a list of media links mirrored onto the profile after publication, by
 * way of `mirrored_podcast` on the job. That is a catalogue entry. It arrives
 * only once the episode is already public, and it says nothing about who the
 * scholar was paired with, which of their words were used, or that a
 * conversation in their name exists at all before it ships.
 *
 * This reads the job collection directly and answers the questions a person
 * named in an episode would actually ask.
 *
 * ── Read-only, and structurally so ─────────────────────────────────────────
 * Every collection here belongs to ngo-admin-backend. This service reads them
 * and never writes them — not the job, not the run, not the approval — and
 * that is the settled shape rather than a first cut. What this portal owes a
 * scholar is sight of what has been made against their name; what happens to
 * an episode is the editorial system's call, made where the state machine that
 * acts on it lives. See src/db/ownership.js for why two writers on one
 * collection is the specific hazard this codebase has already been bitten by.
 *
 * ── Whose dashboard an episode belongs on ──────────────────────────────────
 * Everyone in it who is alive to read it.
 *
 * The seats are named `selected_legacy` and `selected_contemporary`, which
 * reads as "one historical figure, one living scholar". That is the common
 * case and it is not the only one: the admin console's pipeline shows
 * dialogues between two living scholars — "Craig Johnson with Bernadette
 * Hanlon", "Dr. Early with Mo Yee Lee" — where the `legacy` seat carries
 * `entity_type: "scholar"` rather than `"legend"`.
 *
 * Matching only the contemporary seat would have hidden those episodes from
 * the other living participant entirely: voiced under their name, quoted from
 * their work, and invisible to them. So the match is on either seat, and a
 * seat only counts when it is a person — a `legend` has no account and nobody
 * to show anything to.
 */

const { ObjectId } = require("mongodb");

const { getDb } = require("../db/mongo");

const JOBS = "scholar_dialogue_generation_jobs";

/**
 * What the job's status means to the person in the episode.
 *
 * The pipeline's own vocabulary is about where the work is — queued, running,
 * review, approved, published. A scholar is asking a narrower question: can
 * anyone hear this yet, and is it still open to change? `pending` deliberately
 * covers both `review` and `approved`, because the difference between them is
 * an editor's decision inside the admin portal and neither has reached a
 * listener.
 */
const STATE = {
  queued: "making",
  running: "making",
  review: "pending",
  approved: "pending",
  published: "live",
  rejected: "stopped",
  failed: "stopped",
};

/** Fields the list needs. Transcripts and turns are large; they load per episode. */
const LIST_PROJECTION = {
  status: 1,
  run_key: 1,
  createdAt: 1,
  updatedAt: 1,
  topic_prompt: 1,
  target_turns: 1,
  selected_legacy: 1,
  selected_contemporary: 1,
  "alignment.aligned_topic_label": 1,
  "alignment.aligned_topic_summary": 1,
  "alignment.alignment_mode": 1,
  "generated_episode.title": 1,
  "generated_episode.slug": 1,
  "generated_episode.summary": 1,
  "generated_episode.topic_tags": 1,
  "generated_episode.turns.speaker_role": 1,
  "generated_episode.turns.evidence_ids": 1,
  "evidence_segments.scholar_role": 1,
  "evidence_segments.evidence_id": 1,
  "student_variant_config.enabled": 1,
  "student_variant_config.required_for_publish": 1,
  "student_variant_config.band_keys": 1,
  "student_variants.band_key": 1,
  "student_variants.approved_at": 1,
  "student_variants.rejected_at": 1,
  attached_asset: 1,
  "voice_draft.status": 1,
  "voice_draft.asset": 1,
  "review.published_at": 1,
  "validation.ok": 1,
};

function personOf(snapshot) {
  if (!snapshot) return null;
  return {
    name: snapshot.display_name || "",
    kind: snapshot.entity_type === "legend" ? "legend" : "scholar",
    institution: snapshot.institution || "",
    field: snapshot.field_of_study || "",
  };
}

/** Audio, whichever stage produced it, or null while there is none. */
function audioOf(job) {
  const asset = job.attached_asset || job.voice_draft?.asset || null;
  if (!asset || !asset.url) return null;
  return {
    url: asset.url,
    durationSeconds: asset.duration_seconds ?? null,
    /* A voice draft is a machine reading of the transcript that no editor has
       signed off. Saying so is the difference between "listen to the episode"
       and "hear how it currently sounds". */
    isDraft: !job.attached_asset && job.voice_draft?.status !== "approved",
  };
}

/**
 * The age-band rewrites, counted the way the Studio counts reading levels.
 *
 * Same idea, same word to the scholar: a version written for younger readers
 * that nobody sees until it is approved.
 */
function levelsOf(job) {
  const config = job.student_variant_config || {};
  if (!config.enabled) return { required: false, waiting: 0, approved: 0 };
  const variants = job.student_variants || [];
  const approved = variants.filter((v) => v.approved_at).length;
  const rejected = variants.filter((v) => v.rejected_at).length;
  return {
    required: Boolean(config.required_for_publish),
    waiting: Math.max(0, variants.length - approved - rejected),
    approved,
  };
}

/**
 * How much of this is spoken in the scholar's name, and what backs it.
 *
 * This is the number the portal exists to show. An episode is not a mention —
 * it is a person's name on twelve turns of dialogue and, once the voice draft
 * lands, on a synthesised reading of them. A scholar deciding whether they
 * are content with that needs to know how many of those turns are theirs and
 * how many of their own passages were available to ground them.
 */
/**
 * Which seat the viewer is sitting in.
 *
 * Both seats can hold a living scholar, so "which turns are mine" is a
 * question about the viewer and not a property of the episode. With no viewer
 * — the presenter is exported for tests — the contemporary seat is assumed,
 * because that is the seat that always holds a person.
 */
function roleOf(job, profileId) {
  const id = profileId == null ? null : String(profileId);
  if (id && job.selected_legacy?.profile_id === id && job.selected_legacy?.entity_type !== "legend") {
    return "legacy_scholar";
  }
  return "contemporary_scholar";
}

function voiceOf(job, myRole) {
  const turns = job.generated_episode?.turns || [];
  const mine = turns.filter((t) => t.speaker_role === myRole);
  const segments = job.evidence_segments || [];
  return {
    turns: turns.length,
    myTurns: mine.length,
    myQuotes: segments.filter((s) => s.scholar_role === myRole).length,
    /* Turns of theirs with nothing cited behind them. The pipeline's own
       validator has a view on this; this is the scholar-facing count. */
    myTurnsWithoutEvidence: mine.filter((t) => !(t.evidence_ids || []).length).length,
  };
}

function presentEpisode(job, profileId = null) {
  const episode = job.generated_episode || {};
  const myRole = roleOf(job, profileId);
  const mySeat = myRole === "legacy_scholar" ? job.selected_legacy : job.selected_contemporary;
  const otherSeat = myRole === "legacy_scholar" ? job.selected_contemporary : job.selected_legacy;
  return {
    id: String(job._id),
    state: STATE[job.status] || "making",
    status: job.status,
    title: episode.title || job.alignment?.aligned_topic_label || "Untitled conversation",
    slug: episode.slug || null,
    summary: episode.summary || job.alignment?.aligned_topic_summary || "",
    topics: episode.topic_tags || [],
    /* Named "with" rather than "guest" or "host": which of the two is
       interviewing is the pipeline's choice and it varies by alignment mode. */
    with: personOf(otherSeat),
    me: personOf(mySeat),
    voice: voiceOf(job, myRole),
    levels: levelsOf(job),
    audio: audioOf(job),
    publishedAt: job.review?.published_at || null,
    updatedAt: job.updatedAt || job.createdAt || null,
  };
}

/**
 * Every dialogue this scholar is named in, newest first.
 *
 * Includes the unpublished ones, which is the point: an episode that has not
 * shipped is the only one a scholar can still do anything about, and it was
 * the one they could not see.
 */
function seatFilter(profileId) {
  const id = String(profileId);
  /* `entity_type` is checked on the legacy seat because that is the seat a
     legend occupies; a legend's `profile_id` is a slug like "carter-g-woodson"
     and could never collide with a scholar's, but relying on that would be
     relying on an accident. */
  return {
    $or: [
      { "selected_contemporary.profile_id": id, "selected_contemporary.entity_type": { $ne: "legend" } },
      { "selected_legacy.profile_id": id, "selected_legacy.entity_type": { $ne: "legend" } },
    ],
  };
}

async function listEpisodesForScholar(profileId, { limit = 50 } = {}) {
  if (!profileId) return [];
  const db = await getDb();
  const jobs = await db
    .collection(JOBS)
    .find(seatFilter(profileId), {
      projection: LIST_PROJECTION,
      sort: { createdAt: -1 },
      limit: Math.min(Number(limit) || 50, 100),
    })
    .toArray();
  return jobs.map((job) => presentEpisode(job, profileId));
}

/**
 * One episode in full: the turns, and the scholar's own passages behind them.
 *
 * Scoped by `profile_id` in the query rather than checked afterwards, so an id
 * belonging to someone else's episode is a 404 and not a leak.
 */
async function getEpisodeForScholar(profileId, episodeId) {
  if (!profileId || !episodeId) return null;
  let _id;
  try {
    _id = new ObjectId(String(episodeId));
  } catch {
    return null;
  }

  const db = await getDb();
  const job = await db.collection(JOBS).findOne({ _id, ...seatFilter(profileId) });
  if (!job) return null;

  const myRole = roleOf(job, profileId);
  const segments = job.evidence_segments || [];
  const byId = new Map(segments.map((s) => [s.evidence_id, s]));

  return {
    ...presentEpisode(job, profileId),
    openingNote: job.generated_episode?.opening_note || "",
    closingNote: job.generated_episode?.closing_note || "",
    /* The transcript, turn by turn, each carrying the passages cited for it.
       A scholar reading their own turn should be able to see, in the same
       glance, which of their words it was built from. */
    turns: (job.generated_episode?.turns || []).map((t) => ({
      index: t.turn_index,
      role: t.speaker_role,
      mine: t.speaker_role === myRole,
      speaker: t.speaker_name || "",
      text: t.text || "",
      evidence: (t.evidence_ids || [])
        .map((id) => byId.get(id))
        .filter(Boolean)
        .map((s) => ({ id: s.evidence_id, mine: s.scholar_role === myRole, from: s.source_field, text: s.text })),
    })),
    /* Their own passages, whether or not a turn used them. */
    myPassages: segments
      .filter((s) => s.scholar_role === myRole)
      .map((s) => ({ id: s.evidence_id, from: s.source_field, type: s.segment_type, text: s.text })),
  };
}

/* `presentEpisode` is exported for tests: it is the contract this service
   offers the portal, and it is worth pinning without a database. */
module.exports = { listEpisodesForScholar, getEpisodeForScholar, presentEpisode, STATE };
