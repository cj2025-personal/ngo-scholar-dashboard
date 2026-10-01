/**
 * Client-side call for "Draft from my research".
 *
 * Runs in the composer, which is a client component; cookies ride along via
 * `credentials: "include"`, the same way the composer saves a story. Returns
 * `{ ok, data, error }` rather than throwing, so the panel can put a sentence
 * in front of the scholar instead of a stack trace.
 *
 * Uploads go through the Scholar Documents portal, which owns consent,
 * scanning, extraction and review; this helper only ever asks what the result
 * of that is. Drafting returns text to the editor and saves nothing — the
 * story is saved by the scholar through the editorial route like any other.
 */

const AUTH_API_URL =
  process.env.NEXT_PUBLIC_AUTH_API_URL || "http://localhost:4000";

const UNREACHABLE = "We couldn't reach the server. Check your connection and try again.";

async function request(path, init) {
  let response;
  try {
    response = await fetch(`${AUTH_API_URL}${path}`, {
      credentials: "include",
      cache: "no-store",
      ...init,
    });
  } catch {
    return { ok: false, data: null, error: UNREACHABLE };
  }
  return readResult(response);
}

async function readResult(response) {
  let data = null;
  try {
    data = await response.json();
  } catch {
    /* A non-JSON body on an error is still an error. */
  }

  if (!response.ok) {
    return { ok: false, data: null, error: data?.error || data?.message || `Request failed (${response.status}).` };
  }
  return { ok: true, data, error: null };
}

/** What of my work is draftable, citable, or neither — and whether I may use the feature. */
export async function getDraftSources() {
  return request("/api/drafting/sources", { method: "GET" });
}

/** The reader the draft is written for, by age. Mirrors the server's table; the server decides. */
export const DRAFT_AUDIENCES = [
  { value: "ages_8_11", label: "Ages 8–11", grade: 4 },
  { value: "ages_12_14", label: "Ages 12–14", grade: 7 },
  { value: "ages_15_18", label: "Ages 15–18", grade: 9 },
  { value: "adults", label: "Adults", grade: 10 },
];
export const DEFAULT_AUDIENCE = "adults";

/**
 * Whose account the article is. Mirrors the server's table; the server decides.
 *
 * "author" is the default and the reason the feature exists: the scholar
 * publishes it under their own byline, so the prose never refers to them.
 * "about" is the archive's own account of their work, in the third person.
 */
export const DRAFT_VOICES = [
  { value: "author", label: "My own account", hint: "Published under your byline. The article never names you or calls you “he” or “she” — it describes the work." },
  { value: "about", label: "An account about me", hint: "Written about you in the third person, as the archive would describe your work to a reader." },
];
export const DEFAULT_VOICE = "author";

/**
 * Draft an article from one source marked ready — the synchronous path.
 *
 * Kept for tooling; the composer uses the job path below, which survives a
 * proxy timeout and streams progress.
 */
export async function draftFromSource({ origin, sourceId, audience }) {
  return request(`/api/drafting/from/${encodeURIComponent(origin)}/${encodeURIComponent(sourceId)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ audience }),
  });
}

/* ── jobs ────────────────────────────────────────────────────────────────── */

/**
 * Start a draft job. 202 with `{ job, reused }`; `reused` means an identical
 * request already ran. With `approveOutline` the job pauses at
 * `awaiting_outline`; with `createStory` (the default) the finished draft
 * becomes a draft story and the job carries its `storyId`. `levels` is true
 * for every other reading age, or the bands to write, each on its own.
 */
export async function createDraftJob({ origin, sourceId, audience, voice = DEFAULT_VOICE, brief = null, approveOutline = false, createStory = true, levels = false }) {
  return request("/api/drafting/jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ origin, sourceId, audience, voice, brief, approveOutline, createStory, levels }),
  });
}

/**
 * Ask the agent what a paper could become.
 *
 * No brief: the point is that the scholar does not have to arrive with the
 * angle already in their head. Comes back as an ordinary job that stops at
 * the outline, so everything downstream — watching, replanning, approving,
 * discarding — is the same as for a draft they asked for themselves.
 */
export async function proposeFromPaper({ origin, sourceId, audience }) {
  return request("/api/drafting/proposals", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ origin, sourceId, audience }),
  });
}

/**
 * What the scholar means by what they just said, decided by the studio agent's
 * model from the conversation and what is set: reply, ask which paper or who
 * it is for, plan, propose, replan, approve or discard. The page carries the
 * decision out.
 */
export async function converseWithAgent({ messages, state }) {
  return request("/api/drafting/converse", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages, state }),
  });
}

/** Ideas for the page the scholar is on, written by a model that has read it. */
export async function getAgentIdeas({ storyId = null, paperKey = null, focusIndex = null } = {}) {
  return request("/api/drafting/ideas", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ storyId, paperKey, focusIndex }),
  });
}

/** Whether the saved story reads right for its reader: a model's ruling, with the measured grade. */
export async function getStoryReadingLevel(storyId) {
  return request(`/api/editorial-stories/${encodeURIComponent(storyId)}/reading-level`, { method: "GET" });
}

/** Approve the outline, edited or not. Drafting resumes from it. */
export async function approveDraftOutline(jobId, outline) {
  return request(`/api/drafting/jobs/${encodeURIComponent(jobId)}/outline`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ outline }),
  });
}

/** Answer the proposed outline with a follow-up; the job replans from it. */
export async function replanDraftOutline(jobId, instruction) {
  return request(`/api/drafting/jobs/${encodeURIComponent(jobId)}/replan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ instruction }),
  });
}

