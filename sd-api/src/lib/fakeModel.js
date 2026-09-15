/**
 * A model that answers from the prompt, for automated tests.
 *
 * ── Why a fake at this layer ────────────────────────────────────────────────
 * The end-to-end suite has to exercise everything a scholar's click touches:
 * the queue, the lease, the event stream, the save with provenance, the
 * publish guard. None of that is about the model's prose, and a suite that
 * needs credentials and spends tokens is a suite people stop running. So
 * `LLM_PROVIDER=fake` swaps the Vertex client for this: it recognises each
 * of the drafter's prompts by its markers and answers with text lifted
 * verbatim from the passages it was given. Lifted, not invented, so the
 * fidelity judge's verdicts and the verbatim-quote check hold exactly as
 * they would on an honest model.
 *
 * It is deterministic: the same prompt returns the same answer, so a test
 * can assert on content and a rerun cannot flake. It is never selected in
 * production: `env.js` only honours "fake" outside NODE_ENV=production.
 */

const MODEL_VERSION = "fake-model-2026.1";

const sentences = (text) => String(text || "").split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);

/** "[p3] text" lines after a marker, or in the whole prompt. */
function passagesIn(prompt, afterMarker = null) {
  const body = afterMarker && prompt.includes(afterMarker) ? prompt.slice(prompt.indexOf(afterMarker) + afterMarker.length) : prompt;
  const out = [];
  for (const m of body.matchAll(/^\[(p\d+)\] (.+)$/gm)) out.push({ id: m[1], text: m[2].trim() });
  return out;
}

function usage(prompt, text) {
  return { input: Math.ceil(prompt.length / 4), output: Math.ceil(text.length / 4), total: Math.ceil((prompt.length + text.length) / 4) };
}

/**
 * An outline of paper sections; with a brief, the last section goes beyond
 * the paper, so the extension path — the reach judge, the levels that
 * rewrite an implication, the ledger that records it — is exercised end to
 * end. The brief is reported as fully met; the outline tests drive the
 * other coverage verdicts with their own fake.
 */
