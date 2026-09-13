/**
 * The drafting graph.
 *
 *   START → pick_source → plan_outline → draft_blocks → assemble → verify → END
 *                                             ↑                        │
 *                                             └── once, if too hard ───┘
 *
 * ── What LangGraph is for here ──────────────────────────────────────────────
 * Named nodes with one job each, typed state between them, and a conditional
 * edge for the one loop the drafter has. That is the whole of it. The model
 * client, the progress sink and the run recorder are injected, so the graph
 * runs in a test with a fake model and no database.
 *
 * ── Where the durable state lives ───────────────────────────────────────────
 * In the job document, not in a LangGraph checkpointer. The plan describes
 * `interrupt()` before publish; here that pause is the job's
 * `awaiting_review` status, which survives a restart, is visible to the
 * composer, and is closed by the scholar through the resume endpoint. An
 * in-memory checkpointer would not survive a restart and a Mongo checkpointer
 * would be a second store of state this service already owns. The graph is
 * therefore stateless per run and ends where the scholar begins.
 *
 * ── The loops ───────────────────────────────────────────────────────────────
 * Inside `draft_blocks`, every section is judged for fidelity before it is
 * accepted: a second prompt with a fact-checker's job compares the section's
 * paragraphs with the passages they cite. A section with an unsupported
 * paragraph is redrafted with the claims named, up to FIDELITY_RETRIES times;
 * after that unsupported paragraphs are dropped, partial ones ship with a
 * warning, and a section left with no prose fails the run with a sentence.
 * The judge never sees the drafter's instructions and the drafter never sees
 * the judge's — no machine approves its own output.
 *
 * `verify` measures readability. If the draft fails for its audience and no
 * simplification pass has run yet, `draft_blocks` runs again with a note
 * naming the measured grade. Once. A second failure ships with a warning: the
 * scholar is about to edit it, and knowing the measured level is what makes
 * the edit purposeful.
 */

const { StateGraph, Annotation, START, END } = require("@langchain/langgraph");

const composer = require("./draftComposer");
const plan = require("./draftPlan");
const fidelity = require("./fidelity");
const { assessDraftReadability, simplificationNote, VERDICT } = require("./draftReadability");
const { USE } = require("./draftEligibility");

const GRAPH_VERSION = "draft-graph-2026.2";

/** One retry per section for voice; the graph refuses after that. */
const SECTION_VOICE_RETRIES = 1;
/** Redrafts a section may earn from the fidelity judge: three attempts in all. */
const FIDELITY_RETRIES = 2;

const State = Annotation.Root({
  /* inputs */
  source: Annotation(),
  scholar: Annotation(),
  audience: Annotation(),
  prepared: Annotation(),
  brief: Annotation(),
  /* produced */
  passages: Annotation(),
  outline: Annotation(),
  sections: Annotation(),
  draft: Annotation(),
  readability: Annotation(),
  readabilityNote: Annotation(),
  readabilityRetried: Annotation(),
  warnings: Annotation({ reducer: (a, b) => [...(a || []), ...(b || [])], default: () => [] }),
  calls: Annotation({ reducer: (a, b) => [...(a || []), ...(b || [])], default: () => [] }),
});

/**
 * @param {object} deps
 * @param {(req: {prompt: string, systemInstruction: string, responseSchema: object, temperature?: number, maxOutputTokens?: number}) => Promise<{text: string, usage?: object, modelVersion?: string|null}>} deps.generate
 * @param {(event: {step: string, message: string, detail?: object}) => (void|Promise<void>)} [deps.onProgress]
 */
