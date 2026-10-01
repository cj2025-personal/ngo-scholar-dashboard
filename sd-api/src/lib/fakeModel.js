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

/* ── the reading companion and its sub-agents, answered by wording ──────── */

const fakeFc = (name, args) => ({ text: "", functionCalls: [{ name, args }], parts: [{ functionCall: { name, args } }], usage: { input: 500, output: 40, total: 540 }, modelVersion: MODEL_VERSION, resourceName: "fake/model" });

/**
 * The reading companion's tool loop, answered from the question.
 *
 * Round one reads what the question points at: the paragraph it names, the
 * one the reader is looking at, or a search for the question itself. Round
 * two answers from what came back; when the closest search hit is not close
 * at all, the story does not say. Planted phrases drive the reviewer's
 * paths so the suites can assert on them: "made up" writes a claim the fake
 * Sentinel sends back (revise, then a clean second answer); "scary" writes a
 * sentence it refuses; "what does the word X mean" defines X as background;
 * "that thing" asks the reader which they mean.
 */
function answerReader(contents, signal = null) {
  const opening = String(contents[0]?.parts?.[0]?.text || "");
  const ask = (opening.split("THE READER ASKS:")[1] || "").trim();
  const low = ask.toLowerCase();
  const revising = opening.includes("A REVIEWER SENT YOUR LAST ANSWER BACK");
  const last = contents[contents.length - 1];
  const responses = (last?.parts || []).filter((p) => p.functionResponse).map((p) => String(p.functionResponse.response?.result || ""));

  if (!responses.length) {
    /* "take your time" stalls the first call, for the deadline path; an abort ends it the way it ends a real request. */
    if (/take your time/.test(low)) {
      return new Promise((resolve, reject) => {
        const t = setTimeout(() => resolve(fakeFc("read_block", { index: 1, reason: "Reading the first paragraph" })), Number(process.env.FAKE_MODEL_STALL_MS || 4000));
        signal?.addEventListener("abort", () => { clearTimeout(t); const e = new Error("aborted"); e.name = "AbortError"; reject(e); }, { once: true });
      });
    }
    if (/that thing/.test(low)) {
      return fakeFc("answer", { text: "Do you mean the array itself, or the trials it was tested in? Tell me which and I'll look it up.", grounding: "clarify", intent: "clarify", block_ids: ["b1"], follow_ups: [], reason: "Asking which part you mean" });
    }
    /* The paragraph named in the question, else the one the reader is looking at. */
    const m = low.match(/paragraph (\d+)/) || opening.match(/THE READER IS LOOKING AT: \[b(\d+)\]/);
    if (m) return fakeFc("read_block", { index: Number(m[1]), reason: `Reading paragraph ${m[1]}` });
    const term = (low.match(/what does the word ([a-z-]+)/) || [])[1];
    return fakeFc("search", { query: term || ask, reason: term ? `Looking for where the story uses “${term}”` : "Searching the story and the paper for what you asked" });
  }

  const found = responses.join("\n");
  const ids = [...found.matchAll(/^\s*\[([bp]\d+)\]/gm)].map((m) => m[1]);
  const blockIds = [...new Set(ids.filter((id) => id.startsWith("b")))];
  const passageIds = [...new Set(ids.filter((id) => id.startsWith("p")))];
  const firstText = (found.match(/^\s*\[[bp]\d+\](?: \([^)]*\))*(?: cites [p\d,]+)?:? (.+)$/m) || [])[1] || "";
  const sentence = sentences(firstText)[0] || "The story says so.";
  const topScore = Number((found.match(/similarity (-?[\d.]+)/) || [])[1]);
  const followUps = ["What did the trials show?", "What was not tested?"];

  const word = (low.match(/what does the word ([a-z-]+)/) || [])[1];
  if (word && ids.length) {
    return fakeFc("answer", { text: `“${word}” here is a plain word for the idea the paragraph is describing. Read the sentence around it and it will make sense.`, grounding: "background", intent: "define", term: word, block_ids: blockIds.slice(0, 1), passage_ids: [], follow_ups: followUps, reason: "Explaining the word" });
  }
  if (/scary/.test(low)) {
    return fakeFc("answer", { text: "This is frightening and violent, and you should be afraid.", grounding: "story", intent: "explain", block_ids: blockIds.slice(0, 1), passage_ids: passageIds.slice(0, 1), follow_ups: [], reason: "Answering" });
  }
  if (/made up/.test(low) && !revising) {
    return fakeFc("answer", { text: `${sentence} MADE UP FACT: the array was also tested on Mars.`, grounding: "story", intent: "explain", block_ids: blockIds.slice(0, 1), passage_ids: passageIds.slice(0, 1), follow_ups: followUps, reason: "Answering from what I read" });
  }
  if (!ids.length || (Number.isFinite(topScore) && topScore < 0.2)) {
    return fakeFc("answer", { text: "This article doesn't say. The closest it comes is the first paragraph, which you could read again.", grounding: "not_here", intent: "not_in_story", block_ids: ["b1"], passage_ids: [], follow_ups: followUps, reason: "Telling you the story doesn't cover this" });
  }
  const intent = /quiz/.test(low) ? "quiz" : "explain";
  return fakeFc("answer", { text: `Here is what the story says: ${sentence}`, grounding: "story", intent, block_ids: blockIds.slice(0, 2), passage_ids: passageIds.slice(0, 2), follow_ups: followUps, reason: "Answering from what I read" });
}

