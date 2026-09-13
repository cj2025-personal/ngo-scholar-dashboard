#!/usr/bin/env node
/**
 * Check every public story's source against the scientific record.
 *
 * Reads the DOI behind each published story and asks Crossref what has been
 * registered against it: retractions, withdrawals, corrections, expressions
 * of concern. Dry run by default: it prints what it would record and writes
 * nothing. `--commit` stores the result on each story, where the workspace,
 * the Studio and the public page read it.
 *
 *   node scripts/checkRecord.js            # look, write nothing
 *   node scripts/checkRecord.js --commit   # store what was found
 *   node scripts/checkRecord.js --limit 50
 *
 * In production this is what the scheduler's POST /record/sweep does once a
 * day. This script is for running it by hand, or from a laptop.
 */

const { connectToMongo, getDb, COLLECTIONS } = require("../src/db/mongo");
const { sourceDoiFor, fetchWork } = require("../src/services/record.service");
const record = require("../src/lib/record");

const args = process.argv.slice(2);
const commit = args.includes("--commit");
const limitIx = args.indexOf("--limit");
const limit = limitIx >= 0 ? Number(args[limitIx + 1]) || 200 : 200;

async function main() {
  await connectToMongo();
  const db = await getDb();
  const stories = await db
    .collection(COLLECTIONS.scholarEditorials)
    .find({ status: { $in: ["published", "scheduled"] }, "provenance.source_id": { $exists: true, $ne: null } })
    .sort({ "record.checked_at": 1 })
    .limit(limit)
    .project({ slug: 1, title: 1, provenance: 1, record: 1, body_blocks: 1, profile_id: 1 })
    .toArray();
  console.log(`${stories.length} public stor${stories.length === 1 ? "y" : "ies"} with a source. ${commit ? "Writing results." : "Dry run: writing nothing."}`);

  const totals = { checked: 0, noDoi: 0, alerted: 0, failed: 0 };
  for (const s of stories) {
    try {
      const doi = await sourceDoiFor(db, s);
      if (!doi) { totals.noDoi += 1; console.log(`  - ${s.slug}: no DOI on record for the source`); continue; }
      const work = await fetchWork(doi);
      const notices = record.noticesFrom(work);
      const affected = (s.body_blocks || []).map((b, i) => (b.type === "paragraph" && b.provenance?.source_refs?.length ? i + 1 : null)).filter(Boolean);
      const alerts = record.alertsFor({ notices, story: { provenance: { title: s.provenance?.source_title }, bodyBlocks: affected.map(() => ({ type: "paragraph", sourceRefs: [{ passageId: "x" }] })) } });
      totals.checked += 1;
      if (alerts.length) {
        totals.alerted += 1;
        console.log(`  ! ${s.slug}: ${alerts.map((a) => a.kind).join(", ")} — ${record.headline(alerts)}`);
      } else {
        console.log(`  · ${s.slug}: ${notices.length ? `${notices.length} notice(s), none needing attention` : "clean"}`);
      }
      if (commit) {
        const { checkStoryDoc } = require("../src/services/record.service");
        await checkStoryDoc(db, await db.collection(COLLECTIONS.scholarEditorials).findOne({ _id: s._id }));
      }
    } catch (error) {
      totals.failed += 1;
      console.log(`  x ${s.slug}: ${error.message}`);
    }
  }
  console.log(`\nchecked ${totals.checked}, alerted ${totals.alerted}, no DOI ${totals.noDoi}, failed ${totals.failed}`);
  process.exit(0);
}

main().catch((error) => { console.error(error); process.exit(1); });
