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
  authCookieName: process.env.AUTH_COOKIE_NAME || "sd_session",
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