function answerOutline(prompt) {
  const passages = passagesIn(prompt, "=== PAPER, IN NUMBERED PASSAGES ===");
  const titleMatch = prompt.match(/^Paper title: (.+)$/m);
  const title = (titleMatch ? titleMatch[1].replace(/\s*\(\d{4}\)\s*$/, "") : "A paper").slice(0, 100);
  const briefLine = prompt.match(/^The scholar's brief for this article: "(.*)"$/m);
  const briefed = Boolean(briefLine);
  /* "today", "society", "industry", "practice" or "world" in the brief plans
     the author's own context as the last section instead of an implication,
     so the context path — its judge, its list to verify, the publish gate —
     is exercised end to end. */
  const contextual = briefed && /\b(?:today|society|industry|practice|world)\b/i.test(briefLine[1]);
  const n = Math.max(2, Math.min(4, passages.length));
  const beats = [];
  for (let i = 0; i < n; i += 1) {
    const p = passages[i % Math.max(passages.length, 1)];
    const last = briefed && i === n - 1;
    const extension = last && !contextual;
    const context = last && contextual;
    beats.push({
      heading: context ? "Where this matters today" : extension ? "What this means beyond the paper" : `Section ${i + 1}: ${sentences(p?.text || "")[0]?.split(/\s+/).slice(0, 4).join(" ") || "Findings"}`,
      goal: context ? "The author's own context: where the same problem turns up in practice." : extension ? `What follows from passage ${p?.id || "p1"} for the reader.` : `Report what passage ${p?.id || "p1"} says.`,
      kind: context ? "context" : extension ? "extension" : "paper",
      passage_ids: [p?.id || "p1"],
    });
  }
  const last = beats[beats.length - 1];
  const briefMap = briefed ? [{ ask: contextual ? "where this turns up today" : "what this means for the reader", answered_by: last.kind, section: last.heading }] : null;
  return JSON.stringify({ title: `What the paper found: ${title}`, deck: `A report on ${title}, drawn from its own text.`, beats, brief_map: briefMap, brief_coverage: briefed ? { met: "full", note: "" } : null });
}

/** The one implication the fake ever draws: generic, so it follows from any passage. */
const IMPLICATION = "This means the same problem would face anyone who meets what the paper describes.";

function answerSection(prompt) {
  const cited = passagesIn(prompt, prompt.includes("=== PASSAGES THIS SECTION RELATES TO ===") ? "=== PASSAGES THIS SECTION RELATES TO ===" : "=== PASSAGES THIS SECTION MAY USE ===");
  const first = cited[0] || { id: "p1", text: "The paper reports its findings." };
  const s1 = sentences(first.text);
  if (/^Section kind: context$/m.test(prompt)) {
    /* The author's own context: general, so nothing to verify and the
       publish gate stays open for the suites that do not test it.
       FAKE_MODEL_MISATTRIBUTE=1 wears the paper's authority, which the fake
       context judge marks; FAKE_MODEL_SPECIFIC=1 names a thing to verify. */
    const misattributed = process.env.FAKE_MODEL_MISATTRIBUTE === "1" ? " The paper shows this method is used in every phone." : "";
    const specific = process.env.FAKE_MODEL_SPECIFIC === "1" ? " The 2.4 GHz band is one such place." : "";
    return JSON.stringify({ paragraphs: [{ text: `In practice the same problem turns up wherever a receiver must hear a weak signal beside a strong one, such as in a crowded radio band.${specific}${misattributed}`, passage_ids: [first.id] }], quote: null });
  }
  if (/^Section kind: extension$/m.test(prompt)) {
    /* One paragraph of the paper, one that builds on it. FAKE_MODEL_OVERREACH=1
       adds a fact about the world, which the fake reach judge marks. */
    const overreach = process.env.FAKE_MODEL_OVERREACH === "1" ? " This method is now used in every phone." : "";
    const paragraphs = [
      { text: s1.slice(0, 2).join(" "), passage_ids: [first.id], extension: false },
      { text: `${s1[0]} ${IMPLICATION}${overreach}`, passage_ids: [first.id], extension: true },
    ];
    return JSON.stringify({ paragraphs, quote: null });
  }
  const paragraphs = [{ text: s1.slice(0, 3).join(" "), passage_ids: [first.id] }];
  if (cited[1]) {
    const s2 = sentences(cited[1].text);
    paragraphs.push({ text: s2.slice(0, 3).join(" "), passage_ids: [cited[1].id] });
  }
  /* A voice violation on demand, so the refusal path can be driven end to end. */
  if (process.env.FAKE_MODEL_FIRST_PERSON === "1") paragraphs[0].text = `I found this. ${paragraphs[0].text}`;
  return JSON.stringify({ paragraphs, quote: s1[0] && s1[0].length >= 12 ? { text: s1[0], passage_id: first.id } : null });
}

/**
 * Claims, one per sentence, each supported by the passage sentence that
 * shares most of its words. The drafter lifts sentences verbatim, so every
 * claim finds its evidence; the ledger and the reader's highlights then
 * exercise the real path. FAKE_MODEL_UNSUPPORTED_CLAIM=1 marks the last
 * claim of every paragraph unsupported, to drive the partial path.
 */
function answerJudge(prompt) {
  const passages = passagesIn(prompt, "PASSAGES FROM THE PAPER:");
  const body = prompt.slice(prompt.indexOf("PARAGRAPHS TO CHECK:"));
  const rows = [...body.matchAll(/^\((\d+)\) (.+)$/gm)].map((m) => ({ index: Number(m[1]), text: m[2] }));
  const words = (t) => new Set(String(t).toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3));
  const evidenceFor = (claim) => {
    const cw = words(claim);
    let best = null;
    for (const p of passages) {
      for (const sentence of sentences(p.text)) {
        const sw = words(sentence);
        const shared = [...cw].filter((w) => sw.has(w)).length;
        const score = cw.size ? shared / cw.size : 0;
        if (!best || score > best.score) best = { score, id: p.id, sentence };
      }
    }
    return best && best.score >= 0.4 ? best : null;
  };
  return JSON.stringify({
    paragraphs: rows.map(({ index, text }) => {
      const claims = sentences(text).map((sentence, k, all) => {
        const ev = evidenceFor(sentence);
        const forceBad = process.env.FAKE_MODEL_UNSUPPORTED_CLAIM === "1" && k === all.length - 1;
        return ev && !forceBad
          ? { text: sentence, verdict: "supported", passage_ids: [ev.id], evidence: ev.sentence }
          : { text: sentence, verdict: "unsupported", passage_ids: [], evidence: "" };
      });
      return { index, claims };
    }),
  });
}