/**
 * The guard, answered by wording: contact details, names and places a
 * reader gives about themselves are spans to mask; "hurt someone" is
 * declined; everything else goes on to the companion.
 */
function answerGuard(prompt) {
  const q = (prompt.split("QUESTION TO SCREEN:")[1] || "").trim();
  const pii = [];
  for (const m of q.matchAll(/\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g)) pii.push({ text: m[0], kind: "email" });
  for (const m of q.matchAll(/(?:https?:\/\/|www\.)\S+/g)) pii.push({ text: m[0], kind: "link" });
  for (const m of q.matchAll(/\+?\d[\d\s().-]{8,}\d/g)) pii.push({ text: m[0], kind: "phone" });
  const name = q.match(/my name is ([A-Z][a-z]+)/i);
  if (name) pii.push({ text: name[1], kind: "name" });
  const place = q.match(/I live in ([A-Z][a-z]+)/);
  if (place) pii.push({ text: place[1], kind: "location" });
  const age = q.match(/I am (\d{1,2})\b/i);
  if (age) pii.push({ text: age[1], kind: "age" });
  const about = pii.length > 0 || /\b(my name|i live|i am \d)/i.test(q);
  const decline = /hurt someone|kill/i.test(q);
  const intent = decline ? "unsafe" : /quiz/i.test(q) ? "quiz" : /what does the word/i.test(q) ? "define" : /dinner|unicorn/i.test(q) ? "off_topic" : about ? "personal" : "explain";
  return JSON.stringify({ pii, about_reader: about, intent, route: decline ? "decline" : "answer", decline_reason: decline ? "unsafe" : "none", rationale: decline ? "Asks for harm." : "A question about the article." });
}

/**
 * The Sentinel, answered by wording. "MADE UP" is not in the sources and is
 * sent back with guidance; "frightening" is refused; a question about the
 * reader is refused; a link is sent back; anything else passes.
 */