function buildDraftNodes({ generate, onProgress = async () => {} }) {
  if (typeof generate !== "function") throw new TypeError("buildDraftGraph requires generate()");
  const system = composer.buildSystemInstruction();
  const progress = (step, message, detail) => Promise.resolve(onProgress({ step, message, detail }));

  async function pick_source(s) {
    if (!s.source || s.source.use !== USE.DRAFTABLE) {
      throw new Error(`This source can't be drafted from: ${s.source?.reason || "not draftable"}.`);
    }
    const passages = plan.splitPassages(s.prepared.text);
    if (passages.length === 0) throw new Error("We hold this source's title but not enough of its text to draft from.");
    await progress("pick_source", `Reading “${s.source.title}” — ${passages.length} passages, ${s.prepared.words.toLocaleString()} words.`, {
      passages: passages.length,
      truncated: s.prepared.truncated,
    });
    return { passages };
  }

  async function plan_outline(s) {
    /* An outline the scholar already approved is not replanned. */
    if (s.outline && Array.isArray(s.outline.beats) && s.outline.beats.length) {
      await progress("plan_outline", `Using the outline you approved: ${s.outline.beats.length} sections.`, { beats: s.outline.beats.length, approved: true });
      return { outline: s.outline };
    }
    await progress("plan_outline", "Planning the article's sections…");
    const prompt = plan.buildOutlinePrompt({
      scholar: s.scholar, source: s.source, passages: s.passages, truncated: s.prepared.truncated, audience: s.audience, brief: s.brief || null,
    });
    const r = await generate({ prompt, systemInstruction: system, responseSchema: plan.OUTLINE_SCHEMA, temperature: 0.3, maxOutputTokens: 2048 });
    const outline = plan.parseOutline(r.text, s.passages);
    await progress("plan_outline", `Outlined ${outline.beats.length} sections: ${outline.beats.map((b) => b.heading).join(" · ")}`, {
      beats: outline.beats.length,
    });
    return { outline, calls: [{ step: "plan_outline", usage: r.usage || null, model: r.modelVersion || null }] };
  }

  async function draft_blocks(s) {
    const sections = {};
    const calls = [];
    const warnings = [];
    const total = s.outline.beats.length;
    for (const beat of s.outline.beats) {
      await progress("draft_blocks", `Drafting section ${beat.index} of ${total}: ${beat.heading}`, { index: beat.index, total });
      let fidelityNote = null;
      let accepted = null;

      for (let round = 0; round <= FIDELITY_RETRIES; round += 1) {
        /* Draft, with one voice retry. */
        let strictVoice = false;
        let result = null;
        for (let attempt = 0; attempt <= SECTION_VOICE_RETRIES; attempt += 1) {
          const prompt = plan.buildSectionPrompt({
            scholar: s.scholar, beat, passages: s.passages, outline: s.outline, audience: s.audience,
            strictVoice, readabilityNote: s.readabilityNote || null, fidelityNote,
          });
          const r = await generate({ prompt, systemInstruction: system, responseSchema: plan.SECTION_SCHEMA, temperature: strictVoice ? 0.2 : 0.4, maxOutputTokens: 2048 });
          calls.push({ step: "draft_blocks", beat: beat.index, usage: r.usage || null, model: r.modelVersion || null, strictVoice, round });
          result = plan.parseSection(r.text, { beat, passages: s.passages });
          if (result.violations.length === 0) break;
          strictVoice = true;
        }
        if (result.violations.length > 0) {
          throw new Error(`Section ${beat.index} kept writing in the first person after a retry.`);
        }

        /* Judge. */
        await progress("judge_fidelity", `Checking section ${beat.index} of ${total} against the paper…`, { index: beat.index, total, round });
        const judged = await fidelity.judgeSection({ blocks: result.blocks, passages: s.passages, generate });
        if (judged.call) calls.push({ ...judged.call, beat: beat.index, round });

        if (judged.failing.length === 0) {
          accepted = { ...result, blocks: judged.blocks };
          break;
        }
        if (round < FIDELITY_RETRIES) {
          fidelityNote = fidelity.fidelityNote(judged.blocks, judged.failing);
          continue;
        }

        /* Out of retries. Drop what is unsupported, keep what is partial with a
           warning, and refuse the run if nothing survives. */
        const kept = judged.blocks.filter((b, i) => !(judged.failing.includes(i) && b.fidelity?.verdict === fidelity.VERDICT.UNSUPPORTED));
        const dropped = judged.blocks.length - kept.length;
        const partial = kept.filter((b) => b.fidelity?.verdict === fidelity.VERDICT.PARTIAL).length;
        if (!kept.some((b) => b.type === "paragraph")) {
          throw new Error(`Section ${beat.index} ("${beat.heading}") kept making claims the paper doesn't support.`);
        }
        if (dropped) warnings.push(`${dropped} paragraph${dropped === 1 ? "" : "s"} in "${beat.heading}" ${dropped === 1 ? "was" : "were"} left out because the fact-check found ${dropped === 1 ? "it" : "them"} unsupported by the paper.`);
        if (partial) warnings.push(`${partial} paragraph${partial === 1 ? "" : "s"} in "${beat.heading}" ${partial === 1 ? "is" : "are"} only partly supported by the paper; the unsupported claims are marked on the block.`);
        accepted = { ...result, blocks: kept };
      }

      warnings.push(...accepted.warnings);
      sections[beat.index] = accepted;
    }
    return { sections, calls, warnings };
  }

  async function assemble(s) {
    await progress("assemble", "Assembling the draft…");
    const draft = plan.assemble({ outline: s.outline, sections: s.sections });
    return { draft };
  }

  async function verify(s) {
    const readability = assessDraftReadability({ text: s.draft.prose, audience: s.audience });
    const failing = readability.verdict === VERDICT.FAIL;
    await progress(
      "verify",
      failing
        ? `Measured at reading grade ${readability.fkGrade} for a target of ${readability.targetGrade}` +
          (s.readabilityRetried ? "; shipping with a note." : "; simplifying once.")
        : `Measured at reading grade ${readability.fkGrade ?? "n/a"} for a target of ${readability.targetGrade}.`,
      { verdict: readability.verdict, fkGrade: readability.fkGrade, drift: readability.drift },
    );
    if (failing && !s.readabilityRetried) {
      return { readability, readabilityNote: simplificationNote(readability), readabilityRetried: true };
    }
    const warnings = [];
    if (readability.verdict !== VERDICT.PASS && readability.reason) warnings.push(`This draft ${readability.reason}.`);
    if (s.prepared.truncated) {
      warnings.push(
        `Only the first ${s.prepared.words.toLocaleString()} of ${s.prepared.totalWords.toLocaleString()} words were used; the rest of the paper is not reflected here.`,
      );
    }
    return { readability, readabilityNote: null, warnings };
  }

  return { pick_source, plan_outline, draft_blocks, assemble, verify };
}