/**
 * The reach judge, answered by wording: a sentence lifted from a passage
 * follows from it; a sentence that says "this means" follows from the first
 * anchor; anything else is a fact from outside the paper.
 */
function answerReach(prompt) {
  const passages = passagesIn(prompt, "PASSAGES FROM THE PAPER:");
  const body = prompt.slice(prompt.indexOf("PARAGRAPHS THAT BUILD ON THEM:"));
  const rows = [...body.matchAll(/^\((\d+)\) (.+)$/gm)].map((m) => ({ index: Number(m[1]), text: m[2] }));
  const words = (t) => new Set(String(t).toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3));
  const anchorFor = (claim) => {
    const cw = words(claim);
    for (const p of passages) {
      for (const sentence of sentences(p.text)) {
        const sw = words(sentence);
        const shared = [...cw].filter((w) => sw.has(w)).length;
        if (cw.size && shared / cw.size >= 0.4) return p.id;
      }
    }
    return null;
  };
  return JSON.stringify({
    paragraphs: rows.map(({ index, text }) => ({
      index,
      claims: sentences(text).map((sentence) => {
        const anchor = anchorFor(sentence) || (/^(?:this|that|which) means\b|would matter\b|the same problem\b/i.test(sentence) ? passages[0]?.id : null);
        return anchor
          ? { text: sentence, verdict: "follows", anchor_ids: [anchor] }
          : { text: sentence, verdict: "overreach", reason: "outside_fact", anchor_ids: [] };
      }),
    })),
  });
}

/**
 * The context judge, answered by wording: a sentence that says the paper
 * showed something is attributed to it; it is in the passages if it shares
 * most of its words with one; "every phone" and any figure are specifics
 * for the author to verify.
 */
function answerContext(prompt) {
  const passages = passagesIn(prompt, "PASSAGES FROM THE PAPER:");
  const body = prompt.slice(prompt.indexOf("PARAGRAPHS OF THE AUTHOR'S OWN CONTEXT:"));
  const rows = [...body.matchAll(/^\((\d+)\) (.+)$/gm)].map((m) => ({ index: Number(m[1]), text: m[2] }));
  const words = (t) => new Set(String(t).toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3));
  const anchorFor = (claim) => {
    const cw = words(claim);
    for (const p of passages) {
      for (const sentence of sentences(p.text)) {
        const sw = words(sentence);
        const shared = [...cw].filter((w) => sw.has(w)).length;
        if (cw.size && shared / cw.size >= 0.4) return p.id;
      }
    }
    return null;
  };
  return JSON.stringify({
    paragraphs: rows.map(({ index, text }) => ({
      index,
      claims: sentences(text).map((sentence) => {
        const anchor = anchorFor(sentence);
        const attributed = /\b(?:the|this) (?:paper|study|work) (?:shows|showed|found|finds|proves|proved|demonstrates)\b/i.test(sentence);
        const specifics = [...sentence.matchAll(/\b(every phone)\b|\b(\d+(?:\.\d+)?(?: ?(?:GHz|MHz|dB))?)\b/gi)]
          .map((m) => (m[1] ? { text: m[1], kind: "product" } : { text: m[2], kind: "number" }));
        return { text: sentence, attributed, in_passages: Boolean(anchor), anchor_ids: anchor ? [anchor] : [], specifics, unsuitable: false };
      }),
    })),
  });
}

