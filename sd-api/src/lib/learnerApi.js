"use strict";

/**
 * Calls to the learner app's API (user-dashboard-api) through its studio
 * door (/internal/studio, its lib/studioCaller): what a scholar sees and
 * decides there about their own stories.
 *
 * In production this service proves itself with a Google ID token for its own
 * Cloud Run account, minted by the metadata server for the learner API's
 * address; the learner API accepts only the accounts it lists. Outside
 * production, with LEARNER_API_STUDIO_TOKEN instead. Either way the scholar
 * is named in x-scholar-profile, and only after this service has checked the
 * scholar owns what is asked about.
 */
const { env } = require("../config/env");
const { ApiError } = require("./api-error");

const METADATA_IDENTITY_URL =
  "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity";
const TIMEOUT_MS = 10_000;

let cachedToken = null;

/** An ID token for the learner API, cached until a minute before it lapses. */
async function identityToken(fetcher = fetch) {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) return cachedToken.token;
  const res = await fetcher(`${METADATA_IDENTITY_URL}?audience=${encodeURIComponent(env.learnerApiUrl)}`, {
    headers: { "Metadata-Flavor": "Google" },
    signal: AbortSignal.timeout(3_000),
  });
  if (!res.ok) throw new Error(`metadata server answered ${res.status}`);
  const token = (await res.text()).trim();
  /* Google ID tokens last an hour. */
  cachedToken = { token, expiresAt: Date.now() + 55 * 60_000 };
  return token;
}

async function authHeaders(fetcher) {
  if (env.isProduction) return { Authorization: `Bearer ${await identityToken(fetcher)}` };
  if (env.learnerApiStudioToken) return { "x-studio-token": env.learnerApiStudioToken };
  return {};
}

/**
 * One call. Returns the parsed body; a 404 from the learner API is passed on
 * as 404, anything else it refuses or fails as 502 (it failed, not the
 * scholar's request), and an unset address as 503.
 */
async function callLearnerApi(method, path, { profileId, body = null, fetcher = fetch } = {}) {
  if (!env.learnerApiUrl) throw new ApiError(503, "The learner app is not connected on this deployment (LEARNER_API_URL unset).");
  let res;
  try {
    res = await fetcher(`${env.learnerApiUrl}/internal/studio${path}`, {
      method,
      headers: {
        Accept: "application/json",
        ...(body ? { "Content-Type": "application/json" } : {}),
        "x-scholar-profile": String(profileId),
        ...(await authHeaders(fetcher)),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    throw new ApiError(502, `The learner app did not answer (${error.name || "error"}).`);
  }
  const payload = await res.json().catch(() => ({}));
  if (res.status === 404) throw new ApiError(404, payload.message || "Not found.");
  if (!res.ok) throw new ApiError(502, `The learner app refused (${res.status}${payload.code ? ` ${payload.code}` : ""}).`);
  return payload;
}

module.exports = { callLearnerApi, _resetLearnerApiToken: () => { cachedToken = null; } };
