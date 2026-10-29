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

const { AUDIENCES } = require("../audiences");
const { VOICE } = require("../draftComposer");
const { introduce } = require("./identity");
const { BRIEF_KEY } = require("../briefSource");

const CONVERSE_VERSION = "studio-converse-2026.5";

/* The words the scholar sees for each voice and reader, as the composer shows them. */
const VOICES = [
  { value: VOICE.AUTHOR, label: "My own account", hint: "the scholar's own account of their work, under their byline; the scholar is never named in it" },
  { value: VOICE.ABOUT, label: "An account about me", hint: "an article about the scholar and their work, in the third person" },
];
const AUDIENCE_LIST = Object.entries(AUDIENCES).filter(([k]) => !["general", "students"].includes(k)).map(([value, a]) => ({ value, label: a.label }));

const ACTIONS = ["reply", "ask_paper", "set_paper", "ask_audience", "plan", "propose", "replan", "approve", "discard"];
const STAGES = ["start", "outline_waiting", "drafting", "done"];
const MARKER = "THE SCHOLAR JUST SAID:";

const SYSTEM = [
  introduce("the studio agent"),
  "You help a scholar write an article for readers, under the scholar's own name: usually from one of their own",
  `research papers, or — when they choose — from their brief alone, drawing on none of their work (the key ${BRIEF_KEY}).`,
  "You read what the scholar says and decide what they want, then say it back briefly.",
  "",
  "Decide one action:",
  "- plan: start planning the article. Only when you know which paper (named, chosen earlier, or the only one there",
  `  is) — or that it is to come from no paper (${BRIEF_KEY}) — AND what the article should be. Put what they want in`,
  "  `brief`, in their words, including what to focus on,",
  "  what to leave out and any instruction about the reader. Set `audience` when they said or clearly implied who it",
  "  is for; otherwise ask first.",
  "- ask_paper: you cannot tell which paper the article should come from, or whether from none, and there is more",
  "  than one choice. Which paper comes before who it is for: ask this first.",
  "- set_paper: they chose or named a paper but have not said what to write; ask what the article should be.",
  "- ask_audience: the paper and the article are clear, but not who it is for, and they have not left it to you.",
  "  (If they say it does not matter, or for general readers, use adults and plan.)",
  "- propose: they want ideas for what the paper could become, or ask what you would write.",
  "- replan: an outline is waiting and they want it changed; `brief` is the change they asked for.",
  "- approve: an outline is waiting and they approve it as it stands.",
  "- discard: they want to drop the outline or the draft in progress.",
  "- reply: anything else — a question about what you can do, small talk, something you cannot do. Answer honestly.",
  "",
  `Writing from no paper (${BRIEF_KEY}) is the scholar's choice, not yours to make for them. Choose it when they say so`,
  "— no paper, not from my work, don't use my research, just write about … — or when what they ask for is plainly about",
  "none of their papers. The article is then their own account from their brief: every specific in it (a number, a",
  "named study, a date, a place) is listed for them to verify before it can be published, and readers are told it is",
  "not drawn from their research. Say that in your reply when you plan it. A brief about one of their papers comes",
  "from that paper.",
  "",
  "A reader shown as set was chosen — by a tap, or on the page they came from — so do not ask for it again; plan with",
  "it unless they now name another. Lines like `Use “<title>”.` or `For ages 12–14.` are the scholar's taps on cards",
  "you showed them; read them together with what they said before.",
  "",
  "How it goes after you: you plan an outline from the paper, or from the brief alone; the scholar approves it, cuts sections or asks for",
  "changes; the approved outline is drafted into the page beside you, under their name; they read it, edit it, run the",
  "publish check and publish it on Proj Arch themselves, or schedule it. You cannot publish, schedule, send or delete",
  "anything, or change their account. When asked to, say so plainly and tell them the step that does it.",
  "",
  "Whatever the action, set `audience` as soon as the scholar has said or clearly implied who the article is for, in",
  "this message or an earlier one, and `paper_key` once a paper is chosen or named; if a phrase could mean more than",
  "one reading age, ask rather than guess. Set `voice` only when they said whose account it is. Use none for anything",
  "not known.",
  "",
  "Rules: use only the paper keys listed. Never say you have done something you have not. `reply` is what the scholar",
  "reads: one or two plain sentences, warm and direct, about their work. Give a one-sentence `rationale` for the record.",
].join("\n");

/* "none" where nothing is meant: the model API refuses an empty enum value. */
const NONE = "none";

function schema({ paperKeys, audiences, voices }) {
  return {
    type: "OBJECT",
    properties: {
      action: { type: "STRING", enum: ACTIONS },
      paper_key: { type: "STRING", enum: [NONE, ...paperKeys] },
      audience: { type: "STRING", enum: [NONE, ...audiences] },
      voice: { type: "STRING", enum: [NONE, ...voices] },
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
  const said = (v) => (v && v !== NONE ? String(v) : "");
  const paper = said(j.paper_key);
  return {
    action: j.action,
    paperKey: paper || null,
    paperKnown: !paper || paperKeys.includes(paper),
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
    /* What a plan with nothing chosen may bind to: the only paper there is,
       or — with no papers at all — the brief alone. Never the brief when a
       paper exists: writing without the scholar's work is said, not assumed. */
    const papersOnly = keys.filter((k) => k !== BRIEF_KEY);
    const only = papersOnly.length === 1 ? papersOnly[0] : papersOnly.length === 0 && keys.includes(BRIEF_KEY) ? BRIEF_KEY : null;
    if (d.action === "plan" && !paper && !only) { correction = "It planned without knowing which paper, or whether from none."; continue; }
    if (d.action === "plan" && !d.brief) { correction = "It planned without a brief."; continue; }
    if (d.action === "propose" && paper === BRIEF_KEY) { correction = `It proposed an angle with no paper (${BRIEF_KEY}); an angle is read from a paper. Ask what to write instead.`; continue; }
    if (["replan", "approve"].includes(d.action) && state.stage !== "outline_waiting") { correction = "There is no outline waiting."; continue; }
    if (d.action === "plan" && !paper && only) d.paperKey = only;
    return { decision: d, usage, model: last.model };
  }
  /* Still not something the page can do: say so in the model's words, and act on nothing. */
  const fallback = last?.decision ? { ...last.decision, action: "reply", reply: last.decision.reply || "I didn't quite follow. Which paper, and what should the article be about?" } : null;
  return { decision: fallback, usage, model: last?.model || null };
}

module.exports = { CONVERSE_VERSION, ACTIONS, STAGES, VOICES, AUDIENCE_LIST, MARKER, SYSTEM, schema, buildPrompt, parseDecision, decide };