/**
 * A paragraph for another reader: one lifted sentence for the youngest band,
 * two otherwise. A paragraph that goes beyond the paper keeps its own two
 * sentences — the paper's and the implication — so nothing is added or lost.
 */
function answerLevel(prompt) {
  if (/Keep every\s+implication it draws/.test(prompt)) {
    const own = prompt.slice(prompt.indexOf("=== PARAGRAPH TO REWRITE FOR ANOTHER READER ===")).split("\n").slice(1).join(" ").trim();
    return JSON.stringify({ text: sentences(own).slice(0, 2).join(" ") });
  }
  const cited = passagesIn(prompt, "=== PASSAGES THIS PARAGRAPH RESTS ON ===");
  const first = cited[0] || { text: "The paper reports its findings." };
  const s = sentences(first.text);
  const n = /aged 8 to 11/.test(prompt) ? 1 : 2;
  return JSON.stringify({ text: s.slice(0, n).join(" ") });
}

function answerComposer(prompt) {
  const start = prompt.indexOf("=== PAPER BEGINS ===");
  const end = prompt.indexOf("=== PAPER ENDS ===");
  const paper = start >= 0 && end > start ? prompt.slice(start + 20, end) : prompt;
  const s = sentences(paper.replace(/\s+/g, " "));
  const titleMatch = prompt.match(/^Paper title: (.+)$/m);
  return JSON.stringify({
    title: `What the paper found: ${(titleMatch ? titleMatch[1] : "a paper").slice(0, 80)}`,
    deck: s[0] || "A report on the paper.",
    blocks: [
      { kind: "paragraph", text: s.slice(0, 4).join(" ") },
      { kind: "heading", text: "What was measured" },
      { kind: "paragraph", text: s.slice(4, 9).join(" ") || s.slice(0, 2).join(" ") },
      { kind: "quote", text: s[1] || s[0] || "" },
      { kind: "paragraph", text: s.slice(9, 14).join(" ") || s.slice(0, 2).join(" ") },
    ],
  });
}

/**
 * The story agent's tool loop, answered from the instruction.
 *
 * Round one reads "THE SCHOLAR ASKS:" and emits the tool calls a sensible
 * agent would; round two (after the tool results come back) finishes with a
 * summary. Deterministic, so the browser and API suites can assert on it.
 */
