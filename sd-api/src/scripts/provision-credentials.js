#!/usr/bin/env node
/**
 * Provision scholar login credentials mapped to existing scholar ids.
 *
 * Credentials are generated out-of-band here and distributed to scholars
 * separately. Each credential is mapped to a scholar's unique id (the UUID that
 * is both `_id` and `profile_id` in the `scholars` collection). A strong
 * one-time password is generated and printed once; scholars are required to
 * change it on first login (must_change_password).
 *
 * Usage (run from the sd-api folder):
 *   node src/scripts/provision-credentials.js --id <scholarUuid> [--email a@b] [--force]
 *   node src/scripts/provision-credentials.js --ids id1,id2,id3
 *   node src/scripts/provision-credentials.js --file scholar-ids.txt      (one id per line)
 *   node src/scripts/provision-credentials.js --all [--limit 50]          (--limit 0 = no cap)
 *
 * Options:
 *   --email <addr>        Override the generated login email (single-id only).
 *   --password <pw>       Set an explicit password (must meet policy); else generated.
 *   --communities a,b     Seed the future community layer (stored on the credential).
 *   --force               Reset an existing credential (rotates password, kills sessions).
 *   --no-must-change      Do not force a password change on first login.
 *   --csv                 Output as CSV.
 *   --json                Output as JSON.
 */
require("dotenv").config();

const fs = require("fs");

const { connectToMongo, getDb } = require("../db/mongo");
const { provisionCredentialForScholar } = require("../services/credential.service");

function parseArgs(argv) {
  const args = { flags: new Set(), values: {} };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) {
      args.flags.add(key);
    } else {
      args.values[key] = next;
      i += 1;
    }
  }
  return args;
}

async function resolveTargetIds(args) {
  if (args.values.id) return [args.values.id.trim()];
  if (args.values.ids) return args.values.ids.split(",").map((s) => s.trim()).filter(Boolean);
  if (args.values.file) {
    return fs
      .readFileSync(args.values.file, "utf8")
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter((s) => s && !s.startsWith("#"));
  }
  if (args.flags.has("all")) {
    const db = await getDb();
    const cap = args.values.limit !== undefined ? Number(args.values.limit) : 50;
    const cursor = db.collection("scholars").find({}, { projection: { _id: 1 } });
    if (cap > 0) cursor.limit(cap);
    const docs = await cursor.toArray();
    return docs.map((d) => String(d._id));
  }
  return [];
}

function printTable(rows) {
  const cols = ["status", "scholar", "name", "login_email", "temp_password"];
  const widths = cols.map((c) =>
    Math.max(c.length, ...rows.map((r) => String(r[c] ?? "").length)),
  );
  const line = (r) => cols.map((c, i) => String(r[c] ?? "").padEnd(widths[i])).join("  ");
  console.log(line(Object.fromEntries(cols.map((c) => [c, c.toUpperCase()]))));
  console.log(widths.map((w) => "-".repeat(w)).join("  "));
  rows.forEach((r) => console.log(line(r)));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await connectToMongo();

  const ids = await resolveTargetIds(args);
  if (ids.length === 0) {
    console.error(
      "No scholar ids given. Use --id / --ids / --file / --all. See the header for usage.",
    );
    process.exit(1);
  }

  const communities = args.values.communities
    ? args.values.communities.split(",").map((s) => s.trim()).filter(Boolean)
    : [];

  const rows = [];
  for (const scholarUuid of ids) {
    try {
      const result = await provisionCredentialForScholar({
        scholarUuid,
        email: ids.length === 1 ? args.values.email || null : null,
        password: args.values.password || null,
        communities,
        mustChangePassword: !args.flags.has("no-must-change"),
        force: args.flags.has("force"),
        createdBy: "provision-cli",
      });
      rows.push({
        status: result.status,
        scholar: result.scholar.id,
        name: result.scholar.name,
        login_email: result.credential.login_email,
        temp_password: result.tempPassword || (result.status === "exists" ? "(unchanged)" : "(set by you)"),
      });
    } catch (error) {
      rows.push({
        status: "ERROR",
        scholar: scholarUuid,
        name: "",
        login_email: "",
        temp_password: error.message,
      });
    }
  }

  if (args.flags.has("json")) {
    console.log(JSON.stringify(rows, null, 2));
  } else if (args.flags.has("csv")) {
    console.log("status,scholar_id,name,login_email,temp_password");
    rows.forEach((r) =>
      console.log(
        [r.status, r.scholar, `"${r.name}"`, r.login_email, r.temp_password]
          .join(","),
      ),
    );
  } else {
    printTable(rows);
    console.log(
      `\n${rows.length} processed. Temp passwords are shown ONCE — distribute them securely; scholars must change on first login.`,
    );
  }

  process.exit(0);
}

main().catch((error) => {
  console.error("Provisioning failed:", error.message);
  process.exit(1);
});
