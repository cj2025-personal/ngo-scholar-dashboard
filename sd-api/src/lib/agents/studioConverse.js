"use strict";

/**
 * The studio agent's understanding of what a scholar means.
 *
 * A new story starts as a conversation. The scholar says what they want in
 * their own words — "write something from my antenna paper for teenagers",
 * "what could this become?", "lead with the limitations", "looks good" — and
 * this model decides what that means given everything in front of it: the
 * scholar's papers, what has been said, what is already set, and where the
 * conversation is (nothing yet, an outline waiting, a draft being written).
 *
 * It returns one decision — an action, the paper, the reader, the voice, the
 * brief it understood — and the words to say back. The page carries the
 * decision out. It never acts on a paper that is not in the scholar's list:
 * a decision naming one is sent back to the model once with the reason.
 *
 * Pure: the model is injected.
 */

const CONVERSE_VERSION = "studio-converse-2026.1";

const ACTIONS = ["reply", "ask_paper", "set_paper", "ask_audience", "plan", "propose", "replan", "approve", "discard"];
const STAGES = ["start", "outline_waiting", "drafting", "done"];
const MARKER = "THE SCHOLAR JUST SAID:";

const SYSTEM = [
  "You are the studio agent on Archivyn, helping a scholar turn their own research paper into an article for readers,",
  "under the scholar's own name. You read what the scholar says and decide what they want, then say it back briefly.",
  "",
  "Decide one action:",
  "- plan: start planning the article. Only when you know which paper (named, chosen earlier, or the only one there",
  "  is) AND what the article should be. Put what they want in `brief`, in their words, including what to focus on,",
  "  what to leave out and any instruction about the reader. Set `audience` when they said or clearly implied who it",
  "  is for; otherwise ask first.",
  "- ask_paper: they want to write from a paper but you cannot tell which, and there is more than one.",
  "- set_paper: they chose or named a paper but have not said what to write; ask what the article should be.",
  "- ask_audience: the paper and the article are clear, but not who it is for, and they have not left it to you.",
  "  (If they say it does not matter, or for general readers, use adults and plan.)",
  "- propose: they want ideas for what the paper could become, or ask what you would write.",
  "- replan: an outline is waiting and they want it changed; `brief` is the change they asked for.",
  "- approve: an outline is waiting and they approve it as it stands.",
  "- discard: they want to drop the outline or the draft in progress.",
  "- reply: anything else — a question about what you can do, small talk, something you cannot do. Answer honestly.",
  "",
  "A reader shown as set was chosen — by a tap, or on the page they came from — so do not ask for it again; plan with",
  "it unless they now name another. Lines like `Use “<title>”.` or `For ages 12–14.` are the scholar's taps on cards",
  "you showed them; read them together with what they said before.",
  "",
  "Rules: use only the paper keys listed. Never say you have done something you have not. `reply` is what the scholar",
  "reads: one or two plain sentences, warm and direct, about their work. Give a one-sentence `rationale` for the record.",
].join("\n");

function schema({ paperKeys, audiences, voices }) {
  return {
    type: "OBJECT",
    properties: {
      action: { type: "STRING", enum: ACTIONS },
      paper_key: { type: "STRING", enum: ["", ...paperKeys] },
      audience: { type: "STRING", enum: ["", ...audiences] },
      voice: { type: "STRING", enum: ["", ...voices] },
      extra_audiences: { type: "ARRAY", items: { type: "STRING", enum: audiences } },
      brief: { type: "STRING" },
      reply: { type: "STRING" },
      rationale: { type: "STRING" },
    },
    required: ["action", "paper_key", "audience", "voice", "extra_audiences", "brief", "reply", "rationale"],
  };
}

/**
 * @param {object} p
 * @param {{role:"scholar"|"agent", text:string}[]} p.messages   oldest first; the last is what was just said
 * @param {{key:string, title:string, year?:number, words?:number}[]} p.papers
 * @param {{value:string, label:string}[]} p.audiences
 * @param {{value:string, label:string, hint?:string}[]} p.voices
 * @param {object} p.state  {paperKey, paperFrom: "shelf"|"conversation", audience (only once chosen), voice, extraAudiences, stage, outlineTitle}
 * @param {string} [p.scholarName]
 */