/** The scholar's draft jobs, newest first. */
export async function listDraftJobs(limit = 20) {
  return request(`/api/drafting/jobs?limit=${encodeURIComponent(limit)}`, { method: "GET" });
}

/** Discard a draft job that is waiting on the scholar (outline or review) or still queued. */
export async function discardDraftJob(jobId) {
  return resumeDraftJob(jobId, { action: "discard" });
}

/** Every version of a story: what changed, when, and by whom. No bodies. */
export async function listStoryRevisions(storyId, limit = 30) {
  return request(`/api/editorial-stories/${encodeURIComponent(storyId)}/revisions?limit=${encodeURIComponent(limit)}`, { method: "GET" });
}

/**
 * Put an earlier version back. It lands as a NEW version, so the restore can
 * itself be undone. `baseVersion` is the version the editor is showing; if the
 * story has moved on since, the restore is refused rather than overwriting.
 */
export async function restoreStoryRevision(storyId, version, baseVersion = null) {
  return request(`/api/editorial-stories/${encodeURIComponent(storyId)}/revisions/${encodeURIComponent(version)}/restore`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ baseVersion }),
  });
}

/* ── evidence, levels, the record ────────────────────────────────────────── */

/** The scholar's evidence view: the ledger as it stands, the rule checks, and whether it is signed. */
export async function getStoryEvidence(storyId) {
  return request(`/api/editorial-stories/${encodeURIComponent(storyId)}/evidence`, { method: "GET" });
}

/** The signed record behind a public story. Anyone may fetch it. */
export async function getPublicEvidence(slug) {
  return request(`/api/editorial-stories/public/slug/${encodeURIComponent(slug)}/evidence`, { method: "GET" });
}

export function publicEvidenceUrl(slug) {
  return `${AUTH_API_URL}/api/editorial-stories/public/slug/${encodeURIComponent(slug)}/evidence`;
}

/** Write the story for other reading ages. A version of the story. */
export async function generateStoryLevels(storyId, { audiences = null, baseVersion = null } = {}) {
  return request(`/api/editorial-stories/${encodeURIComponent(storyId)}/levels`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ audiences, baseVersion }),
  });
}

/**
 * Judge one paragraph again, against the words it says now.
 *
 * The verdict stored on a block is about the text the drafter wrote. A
 * scholar who rewrites that paragraph — which is what the publish check asks
 * of them when it will not pass — was left carrying the old verdict, with no
 * way to earn a new one. This asks for one. The story must be saved first:
 * the judge reads the article, not the editor.
 */
export async function recheckStoryBlock(storyId, index, { baseVersion = null } = {}) {
  return request(`/api/editorial-stories/${encodeURIComponent(storyId)}/blocks/${encodeURIComponent(index)}/recheck`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ baseVersion }),
  });
}

/**
 * Discard reading levels: the bands named, or every band not yet approved.
 * A level that was live for readers stops being shown, so the caller asks
 * first. A version of the story like any other write.
 */
