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
 * Inside `draft_blocks`, every section is judged before it is accepted. A
 * paragraph drawn from the paper goes to the fidelity judge: a second prompt
 * with a fact-checker's job compares it with the passages it cites. A
 * paragraph that goes beyond the paper — an extension, planned only when
 * the scholar's brief asks for what the paper does not say — goes to the
 * reach judge instead, which asks whether each claim follows from the
 * passages it builds on, is said as an implication, and brings in nothing
 * from outside. A section with a failing paragraph is redrafted with the
 * claims named, up to FIDELITY_RETRIES times; after that unsupported and
 * overreaching paragraphs are dropped, partial ones ship with a warning,
 * and a section left with no prose fails the run with a sentence. Neither
 * judge sees the drafter's instructions and the drafter never sees theirs —
 * no machine approves its own output.
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
const reach = require("./reach");
const context = require("./context");
const { assessDraftReadability, simplificationNote, VERDICT } = require("./draftReadability");
const { USE } = require("./draftEligibility");
const checks = require("./checks");

const GRAPH_VERSION = "draft-graph-2026.4";

/** One retry per section for voice; the graph refuses after that. */
const SECTION_VOICE_RETRIES = 1;
/** Redrafts a section may earn from the fidelity judge: three attempts in all. */
const FIDELITY_RETRIES = 2;

