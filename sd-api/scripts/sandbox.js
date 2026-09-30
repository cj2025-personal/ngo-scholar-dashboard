#!/usr/bin/env node
/**
 * A local sandbox: the whole API on a throwaway database, with one scholar
 * you can sign in as.
 *
 *   npm run sandbox            # real model, from the same variables the API reads
 *   npm run sandbox -- --fake  # the fake model: no credentials, no cost
 *
 * ── What it is for ──────────────────────────────────────────────────────────
 * Checking the agents by hand. Production credentials are argon2 hashes and
 * cannot be read back, and nobody should be resetting a real scholar's
 * password to try a feature. So this starts an in-memory MongoDB, seeds the
 * same scholar, papers and session the test suites use, sets that scholar a
 * known password, and runs the real API against it on port 4100. Start the
 * UI with `npm run dev` in sd-ui and sign in with what is printed.
 *
 * ── What it touches ─────────────────────────────────────────────────────────
 * Nothing that lasts. The database lives in this process and is gone when
 * it exits. MONGODB_URI and MONGODB_DB from .env are ignored; the model
 * variables are read as usual, so drafting and the companion use the real
 * model unless --fake is given. Refuses to run in production. Listens on
 * 4100, where sd-ui/.env points, unless SANDBOX_PORT says otherwise.
 */

require("dotenv").config();

const path = require("path");
const { spawn } = require("child_process");

const API_DIR = path.resolve(__dirname, "..");
const PASSWORD = "sandbox-reader-2026";

async function main() {
  if (process.env.NODE_ENV === "production") {
    console.error("The sandbox is for a developer's machine, not a deployment.");
    process.exit(2);
  }
  const fake = process.argv.includes("--fake");
  /* 4100, which is where sd-ui/.env expects the API on this machine. */
  const port = Number(process.env.SANDBOX_PORT || 4100);
  const uiOrigin = process.env.SANDBOX_UI_ORIGIN || "http://localhost:3000";

  const { MongoMemoryServer } = require("mongodb-memory-server");
  const { MongoClient } = require("mongodb");
  const { seedScholar, EMAIL } = require(path.join(API_DIR, "tests-e2e", "seed.js"));
  const { hashPassword } = require(path.join(API_DIR, "src", "lib", "passwords.js"));

  const mongod = await MongoMemoryServer.create();
  const client = await MongoClient.connect(mongod.getUri());
  const db = client.db("sd_sandbox");
  await seedScholar(db);
  /* The seed's credential has a placeholder hash. Give it one that a real
     sign-in verifies, so the login page works like the deployed one. */
  await db.collection("scholar_credentials").updateOne({ login_email: EMAIL }, { $set: { password_hash: await hashPassword(PASSWORD), must_change_password: false } });
  await client.close();

  const inherited = { ...process.env };
  delete inherited.NODE_TEST_CONTEXT;
  delete inherited.NODE_OPTIONS;
  const child = spawn(process.execPath, ["src/index.js"], {
    cwd: API_DIR,
    env: {
      ...inherited,
      NODE_ENV: "development",
      PORT: String(port),
      MONGODB_URI: mongod.getUri(),
      MONGODB_DB: "sd_sandbox",
      ...(fake ? { LLM_PROVIDER: "fake" } : {}),
      CORS_ORIGIN: uiOrigin,
      AUTH_COOKIE_SAMESITE: "lax",
      AUTH_COOKIE_DOMAIN: "",
      READER_COOKIE_SECRET: "sandbox",
      DRAFTING_POLL_MS: "500",
    },
    stdio: "inherit",
  });

  const stop = async () => {
    if (child.exitCode === null) child.kill();
    await mongod.stop();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  child.on("exit", async (code) => { await mongod.stop(); process.exit(code || 0); });

  console.log("");
  console.log("=".repeat(70));
  console.log("SANDBOX · in-memory database · " + (fake ? "fake model" : `model ${process.env.STORY_LLM_MODEL || process.env.LLM_MODEL || "gemini-2.5-flash"}`));
  console.log(`  API      http://localhost:${port}`);
  console.log(`  UI       start it in sd-ui with: npm run dev   (sd-ui/.env must point NEXT_PUBLIC_AUTH_API_URL at http://localhost:${port})`);
  console.log(`  Sign in  ${uiOrigin}/login`);
  console.log(`           email     ${EMAIL}`);
  console.log(`           password  ${PASSWORD}`);
  console.log("  Papers   four seeded papers to draft from; publish a story to try the reading companion on it");
  console.log("  Ctrl+C stops everything and forgets it all.");
  console.log("=".repeat(70));
  console.log("");
}

main().catch((error) => {
  console.error(error);
  process.exit(2);
});
