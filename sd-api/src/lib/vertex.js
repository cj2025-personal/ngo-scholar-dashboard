/**
 * The one place sd-api talks to a language model.
 *
 * ── Why Vertex, and why REST ───────────────────────────────────────────────
 * Every generating service on the platform (user-dashboard-api, paris-service,
 * the Scholar Documents extractor) runs on Vertex AI Gemini under the same
 * project, and the deployment already carries `LLM_PROVIDER`, `STORY_LLM_MODEL`,
 * `GCP_PROJECT_ID` and `GCP_LOCATION`. Matching that convention means one set
 * of credentials, one quota, one bill — and a model swap is an env change made
 * once, not a code change made per service.
 *
 * REST with `google-auth-library` rather than a client SDK because that is what
 * user-dashboard-api does, and because the whole surface this service needs is
 * one `:generateContent` call. `google-auth-library` is already in the tree as
 * a dependency of `@google-cloud/storage`; it is declared directly so a future
 * storage upgrade cannot silently remove it.
 *
 * ── Thinking is off ────────────────────────────────────────────────────────
 * On Gemini 2.5 the reasoning pass is billed to `maxOutputTokens`. Left unset it
 * can consume the whole budget and return truncated JSON — user-dashboard-api
 * lost a run of Evidence Hunt generations exactly that way. Pinned to 0 here;
 * a caller that wants reasoning asks for it and sizes the budget to match.
 */

const { GoogleAuth } = require("google-auth-library");

const { env } = require("../config/env");
const { resolveKeyFilename } = require("./gcs");

let auth = null;

/**
 * The same credentials the storage client uses, resolved the same way:
 * inline JSON first, then a key file — where "file" may be the directory
 * holding exactly one key, which is how this deployment's `.env` points at
 * it. Neither set means Application Default Credentials, which is what a
 * Cloud Run service account provides.
 */
function getAuth() {
  if (!auth) {
    const options = { scopes: ["https://www.googleapis.com/auth/cloud-platform"] };
    if (env.gcpServiceAccountJson) {
      try {
        options.credentials = JSON.parse(env.gcpServiceAccountJson);
      } catch {
        throw new Error("GCP service account JSON is invalid.");
      }
    } else if (env.gcpServiceAccountKeyFile) {
      options.keyFilename = resolveKeyFilename(env.gcpServiceAccountKeyFile);
    }
    auth = new GoogleAuth(options);
  }
  return auth;
}

/** The test double, selected by LLM_PROVIDER=fake outside production. */
const isFake = () => env.llm.provider === "fake" && !env.isProduction;

/** True when this deployment can generate at all. Absent config disables the
 *  feature rather than crashing the service at boot: drafting is one perk on
 *  one panel, not something the portal needs to serve a login page. */
function isConfigured() {
  if (isFake()) return true;
  return env.llm.provider === "vertex" && Boolean(env.llm.project) && Boolean(env.llm.model);
}

function describeMissingConfig() {
  if (isFake()) return null;
  if (env.llm.provider !== "vertex") return `LLM_PROVIDER is "${env.llm.provider}"; only "vertex" is supported${env.isProduction ? "" : " (and \"fake\" for tests)"}.`;
  if (!env.llm.project) return "GCP_PROJECT_ID is not set.";
  if (!env.llm.model) return "STORY_LLM_MODEL (or LLM_MODEL) is not set.";
  return null;
}

/** A bare model id becomes a publisher resource; a full resource path passes through. */
function resolveResourceName() {
  if (isFake()) return "fake/model";
  const model = String(env.llm.model).trim().replace(/^\/+/, "");
  if (model.startsWith("projects/")) return model;
  return `projects/${env.llm.project}/locations/${env.llm.location}/publishers/google/models/${model}`;
}

function buildUrl(resourceName) {
  const location = (resourceName.match(/\/locations\/([^/]+)/) || [])[1] || env.llm.location;
  return `https://${location}-aiplatform.googleapis.com/v1/${resourceName}:generateContent`;
}

async function getAccessToken() {
  if (process.env.VERTEX_ACCESS_TOKEN) return process.env.VERTEX_ACCESS_TOKEN;
  const client = await getAuth().getClient();
  const { token } = await client.getAccessToken();
  if (!token) throw new Error("Failed to obtain a Google access token.");
  return token;
}