function answerAgent(contents) {
  const last = contents[contents.length - 1];
  const hasResponses = (last?.parts || []).some((p) => p.functionResponse);
  const usageOf = (n) => ({ input: 400 + n, output: 60, total: 460 + n });
  if (hasResponses) {
    const results = last.parts.map((p) => String(p.functionResponse?.response?.result || ""));
    const refused = results.filter((r) => r.startsWith("refused")).length;
    const fc = { name: "finish", args: { summary: refused ? `Made the changes I could; ${refused} step${refused === 1 ? " was" : "s were"} refused by the rules.` : "Done as asked." } };
    return { text: "", functionCalls: [fc], parts: [{ functionCall: fc }], usage: usageOf(1), modelVersion: MODEL_VERSION, resourceName: "fake/model" };
  }
  const opening = String(contents[0]?.parts?.[0]?.text || "");
  const ask = (opening.split("THE SCHOLAR ASKS:")[1] || "").trim();
  const low = ask.toLowerCase();
  const blockNum = (re) => { const m = low.match(re); return m ? Number(m[1]) : null; };
  const blockLine = (n) => (opening.match(new RegExp(`^\\[${n}\\] \\(([a-z]+)\\)[^:]*: (.+)$`, "m")) || []);
  const firstPassage = (opening.match(/^\[(p\d+)\] (.+)$/m) || []);
  const calls = [];
  if (/^add (an )?(image|illustration|picture)/.test(low) || /add (an )?(image|illustration|picture)/.test(low)) {
    const after = blockNum(/after (?:block|paragraph) (\d+)/) ?? 1;
    calls.push({ name: "add_image", args: { after, description: ask.replace(/.*(image|illustration|picture) (of|showing) /i, ""), caption: `Illustration: ${ask.replace(/.*(image|illustration|picture) (of|showing) /i, "")}`, alt: "Illustration" } });
  } else if (/shorten|tighten|cut down/.test(low)) {
    const n = blockNum(/(?:block|paragraph) (\d+)/) ?? 2;
    const [, , text] = blockLine(n);
    const cites = (opening.match(new RegExp(`^\\[${n}\\] \\([a-z]+\\) cites ([p\\d,]+)`, "m")) || [])[1];
    const first = String(text || "").split(/(?<=[.!?])\s+/)[0] || "Shortened.";
    calls.push({ name: "replace_block", args: { index: n, text: first, passage_ids: cites ? cites.split(",") : [firstPassage[1] || "p1"] } });
  } else if (/delete|remove|drop/.test(low)) {
    const n = blockNum(/(?:block|paragraph) (\d+)/) ?? 2;
    calls.push({ name: "delete_block", args: { index: n } });
  } else if (/title/.test(low)) {
    calls.push({ name: "set_heading_fields", args: { title: ask.replace(/.*title (to|as) /i, "").replace(/^["“]|["”]$/g, "") } });
  } else if (/^say as (me|myself)|my own view|my view/.test(low)) {
    calls.push({ name: "insert_block", args: { after: 999, kind: "paragraph", text: ask.replace(/^.*?:\s*/, ""), passage_ids: [], own_view: true } });
  } else if (/add|mention|include/.test(low)) {
    /* Add a sentence from the paper: cite the first passage that matches a word of the ask. */
    const words = low.split(/\W+/).filter((w) => w.length > 5);
    const passages = [...opening.matchAll(/^\[(p\d+)\] (.+)$/gm)].map((m) => ({ id: m[1], text: m[2] }));
    const hit = passages.find((p) => words.some((w) => p.text.toLowerCase().includes(w))) || passages[0];
    if (!hit) calls.push({ name: "finish", args: { summary: "The paper has no passages to draw on." } });
    else calls.push({ name: "insert_block", args: { after: blockNum(/after (?:block|paragraph) (\d+)/) ?? 1, kind: "paragraph", text: hit.text.split(/(?<=[.!?])\s+/).slice(0, 2).join(" "), passage_ids: [hit.id] } });
  } else if (/first person|as me/.test(low)) {
    calls.push({ name: "replace_block", args: { index: 2, text: "I think this is the best part.", passage_ids: [firstPassage[1] || "p1"] } });
  } else {
    calls.push({ name: "finish", args: { summary: "I did not understand what to change; try naming a block number." } });
  }
  return { text: "", functionCalls: calls, parts: calls.map((fc) => ({ functionCall: fc })), usage: usageOf(2), modelVersion: MODEL_VERSION, resourceName: "fake/model" };
}

/** Same signature as `vertex.generateContent`. */
async function generateContent({ prompt, contents = null, tools = null }) {
  if (tools && Array.isArray(contents)) return answerAgent(contents);
  const p = String(prompt || (contents ? contents.map((c) => (c.parts || []).map((x) => x.text || "").join("\n")).join("\n") : ""));
  let text;
  if (p.includes("PARAGRAPHS OF THE AUTHOR'S OWN CONTEXT:")) text = answerContext(p);
  else if (p.includes("PARAGRAPHS THAT BUILD ON THEM:")) text = answerReach(p);
  else if (p.includes("PARAGRAPHS TO CHECK:")) text = answerJudge(p);
  else if (p.includes("=== PARAGRAPH TO REWRITE FOR ANOTHER READER ===")) text = answerLevel(p);
  else if (p.includes("=== PAPER, IN NUMBERED PASSAGES ===")) text = answerOutline(p);
  else if (p.includes("=== PASSAGES THIS SECTION MAY USE ===") || p.includes("=== PASSAGES THIS SECTION RELATES TO ===")) text = answerSection(p);
  else text = answerComposer(p);
  return { text, usage: usage(p, text), modelVersion: MODEL_VERSION, resourceName: "fake/model" };
}

module.exports = { MODEL_VERSION, generateContent };