function answerSentinelRuling(prompt) {
  const answer = (prompt.split("ANSWER TO RULE ON:")[1] || "").trim();
  const anchors = [...prompt.matchAll(/^\[([bp]\d+)\] /gm)].map((m) => m[1]);
  const claims = sentences(answer).map((s) => {
    const absence = /doesn't say|does not say|read it again|read the sentence|do you mean/i.test(s);
    const madeUp = /MADE UP/.test(s);
    return { text: s, in_sources: !madeUp, anchor_ids: !madeUp && !absence ? anchors.slice(0, 1) : [], unsuitable: /frightening|violent/i.test(s), personal_data: /your name|where you live|how old are you/i.test(s), off_topic: false };
  });
  let verdict = "pass";
  let reasons = [];
  let guidance = "";
  if (claims.some((c) => c.unsuitable)) { verdict = "refuse"; reasons = ["unsuitable"]; }
  else if (claims.some((c) => c.personal_data)) { verdict = "refuse"; reasons = ["asks_about_reader"]; }
  else if (/MADE UP/.test(answer)) { verdict = "revise"; reasons = ["not_in_sources"]; guidance = "Remove “the array was also tested on Mars”: the article and the cited passages do not say it."; }
  else if (/https?:\/\/|www\./.test(answer)) { verdict = "revise"; reasons = ["link_or_contact"]; guidance = "Take the link out and say it in words."; }
  return JSON.stringify({
    claims, link_or_contact: /https?:\/\/|www\./.test(answer), asks_about_reader: /your name|where you live/i.test(answer),
    reading_level: "fits", length: "fits", unchecked_specifics: false, story_answers_it: false,
    verdict, reasons, guidance, rationale: verdict === "pass" ? "Every claim is in what it cites." : `Ruled ${verdict}.`,
  });
}

function answerRefusal() {
  return JSON.stringify({ text: "I can't answer that one well from this article, but I'd be glad to help with anything in its paragraphs." });
}

function answerMemory(prompt) {
  const n = (prompt.match(/^Reader: /gm) || []).length;
  const prev = (prompt.match(/SUMMARY SO FAR: (.+)/) || [])[1] || "";
  const before = Number((prev.match(/asked (\d+)/) || [])[1]) || 0;
  return JSON.stringify({ summary: `Earlier, the reader asked ${before + n} questions about the article.` });
}

function answerSuggest(prompt) {
  const focus = (prompt.match(/THE PARAGRAPH IN FOCUS: \[b(\d+)\]/) || [])[1];
  const headings = [...prompt.matchAll(/^\[b\d+\] \((?:sub)?heading\) (.+)$/gm)].map((m) => m[1]);
  const groups = [];
  if (focus) groups.push({ title: "About the paragraph you tapped", questions: [`What does paragraph ${focus} mean?`, `How did they find out what paragraph ${focus} says?`] });
  groups.push({ title: "About the whole story", questions: ["What's the main point of this story?", "What did they actually do in this study?"] });
  if (headings.length) groups.push({ title: "By section", questions: headings.map((h) => `What is “${h}” about?`) });
  groups.push({ title: "Test yourself", questions: ["Quiz me on what I've read"] });
  return JSON.stringify({ groups });
}

/**
 * The studio agent's reading of a scholar, for the test double: plain rules
 * over the prompt the real model is given, so the suite can walk every path
 * the page takes. The real model reads the same prompt and decides.
 */
const CONVERSE_STOP = new Set(["the", "and", "for", "with", "from", "that", "this", "into", "over", "about", "paper", "study", "article", "research", "using", "based", "small", "large", "their", "there", "what", "which", "when", "have", "been", "were", "will", "would", "should", "could", "than", "then", "them", "they", "your", "some", "more", "most", "very", "also", "just", "like", "make", "write", "want", "generate", "draft", "create"]);
const contentWords = (t) => String(t || "").toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3 && !CONVERSE_STOP.has(w));