const RETRYABLE = new Set([408, 429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 3;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * One generation.
 *
 * @param {object} req
 * @param {string} req.prompt              the user turn
 * @param {string} [req.systemInstruction]
 * @param {object} [req.responseSchema]    Vertex OpenAPI-subset schema; implies JSON output
 * @param {number} [req.temperature]
 * @param {number} [req.maxOutputTokens]
 * @param {number} [req.timeoutMs]
 * @returns {Promise<{text: string, usage: {input: number|null, output: number|null, total: number|null}, modelVersion: string|null, resourceName: string}>}
 */
async function generateContent({
  prompt = null,
  /* A full conversation, for tool-calling loops: [{role: "user"|"model", parts: [...]}].
     When given, `prompt` is ignored. */
  contents = null,
  systemInstruction = null,
  responseSchema = null,
  /* Gemini function declarations: [{functionDeclarations: [{name, description, parameters}]}]. */
  tools = null,
  toolConfig = null,
  temperature = 0.4,
  maxOutputTokens = 4096,
  timeoutMs = 90_000,
}) {
  const missing = describeMissingConfig();
  if (missing) throw new Error(`Drafting is not configured: ${missing}`);
  if (isFake()) return require("./fakeModel").generateContent({ prompt, contents, systemInstruction, responseSchema, tools });

  const resourceName = resolveResourceName();
  const url = buildUrl(resourceName);
  const token = await getAccessToken();

  const body = {
    contents: Array.isArray(contents) && contents.length ? contents : [{ role: "user", parts: [{ text: String(prompt || "") }] }],
    generationConfig: {
      temperature,
      topP: 0.95,
      maxOutputTokens,
      thinkingConfig: { thinkingBudget: 0 },
      ...(responseSchema ? { responseMimeType: "application/json", responseSchema } : {}),
    },
    ...(systemInstruction ? { systemInstruction: { parts: [{ text: systemInstruction }] } } : {}),
    ...(tools ? { tools } : {}),
    ...(toolConfig ? { toolConfig } : {}),
  };

  let lastError = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      lastError = error;
      clearTimeout(timer);
      if (attempt < MAX_ATTEMPTS) {
        await sleep(500 * 2 ** (attempt - 1));
        continue;
      }
      throw new Error(`Vertex request failed: ${error.message}`);
    }
    clearTimeout(timer);

    if (!response.ok) {
      const snippet = (await response.text().catch(() => "")).slice(0, 300);
      lastError = new Error(`Vertex generateContent error ${response.status}: ${snippet}`);
      if (RETRYABLE.has(response.status) && attempt < MAX_ATTEMPTS) {
        const retryAfter = Number(response.headers.get("retry-after"));
        await sleep(Math.max(Number.isFinite(retryAfter) ? retryAfter * 1000 : 0, 500 * 2 ** (attempt - 1)));
        continue;
      }
      throw lastError;
    }

    const payload = await response.json();
    const parts = payload?.candidates?.[0]?.content?.parts || [];
    const text = parts.map((p) => p.text || "").join("");
    const functionCalls = parts.filter((p) => p.functionCall && p.functionCall.name).map((p) => ({ name: p.functionCall.name, args: p.functionCall.args || {} }));
    if (!text.trim() && functionCalls.length === 0) {
      const reason = payload?.candidates?.[0]?.finishReason || payload?.promptFeedback?.blockReason || "empty";
      throw new Error(`Vertex returned no text (${reason}).`);
    }
    const u = payload?.usageMetadata || {};
    const count = (v) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : null);

    return {
      text,
      functionCalls,
      /* The model turn as sent back, so a tool loop can append it verbatim. */
      parts,
      usage: { input: count(u.promptTokenCount), output: count(u.candidatesTokenCount), total: count(u.totalTokenCount) },
      modelVersion: typeof payload?.modelVersion === "string" ? payload.modelVersion : null,
      resourceName,
    };
  }

  throw lastError || new Error("Vertex request failed.");
}

module.exports = { generateContent, getAccessToken, isConfigured, describeMissingConfig, resolveResourceName };