export async function discardStoryLevels(storyId, { audiences = null, baseVersion = null } = {}) {
  return request(`/api/editorial-stories/${encodeURIComponent(storyId)}/levels/discard`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ audiences, baseVersion }),
  });
}

/** Approve levels for readers. */
export async function approveStoryLevels(storyId, { audiences = null, baseVersion = null } = {}) {
  return request(`/api/editorial-stories/${encodeURIComponent(storyId)}/levels/approve`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ audiences, baseVersion }),
  });
}

/** Ask now whether the record has moved against this story's source. */
export async function checkStoryRecord(storyId) {
  return request(`/api/editorial-stories/${encodeURIComponent(storyId)}/record/check`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
}

export async function acknowledgeStoryRecord(storyId) {
  return request(`/api/editorial-stories/${encodeURIComponent(storyId)}/record/acknowledge`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
}

/** Delete a story, draft or published. Gone from every read at once; the owner only. */
export async function deleteStory(storyId) {
  return request(`/api/editorial-stories/${encodeURIComponent(storyId)}`, { method: "DELETE" });
}

/* ── the story agent ─────────────────────────────────────────────────────── */

/**
 * Agree to the agent's terms, as the profile reported them. The version sent
 * is the one the sheet showed; the server refuses a stale one, so a sheet
 * drawn before the terms changed cannot agree to terms never read.
 * Returns `{ aiTerms }` as the profile will now report them.
 */
export async function acceptAiTerms(version) {
  return request("/api/profile/ai-terms/accept", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ version }),
  });
}

/**
 * Tell the agent what to change. Returns `{ turn }` with a proposal to accept or reject.
 *
 * The turn is asked for as a stream, so the page can show each step as the
 * agent takes it — `onProgress({ step, message, tool, refused, detail })` —
 * and the turn arrives as the last frame. A server or a proxy that answers
 * with plain JSON instead gives the same result, with no steps on the way.
 */
export async function askStoryAgent(storyId, instruction, { onProgress = () => {} } = {}) {
  let response;
  try {
    response = await fetch(`${AUTH_API_URL}/api/editorial-stories/${encodeURIComponent(storyId)}/agent`, {
      method: "POST",
      credentials: "include",
      cache: "no-store",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream, application/json" },
      body: JSON.stringify({ instruction }),
    });
  } catch {
    return { ok: false, data: null, error: UNREACHABLE };
  }
  if (!/text\/event-stream/.test(response.headers.get("content-type") || "") || !response.body) return readResult(response);

  let result = null;
  try {
    await readEventStream(response.body, (event, data) => {
      if (event === "progress") onProgress(data);
      else if (event === "turn") result = { ok: true, data, error: null };
      else if (event === "error") result = { ok: false, data: null, error: data?.error || "That did not complete. Try again in a moment." };
    });
  } catch {
    /* The connection dropped mid-turn. */
  }
  /* A stream that ended without its last frame: the turn may still have been
     saved on the server, and the thread shows it on the next load. */
  return result || { ok: false, data: null, error: "The connection closed before the change was ready. Reload the page in a moment to see whether it arrived." };
}

/** Read Server-Sent Events from a fetch body, frame by frame, until it ends. */
async function readEventStream(body, onFrame) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
    let end;
    while ((end = buffer.indexOf("\n\n")) >= 0) {
      const raw = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      let event = "message";
      const data = [];
      for (const line of raw.split("\n")) {
        if (line.startsWith(":")) continue; // a keep-alive
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
      }
      if (!data.length) continue;
      let parsed = null;
      try { parsed = JSON.parse(data.join("\n")); } catch { continue; }
      onFrame(event, parsed);
    }
  }
}

export async function listStoryTurns(storyId) {
  return request(`/api/editorial-stories/${encodeURIComponent(storyId)}/agent/turns`, { method: "GET" });
}

