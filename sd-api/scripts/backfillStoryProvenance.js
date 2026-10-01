#!/usr/bin/env node
/**
 * Restore the reader and voice on stories that lost them when they were saved.
 *
 *   node scripts/backfillStoryProvenance.js            # report only: what would change
 *   node scripts/backfillStoryProvenance.js --apply    # write it
 *
 * ── Why ─────────────────────────────────────────────────────────────────────
 * A draft written in the page beside the agent is saved by the page, which
 * claims the draft job's provenance for the story. That claim read the job
 * without its `audience` and `voice`, so every such story was stored as
 * written for nobody in particular — read as adults, about the scholar —
 * whatever the scholar asked for. The reading-level target, the other
 * reading ages offered, the levels and the edit agent all read those two
 * fields from the story.
 *
 * Each story names the job it came from (`provenance.job_id`); the job holds
 * what was asked. Only a field that is empty on the story and set on the job
 * is written, so nothing the scholar has since set is touched, and the
 * story's version is not bumped: this restores a record, it is not an edit.
 */

require("dotenv").config();

const { getDb, COLLECTIONS, closeDb } = require("../src/db/mongo");

const apply = process.argv.includes("--apply");

(async () => {
  const db = await getDb();
  const stories = db.collection(COLLECTIONS.scholarEditorials);
  const jobs = db.collection(COLLECTIONS.draftJobs);
  const candidates = await stories.find(
    { "provenance.job_id": { $ne: null }, $or: [{ "provenance.audience": null }, { "provenance.voice": null }] },
    { projection: { title: 1, status: 1, slug: 1, provenance: 1 } },
  ).toArray();

  let changed = 0;
  for (const s of candidates) {
    const job = await jobs.findOne({ _id: s.provenance.job_id }, { projection: { audience: 1, voice: 1, brief: 1 } });
    if (!job) { console.log(`skip   ${s._id}  "${s.title}"  — its job is gone`); continue; }
    const set = {};
    if (!s.provenance.audience && job.audience) set["provenance.audience"] = job.audience;
    if (!s.provenance.voice && job.voice) set["provenance.voice"] = job.voice;
    if (!Object.keys(set).length) continue;
    changed += 1;
    console.log(`${apply ? "fix   " : "would "} ${s._id}  [${s.status}] "${s.title}"  →  ${Object.entries(set).map(([k, v]) => `${k.split(".")[1]}=${v}`).join(", ")}${job.brief ? `  (asked: "${String(job.brief).slice(0, 70)}")` : ""}`);
    if (apply) await stories.updateOne({ _id: s._id }, { $set: set });
  }
  console.log(`\n${candidates.length} stor${candidates.length === 1 ? "y" : "ies"} with an empty reader or voice; ${changed} ${apply ? "restored" : "would be restored"} from ${changed === 1 ? "its job" : "their jobs"}.${apply || !changed ? "" : " Run with --apply to write."}`);
  if (typeof closeDb === "function") await closeDb();
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
