/**
 * Delete generated student-facing content and the learner records that point
 * at it. Leave the scholar corpus alone.
 *
 *   node purge-generated-content.js                      # dry run
 *   node purge-generated-content.js --execute --out ./backup
 *
 * Run it from a directory where `mongodb` and `dotenv` resolve — the sd-api
 * checkout is the obvious one — with MONGODB_URI in the environment or a .env
 * beside it.
 *
 * ── Why this refuses to guess ──────────────────────────────────────────────
 * Every collection is named literally. There is no pattern matching at
 * execution time, because a regex that grew one character would silently widen
 * a mass delete and nothing would notice until the data was gone. A name
 * appearing in both PROTECT and a delete list is a hard abort rather than a
 * precedence rule: that is a mistake in the lists, and picking a winner would
 * leave the wrong list quietly wrong.
 *
 * Dry run unless --execute. Every targeted collection is exported to JSON
 * first, and protected counts are compared before and after, so the corpus
 * being intact is demonstrated rather than asserted.
 */

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { MongoClient } = require("mongodb");

/* ── Never touched ─────────────────────────────────────────────────────────
   Curated records, harvested corpus, scholar identity, anything a scholar gave
   us or decided, and the compliance trails — which are the last thing that
   should vanish alongside the content they describe. */
const PROTECT = [
  // Curated identity, scholars and legends alike.
  "scholars",
  "legend_scholars",
  "legend_profiles",

  // The corpus generation reads from.
  "scholar_passages",
  "source_texts",
  "profile_vectors",
  "profile_features",
  "profile_neighbors",
  "professorchunkexposures",
  "enrichment_raw",

  /* Harvested BBC News RSS — source, url, title, summary, full text, fetched
     February 2026. An RSS feed carries only recent items, so this cannot be
     re-fetched: the acquisition window closed months ago. It is the one thing
     on the original delete list that a re-run would not reproduce. */
  "daily_story_trend_issues",

  // Contributed by scholars, or decided by them.
  "scholar_documents",
  "scholar_document_audit_events",
  "scholar_docs_auth_events",
  "scholar_suggestions",
  "scholar_credentials",
  "scholar_credential_audit_events",
  "scholar_sessions",
  "scholar_invites",
  "scholar_registrations",
  "scholar_editorials",

  // Curation of the scholar record itself.
  "scholar_review_items",
  "scholar_review_batches",
  "scholar_intake_runs",
  "scholar_image_review_items",
  "scholar_image_batches",
  "scholar_image_audit_events",
  "community_review_items",
  "community_gold_labels",

  // Identity.
  "users",
  "auth_users",
  "admin_users",
  "admin_sessions",
  "student_profiles",
  "learneridentityaliases",
  "tenants",

  /* Compliance and safety. Deleting an audit trail next to the content it
     covers is how it stops being one. */
  "consent_ledger",
  "learner_erasures",
  "audit_log",
  "safety_events",

  // Model and taxonomy definitions — configuration, not data.
  "parislevels",
  "parispillars",
  "parisskills",
  "parisskillmappings",
  "competencies",
  "competency_domains",
  "competency_models",
  "competency_relations",
  "competency_version_mappings",
  "standard_definitions",
  "taxonomy_pathways",
  "taxonomy_terms",
  "skill_code_patterns",
  "misconceptions",
  "misconceptiontaxonomies",
];

/* ── Generated student-facing content ─────────────────────────────────────── */
const GENERATED_CONTENT = [
  "reading_passages",
  "stories",
  "scholarstories",
  "storyblocks",
  "storymedias",
  "legend_scholar_daily_stories",

  "daily_story_pool",
  "daily_story_jobs",
  "dailystoryjobs",
  "daily_story_eval_jobs",
  "daily_story_retry_jobs",
  "daily_story_trend_jobs",
  "daily_story_profile_quality",
  "daily_story_profile_quality_jobs",
  "daily_story_quality_events",

  "dailychallenges",
  "daily_challenge_pool",
  "dailychallengereviews",
  "communitydailycontents",

  "evidence_hunt_bank_items",
  "evidence_hunt_items",
  "evidence_hunt_sessions",
  "evidence_hunt_responses",
  "evidence_hunt_question_attempts",

  "escape_room_rooms",
  "escape_room_options",
  "escape_room_events",
  "escape_room_responses",
  "escape_room_sessions",

  "paragraph_purpose_analyses",
  "paragraph_purpose_items",
  "paragraph_purpose_submissions",

  /* 4,924 rows, every one `status: "candidate"` — none reviewed by a person,
     none carrying a note. Mined from `scholar_passages`, which survives, so
     re-running the miner reproduces it exactly. */
  "contested_pairs",

  "podcast_runs",
  "podcast_qa_runs",
  "editorial_story_audit_events",
  "readingcoachsessions",
  "readingcoachmessages",
  "spot_machine_rounds",
  "unit_texts",
];

/* ── Learner records that point at the content above ──────────────────────── */
const LEARNER_RECORDS = [
  "student_question_attempt",
  "student_task_attempt",
  "student_daily_snapshot",
  "student_event_log",
  "student_standard_mastery",
  "student_sessions",
  "student_personalization_prep_audit",
  "storyattempts",
  "dailychallengeattempts",
  "inferencegymattempts",

  "studentcompetencysnapshots",
  "studentparisprofiles",
  "studentparisskillmasteries",
  "scorechangeledgers",
  "masteryevidences",
  "confidencecalibrations",
  "dimensionbaselines",
  "learner_board_snapshots",

  "parisevidencerecords",
  "parisartifactscores",
  "parisrecommendations",
  "parisuseractions",
  "parisusercontexts",
  "paristeacherreviews",
  "paris_evidence_outbox",
  "paris_evidence_retry",

  "arcenrollments",
  "arcwritingresponses",
  "arc_confusion_marks",
  "knowledgearcs",
  "forgesessions",
  "conversations",
  "conversations_archive",
];

