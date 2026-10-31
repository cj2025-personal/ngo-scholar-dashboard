/**
 * The evals reach the model without a key, or fail saying why.
 *
 * What must hold: with no key named, the Google client is built from
 * Application Default Credentials and nothing overrides them; the credential
 * file CI's auth step writes for workload identity federation is read on that
 * path and yields a token; the preflight fails — never passes, never skips —
 * without a project, with only the fake model, or without a token; and the CI
 * job that runs the evals authenticates that way and has no step that exits
 * 0 without running them.
 *
 * Nothing here leaves the machine: the identity provider, the token exchange
 * and the impersonation endpoint are local stand-ins, and no model is called.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

/* This file's own process: a configured Vertex deployment with no key. */
process.env.MONGODB_URI ||= "mongodb://localhost:27017/eval-credentials-test";
process.env.MONGODB_DB ||= "eval-credentials-test";
process.env.LLM_PROVIDER = "vertex";
process.env.GCP_PROJECT_ID = "test-project";
process.env.STORY_LLM_MODEL = "gemini-2.5-flash";
process.env.GCP_SERVICE_ACCOUNT_JSON = "";
process.env.GCP_SERVICE_ACCOUNT_KEY_FILE = "";
process.env.GOOGLE_APPLICATION_CREDENTIALS = "";
/* So the client never asks gcloud or a metadata server which project it is in. */
process.env.GOOGLE_CLOUD_PROJECT = "test-project";
delete process.env.VERTEX_ACCESS_TOKEN;

const { GoogleAuth } = require("google-auth-library");
const vertex = require("../src/lib/vertex");

const SCOPES = ["https://www.googleapis.com/auth/cloud-platform"];
const SA = "github-deployer@ngo-application-services.iam.gserviceaccount.com";
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "sd-eval-creds-"));
test.after(() => fs.rmSync(scratch, { recursive: true, force: true }));

/**
 * The file google-github-actions/auth@v2 writes for workload identity
 * federation, pointed at local stand-ins: where GitHub's OIDC token comes
 * from, Google's token exchange, and the impersonation endpoint.
 */
function workloadIdentityFile(base, name = "gha-creds-test.json") {
  const file = path.join(scratch, name);
  fs.writeFileSync(file, JSON.stringify({
    type: "external_account",
    audience: "//iam.googleapis.com/projects/77137640226/locations/global/workloadIdentityPools/github-pool/providers/github-provider",
    subject_token_type: "urn:ietf:params:oauth:token-type:jwt",
    token_url: `${base}/sts`,
    service_account_impersonation_url: `${base}/iam/${SA}:generateAccessToken`,
    credential_source: {
      url: `${base}/oidc?audience=github-pool`,
      headers: { Authorization: "Bearer actions-request-token" },
      format: { type: "json", subject_token_field_name: "value" },
    },
  }));
  return file;
}

/** The three endpoints the keyless exchange calls, answering as Google and GitHub do. */
async function standIns({ refuseOidc = false } = {}) {
  const seen = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      seen.push({ method: req.method, url: req.url, auth: req.headers.authorization || null, body });
      res.setHeader("Content-Type", "application/json");
      if (req.url.startsWith("/oidc")) {
        if (refuseOidc) { res.statusCode = 403; return res.end(JSON.stringify({ message: "id-token permission is not granted" })); }
        return res.end(JSON.stringify({ value: "github-oidc-jwt" }));
      }
      if (req.url === "/sts") return res.end(JSON.stringify({ access_token: "federated-token", issued_token_type: "urn:ietf:params:oauth:token-type:access_token", token_type: "Bearer", expires_in: 3600 }));
      if (req.url.startsWith("/iam/")) return res.end(JSON.stringify({ accessToken: "ya29.impersonated", expireTime: new Date(Date.now() + 3_600_000).toISOString() }));
      res.statusCode = 404;
      return res.end("{}");
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { base: `http://127.0.0.1:${server.address().port}`, seen, close: () => new Promise((r) => server.close(r)) };
}

