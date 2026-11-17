#!/usr/bin/env node
/**
 * Give a scholar already in the directory a studio account, the way the
 * product does it: an invitation from this API (POST /api/internal/invites),
 * redeemed on the studio's claim page, where the scholar chooses the password.
 *
 *   npm run invite:scholar -- --name "Craig L Johnson" --email <sign-in email> --issued-by "<your name>"
 *   npm run invite:scholar -- --profile <profile_id> --email <sign-in email> --issued-by "<your name>"
 *   add --replace to re-invite a scholar who already has an account (claiming sets a new password)
 *
 * ── Why a script ───────────────────────────────────────────────────────────
 * Issuing is service-to-service (routes/invite.routes.js) and the admin
 * portal has no button for it yet, so an admin runs this and sends the link.
 * Used 2026-11-17 for the first live check of the studio.
 *
 * ── What it does ───────────────────────────────────────────────────────────
 * 1. Finds the scholar, read-only, in the database this API's .env names
 *    (production on a developer's machine). With --name it lists who matches
 *    and stops unless exactly one does; then pass --profile.
 * 2. Stops if the scholar already has an account (unless --replace), and if
 *    the sign-in address would clash with another scholar's: addresses are
 *    matched on the part before the @ (lib/loginEmail.js), so
 *    jane@uni.edu and jane@archivyn.com are the same sign-in.
 * 3. Reads the service secret from Secret Manager (scholar-api-service-token)
 *    with your gcloud login; it is sent, never printed.
 * 4. Asks the API for the invitation and prints the claim link, once: it is
 *    never stored and cannot be shown again. It lasts 7 days.
 *
 * Writes nothing itself; the API records the invitation. The studio API and
 * UI must be switched on. To try it against the local sandbox first, set
 * STUDIO_API, STUDIO_SITE, INVITE_MONGODB_URI, INVITE_MONGODB_DB and
 * INVITE_SERVICE_TOKEN.
 */
require("dotenv").config({ quiet: true });

const { execSync } = require("child_process");
const { MongoClient } = require("mongodb");

const { canonicalLoginEmail } = require("../src/lib/loginEmail");

const API = process.env.STUDIO_API || "https://studio-api.projarch.org";
const SITE = process.env.STUDIO_SITE || "https://studio.projarch.org";
const MONGO_URI = process.env.INVITE_MONGODB_URI || process.env.MONGODB_URI;
const MONGO_DB = process.env.INVITE_MONGODB_DB || process.env.MONGODB_DB;

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : null;
};
const nameOf = (scholar) => scholar?.name?.display || scholar?.name?.full || "the scholar";

async function main() {
  const name = arg("name");
  let profileId = arg("profile");
  const email = arg("email");
  const issuedBy = arg("issued-by");
  if (!email || !issuedBy || (!name && !profileId)) {
    console.error('Usage: npm run invite:scholar -- (--name "<name>" | --profile <id>) --email <sign-in email> --issued-by "<your name>" [--replace]');
    process.exit(2);
  }

  const client = await MongoClient.connect(MONGO_URI);
  const db = client.db(MONGO_DB);
  const scholars = db.collection("scholars");
  const credentials = db.collection("scholar_credentials");
  const accountOf = (id) => credentials.findOne({ $or: [{ profile_id: id }, { scholar_id: id }] }, { projection: { login_email: 1, is_active: 1 } });

  /* 1. Who. */
  let scholar;
  try {
    if (profileId) {
      scholar = await scholars.findOne({ profile_id: profileId }, { projection: { profile_id: 1, name: 1, about: 1, status: 1 } });
      if (!scholar) {
        console.error(`No scholar with profile_id ${profileId}.`);
        process.exit(1);
      }
    } else {
      /* Every word of the name (initials skipped), in any order, in the display or full name. */
      const words = name.split(/\s+/).filter((w) => w.replace(/\W/g, "").length > 1);
      const escape = (w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const match = { $and: words.map((w) => ({ $or: [{ "name.display": { $regex: escape(w), $options: "i" } }, { "name.full": { $regex: escape(w), $options: "i" } }] })) };
      const found = await scholars.find(match, { projection: { profile_id: 1, name: 1, about: 1, status: 1 } }).limit(10).toArray();
      console.log(`Scholars matching "${name}": ${found.length}`);
      for (const s of found) {
        const account = await accountOf(s.profile_id);
        const where = [s.about?.current_position, s.about?.institution].filter(Boolean).join(" · ");
        console.log(`  ${s.profile_id}  ${nameOf(s)}${where ? ` · ${where}` : ""} · status ${s.status || "?"} · studio account: ${account ? `yes (${account.login_email}${account.is_active === false ? ", inactive" : ""})` : "none"}`);
      }
      if (found.length !== 1) {
        console.log("\nRun again with --profile <the right profile_id> to continue.");
        process.exit(found.length ? 0 : 1);
      }
      scholar = found[0];
      profileId = scholar.profile_id;
    }

    /* 2. An account already there: claiming would replace its password, so only on purpose. */
    const existing = await accountOf(profileId);
    if (existing && !process.argv.includes("--replace")) {
      console.log(`\n${nameOf(scholar)} already has a studio account (${existing.login_email}). Sign in with it, or run again with --replace to issue an invite that sets a new password.`);
      process.exit(0);
    }
    const signIn = canonicalLoginEmail(email);
    if (!signIn) {
      console.error(`${email} is not an address a scholar can sign in with.`);
      process.exit(1);
    }
    /* Older rows may still be stored under another domain: the same local part on another scholar is a clash. */
    const local = signIn.split("@")[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const clash = await credentials.findOne(
      { login_email: { $regex: `^${local}@`, $options: "i" }, profile_id: { $ne: profileId }, scholar_id: { $ne: profileId } },
      { projection: { login_email: 1 } },
    );
    if (clash) {
      console.error(`${email} would sign in as ${signIn}, but another scholar's account already uses "${signIn.split("@")[0]}@" (${clash.login_email}). Use a different email.`);
      process.exit(1);
    }
    console.log(`\nInviting ${nameOf(scholar)} (${profileId}) to sign in as ${email} (stored as ${signIn}).`);
  } finally {
    await client.close();
  }

  /* 3. The service secret, never printed. */
  const token =
    process.env.INVITE_SERVICE_TOKEN ||
    execSync("gcloud secrets versions access latest --secret=scholar-api-service-token --project ngo-application-services", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "inherit"],
    }).trim();

  /* 4. The invitation. */
  const res = await fetch(`${API}/api/internal/invites`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-service-token": token, "x-service-name": "admin-invite-script" },
    body: JSON.stringify({ profileId, email, issuedBy }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error(`The studio API refused (${res.status}): ${body.error || body.message || JSON.stringify(body)}`);
    process.exit(1);
  }
  console.log(`\nInvitation for ${body.scholarName || nameOf(scholar)}, valid until ${new Date(body.expiresAt).toLocaleString()}.`);
  console.log(`Claim link (shown once): ${SITE}${body.claimPath}`);
  console.log("Open it and choose a password (12+ characters, upper and lower case, a number, a symbol), then sign in at");
  console.log(`${SITE}/login with ${email}.`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
