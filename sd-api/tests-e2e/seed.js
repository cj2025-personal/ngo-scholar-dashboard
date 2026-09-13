/**
 * The scholar the end-to-end suites are about.
 *
 * Shared by the API suite (tests-e2e/drafting.e2e.test.js) and the browser
 * suite in sd-ui, so both talk about the same person, papers and session:
 * one Legacy scholar with a credential and a live session, a second identity
 * that is a machine by name, three licensed papers and one quotable-only
 * source. Seeds a database handle; opens nothing.
 */

const crypto = require("crypto");

const PROFILE_ID = "e2e-profile-0001";
const EMAIL = "e2e.scholar@example.edu";
const SYSTEM_PROFILE = "e2e-system-0002";
const SYSTEM_EMAIL = "system-legend-conversation-regeneration";

const PAPER = [
  "Adaptive antenna arrays reduce interference by steering nulls toward unwanted sources. The method updates weights with a least-mean-squares rule every two milliseconds, which is fast enough for fixed interferers. Four patch elements were spaced at half a wavelength.",
  "In field trials the array improved the signal-to-noise ratio by eleven decibels with one interferer and by seven with two. The desired signal arrived at broadside in every trial, which is the easiest case for the array. Convergence took between forty and three hundred updates.",
  "The authors note that performance degrades when more than four interferers are present, because the array has only three degrees of freedom left once one is spent on the desired direction. In seventeen of forty trials the array reduced desired-signal gain by more than two decibels.",
  "All trials were run in an anechoic chamber. Multipath in a real building would present many more apparent sources, so the degradation is expected to appear at lower interferer counts outdoors. The array was not tested with moving interferers.",
  "Future work should test a six- or eight-element array under multipath and with moving sources. A larger step size converged faster but oscillated in the two-interferer geometry.",
  "The weight update runs on a small digital signal processor mounted behind the array. Each update reads four complex samples, forms the error against a reference tone, and adjusts the weights by a fraction of that error. The processor spends most of its time waiting for samples, so a faster update rate is possible if the geometry demands it.",
  "Power consumption was measured at 1.8 watts for the processor and 0.6 watts for the four low-noise amplifiers. That is within the budget of a battery-powered sensor node for about nine hours, which the authors consider adequate for the field trials described but not for a permanent installation.",
  "Two of the forty trials in the four-interferer geometry were repeated after a cable fault was found. The repeated trials produced results within one decibel of the originals, and the originals were kept in the analysis.",
].join("\n\n");

const sha = (t) => crypto.createHash("sha256").update(t).digest("hex");

/**
 * @param {import("mongodb").Db} target
 * @returns {Promise<{token: string, systemToken: string}>}  session tokens, ready for the cookie
 */
async function seedScholar(target) {
  const now = new Date();
  await target.collection("scholars").insertMany([
    { _id: PROFILE_ID, profile_id: PROFILE_ID, status: "legacy", name: { display: "Test Scholar", full: "Test Scholar" }, about: { current_position: "Professor", institution: "Example University", avatar_initial: "T" } },
    { _id: SYSTEM_PROFILE, profile_id: SYSTEM_PROFILE, status: "legacy", name: { display: "System Actor" } },
  ]);
  await target.collection("scholar_credentials").insertMany([
    { scholar_id: PROFILE_ID, profile_id: PROFILE_ID, login_email: EMAIL, is_active: true, session_version: 0, password_hash: "x" },
    { scholar_id: SYSTEM_PROFILE, profile_id: SYSTEM_PROFILE, login_email: SYSTEM_EMAIL, is_active: true, session_version: 0, password_hash: "x" },
  ]);
  const token = crypto.randomBytes(48).toString("base64url");
  const systemToken = crypto.randomBytes(48).toString("base64url");
  const expires = new Date(now.getTime() + 3600_000);
  await target.collection("scholar_sessions").insertMany([
    { scholar_id: PROFILE_ID, profile_id: PROFILE_ID, login_email: EMAIL, session_version: 0, token_hash: sha(token), created_at: now, last_seen_at: now, expires_at: expires },
    { scholar_id: SYSTEM_PROFILE, profile_id: SYSTEM_PROFILE, login_email: SYSTEM_EMAIL, session_version: 0, token_hash: sha(systemToken), created_at: now, last_seen_at: now, expires_at: expires },
  ]);
  /* Papers as the open-access fetch would store them. `word_count` is what
     the inventory reads; `text` is what the drafter reads. */
  const paper = (id, title, words, extra = {}) => ({
    source_id: id, scholar_slug: "test-scholar", source_url: `https://doi.org/10.1000/${id}`, resolved_url: `https://pmc.example/${id}`, host: "pmc.example",
    license_type: "cc_by", allowed_use: "full_text", title, text: PAPER, word_count: words, extractor: "pmc_jats", mentions_scholar: true, fetched_at: now, ...extra,
  });
  await target.collection("source_texts").insertMany([
    paper("src-e2e-1", "Adaptive nulling in small antenna arrays", 6200),
    paper("src-e2e-2", "Second paper", 4100),
    paper("src-e2e-3", "Third paper", 3900),
    paper("src-e2e-q", "Quotable only", 900, { source_url: "https://example.org/q", resolved_url: "https://example.org/q", host: "example.org", license_type: "fair_use_short_quote", allowed_use: "short_quotes", extractor: "html_strip" }),
  ]);
  return { token, systemToken };
}

module.exports = { PROFILE_ID, EMAIL, SYSTEM_PROFILE, SYSTEM_EMAIL, PAPER, seedScholar };