/** The preflight as CI runs it, from a directory with no .env to read. */
function preflight(env) {
  const inherited = { ...process.env };
  delete inherited.NODE_TEST_CONTEXT;
  delete inherited.NODE_OPTIONS;
  const cwd = fs.mkdtempSync(path.join(scratch, "run-"));
  const child = spawn(process.execPath, [path.join(__dirname, "..", "scripts", "evalPreflight.js")], {
    cwd,
    env: {
      ...inherited,
      GITHUB_ACTIONS: "true",
      LLM_PROVIDER: "vertex",
      GCP_PROJECT_ID: "test-project",
      VERTEX_PROJECT_ID: "",
      GOOGLE_CLOUD_PROJECT: "",
      STORY_LLM_MODEL: "gemini-2.5-flash",
      GCP_SERVICE_ACCOUNT_JSON: "",
      GCP_SERVICE_ACCOUNT_KEY_FILE: "",
      GOOGLE_APPLICATION_CREDENTIALS: "",
      VERTEX_ACCESS_TOKEN: "",
      ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let out = "";
  child.stdout.on("data", (d) => { out += d; });
  child.stderr.on("data", (d) => { out += d; });
  return new Promise((resolve) => child.on("close", (code) => resolve({ code, out })));
}

test("with no key named, the client is built from Application Default Credentials alone", () => {
  assert.deepEqual(vertex.authOptions(), { scopes: SCOPES }, "the variables blanked, as CI and the memo for live evals say");
  assert.deepEqual(vertex.authOptions({ gcpServiceAccountJson: null, gcpServiceAccountKeyFile: null }), { scopes: SCOPES });
});

test("a key, when one is named, is still the one used", () => {
  assert.deepEqual(vertex.authOptions({ gcpServiceAccountJson: '{"type":"service_account"}' }).credentials, { type: "service_account" });
  const file = path.join(scratch, "key.json");
  fs.writeFileSync(file, "{}");
  assert.equal(vertex.authOptions({ gcpServiceAccountKeyFile: file }).keyFilename, file);
});

test("the workload-identity file CI's auth step writes is read, whichever way the variable reaches the client", async () => {
  const file = workloadIdentityFile("http://127.0.0.1:9");
  // Through env.js, which reads GOOGLE_APPLICATION_CREDENTIALS as the file to use.
  const viaEnv = await new GoogleAuth(vertex.authOptions({ gcpServiceAccountKeyFile: file })).getClient();
  assert.equal(viaEnv.constructor.name, "IdentityPoolClient");
  // Through the library's own Application Default Credentials lookup.
  process.env.GOOGLE_APPLICATION_CREDENTIALS = file;
  try {
    const viaAdc = await new GoogleAuth(vertex.authOptions({})).getClient();
    assert.equal(viaAdc.constructor.name, "IdentityPoolClient");
  } finally {
    process.env.GOOGLE_APPLICATION_CREDENTIALS = "";
  }
});

test("the access check: a token is a pass; no token, no project or the fake is a failure", async () => {
  const ok = await vertex.checkAccess({ client: async () => new (class IdentityPoolClient {})(), token: async () => "t" });
  assert.equal(ok.ok, true);
  assert.equal(ok.credentials, "IdentityPoolClient");
  assert.match(ok.model, /projects\/test-project\/locations\/.+\/models\/gemini-2\.5-flash$/);

  const refused = await vertex.checkAccess({ client: async () => new (class IdentityPoolClient {})(), token: async () => { throw new Error("Permission 'iam.serviceAccounts.getAccessToken' denied"); } });
  assert.equal(refused.ok, false);
  assert.match(refused.problem, /no usable Google credentials .*getAccessToken' denied/);

  const none = await vertex.checkAccess({ client: async () => { throw new Error("Could not load the default credentials."); } });
  assert.equal(none.ok, false);
  assert.match(none.problem, /Could not load the default credentials/);
});

test("the preflight, as CI runs it, gets a token through the whole keyless exchange", async () => {
  const google = await standIns();
  try {
    const { code, out } = await preflight({ GOOGLE_APPLICATION_CREDENTIALS: workloadIdentityFile(google.base, "gha-creds-ok.json") });
    assert.equal(code, 0, out);
    assert.match(out, /credentials\s+IdentityPoolClient: an access token was issued/);
    assert.match(out, /model\s+projects\/test-project\/locations\/us-central1\/publishers\/google\/models\/gemini-2\.5-flash/);
    const [oidc, sts, iam] = google.seen;
    assert.equal(oidc.auth, "Bearer actions-request-token", "GitHub's OIDC token was asked for with the runner's request token");
    assert.match(sts.body, /subject_token=github-oidc-jwt/, "and exchanged with Google");
    assert.equal(iam.auth, "Bearer federated-token", "and the federated token impersonated the service account");
    assert.ok(iam.url.includes(SA));
  } finally {
    await google.close();
  }
});

test("the preflight fails, never skips, when the token cannot be had", async () => {
  const google = await standIns({ refuseOidc: true });
  try {
    const { code, out } = await preflight({ GOOGLE_APPLICATION_CREDENTIALS: workloadIdentityFile(google.base, "gha-creds-refused.json") });
    assert.equal(code, 1, out);
    assert.match(out, /::error::The evals cannot reach the model: no usable Google credentials/);
    assert.match(out, /\[client: IdentityPoolClient\]/);
    assert.equal(google.seen.filter((r) => r.url === "/sts").length, 0, "nothing was exchanged");
  } finally {
    await google.close();
  }
});

test("the preflight fails without a project, and against the fake model", async () => {
  const unconfigured = await preflight({ GCP_PROJECT_ID: "" });
  assert.equal(unconfigured.code, 1, unconfigured.out);
  assert.match(unconfigured.out, /::error::The evals cannot reach the model: GCP_PROJECT_ID is not set/);
  const fake = await preflight({ LLM_PROVIDER: "fake" });
  assert.equal(fake.code, 1, fake.out);
  assert.match(fake.out, /the evals would measure the test double/);
});

// ── The CI job itself ──────────────────────────────────────────────────────

const WORKFLOW = path.join(__dirname, "..", "..", ".github", "workflows", "sd-api.yml");

/** The `evals:` job's lines, from its key to the next job or the end. */
function evalsJob() {
  const lines = fs.readFileSync(WORKFLOW, "utf8").split(/\r?\n/);
  const start = lines.indexOf("  evals:");
  assert.ok(start >= 0, "sd-api.yml has an evals job");
  const end = lines.findIndex((l, i) => i > start && /^ {2}[A-Za-z][\w-]*:\s*$/.test(l));
  return lines.slice(start, end === -1 ? lines.length : end).filter((l) => !/^\s*#/.test(l)).join("\n");
}

test("the CI evals job authenticates without a key and cannot skip itself", () => {
  const job = evalsJob();
  assert.match(job, /id-token:\s*write/, "the job may ask GitHub for an OIDC token");
  assert.match(job, /uses:\s*google-github-actions\/auth@v2/);
  assert.match(job, /workload_identity_provider:/);
  assert.match(job, /service_account:/);
  assert.doesNotMatch(job, /credentials_json|GCP_SA_KEY|secrets\.GCP_SERVICE_ACCOUNT_JSON/, "no stored key");
  assert.doesNotMatch(job, /exit 0/, "no step ends early as a pass");
  assert.doesNotMatch(job, /continue-on-error:\s*true/, "no step's failure is ignored");
  const at = (needle) => job.indexOf(needle);
  assert.ok(at("npm run eval:preflight") > at("google-github-actions/auth@v2"), "the preflight runs after the auth step");
  for (const suite of ["drafts", "reader", "converse", "voice", "review", "edit", "guard"]) {
    assert.ok(at(`npm run eval:${suite}`) > at("npm run eval:preflight"), `eval:${suite} runs, after the preflight`);
  }
});