const TARGETS = [
  { group: "generated content", names: GENERATED_CONTENT },
  { group: "learner records", names: LEARNER_RECORDS },
];

async function main() {
  const execute = process.argv.includes("--execute");
  const outFlag = process.argv.indexOf("--out");
  const outDir = outFlag > -1 ? process.argv[outFlag + 1] : null;

  assertListsAreDisjoint();

  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) throw new Error("set MONGODB_URI");

  const client = await MongoClient.connect(uri);
  const db = client.db(process.env.MONGO_DB || "ngo_profiles");
  const existing = new Set((await db.listCollections().toArray()).map((c) => c.name));

  /* Counted before anything happens so the same numbers can be re-checked
     after, and a protected collection losing documents is detectable rather
     than merely unlikely. */
  const protectedBefore = await countAll(db, PROTECT.filter((n) => existing.has(n)));

  console.log(`database   : ${db.databaseName}`);
  console.log(`mode       : ${execute ? "EXECUTE — deletions are permanent" : "dry run"}`);
  console.log(`backup     : ${outDir ? path.resolve(outDir) : execute ? "NONE" : "n/a"}`);

  let grandTotal = 0;
  const plan = [];

  for (const { group, names } of TARGETS) {
    console.log(`\n── ${group} ──────────────────────────────────`);
    let groupTotal = 0;
    for (const name of names) {
      if (!existing.has(name)) continue;
      const n = await db.collection(name).countDocuments();
      groupTotal += n;
      if (n > 0) {
        plan.push({ name, n });
        console.log(`   ${String(n).padStart(7)}  ${name}`);
      }
    }
    console.log(`   ${String(groupTotal).padStart(7)}  — ${group} total`);
    grandTotal += groupTotal;
  }

  console.log(
    `\nprotected  : ${Object.keys(protectedBefore).length} collections, ` +
      `${sum(Object.values(protectedBefore)).toLocaleString()} documents — untouched`
  );
  console.log(`to delete  : ${grandTotal.toLocaleString()} documents across ${plan.length} collections`);

  if (!execute) {
    console.log("\nDry run. Nothing changed. Re-run with --execute --out <dir> to apply.");
    return client.close();
  }

  if (!outDir) {
    console.error("\nRefusing to delete without --out <dir>. The backup is the only thing standing behind this.");
    process.exitCode = 1;
    return client.close();
  }

  // ── Back up first ────────────────────────────────────────────────────────
  fs.mkdirSync(outDir, { recursive: true });
  console.log("\n── backing up ──────────────────────────────────");
  for (const { name, n } of plan) {
    const docs = await db.collection(name).find({}).toArray();
    if (docs.length !== n) {
      console.error(`   MISMATCH on ${name}: counted ${n}, exported ${docs.length}. Stopping before any delete.`);
      process.exitCode = 1;
      return client.close();
    }
    const file = path.join(outDir, `${name}.json`);
    fs.writeFileSync(file, JSON.stringify(docs));
    console.log(`   ${String(docs.length).padStart(7)}  ${name}  →  ${(fs.statSync(file).size / 1048576).toFixed(1)} MB`);
  }

  // ── Delete ───────────────────────────────────────────────────────────────
  console.log("\n── deleting ────────────────────────────────────");
  let deleted = 0;
  for (const { name } of plan) {
    const res = await db.collection(name).deleteMany({});
    deleted += res.deletedCount;
    console.log(`   ${String(res.deletedCount).padStart(7)}  ${name}`);
  }

  // ── Prove the corpus is intact ───────────────────────────────────────────
  const after = await countAll(db, Object.keys(protectedBefore));
  const changed = Object.keys(protectedBefore).filter((k) => protectedBefore[k] !== after[k]);

  console.log(`\ndeleted    : ${deleted.toLocaleString()} documents`);
  console.log(`backup     : ${path.resolve(outDir)}`);
  if (changed.length === 0) {
    console.log(`corpus     : intact — all ${Object.keys(protectedBefore).length} protected collections unchanged`);
  } else {
    console.error(`corpus     : CHANGED in ${changed.length} collection(s)`);
    for (const k of changed) console.error(`   ${k}: ${protectedBefore[k]} → ${after[k]}`);
    process.exitCode = 1;
  }

  await client.close();
}

/** A name in both lists is a mistake in the lists, not a question of precedence. */
function assertListsAreDisjoint() {
  const p = new Set(PROTECT);
  const all = [...GENERATED_CONTENT, ...LEARNER_RECORDS];
  const overlaps = all.filter((n) => p.has(n));
  if (overlaps.length) throw new Error(`named in both PROTECT and a delete list: ${overlaps.join(", ")}`);
  const dupes = all.filter((n, i) => all.indexOf(n) !== i);
  if (dupes.length) throw new Error(`listed twice for deletion: ${[...new Set(dupes)].join(", ")}`);
}

async function countAll(db, names) {
  const out = {};
  for (const n of names) out[n] = await db.collection(n).countDocuments();
  return out;
}

const sum = (xs) => xs.reduce((a, b) => a + b, 0);

main().catch((e) => {
  console.error("FAILED:", e.message);
  process.exitCode = 1;
});
