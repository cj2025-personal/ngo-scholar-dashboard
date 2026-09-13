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

function answerOutline(prompt) {
  const passages = passagesIn(prompt, "=== PAPER, IN NUMBERED PASSAGES ===");
  const titleMatch = prompt.match(/^Paper title: (.+)$/m);
  const title = (titleMatch ? titleMatch[1].replace(/\s*\(\d{4}\)\s*$/, "") : "A paper").slice(0, 100);
  const n = Math.max(2, Math.min(4, passages.length));
  const beats = [];
  for (let i = 0; i < n; i += 1) {
    const p = passages[i % Math.max(passages.length, 1)];
    beats.push({ heading: `Section ${i + 1}: ${sentences(p?.text || "")[0]?.split(/\s+/).slice(0, 4).join(" ") || "Findings"}`, goal: `Report what passage ${p?.id || "p1"} says.`, passage_ids: [p?.id || "p1"] });
  }
  return JSON.stringify({ title: `What the paper found: ${title}`, deck: `A report on ${title}, drawn from its own text.`, beats });
}

function answerSection(prompt) {
  const cited = passagesIn(prompt, "=== PASSAGES THIS SECTION MAY USE ===");
  const first = cited[0] || { id: "p1", text: "The paper reports its findings." };
  const s1 = sentences(first.text);
  const paragraphs = [{ text: s1.slice(0, 3).join(" "), passage_ids: [first.id] }];
  if (cited[1]) {
    const s2 = sentences(cited[1].text);
    paragraphs.push({ text: s2.slice(0, 3).join(" "), passage_ids: [cited[1].id] });
  }
  /* A voice violation on demand, so the refusal path can be driven end to end. */
  if (process.env.FAKE_MODEL_FIRST_PERSON === "1") paragraphs[0].text = `I found this. ${paragraphs[0].text}`;
  return JSON.stringify({ paragraphs, quote: s1[0] && s1[0].length >= 12 ? { text: s1[0], passage_id: first.id } : null });
}

function answerJudge(prompt) {
  const indexes = [...prompt.matchAll(/^\((\d+)\) /gm)].map((m) => Number(m[1]));
  return JSON.stringify({ paragraphs: indexes.map((index) => ({ index, verdict: "supported", unsupported_claims: [], reasons: [] })) });
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
  if (p.includes("PARAGRAPHS TO CHECK:")) text = answerJudge(p);
  else if (p.includes("=== PAPER, IN NUMBERED PASSAGES ===")) text = answerOutline(p);
  else if (p.includes("=== PASSAGES THIS SECTION MAY USE ===")) text = answerSection(p);
  else text = answerComposer(p);
  return { text, usage: usage(p, text), modelVersion: MODEL_VERSION, resourceName: "fake/model" };
}

module.exports = { MODEL_VERSION, generateContent };
