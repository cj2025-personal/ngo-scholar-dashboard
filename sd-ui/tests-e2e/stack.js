/**
 * The stack behind the browser suite: an in-memory MongoDB, the seeded
 * scholar, and the real sd-api process with the fake model.
 *
 * Started once in Playwright's global setup and torn down in global
 * teardown. State that the spec needs (the session token, the API url) is
 * written to a file, because setup and specs run in different processes.
 * Everything here comes from the sibling API checkout; nothing is stubbed.
 */

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const API_DIR = path.resolve(__dirname, "..", "..", "sd-api");
const STATE_FILE = path.join(__dirname, ".state.json");
const API_PORT = Number(process.env.E2E_API_PORT || 4103);
const DB_NAME = "sd_ui_e2e";

const fromApi = (mod) => require(require.resolve(mod, { paths: [API_DIR] }));

async function waitForHealth(url, child, log, attempts = 150) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const r = await fetch(`${url}/health`);
      if (r.status === 200) return;
    } catch { /* not yet */ }
    if (child.exitCode !== null) throw new Error(`sd-api exited early:\n${log()}`);
    await new Promise((r) => setTimeout(r, 100));
  }
  child.kill();
  throw new Error(`sd-api did not come up:\n${log()}`);
}

async function start() {
  const { MongoMemoryServer } = fromApi("mongodb-memory-server");
  const { MongoClient } = fromApi("mongodb");
  const { seedScholar } = require(path.join(API_DIR, "tests-e2e", "seed.js"));

  const mongod = await MongoMemoryServer.create();
  const client = await MongoClient.connect(mongod.getUri());
  const tokens = await seedScholar(client.db(DB_NAME));
  await client.close();

  const inherited = { ...process.env };
  delete inherited.NODE_TEST_CONTEXT;
  delete inherited.NODE_OPTIONS;
  const child = spawn(process.execPath, ["src/index.js"], {
    cwd: API_DIR,
    env: {
      ...inherited,
      NODE_ENV: "test",
      PORT: String(API_PORT),
      MONGODB_URI: mongod.getUri(),
      MONGODB_DB: DB_NAME,
      LLM_PROVIDER: "fake",
      DRAFTING_POLL_MS: "150",
      DRAFT_DAILY_CAP: "10",
      CORS_ORIGIN: `http://localhost:${process.env.E2E_UI_PORT || 3103},http://127.0.0.1:${process.env.E2E_UI_PORT || 3103}`,
      GCP_PROJECT_ID: "",
      GCP_SERVICE_ACCOUNT_JSON: "",
      GCP_SERVICE_ACCOUNT_KEY_FILE: "",
      GOOGLE_APPLICATION_CREDENTIALS: "",
      LANGSMITH_API_KEY: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
    detached: false,
  });
  let log = "";
  child.stdout.on("data", (d) => { log += d; });
  child.stderr.on("data", (d) => { log += d; });
  const apiUrl = `http://localhost:${API_PORT}`;
  await waitForHealth(apiUrl, child, () => log);

  fs.writeFileSync(STATE_FILE, JSON.stringify({ apiUrl, token: tokens.token, apiPid: child.pid, mongoUri: mongod.getUri() }, null, 2));
  /* Keep handles on the setup process so teardown can stop them. */
  globalThis.__e2eStack = { mongod, child };
  return { apiUrl, token: tokens.token };
}

async function stop() {
  const stack = globalThis.__e2eStack;
  if (stack?.child && stack.child.exitCode === null) stack.child.kill();
  if (stack?.mongod) await stack.mongod.stop();
  if (!stack && fs.existsSync(STATE_FILE)) {
    /* Setup and teardown ran in different processes: fall back to the pid. */
    try {
      const { apiPid } = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
      if (apiPid) process.kill(apiPid);
    } catch { /* already gone */ }
  }
  if (fs.existsSync(STATE_FILE)) fs.unlinkSync(STATE_FILE);
}

function readState() {
  return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
}

module.exports = { start, stop, readState, STATE_FILE, API_PORT };