function answerConverse(prompt) {
  const between = (start, end) => {
    const a = prompt.indexOf(start);
    if (a < 0) return "";
    const b = end ? prompt.indexOf(end, a + start.length) : -1;
    return prompt.slice(a + start.length, b < 0 ? undefined : b);
  };
  const papers = between("THEIR PAPERS (key — title):", "READER AGES").split("\n")
    .map((l) => l.trim().match(/^(\S+) — (.+?)(?: \(\d{4}\))?(?:, \d+ words)?$/)).filter(Boolean)
    .map((m) => ({ key: m[1], title: m[2] }));
  const labels = Object.fromEntries(between("READER AGES (value — label):", "VOICES").split("\n")
    .map((l) => l.trim().match(/^(\S+) — (.+)$/)).filter(Boolean).map((m) => [m[1], m[2]]));
  const said = between("THE SCHOLAR JUST SAID:", null).trim();
  const earlier = between("THE CONVERSATION SO FAR:", "THE SCHOLAR JUST SAID:").split("\n")
    .filter((l) => l.startsWith("Scholar: ")).map((l) => l.slice("Scholar: ".length).trim());
  const setPaper = (prompt.match(/^paper: (\S+)/m) || [])[1];
  const setReader = (prompt.match(/; reader: ([a-z0-9_]+)/) || [])[1] || null;
  const stage = (prompt.match(/^stage: (\w+)/m) || [])[1] || "start";

  const out = (action, extra = {}) => JSON.stringify({ action, paper_key: "none", audience: "none", voice: "none", extra_audiences: [], brief: "", reply: "", rationale: `fake: ${action}`, ...extra });

  if (stage === "outline_waiting") {
    if (/^(looks good|approve|approved|go ahead|yes|draft it|perfect)\b/i.test(said)) return out("approve", { reply: "Drafting it now." });
    if (/\b(discard|drop it|scrap it|start over)\b/i.test(said)) return out("discard", { reply: "Discarded. Describe another article whenever you like." });
    return out("replan", { brief: said, reply: "Replanning the outline from what you said." });
  }

  /* The page's own taps, and a request for a paper with nothing described yet, are not briefs. */
  const bare = (t) => /\b(paper|papers|study|research|publication|article)\b/i.test(t) && contentWords(t).length <= 3;
  const isBrief = (t) => Boolean(t) && !/^use “/i.test(t) && !/^for [^.]{0,24}\.$/i.test(t) && !bare(t);
  const brief = isBrief(said) ? said : [...earlier].reverse().find(isBrief) || "";

  const named = (() => {
    const asked = new Set(contentWords(`${said} ${brief}`));
    const scored = papers.map((p) => {
      const title = contentWords(p.title);
      const hits = title.filter((w) => asked.has(w)).length;
      return { p, hits, share: title.length ? hits / title.length : 0 };
    }).filter((s) => s.hits >= 2 || (s.hits >= 1 && s.share >= 0.5)).sort((a, b) => b.hits - a.hits || b.share - a.share);
    if (!scored.length || (scored.length > 1 && scored[0].hits === scored[1].hits)) return null;
    return scored[0].p;
  })();
  const paper = papers.find((p) => p.key === setPaper) || named || (papers.length === 1 ? papers[0] : null);

  const readerIn = (t) => {
    const s = String(t || "").toLowerCase();
    if (/\b(kids?|children|aged? 8|young readers)\b/.test(s)) return "ages_8_11";
    if (/\b(aged? 12|middle school|tweens?)\b/.test(s)) return "ages_12_14";
    if (/\b(aged? 15|teens?|teenagers?|high school)\b/.test(s)) return "ages_15_18";
    if (/\b(adults?|general readers?|the public)\b/.test(s)) return "adults";
    return null;
  };
  const reader = readerIn(said) || setReader || readerIn(brief);

  if (/\b(what could (this|the|it)|ideas for|propose|suggest an angle)\b/i.test(said)) {
    return paper ? out("propose", { paper_key: paper.key, reply: `I will read “${paper.title}” and propose what it could become.` }) : out("ask_paper", { reply: "Which paper should I read? Tap one, or name it." });
  }
  if (!paper) {
    return out("ask_paper", { brief, reply: brief ? "Which of your papers should this come from? Tap one, or name it." : "Which of your papers should this come from? Tap one, or name it. Only papers we hold in full and may reproduce are listed." });
  }
  if (!brief) {
    return out("set_paper", { paper_key: paper.key, reply: `Working from “${paper.title}”. Now tell me what the article should be: what to focus on, what to leave out, who it is for — or ask what the paper could become.` });
  }
  if (!reader) {
    return out("ask_audience", { paper_key: paper.key, brief, reply: `Working from “${paper.title}”. Who is this for? Tap an age, or tell me.` });
  }
  return out("plan", { paper_key: paper.key, audience: reader, brief, reply: `Planning it from “${paper.title}”, for ${(labels[reader] || reader).toLowerCase()}. I will read the paper and come back with an outline.` });
}

