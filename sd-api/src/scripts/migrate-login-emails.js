/**
 * Move every scholar login onto the canonical address rule.
 *
 *   node src/scripts/migrate-login-emails.js            # dry run
 *   node src/scripts/migrate-login-emails.js --execute
 *
 * ── Why ────────────────────────────────────────────────────────────────────
 * `scholar_credentials` had two issuers with two conventions. The documents
 * portal normalises every login to `<local>@archivyn.com`; this service issued
 * `<local>@scholars.archivyn.com`. The only Legacy scholar with a login could
 * not open the portal. The rule is now shared (lib/loginEmail.js) and held
 * equal to the portal's by a contract test; this brings the stored rows onto it.
 *
 * ── What does not change ───────────────────────────────────────────────────
 * Only `login_email`. The password hash is untouched — both services verify
 * argon2id — so a scholar keeps their password and, because lookups try the
 * address as typed as a fallback, keeps working with the old address too.
 *
 * ── Refusals ───────────────────────────────────────────────────────────────
 * A target address that already exists on another row is a collision, and the
 * script stops before touching anything rather than merging two identities.
 * sd-api owns this collection (manifest 2026-09-11.4).
 */

require("dotenv").config();
const { connectToMongo, getCollections } = require("../db/mongo");
const { canonicalLoginEmail, isCanonicalLoginEmail } = require("../lib/loginEmail");

async function main() {
  const execute = process.argv.includes("--execute");
  await connectToMongo();
  const { credentials } = await getCollections();

  const rows = await credentials
    .find({}, { projection: { login_email: 1, scholar_id: 1, profile_id: 1 } })
    .toArray();

  const plan = [];
  const taken = new Set(rows.map((r) => r.login_email));
  const problems = [];

  for (const row of rows) {
    if (isCanonicalLoginEmail(row.login_email)) continue;
    const target = canonicalLoginEmail(row.login_email);
    if (!target) {
      problems.push(`${row.login_email}: nothing survives normalisation`);
      continue;
    }
    if (taken.has(target)) {
      problems.push(`${row.login_email} → ${target}: target already exists on another row`);
      continue;
    }
    taken.add(target);
    plan.push({ _id: row._id, from: row.login_email, to: target, scholar: String(row.scholar_id || row.profile_id) });
  }

  console.log(`credentials : ${rows.length}`);
  console.log(`already canonical: ${rows.length - plan.length - problems.length}`);
  console.log(`to migrate  : ${plan.length}`);
  for (const p of plan) console.log(`   ${p.from}\n     → ${p.to}   (${p.scholar.slice(0, 8)}…)`);
  if (problems.length) {
    console.log(`refusing: ${problems.length} problem(s)`);
    for (const p of problems) console.log("   " + p);
    process.exitCode = 1;
    return;
  }
  if (!execute) {
    console.log("\nDry run. Nothing changed. Re-run with --execute to apply.");
    return;
  }

  let changed = 0;
  for (const p of plan) {
    /* Filter on the old address as well as the id, so a row that changed under
       us — or was already migrated by a parallel run — is skipped, not clobbered. */
    const res = await credentials.updateOne(
      { _id: p._id, login_email: p.from },
      { $set: { login_email: p.to, login_email_previous: p.from, login_email_migrated_at: new Date() } },
    );
    changed += res.modifiedCount;
    console.log(`   ${res.modifiedCount ? "migrated" : "skipped "}  ${p.from} → ${p.to}`);
  }

  const after = await credentials.find({}, { projection: { login_email: 1 } }).toArray();
  const stillOld = after.filter((r) => !isCanonicalLoginEmail(r.login_email)).length;
  const distinct = new Set(after.map((r) => r.login_email)).size;
  console.log(`\nchanged     : ${changed}`);
  console.log(`non-canonical remaining: ${stillOld}`);
  console.log(`unique addresses: ${distinct} of ${after.length}${distinct === after.length ? "" : "  ← DUPLICATE"}`);
  if (stillOld || distinct !== after.length) process.exitCode = 1;
}

main()
  .then(() => process.exit(process.exitCode || 0))
  .catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