function buildPrompt({ messages, papers, audiences, voices, state, scholarName }) {
  const said = messages.length ? messages[messages.length - 1].text : "";
  const earlier = messages.slice(0, -1);
  return [
    `THE SCHOLAR: ${scholarName || "(name unknown)"}`,
    "",
    "THEIR PAPERS (key — title):",
    ...(papers.length ? papers.map((p) => `${p.key} — ${p.title}${p.year ? ` (${p.year})` : ""}${p.words ? `, ${p.words} words` : ""}`) : ["(none can be drafted from)"]),
    "",
    "READER AGES (value — label):",
    ...audiences.map((a) => `${a.value} — ${a.label}`),
    "VOICES (value — label):",
    ...voices.map((v) => `${v.value} — ${v.label}${v.hint ? `: ${v.hint}` : ""}`),
    "",
    "WHAT IS SET SO FAR:",
    `paper: ${state.paperKey || "(none)"}${state.paperKey ? ` (chosen ${state.paperFrom === "shelf" ? "on their Papers shelf, before this conversation" : "in this conversation"})` : ""}; reader: ${state.audience || "(not said)"}; voice: ${state.voice || "(default)"}; also for: ${(state.extraAudiences || []).join(", ") || "(none)"}`,
    `stage: ${STAGES.includes(state.stage) ? state.stage : "start"}${state.outlineTitle ? ` — the waiting outline is titled "${state.outlineTitle}"` : ""}`,
    "",
    ...(earlier.length ? ["THE CONVERSATION SO FAR:", ...earlier.map((m) => `${m.role === "scholar" ? "Scholar" : "You"}: ${m.text}`), ""] : []),
    `${MARKER} ${said}`,
  ].join("\n");
}

function stripFence(raw) {
  const s = String(raw || "").trim();
  const m = s.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return m ? m[1] : s;
}

function parseDecision(raw, { paperKeys, audiences, voices }) {
  let j;
  try { j = JSON.parse(stripFence(raw)); } catch { return null; }
  if (!j || !ACTIONS.includes(j.action)) return null;
  return {
    action: j.action,
    paperKey: String(j.paper_key || "") || null,
    paperKnown: !j.paper_key || paperKeys.includes(j.paper_key),
    audience: audiences.includes(j.audience) ? j.audience : null,
    voice: voices.includes(j.voice) ? j.voice : null,
    extraAudiences: [...new Set((Array.isArray(j.extra_audiences) ? j.extra_audiences : []).filter((a) => audiences.includes(a)))],
    brief: String(j.brief || "").trim().slice(0, 1000),
    reply: String(j.reply || "").trim().slice(0, 600),
    rationale: String(j.rationale || "").slice(0, 400),
  };
}

/**
 * Decide what the scholar means. One correction round if the decision names
 * a paper that is not theirs, or plans without a paper or a brief.
 * @returns {Promise<{decision: object, usage: object[], model: string|null}>}
 */
async function decide({ messages, papers, audiences, voices, state, scholarName, generate }) {
  const keys = papers.map((p) => p.key);
  const aud = audiences.map((a) => a.value);
  const vs = voices.map((v) => v.value);
  const responseSchema = schema({ paperKeys: keys, audiences: aud, voices: vs });
  const prompt = buildPrompt({ messages, papers, audiences, voices, state, scholarName });
  const usage = [];
  let correction = "";
  let last = null;
  for (let round = 0; round < 2; round += 1) {
    const r = await generate({ prompt: correction ? `${prompt}\n\nYOUR LAST DECISION COULD NOT BE CARRIED OUT: ${correction} Decide again.` : prompt, systemInstruction: SYSTEM, responseSchema });
    if (r.usage) usage.push(r.usage);
    const d = parseDecision(r.text, { paperKeys: keys, audiences: aud, voices: vs });
    last = { decision: d, model: r.model || null };
    if (!d) { correction = "It was not legible JSON."; continue; }
    const paper = d.paperKey || state.paperKey || null;
    if (!d.paperKnown) { correction = `It named the paper "${d.paperKey}", which is not in the scholar's list.`; continue; }
    if (d.action === "plan" && !paper && keys.length !== 1) { correction = "It planned without knowing which paper."; continue; }
    if (d.action === "plan" && !d.brief) { correction = "It planned without a brief."; continue; }
    if (["replan", "approve"].includes(d.action) && state.stage !== "outline_waiting") { correction = "There is no outline waiting."; continue; }
    if (d.action === "plan" && !paper && keys.length === 1) d.paperKey = keys[0];
    return { decision: d, usage, model: last.model };
  }
  /* Still not something the page can do: say so in the model's words, and act on nothing. */
  const fallback = last?.decision ? { ...last.decision, action: "reply", reply: last.decision.reply || "I didn't quite follow. Which paper, and what should the article be about?" } : null;
  return { decision: fallback, usage, model: last?.model || null };
}

module.exports = { CONVERSE_VERSION, ACTIONS, STAGES, MARKER, SYSTEM, schema, buildPrompt, parseDecision, decide };