/** Ideas for the studio, for the test double: built from what the prompt shows. */
function answerIdeas(prompt) {
  if (prompt.includes("PAPERS TO SUGGEST ARTICLES FROM:")) {
    const chosen = (prompt.match(/^THE CHOSEN PAPER: (.+)$/m) || [])[1];
    const titles = [...prompt.matchAll(/^- (.+?)(?: \(\d{4}\))?$/gm)].map((m) => m[1]);
    const groups = [];
    if (chosen) groups.push({ title: "Ask the agent", ideas: [{ text: "What could this paper become?", action: "propose" }] });
    const about = chosen || titles[0] || "this paper";
    groups.push({ title: "Briefs to start from", ideas: [
      { text: `Explain the key finding of “${about}” and how it was reached, for readers aged 12 to 14`, action: "prefill" },
      { text: "Focus on the limitations: what was not tested, and what that means", action: "prefill" },
      { text: "A short piece on how the experiment was actually done, step by step", action: "prefill" },
    ] });
    return JSON.stringify({ groups });
  }
  const lines = [...prompt.matchAll(/^\[(\d+)\] \((\w+)\)(?: \{([^}]*)\})? (.*)$/gm)].map((m) => ({ index: Number(m[1]), type: m[2], notes: m[3] || "", text: m[4] }));
  const flagged = lines.filter((b) => /checker: (?!supported)|beyond the paper: (?!follows)/.test(b.notes));
  const focus = Number((prompt.match(/^THE SCHOLAR IS ON PARAGRAPH: (\d+)/m) || [])[1]) || null;
  const groups = [];
  if (flagged.length) groups.push({ title: "Needs a look", ideas: flagged.slice(0, 3).map((b) => ({ text: `Rewrite paragraph ${b.index} so every claim stays within the paper`, action: "prefill" })) });
  if (/^THE PAPER'S RECORD: (?!nothing has changed)/m.test(prompt)) groups.push({ title: "On the record", ideas: [{ text: "Add a short notice at the top saying the paper has been updated on the record", action: "prefill" }] });
  if (focus) groups.push({ title: "The paragraph you are on", ideas: [{ text: `Shorten paragraph ${focus} to two sentences`, action: "prefill" }, { text: `Add an illustration after paragraph ${focus}`, action: "prefill" }] });
  groups.push({ title: "The whole article", ideas: [
    { text: "Shorten the opening to two sentences", action: "prefill" },
    { text: "Add a paragraph about the limitations, citing the paper", action: "prefill" },
  ] });
  const headings = lines.filter((b) => b.type === "heading" || b.type === "subheading").slice(0, 3);
  if (headings.length) groups.push({ title: "By section", ideas: headings.map((h) => ({ text: `Tighten the section “${h.text.replace(/[.?!]+$/, "")}”`, action: "prefill" })) });
  return JSON.stringify({ groups });
}

/* ── Voice and reading level, as the test double judges them ──────────────
   The rules the composer once enforced, kept here only so the fake voice
   judge answers the way the suite expects. Production asks a model. */

/* Exact forms, case-sensitive, so "US" (the country) and "Us" do not trip it
   while "I", "We" at sentence start and "we" mid-sentence do. */
/* The singular first person is the author, always, with no second reading. */
const FIRST_PERSON = new Set([
  "I", "I'm", "I've", "I'd", "I'll", "me", "my", "mine", "myself",
  "My", "Me", "Mine", "Myself",
]);

