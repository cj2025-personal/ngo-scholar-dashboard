#!/usr/bin/env node
/**
 * Turn real draft jobs into eval rows.
 *
 *   npm run eval:capture                       # append delivered jobs to evals/drafts.jsonl
 *   npm run eval:capture -- --out evals/real.jsonl --limit 10
 *
 * ── Why capture rather than author ──────────────────────────────────────────
 * The seed set is synthetic and says so. The plan builds the real set from
 * the first ten drafts scholars actually request, because those are the
 * papers, lengths and fields the drafter will meet. Every delivered job
 * already holds the prepared source text it was drafted from, so a row is a
 * read, not a reconstruction. Rows are keyed by job id and never duplicated.
 *
 * Reads `scholar_draft_jobs`; writes a file. The eval set is versioned in the
 * repo, so the append is reviewed like any other change before it gates CI.
 */

require("dotenv").config();

const fs = require("fs");
const path = require("path");

const { getCollections, COLLECTIONS } = require("../src/db/mongo");
const { parseJsonl } = require("../src/lib/draftEvals");

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const out = path.resolve(opt("--out", path.join(__dirname, "..", "evals", "drafts.jsonl")));
const limit = Number(opt("--limit", 50)) || 50;

const main = async () => {
  const { db } = await getCollections();
  const existing = fs.existsSync(out) ? new Set(parseJsonl(fs.readFileSync(out, "utf8")).map((r) => r.id)) : new Set();

  const jobs = await db
    .collection(COLLECTIONS.draftJobs)
    .find({ status: { $in: ["awaiting_review", "published"] }, source_text: { $exists: true } }, { projection: { source: 1, source_text: 1, audience: 1, scholar_name: 1, finished_at: 1 } })
    .sort({ finished_at: -1 })
    .limit(limit)
    .toArray();

  const rows = jobs
    .map((j) => ({
      id: `job-${String(j._id)}`,
      title: j.source?.title || null,
      year: j.source?.year ?? null,
      origin: j.source?.origin || "harvested",
      scholarName: j.scholar_name || "the scholar",
      audience: j.audience || "general",
      capturedAt: j.finished_at || null,
      text: j.source_text,
    }))
    .filter((r) => !existing.has(r.id) && typeof r.text === "string" && r.text.split(/\s+/).length >= 200);

  if (!rows.length) {
    console.log(`nothing new to capture (${jobs.length} delivered job(s) seen, ${existing.size} row(s) already in ${path.basename(out)})`);
  } else {
    fs.appendFileSync(out, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
    console.log(`appended ${rows.length} row(s) to ${out}; ${existing.size + rows.length} total`);
    for (const r of rows) console.log(`  ${r.id}  ${r.audience.padEnd(8)}  ${r.text.split(/\s+/).length}w  ${(r.title || "").slice(0, 60)}`);
  }
  process.exit(0);
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