function buildDraftGraph(deps) {
  const n = buildDraftNodes(deps);
  const graph = new StateGraph(State)
    .addNode("pick_source", n.pick_source)
    .addNode("plan_outline", n.plan_outline)
    .addNode("draft_blocks", n.draft_blocks)
    .addNode("assemble", n.assemble)
    .addNode("verify", n.verify)
    .addEdge(START, "pick_source")
    .addEdge("pick_source", "plan_outline")
    .addEdge("plan_outline", "draft_blocks")
    .addEdge("draft_blocks", "assemble")
    .addEdge("assemble", "verify")
    .addConditionalEdges("verify", (s) => (s.readabilityNote ? "draft_blocks" : END), ["draft_blocks", END]);

  return graph.compile();
}

/**
 * The first two nodes only: read the paper and propose an outline for the
 * scholar to approve. The same nodes the full run uses, so an approved
 * outline re-enters the graph unchanged.
 *
 * @returns {Promise<{outline: {title, deck, beats}, passages: {id, words}[], calls: object[]}>}
 */
async function runOutlineOnly(input, deps) {
  const nodes = buildDraftNodes(deps);
  const picked = await nodes.pick_source(input);
  const planned = await nodes.plan_outline({ ...input, ...picked });
  return {
    outline: planned.outline,
    passages: picked.passages.map((p) => ({ id: p.id, words: p.words, text: p.text })),
    calls: planned.calls || [],
    graphVersion: GRAPH_VERSION,
  };
}

/**
 * Approve an outline: keep the beats the scholar kept, in their order, with
 * their headings, and only passages that exist. Cut beats are gone.
 */
function normaliseApprovedOutline(proposed, approved, passages) {
  const known = new Set(passages.map((p) => p.id));
  const beats = (Array.isArray(approved?.beats) ? approved.beats : proposed.beats)
    .map((b, i) => ({
      index: i + 1,
      heading: String(b.heading || "").replace(/\s+/g, " ").trim().slice(0, 140) || `Section ${i + 1}`,
      goal: String(b.goal || "").replace(/\s+/g, " ").trim().slice(0, 300),
      passageIds: (Array.isArray(b.passageIds) ? b.passageIds : []).map(String).filter((id) => known.has(id)),
    }))
    .filter((b) => b.passageIds.length > 0);
  if (beats.length < 1) throw new Error("An approved outline needs at least one section that cites a passage.");
  return {
    title: String(approved?.title || proposed.title || "").trim().slice(0, 140),
    deck: String(approved?.deck || proposed.deck || "").trim().slice(0, 280),
    beats,
  };
}

/**
 * Run the graph and shape the result for the job.
 *
 * @param {object} input   { source, scholar, audience, prepared, brief?, outline? }
 * @param {object} deps    { generate, onProgress }
 */
async function runDraftGraph(input, deps) {
  const graph = buildDraftGraph(deps);
  const final = await graph.invoke(input, { recursionLimit: 12 });
  const warnings = dedupe(final.warnings || []);
  return {
    title: final.outline.title,
    subtitle: final.outline.deck,
    excerpt: final.outline.deck,
    bodyBlocks: final.draft.bodyBlocks,
    words: final.draft.words,
    outline: final.outline.beats.map((b) => ({ index: b.index, heading: b.heading, passageIds: b.passageIds })),
    passages: final.passages.map((p) => ({ id: p.id, words: p.words })),
    readability: final.readability
      ? { verdict: final.readability.verdict, fkGrade: final.readability.fkGrade, targetGrade: final.readability.targetGrade, drift: final.readability.drift, tolerance: final.readability.tolerance, reliable: final.readability.reliable }
      : null,
    warnings,
    calls: final.calls || [],
    graphVersion: GRAPH_VERSION,
  };
}

function dedupe(list) {
  return [...new Set(list)];
}

module.exports = { GRAPH_VERSION, SECTION_VOICE_RETRIES, FIDELITY_RETRIES, buildDraftNodes, buildDraftGraph, runDraftGraph, runOutlineOnly, normaliseApprovedOutline };
