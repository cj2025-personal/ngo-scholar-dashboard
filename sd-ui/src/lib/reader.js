/**
 * Client-side calls for the reading companion.
 *
 * Runs in the public reader, where there is no session: the API hands the
 * browser a device cookie on the first call and `credentials: "include"`
 * carries it back. Returns `{ ok, data, error }` rather than throwing, so
 * the panel can put a sentence in front of a reader.
 */

const AUTH_API_URL = process.env.NEXT_PUBLIC_AUTH_API_URL || "http://localhost:4000";

async function request(path, init) {
  let response;
  try {
    response = await fetch(`${AUTH_API_URL}${path}`, { credentials: "include", cache: "no-store", ...init });
  } catch {
    return { ok: false, data: null, error: "We couldn't reach the server. Check your connection and try again." };
  }
  let data = null;
  try { data = await response.json(); } catch { /* a non-JSON body on an error is still an error */ }
  if (!response.ok) return { ok: false, data: null, error: data?.error || data?.message || `Request failed (${response.status}).` };
  return { ok: true, data, error: null };
}

/** This reader's questions about one story, oldest first. */
export async function getCompanionThread(slug) {
  return request(`/api/reader/stories/${encodeURIComponent(slug)}/turns`, { method: "GET" });
}

/** Everything this reader has asked, newest first. */
export async function getMyCompanionTurns() {
  return request("/api/reader/me/turns", { method: "GET" });
}

/** Forget this reader: every question goes, and the device starts over. */
export async function forgetMe() {
  return request("/api/reader/me", { method: "DELETE" });
}

/**
 * Ask, and watch the work.
 *
 * The answer is a stream of events on the POST itself: `step` frames as the
 * companion reads and searches, then one `answer` frame once the Sentinel
 * has passed it, then `done`. A refusal or a failure arrives as an `error`
 * frame inside the stream, or as a plain HTTP error before it opens.
 *
 * @param {string} slug
 * @param {{question: string, level?: string|null, focusIndex?: number|null}} body
 * @param {{onStep?: (s: {tool: string, summary: string}) => void, signal?: AbortSignal}} [handlers]
 * @returns {Promise<{ok: boolean, data: {text: string, turn: object, remaining: number|null}|null, error: string|null, status?: number}>}
 */
export async function askCompanion(slug, body, { onStep = () => {}, signal } = {}) {
  let response;
  try {
    response = await fetch(`${AUTH_API_URL}/api/reader/stories/${encodeURIComponent(slug)}/ask`, {
      method: "POST",
      credentials: "include",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
  } catch (e) {
    if (e?.name === "AbortError") return { ok: false, data: null, error: null, aborted: true };
    return { ok: false, data: null, error: "We couldn't reach the server. Check your connection and try again." };
  }
  if (!response.ok) {
    let data = null;
    try { data = await response.json(); } catch { /* no body */ }
    return { ok: false, data: null, error: data?.error || `Request failed (${response.status}).`, status: response.status };
  }
  if (!response.body) return { ok: false, data: null, error: "This browser can't read the answer as it arrives." };

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let answer = null;
  let remaining = null;
  let error = null;
  let status = null;
  /* A turn that was stopped still has a record; the thread shows it. */
  let failedTurn = null;

  const handle = (frame) => {
    if (frame.event === "step") onStep(frame.data || {});
    else if (frame.event === "answer") answer = frame.data;
    else if (frame.event === "done") remaining = frame.data?.remaining ?? null;
    else if (frame.event === "error") { error = frame.data?.message || "Something went wrong."; status = frame.data?.status || null; failedTurn = frame.data?.turn || null; }
  };

  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buffer.indexOf("\n\n")) >= 0) {
        const raw = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        if (!raw.trim() || raw.startsWith(":")) continue;
        const frame = {};
        for (const line of raw.split("\n")) {
          const m = line.match(/^(\w+): ?(.*)$/);
          if (m) frame[m[1]] = m[2];
        }
        if (frame.data) { try { frame.data = JSON.parse(frame.data); } catch { frame.data = null; } }
        handle(frame);
      }
    }
  } catch (e) {
    if (e?.name === "AbortError") return { ok: false, data: null, error: null, aborted: true };
    return { ok: false, data: null, error: "The connection dropped before the answer arrived. Ask again." };
  }

  if (error) return { ok: false, data: null, error, status, turn: failedTurn };
  if (!answer) return { ok: false, data: null, error: "The answer didn't arrive. Ask again." };
  return { ok: true, data: { text: answer.text, turn: answer.turn, remaining }, error: null };
}
