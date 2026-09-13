const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function getNumberEnv(name, fallback) {
  const rawValue = process.env[name];

  if (!rawValue) {
    return fallback;
  }

  const parsedValue = Number(rawValue);

  if (Number.isNaN(parsedValue)) {
    throw new Error(`${name} must be a valid number.`);
  }

  return parsedValue;
}

const corsOrigins = (process.env.CORS_ORIGIN || "http://localhost:3000")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

const authLinkableCollections = (process.env.AUTH_LINKABLE_COLLECTIONS || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

const env = {
  nodeEnv: process.env.NODE_ENV || "development",
  isProduction: process.env.NODE_ENV === "production",
  port: getNumberEnv("PORT", 4000),
  corsOrigins,
  mongodbUri: process.env.MONGODB_URI,
  mongodbDb: process.env.MONGODB_DB,
  /* The shared secret our own services present to issue invitations. Absent
     means invitation issuing is DISABLED, not open — see invite.routes.js. */
  serviceToken: process.env.SERVICE_TOKEN || null,
  authCookieName: process.env.AUTH_COOKIE_NAME || "sd_session",
  /* Unset in development. At deploy, the shared parent domain — e.g.
     ".archivyn.example" — so sibling subdomains share one scholar session. */
  authCookieDomain: process.env.AUTH_COOKIE_DOMAIN || null,
  authSessionTtlDays: getNumberEnv("AUTH_SESSION_TTL_DAYS", 14),
  authLockoutAttempts: getNumberEnv("AUTH_LOCKOUT_ATTEMPTS", 5),
  authLockoutMinutes: getNumberEnv("AUTH_LOCKOUT_MINUTES", 15),
  authPasswordHistoryLimit: getNumberEnv("AUTH_PASSWORD_HISTORY_LIMIT", 5),
  authLinkableCollections,
  gcpProjectId:
    process.env.GCP_PROJECT_ID ||
    process.env.GOOGLE_CLOUD_PROJECT ||
    process.env.GCLOUD_PROJECT ||
    null,
  gcpEditorialImagesBucket:
    process.env.GCP_EDITORIAL_IMAGES_BUCKET ||
    process.env.GCS_EDITORIAL_IMAGES_BUCKET ||
    "editorial-images",
  gcpServiceAccountJson: process.env.GCP_SERVICE_ACCOUNT_JSON || null,
  gcpServiceAccountKeyFile:
    process.env.GCP_SERVICE_ACCOUNT_KEY_FILE ||
    process.env.GOOGLE_APPLICATION_CREDENTIALS ||
    null,
  /* "Draft from my research". Same variable names every other generating
     service on the platform reads, so one deployment config serves all of
     them. Nothing here is required: unset means the drafter reports itself
     as unavailable, never that the portal fails to boot. */
  llm: {
    provider: (process.env.LLM_PROVIDER || "vertex").trim().toLowerCase(),
    model:
      process.env.STORY_LLM_MODEL ||
      process.env.LLM_MODEL ||
      "gemini-2.5-flash",
    project:
      process.env.GCP_PROJECT_ID ||
      process.env.VERTEX_PROJECT_ID ||
      process.env.GOOGLE_CLOUD_PROJECT ||
      null,
    location: process.env.GCP_LOCATION || process.env.VERTEX_LOCATION || "us-central1",
  },
  /* Illustrations on request, through Vertex Imagen. Off by default until a
     deployment turns it on; the agent then refuses add_image with a reason. */
  images: {
    enabled: String(process.env.DRAFTING_IMAGES ?? "false").toLowerCase() === "true",
    model: process.env.IMAGE_MODEL || "imagen-3.0-generate-002",
  },
  /* The evidence ledger: a signed manifest of every claim behind a published
     story. LEDGER_SIGNING_KEY is an Ed25519 private key as a PKCS8 PEM, or
     that PEM base64-encoded onto one line. Absent outside production, one key
     is generated per process so local runs and tests still sign. Absent in
     production, manifests go out marked unsigned and the boot log says so. */
  ledger: {
    privateKey: process.env.LEDGER_SIGNING_KEY || null,
    keyId: process.env.LEDGER_KEY_ID || null,
  },
  /* Watching the scientific record: retractions and corrections of the
     papers behind published stories. `sweepToken` guards the endpoint a
     scheduler calls; absent means the sweep is disabled, not open. */
  record: {
    enabled: String(process.env.RECORD_CHECKS ?? "true").toLowerCase() !== "false",
    sweepToken: process.env.RECORD_SWEEP_TOKEN || null,
    crossrefMailto: process.env.CROSSREF_MAILTO || null,
  },
  /* The drafting job queue. `enabled` is the kill switch; `worker` lets a
     deployment serve the API without running the queue (a second replica, or
     a local dev instance pointed at shared data). */
  drafting: {
    enabled: String(process.env.DRAFTING_ENABLED ?? "true").toLowerCase() !== "false",
    worker: String(process.env.DRAFTING_WORKER ?? "true").toLowerCase() !== "false",
    dailyCap: getNumberEnv("DRAFT_DAILY_CAP", 10),
    pollMs: getNumberEnv("DRAFTING_POLL_MS", 2000),
    /* Staged rollout: "pilot" opens the drafter to DRAFTING_PILOT_PROFILES
       only; "all" (the default) to every eligible scholar. See lib/rollout.js. */
    rollout: (process.env.DRAFTING_ROLLOUT || "all").trim().toLowerCase(),
    pilotProfiles: (process.env.DRAFTING_PILOT_PROFILES || "")
      .split(/[,\s]+/)
      .map((v) => v.trim())
      .filter(Boolean),
  },
};

if (!env.mongodbUri) {
  throw new Error("MONGODB_URI is required.");
}

if (!env.mongodbDb) {
  throw new Error("MONGODB_DB is required.");
}

env.authSessionTtlMs = env.authSessionTtlDays * ONE_DAY_MS;

module.exports = {
  env,
};