const State = Annotation.Root({
  /* inputs */
  source: Annotation(),
  scholar: Annotation(),
  audience: Annotation(),
  voice: Annotation(),
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
  checks: Annotation(),
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
  const progress = (step, message, detail) => Promise.resolve(onProgress({ step, message, detail }));
  /* The system instruction depends on whose account this is, so it is built
     per run rather than once per process. */
  const systemFor = (s) => composer.buildSystemInstruction({ voice: s.voice, scholarName: s.scholar?.name || null });

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
      scholar: s.scholar, source: s.source, passages: s.passages, truncated: s.prepared.truncated, audience: s.audience, brief: s.brief || null, voice: s.voice,
    });
    const r = await generate({ prompt, systemInstruction: systemFor(s), responseSchema: plan.OUTLINE_SCHEMA, temperature: 0.3, maxOutputTokens: 2048 });
    const { dropped, ...outline } = plan.parseOutline(r.text, s.passages, { allowExtension: Boolean(s.brief) });
    const extensions = outline.beats.filter((b) => b.kind === plan.BEAT_KIND.EXTENSION).length;
    const contexts = outline.beats.filter((b) => b.kind === plan.BEAT_KIND.CONTEXT).length;
    await progress("plan_outline", `Outlined ${outline.beats.length} sections: ${outline.beats.map((b) => b.heading).join(" · ")}` + (extensions ? ` (${extensions} beyond the paper)` : "") + (contexts ? ` (${contexts} of your own context)` : ""), {
      beats: outline.beats.length,
      extensions,
      contexts,
      coverage: outline.coverage?.met || null,
    });
    /* The brief is answered out loud. A plan that quietly did something other
       than what was asked is the failure these two warnings guard. */
    const warnings = [];
    if (outline.coverage && outline.coverage.met !== plan.COVERAGE.FULL) {
      warnings.push(
        outline.coverage.met === plan.COVERAGE.NONE
          ? `The paper cannot carry what the brief asked for${outline.coverage.note ? `: ${outline.coverage.note}` : "."} This plan reports the paper instead.`
          : `Part of the brief was left out${outline.coverage.note ? `: ${outline.coverage.note}` : "."}`,
      );
    }
    if (dropped) warnings.push(`${dropped} proposed section${dropped === 1 ? "" : "s"} that went beyond the paper ${dropped === 1 ? "was" : "were"} left out, so the article rests mostly on what the paper says.`);
    return { outline, warnings, calls: [{ step: "plan_outline", usage: r.usage || null, model: r.modelVersion || null }] };
  }

  async function draft_blocks(s) {
    const sections = {};
    const calls = [];
    const warnings = [];
    const total = s.outline.beats.length;
    for (const beat of s.outline.beats) {
      const extension = beat.kind === plan.BEAT_KIND.EXTENSION;
      const contextBeat = beat.kind === plan.BEAT_KIND.CONTEXT;
      await progress("draft_blocks", `Drafting section ${beat.index} of ${total}: ${beat.heading}` + (extension ? " (beyond the paper)" : contextBeat ? " (your own context)" : ""), { index: beat.index, total, kind: beat.kind || plan.BEAT_KIND.PAPER });
      let fidelityNote = null;
      let reachNote = null;
      let contextNote = null;
      let accepted = null;

      for (let round = 0; round <= FIDELITY_RETRIES; round += 1) {
        /* Draft, with one retry for voice: first person in either voice, and
           in the author's own voice also any reference to the author. */
        let strictVoice = false;
        let strictSelf = false;
        let result = null;
        for (let attempt = 0; attempt <= SECTION_VOICE_RETRIES; attempt += 1) {
          const prompt = plan.buildSectionPrompt({
            scholar: s.scholar, beat, passages: s.passages, outline: s.outline, audience: s.audience, voice: s.voice,
            brief: s.brief || null, strictVoice, strictSelf, readabilityNote: s.readabilityNote || null, fidelityNote, reachNote, contextNote,
          });
          const r = await generate({ prompt, systemInstruction: systemFor(s), responseSchema: plan.SECTION_SCHEMA, temperature: strictVoice || strictSelf ? 0.2 : 0.4, maxOutputTokens: 2048 });
          calls.push({ step: "draft_blocks", beat: beat.index, usage: r.usage || null, model: r.modelVersion || null, strictVoice, strictSelf, round });
          result = plan.parseSection(r.text, { beat, passages: s.passages, voice: s.voice, scholarName: s.scholar?.name || null });
          if (result.violations.length === 0 && result.selfReferences.length === 0) break;
          strictVoice = strictVoice || result.violations.length > 0;
          strictSelf = strictSelf || result.selfReferences.length > 0;
        }
        if (result.violations.length > 0) {
          throw new Error(`Section ${beat.index} kept writing in the first person after a retry.`);
        }
        /* A name that survives the retry is not worth losing the draft over:
           it is one word for the scholar to cut, and the warning says where. */
        if (result.selfReferences.length > 0) {
          warnings.push(
            `"${beat.heading}" still refers to you by name, which an article under your own byline should not: ` +
            `${result.selfReferences.slice(0, 2).map((x) => `“${x.trim().slice(0, 100)}”`).join(" ")} Rewrite ${result.selfReferences.length === 1 ? "it" : "them"} with the work as the subject, or ask the agent to.`,
          );
        }

        /* Judge: the paper's paragraphs for fidelity, the extension paragraphs
           for reach. Each judge sees only its own kind. */
        await progress("judge_fidelity", `Checking section ${beat.index} of ${total} against the paper…`, { index: beat.index, total, round });
        const judgedF = await fidelity.judgeSection({ blocks: result.blocks, passages: s.passages, generate });
        if (judgedF.call) calls.push({ ...judgedF.call, beat: beat.index, round });
        let blocks = judgedF.blocks;
        let failingF = judgedF.failing;
        let failingR = [];
        let failingC = [];
        if (extension) {
          await progress("judge_reach", `Checking what section ${beat.index} of ${total} draws from the paper…`, { index: beat.index, total, round });
          const judgedR = await reach.judgeSection({ blocks, passages: s.passages, audience: s.audience, generate });
          if (judgedR.call) calls.push({ ...judgedR.call, beat: beat.index, round });
          blocks = judgedR.blocks;
          failingR = judgedR.failing;
        }
        if (contextBeat) {
          /* The author's own context: judged for what it claims of the paper,
             and its specifics listed for the author to verify. */
          await progress("judge_context", `Checking section ${beat.index} of ${total} for what it claims of the paper…`, { index: beat.index, total, round });
          const judgedC = await context.judgeSection({ blocks, passages: s.passages, audience: s.audience, generate });
          if (judgedC.call) calls.push({ ...judgedC.call, beat: beat.index, round });
          blocks = judgedC.blocks;
          failingC = judgedC.failing;
        }
        const failing = [...new Set([...failingF, ...failingR, ...failingC])].sort((a, b) => a - b);

        if (failing.length === 0) {
          accepted = { ...result, blocks };
          break;
        }
        if (round < FIDELITY_RETRIES) {
          fidelityNote = failingF.length ? fidelity.fidelityNote(blocks, failingF) : null;
          reachNote = failingR.length ? reach.reachNote(blocks, failingR) : null;
          contextNote = failingC.length ? context.contextNote(blocks, failingC) : null;
          continue;
        }

        /* Out of retries. Drop what is unsupported or overreaching, keep what
           is partial with a warning, and refuse the run if nothing survives. */
        const isContext = (b) => Boolean(b.ownView && b.context);
        const gone = (b, i) => failing.includes(i) && (
          isContext(b) ? b.context?.verdict === context.VERDICT.MISATTRIBUTED
            : b.extension ? b.reach?.verdict === reach.VERDICT.OVERREACH
              : b.fidelity?.verdict === fidelity.VERDICT.UNSUPPORTED
        );
        const kept = blocks.filter((b, i) => !gone(b, i));
        const droppedPaper = blocks.filter((b, i) => gone(b, i) && !b.extension && !isContext(b)).length;
        const droppedReach = blocks.filter((b, i) => gone(b, i) && b.extension).length;
        const droppedContext = blocks.filter((b, i) => gone(b, i) && isContext(b)).length;
        const partial = kept.filter((b) => !b.extension && !isContext(b) && b.fidelity?.verdict === fidelity.VERDICT.PARTIAL).length;
        const partialReach = kept.filter((b) => b.extension && b.reach?.verdict === reach.VERDICT.PARTIAL).length;
        const partialContext = kept.filter((b) => isContext(b) && b.context?.verdict === context.VERDICT.PARTIAL).length;
        if (!kept.some((b) => b.type === "paragraph")) {
          throw new Error(
            contextBeat && !droppedPaper
              ? `Section ${beat.index} ("${beat.heading}") kept presenting your own context as the paper's finding.`
              : extension && !droppedPaper
                ? `Section ${beat.index} ("${beat.heading}") kept going beyond what the paper supports.`
                : `Section ${beat.index} ("${beat.heading}") kept making claims the paper doesn't support.`,
          );
        }
        if (droppedContext) warnings.push(`${droppedContext} paragraph${droppedContext === 1 ? "" : "s"} in "${beat.heading}" ${droppedContext === 1 ? "was" : "were"} left out because ${droppedContext === 1 ? "it" : "they"} presented your own context as the paper's finding.`);
        if (partialContext) warnings.push(`${partialContext} paragraph${partialContext === 1 ? "" : "s"} in "${beat.heading}" ${partialContext === 1 ? "presents" : "present"} part of your own context as the paper's finding; the sentences are marked on the block.`);
        if (droppedPaper) warnings.push(`${droppedPaper} paragraph${droppedPaper === 1 ? "" : "s"} in "${beat.heading}" ${droppedPaper === 1 ? "was" : "were"} left out because the fact-check found ${droppedPaper === 1 ? "it" : "them"} unsupported by the paper.`);
        if (droppedReach) warnings.push(`${droppedReach} paragraph${droppedReach === 1 ? "" : "s"} in "${beat.heading}" ${droppedReach === 1 ? "was" : "were"} left out because ${droppedReach === 1 ? "it" : "they"} went beyond what the paper supports.`);
        if (partial) warnings.push(`${partial} paragraph${partial === 1 ? "" : "s"} in "${beat.heading}" ${partial === 1 ? "is" : "are"} only partly supported by the paper; the unsupported claims are marked on the block.`);
        if (partialReach) warnings.push(`${partialReach} paragraph${partialReach === 1 ? "" : "s"} in "${beat.heading}" ${partialReach === 1 ? "draws" : "draw"} an implication the paper only partly supports; the claims that go too far are marked on the block.`);
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

    /* Two rules the judge does not apply: every number must be in a cited
       passage, and the paper's own caveats should not have been left out. */
    const numbers = checks.numericConsistency({ blocks: s.draft.bodyBlocks, passages: s.passages });
    if (!numbers.ok) {
      warnings.push(
        `${numbers.misses.length === 1 ? "A number" : `${numbers.misses.length} numbers`} in this draft ${numbers.misses.length === 1 ? "is" : "are"} not in the passages cited: ` +
        `${numbers.misses.map((m) => `${m.number} (block ${m.block})`).join(", ")}. Check ${numbers.misses.length === 1 ? "it" : "them"} against the paper before publishing.`,
      );
    }
    const limitations = checks.limitationsCoverage({ blocks: s.draft.bodyBlocks, passages: s.passages });
    if (limitations.ok === false) warnings.push(limitations.sentence);

    /* Two more, only where the article goes beyond the paper: a sentence
       that reads as a fact about the world, and the share of such prose. */
    const worldClaims = checks.worldClaims({ blocks: s.draft.bodyBlocks });
    if (worldClaims.ok === false) {
      warnings.push(
        `${worldClaims.hits.length === 1 ? "A sentence" : `${worldClaims.hits.length} sentences`} in the parts that go beyond the paper read${worldClaims.hits.length === 1 ? "s" : ""} as a claim about the world rather than an implication: ` +
        `${worldClaims.hits.map((h) => `"${h.sentence}" (block ${h.block})`).join("; ")}. Say what follows, not what is done.`,
      );
    }
    const budget = checks.extensionBudget({ blocks: s.draft.bodyBlocks });
    if (budget.ok === false) warnings.push(budget.sentence);

    /* The author's own context: a sentence that wears the paper's authority,
       by wording; and the specifics the author must verify before the story
       can be published. */
    const attribution = checks.attributionCues({ blocks: s.draft.bodyBlocks });
    if (attribution.ok === false) {
      warnings.push(
        `${attribution.hits.length === 1 ? "A sentence" : `${attribution.hits.length} sentences`} in your own context read${attribution.hits.length === 1 ? "s" : ""} as the paper's finding: ` +
        `${attribution.hits.map((h) => `"${h.sentence}" (block ${h.block})`).join("; ")}. Say it as what you know, not as what the paper showed.`,
      );
    }
    const verifyItems = checks.verifyList({ blocks: s.draft.bodyBlocks });
    if (verifyItems.unverified) {
      warnings.push(`${verifyItems.unverified} specific${verifyItems.unverified === 1 ? "" : "s"} in your own context ${verifyItems.unverified === 1 ? "is" : "are"} listed for you to verify in Checks before this can be published: ${verifyItems.items.filter((i) => !i.verified).slice(0, 6).map((i) => i.text).join(", ")}${verifyItems.unverified > 6 ? ", …" : ""}.`);
    }

    /* Sections are drafted by separate calls, so nothing but this stops them
       disagreeing about the author's pronoun. They did, under a real name. */
    const pronouns = composer.pronounConsistency({ blocks: s.draft.bodyBlocks });
    if (pronouns.ok === false) warnings.push(pronouns.sentence);
    if (s.prepared.truncated) {
      warnings.push(
        `Only the first ${s.prepared.words.toLocaleString()} of ${s.prepared.totalWords.toLocaleString()} words were used; the rest of the paper is not reflected here.`,
      );
    }
    return { readability, readabilityNote: null, warnings, checks: { numbers, limitations, worldClaims, budget, pronouns, attribution, verify: verifyItems } };
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
  const withVoice = { ...input, voice: composer.normaliseVoice(input.voice) };
  const picked = await nodes.pick_source(withVoice);
  const planned = await nodes.plan_outline({ ...withVoice, ...picked });
  return {
    outline: planned.outline,
    warnings: planned.warnings || [],
    passages: picked.passages.map((p) => ({ id: p.id, words: p.words, text: p.text })),
    calls: planned.calls || [],
    graphVersion: GRAPH_VERSION,
  };
}

/**
 * Approve an outline: keep the beats the scholar kept, in their order, with
 * their headings and kinds, and only passages that exist. Cut beats are gone.
 * A kind is trusted from the client only as far as the proposal allowed it:
 * a section can be cut, not promoted to go beyond the paper.
 */
function normaliseApprovedOutline(proposed, approved, passages) {
  const known = new Set(passages.map((p) => p.id));
  /* The kinds beyond the paper the proposal offered, by heading. */
  const proposedKind = new Map((proposed.beats || []).filter((b) => b.kind && b.kind !== plan.BEAT_KIND.PAPER).map((b) => [b.heading, b.kind]));
  const beats = (Array.isArray(approved?.beats) ? approved.beats : proposed.beats)
    .map((b, i) => ({
      index: i + 1,
      heading: String(b.heading || "").replace(/\s+/g, " ").trim().slice(0, 140) || `Section ${i + 1}`,
      goal: String(b.goal || "").replace(/\s+/g, " ").trim().slice(0, 300),
      kind: b.kind && b.kind !== plan.BEAT_KIND.PAPER && (proposedKind.get(b.heading) === b.kind || proposedKind.get(String(b.proposedHeading || "")) === b.kind) ? b.kind : plan.BEAT_KIND.PAPER,
      passageIds: (Array.isArray(b.passageIds) ? b.passageIds : []).map(String).filter((id) => known.has(id)),
    }))
    .filter((b) => b.passageIds.length > 0);
  if (beats.length < 1) throw new Error("An approved outline needs at least one section that cites a passage.");
  return {
    title: String(approved?.title || proposed.title || "").trim().slice(0, 140),
    deck: String(approved?.deck || proposed.deck || "").trim().slice(0, 280),
    beats,
    coverage: proposed.coverage || null,
    briefMap: proposed.briefMap || null,
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
  const final = await graph.invoke({ ...input, voice: composer.normaliseVoice(input.voice) }, { recursionLimit: 12 });
  const warnings = dedupe(final.warnings || []);
  return {
    title: final.outline.title,
    subtitle: final.outline.deck,
    excerpt: final.outline.deck,
    bodyBlocks: final.draft.bodyBlocks,
    words: final.draft.words,
    outline: final.outline.beats.map((b) => ({ index: b.index, heading: b.heading, kind: b.kind || plan.BEAT_KIND.PAPER, passageIds: b.passageIds })),
    coverage: final.outline.coverage || null,
    passages: final.passages.map((p) => ({ id: p.id, words: p.words })),
    readability: final.readability
      ? { verdict: final.readability.verdict, fkGrade: final.readability.fkGrade, targetGrade: final.readability.targetGrade, drift: final.readability.drift, tolerance: final.readability.tolerance, reliable: final.readability.reliable }
      : null,
    warnings,
    checks: final.checks || null,
    calls: final.calls || [],
    graphVersion: GRAPH_VERSION,
  };
}

function dedupe(list) {
  return [...new Set(list)];
}

module.exports = { GRAPH_VERSION, SECTION_VOICE_RETRIES, FIDELITY_RETRIES, buildDraftNodes, buildDraftGraph, runDraftGraph, runOutlineOnly, normaliseApprovedOutline };