/**
 * "We" has two meanings and only one of them is forbidden.
 *
 * ── What this cost ──────────────────────────────────────────────────────────
 * Every `we`, `us` and `our` counted as the author speaking, so an article
 * for a child — where "things we use every day" and "it helps us find" are
 * ordinary English for everyone, the reader included — tripped the guard on
 * the first section and the run refused. A scholar approved six sections and
 * got a sentence telling them to try a different paper. Measured on the real
 * model: three such sentences in the first section, none of them the author.
 *
 * ── The line ────────────────────────────────────────────────────────────────
 * The authorial "we" attaches to the work: a verb for doing research, or a
 * possessive over what was produced. The inclusive "we" attaches to the
 * world. So `we found`, `we measured`, `our method`, `our results` are the
 * author; `we use every day`, `helps us find`, `tells us about the weather`
 * are not. Everyday verbs are deliberately absent from the list — "we use"
 * and "we see" are how you explain anything to anyone.
 *
 * A heuristic, so it can miss: "we wanted to know whether" is the author and
 * passes. That is the cheap failure — one sentence in front of the scholar,
 * who is reading the draft anyway. The expensive failure was the other
 * direction, and it threw six sections away.
 */
const RESEARCH_VERB = /\b[Ww]e\s+(?:\w+ly\s+|also\s+|then\s+|first\s+|next\s+|have\s+|had\s+|here\s+)*(?:found|find|show|showed|shown|present|presented|propose|proposed|develop|developed|design|designed|build|built|test|tested|measure|measured|ran|run|observe|observed|report|reported|conclude|concluded|demonstrate|demonstrated|evaluate|evaluated|compare|compared|analyse|analysed|analyze|analyzed|derive|derived|simulate|simulated|investigate|investigated|introduce|introduced|implement|implemented|collect|collected|record|recorded|obtain|obtained|establish|established|verify|verified|confirm|confirmed|validate|validated|quantify|quantified|assess|assessed|examine|examined|estimate|estimated|calculate|calculated|compute|computed|apply|applied|carried\s+out|carry\s+out|set\s+out|cut|reduce|reduced|improve|improved|achieve|achieved|increase|increased|decrease|decreased|eliminate|eliminated|suppress|suppressed|solve|solved)\b/;
const OUR_WORK = /\b[Oo]ur\s+(?:\w+\s+){0,2}(?:method|methods|approach|approaches|work|paper|papers|study|studies|research|result|results|finding|findings|data|dataset|experiment|experiments|simulation|simulations|analysis|algorithm|algorithms|technique|techniques|model|models|array|arrays|system|systems|design|implementation|measurement|measurements|trial|trials|test|tests|contribution|contributions|proposal|hypothesis)\b/;

