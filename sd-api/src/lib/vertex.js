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

/**
 * A bare model id becomes a publisher resource; a full resource path passes
 * through. With no model named, the deployment's own (`STORY_LLM_MODEL`):
 * callers that route by purpose name the model they were routed to.
 */
function resolveResourceName(model = null) {
  if (isFake()) return model ? `fake/${model}` : "fake/model";
  const id = String(model || env.llm.model).trim().replace(/^\/+/, "");
  if (id.startsWith("projects/")) return id;
  return `projects/${env.llm.project}/locations/${env.llm.location}/publishers/google/models/${id}`;
}

function buildUrl(resourceName, method = "generateContent") {
  const location = (resourceName.match(/\/locations\/([^/]+)/) || [])[1] || env.llm.location;
  return `https://${location}-aiplatform.googleapis.com/v1/${resourceName}:${method}`;
}

/**
 * An error the router must not answer by trying another model: the model
 * declined on safety grounds, which is a decision about the content, not a
 * fault in the service. Named so the router can tell it apart.
 */
function blockedError(reason) {
  const e = new Error(`The model declined to answer (${reason}).`);
  e.name = "ModelBlockedError";
  e.code = "BLOCKED";
  e.reason = reason;
  return e;
}
const BLOCK_REASONS = new Set(["SAFETY", "PROHIBITED_CONTENT", "BLOCKLIST", "SPII", "RECITATION"]);

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

/** The error a caller's abort surfaces as: named, so it can be told from a fault. */
function abortError(signal) {
  const e = new Error(signal?.reason instanceof Error ? signal.reason.message : String(signal?.reason || "The request was aborted."));
  e.name = "AbortError";
  return e;
}

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
  /* Gemini safety thresholds: [{category, threshold}]. Unset means the
     model's defaults, which is what every scholar-facing call wants. The
     reading companion sets the strict ones when the reader is a child. */
  safetySettings = null,
  temperature = 0.4,
  maxOutputTokens = 4096,
  timeoutMs = 90_000,
  /* The caller's way out: a reader who closed the page, a turn past its
     deadline. Aborting ends the request in flight and stops the retries. */
  signal = null,
  /* Which model, when the caller was routed to one; the deployment's own otherwise. */
  model = null,
  /* Reasoning before answering. Off unless asked for, and billed to
     maxOutputTokens, so a caller that asks sizes the budget to match. */
  thinkingBudget = 0,
}) {
  const missing = describeMissingConfig();
  if (missing) throw new Error(`Drafting is not configured: ${missing}`);
  if (isFake()) return require("./fakeModel").generateContent({ prompt, contents, systemInstruction, responseSchema, tools, signal, model });

  const resourceName = resolveResourceName(model);
  const url = buildUrl(resourceName);
  const token = await getAccessToken();

  const body = {
    contents: Array.isArray(contents) && contents.length ? contents : [{ role: "user", parts: [{ text: String(prompt || "") }] }],
    generationConfig: {
      temperature,
      topP: 0.95,
      maxOutputTokens,
      thinkingConfig: { thinkingBudget: Math.max(0, Number(thinkingBudget) || 0) },
      ...(responseSchema ? { responseMimeType: "application/json", responseSchema } : {}),
    },
    ...(systemInstruction ? { systemInstruction: { parts: [{ text: systemInstruction }] } } : {}),
    ...(tools ? { tools } : {}),
    ...(toolConfig ? { toolConfig } : {}),
    ...(Array.isArray(safetySettings) && safetySettings.length ? { safetySettings } : {}),
  };

  let lastError = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    if (signal?.aborted) throw abortError(signal);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const onAbort = () => controller.abort();
    signal?.addEventListener("abort", onAbort, { once: true });
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
      signal?.removeEventListener("abort", onAbort);
      /* The caller's abort is not a fault to retry. */
      if (signal?.aborted) throw abortError(signal);
      if (attempt < MAX_ATTEMPTS) {
        await sleep(500 * 2 ** (attempt - 1));
        continue;
      }
      throw new Error(`Vertex request failed: ${error.message}`);
    }
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);

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
    /* Thought summaries, when a caller asked for reasoning, are not the answer. */
    const text = parts.filter((p) => !p.thought).map((p) => p.text || "").join("");
    const functionCalls = parts.filter((p) => p.functionCall && p.functionCall.name).map((p) => ({ name: p.functionCall.name, args: p.functionCall.args || {} }));
    if (!text.trim() && functionCalls.length === 0) {
      const reason = payload?.candidates?.[0]?.finishReason || payload?.promptFeedback?.blockReason || "empty";
      if (BLOCK_REASONS.has(reason)) throw blockedError(reason);
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

/**
 * Embeddings: text to vectors, for finding what a question is about by
 * meaning rather than by shared words.
 *
 * @param {object} req
 * @param {string[]} req.texts
 * @param {"RETRIEVAL_DOCUMENT"|"RETRIEVAL_QUERY"|"SEMANTIC_SIMILARITY"|"CLASSIFICATION"} [req.taskType]
 * @param {string} req.model                a Vertex embedding model, e.g. text-embedding-005
 * @param {number} [req.batchSize]          instances per request
 * @param {AbortSignal} [req.signal]
 * @param {number} [req.timeoutMs]
 * @returns {Promise<{vectors: number[][], model: string, usage: {input: number|null}}>}
 */
async function embed({ texts, taskType = "RETRIEVAL_DOCUMENT", model, batchSize = 32, signal = null, timeoutMs = 30_000 }) {
  const missing = describeMissingConfig();
  if (missing) throw new Error(`Embeddings are not configured: ${missing}`);
  if (!model) throw new Error("An embedding model must be named.");
  const list = (texts || []).map((t) => String(t || "").slice(0, 8000));
  if (isFake()) return require("./fakeModel").embed({ texts: list, taskType, model });

  const resourceName = resolveResourceName(model);
  const url = buildUrl(resourceName, "predict");
  const token = await getAccessToken();
  const vectors = [];
  let tokens = 0;
  for (let i = 0; i < list.length; i += batchSize) {
    if (signal?.aborted) throw abortError(signal);
    const chunk = list.slice(i, i + batchSize);
    let done = false;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS && !done; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const onAbort = () => controller.abort();
      signal?.addEventListener("abort", onAbort, { once: true });
      let response;
      try {
        response = await fetch(url, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ instances: chunk.map((content) => ({ content, task_type: taskType })) }),
          signal: controller.signal,
        });
      } catch (error) {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        if (signal?.aborted) throw abortError(signal);
        if (attempt < MAX_ATTEMPTS) { await sleep(500 * 2 ** (attempt - 1)); continue; }
        throw new Error(`Vertex embedding request failed: ${error.message}`);
      }
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      if (!response.ok) {
        const snippet = (await response.text().catch(() => "")).slice(0, 300);
        if (RETRYABLE.has(response.status) && attempt < MAX_ATTEMPTS) { await sleep(500 * 2 ** (attempt - 1)); continue; }
        throw new Error(`Vertex embedding error ${response.status}: ${snippet}`);
      }
      const payload = await response.json();
      for (const p of payload.predictions || []) {
        vectors.push(p.embeddings?.values || []);
        tokens += Number(p.embeddings?.statistics?.token_count) || 0;
      }
      done = true;
    }
  }
  if (vectors.length !== list.length) throw new Error(`Vertex returned ${vectors.length} embeddings for ${list.length} texts.`);
  return { vectors, model, usage: { input: tokens || null } };
}

module.exports = { generateContent, embed, getAccessToken, isConfigured, describeMissingConfig, resolveResourceName };