/** `action` is "accept" (applies the proposal; returns the updated story) or "reject". */
export async function resolveStoryTurn(storyId, turnId, action) {
  return request(`/api/editorial-stories/${encodeURIComponent(storyId)}/agent/turns/${encodeURIComponent(turnId)}/${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
}

/** The passages of the story's source paper, numbered as the chips cite them. */
export async function getStoryPassages(storyId) {
  return request(`/api/editorial-stories/${encodeURIComponent(storyId)}/passages`, { method: "GET" });
}

/** The same, for a published story, with no session. */
export async function getPublicStoryPassages(slug) {
  return request(`/api/editorial-stories/public/slug/${encodeURIComponent(slug)}/passages`, { method: "GET" });
}

export async function getDraftJob(jobId) {
  return request(`/api/drafting/jobs/${encodeURIComponent(jobId)}`, { method: "GET" });
}

/** Record where the draft went: `publish` with the story id, or `discard`. */
export async function resumeDraftJob(jobId, { action, storyId = null }) {
  return request(`/api/drafting/jobs/${encodeURIComponent(jobId)}/resume`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, storyId }),
  });
}

/** A job is settled when the scholar can act on it: outline or draft ready, or it ended. */
export function isSettled(job) {
  return Boolean(job && (job.status === "awaiting_review" || job.status === "awaiting_outline" || job.terminal));
}

/**
 * Watch a job until it settles.
 *
 * Server-Sent Events with the session cookie; if the browser cannot hold the
 * stream open (a proxy that buffers, a corporate network), it falls back to
 * polling the job every two seconds. Either way the caller sees the same
 * two callbacks. Returns a function that stops watching.
 *
 * @param {string} jobId
 * @param {{ onProgress?: (e: {step: string, message: string}) => void, onSettled: (job: object) => void, onError?: (message: string) => void }} handlers
 */
export function watchDraftJob(jobId, { onProgress = () => {}, onSettled, onError = () => {}, after = 0 }) {
  let stopped = false;
  let source = null;
  let pollTimer = null;
  let settledSent = false;

  const settle = (job) => {
    if (stopped || settledSent) return;
    settledSent = true;
    stop();
    onSettled(job);
  };

  const stop = () => {
    stopped = true;
    if (source) { source.close(); source = null; }
    if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
  };

  const poll = async () => {
    if (stopped) return;
    const res = await getDraftJob(jobId);
    if (stopped) return;
    if (!res.ok) { onError(res.error); stop(); return; }
    const job = res.data.job;
    if (job.step) onProgress({ step: job.step, message: stepLabel(job.step) });
    if (isSettled(job)) { settle(job); return; }
    pollTimer = setTimeout(poll, 2000);
  };

  if (typeof EventSource === "undefined") {
    poll();
    return stop;
  }

  let gotAnyFrame = false;
  try {
    source = new EventSource(`${AUTH_API_URL}/api/drafting/jobs/${encodeURIComponent(jobId)}/events${after ? `?after=${after}` : ""}`, { withCredentials: true });
  } catch {
    poll();
    return stop;
  }

  source.addEventListener("progress", (e) => {
    gotAnyFrame = true;
    try {
      const data = JSON.parse(e.data);
      /* The whole frame rides along: a section as it lands carries its blocks. */
      onProgress({ step: data.step, message: data.message || stepLabel(data.step), detail: data });
    } catch { /* a malformed frame is not worth stopping for */ }
  });
  source.addEventListener("done", (e) => {
    gotAnyFrame = true;
    try { settle(JSON.parse(e.data)); } catch { poll(); }
  });
  source.addEventListener("timeout", () => { poll(); });
  source.addEventListener("error", () => {
    /* Before any frame: the stream probably cannot be held open here; poll
       instead. After frames: the browser will reconnect on its own with
       Last-Event-ID, so leave it be. */
    if (!gotAnyFrame && !stopped) {
      if (source) { source.close(); source = null; }
      poll();
    }
  });

  return stop;
}

const STEP_LABELS = {
  draft_levels: "Writing it for every reading age…",
  pick_source: "Reading the paper…",
  plan_outline: "Planning the article's sections…",
  draft_blocks: "Drafting sections…",
  judge_voice: "Reading each section for whose voice it is in…",
  judge_fidelity: "Checking the draft against the paper…",
  judge_reach: "Checking what the draft draws from the paper…",
  judge_context: "Checking your own context for what it claims of the paper…",
  assemble: "Assembling the draft…",
  review_article: "Reading the whole article: its headings, whose pronoun, its rhythm…",
  verify: "Reading the draft as its reader would…",
  create_story: "Opening the draft in your workspace…",
};

export function stepLabel(step) {
  return STEP_LABELS[step] || "Working…";
}