/** Sentences of `text` that speak in the author's own first person. */
function firstPersonSentences(text) {
  const sentences = String(text || "").split(/(?<=[.!?])\s+/);
  return sentences.filter((raw) => {
    const sentence = raw.replace(/[“”"]/g, "");
    const singular = sentence
      .split(/\s+/)
      .map((w) => w.replace(/^[^A-Za-z']+|[^A-Za-z']+$/g, ""))
      .some((w) => FIRST_PERSON.has(w));
    return singular || RESEARCH_VERB.test(sentence) || OUR_WORK.test(sentence);
  });
}

/* Ways an article refers to its own author without naming them. */
const AUTHOR_NOUNS = /\b(?:the|this|its)\s+(?:present\s+|current\s+)?(?:author|authors|researcher|researchers|investigator|investigators|writer)\b/i;
/* Singular personal pronouns. In an impersonal account there is rarely a
   legitimate one, and the failure this guards is a real person's pronoun
   being guessed — so they are reported, but as a warning, not a refusal. */
const PERSONAL_PRONOUN = /\b(?:he|him|his|she|her|hers)\b/i;

/** The forms a name is referred to by: the full name, and each part long enough to be distinctive. */
function nameForms(scholarName) {
  const full = String(scholarName || "").replace(/\s+/g, " ").trim();
  if (!full) return [];
  const parts = full.split(" ").filter((p) => p.replace(/[^A-Za-z]/g, "").length >= 3);
  return [...new Set([full, ...parts])].filter(Boolean);
}

/**
 * Sentences that refer to the article's own author, which VOICE.AUTHOR
 * forbids. Two severities, because they deserve different answers:
 *
 *   named     the author is named, or called "the author". Unambiguous, and
 *             the drafter is sent back to rewrite it.
 *   pronouns  a gendered pronoun, which usually means the author crept in as
 *             a subject but may legitimately refer to someone else the paper
 *             names. Reported to the scholar, never a refusal — guessing
 *             which is which is exactly the judgement a person should make.
 *
 * @param {string} text
 * @param {string|null} scholarName
 * @returns {{named: string[], pronouns: string[]}}
 */
function selfReferenceSentences(text, scholarName = null) {
  const forms = nameForms(scholarName).map((f) => new RegExp(`\\b${f.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i"));
  const named = [];
  const pronouns = [];
  for (const sentence of String(text || "").split(/(?<=[.!?])\s+/)) {
    if (!sentence.trim()) continue;
    if (forms.some((re) => re.test(sentence)) || AUTHOR_NOUNS.test(sentence)) named.push(sentence);
    else if (PERSONAL_PRONOUN.test(sentence)) pronouns.push(sentence);
  }
  return { named, pronouns };
}


/** The voice judge, for the test double: the rules above over the paragraphs it is shown. */
function answerVoice(prompt) {
  const voice = (prompt.match(/^THE VOICE: (author|about)/m) || [])[1] || "about";
  const name = (prompt.match(/^THE SCHOLAR: (.+)$/m) || [])[1] || "";
  const scholar = /^\(name not known\)$/.test(name) ? null : name;
  const body = prompt.slice(prompt.indexOf("PARAGRAPHS TO CHECK FOR VOICE:"));
  const paragraphs = [...body.matchAll(/^\[P(\d+)\] (.*)$/gm)].map((m) => ({ index: Number(m[1]), text: m[2] }));
  return JSON.stringify({
    paragraphs: paragraphs.map((p) => {
      const self = voice === "author" ? selfReferenceSentences(p.text, scholar) : { named: [], pronouns: [] };
      return {
        id: `P${p.index}`,
        findings: [
          ...firstPersonSentences(p.text).map((sentence) => ({ sentence, kind: "speaks_as_author", reason: "It speaks as the researchers." })),
          ...self.named.map((sentence) => ({ sentence, kind: "names_author", reason: "It names the author in their own account." })),
          ...self.pronouns.map((sentence) => ({ sentence, kind: "pronoun_for_author", reason: "A pronoun may stand for the author." })),
        ],
      };
    }),
  });
}

/** The band judge, for the test double: the reading-grade formula decides, as it once did. */
function answerBand(prompt) {
  const { AUDIENCES } = require("./audiences");
  const { assessDraftReadability, VERDICT } = require("./draftReadability");
  const readers = (prompt.match(/^THE READER: (.+?)\. What they need:/m) || [])[1];
  const audience = Object.keys(AUDIENCES).find((k) => AUDIENCES[k].readers === readers) || "adults";
  const text = prompt.slice(prompt.indexOf("PROSE TO PLACE FOR ITS READER:") + "PROSE TO PLACE FOR ITS READER:".length).trim();
  const a = assessDraftReadability({ text, audience });
  if (a.verdict !== VERDICT.FAIL) return JSON.stringify({ verdict: "fits", reason: "It reads at the reader's level.", guidance: "", sentences: [] });
  const longest = text.split(/(?<=[.!?])\s+/).sort((x, y) => y.length - x.length).slice(0, 2);
  return JSON.stringify(a.tooSimple
    ? { verdict: "too_simple", reason: `It reads well below ${AUDIENCES[audience].readers}.`, guidance: "Join sentences that belong together and vary their length; name a thing once and use the name after that.", sentences: [] }
    : { verdict: "too_hard", reason: `It reads above ${AUDIENCES[audience].readers} (grade ${a.fkGrade} against ${a.targetGrade}).`, guidance: "Shorten sentences to 15–20 words, prefer one- and two-syllable words, and define each technical term in the sentence that introduces it.", sentences: longest });
}

/**
 * Embeddings for the test double: words hashed into a fixed space, so texts
 * that share words point the same way and texts that share none are near
 * orthogonal. Enough for "the closest passage" to mean something in a suite.
 */
function embed({ texts, model }) {
  const DIMS = 256;
  const STOP = new Set(["the", "and", "that", "this", "with", "what", "does", "from", "they", "them", "were", "have", "which", "about", "into", "their", "there", "when", "your", "mean"]);
  const vec = (t) => {
    const v = new Array(DIMS).fill(0);
    for (const raw of String(t || "").toLowerCase().split(/[^a-z0-9]+/)) {
      if (raw.length < 4 || STOP.has(raw)) continue;
      const w = raw.replace(/(ing|ers|er|es|s)$/, "");
      let h = 2166136261;
      for (let i = 0; i < w.length; i += 1) { h ^= w.charCodeAt(i); h = Math.imul(h, 16777619); }
      v[Math.abs(h) % DIMS] += 1;
    }
    return v;
  };
  return Promise.resolve({ vectors: texts.map(vec), model, usage: { input: texts.join(" ").length / 4 } });
}

/** Same signature as `vertex.generateContent`. */
async function generateContent({ prompt, contents = null, tools = null, signal = null, model = null }) {
  if (tools && Array.isArray(contents)) {
    if (String(contents[0]?.parts?.[0]?.text || "").includes("THE READER ASKS:")) return answerReader(contents, signal);
    return answerAgent(contents);
  }
  const p = String(prompt || (contents ? contents.map((c) => (c.parts || []).map((x) => x.text || "").join("\n")).join("\n") : ""));
  let text;
  if (p.includes("QUESTION TO SCREEN:")) text = answerGuard(p);
  else if (p.includes("ANSWER TO RULE ON:")) text = answerSentinelRuling(p);
  else if (p.includes("REFUSAL TO WRITE:")) text = answerRefusal(p);
  else if (p.includes("THREAD TO SUMMARISE:")) text = answerMemory(p);
  else if (p.includes("QUESTIONS TO SUGGEST FOR:")) text = answerSuggest(p);
  else if (p.includes("THE SCHOLAR JUST SAID:")) text = answerConverse(p);
  else if (p.includes("PARAGRAPHS TO CHECK FOR VOICE:")) text = answerVoice(p);
  else if (p.includes("PROSE TO PLACE FOR ITS READER:")) text = answerBand(p);
  else if (p.includes("DRAFT TO SUGGEST EDITS FOR:") || p.includes("PAPERS TO SUGGEST ARTICLES FROM:")) text = answerIdeas(p);
  else if (p.includes("PARAGRAPHS OF THE AUTHOR'S OWN CONTEXT:")) text = answerContext(p);
  else if (p.includes("PARAGRAPHS THAT BUILD ON THEM:")) text = answerReach(p);
  else if (p.includes("PARAGRAPHS TO CHECK:")) text = answerJudge(p);
  else if (p.includes("=== PARAGRAPH TO REWRITE FOR ANOTHER READER ===")) text = answerLevel(p);
  else if (p.includes("=== PAPER, IN NUMBERED PASSAGES ===")) text = answerOutline(p);
  else if (p.includes("=== PASSAGES THIS SECTION MAY USE ===") || p.includes("=== PASSAGES THIS SECTION RELATES TO ===")) text = answerSection(p);
  else text = answerComposer(p);
  return { text, usage: usage(p, text), modelVersion: MODEL_VERSION, resourceName: model ? `fake/${model}` : "fake/model" };
}

module.exports = { MODEL_VERSION, generateContent, embed };
