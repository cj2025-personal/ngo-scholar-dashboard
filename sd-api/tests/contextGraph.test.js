/**
 * The drafting graph with a context section: the author's own context is
 * planned when the brief asks about the world, drafted as the author's own,
 * judged for attribution rather than fidelity, listed for verification, and
 * dropped when it keeps wearing the paper's authority. The planner's budget
 * and the approved-outline path treat the third kind like the second.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const composer = require("../src/lib/draftComposer");
const plan = require("../src/lib/draftPlan");
const fidelity = require("../src/lib/fidelity");
const context = require("../src/lib/context");
const { runDraftGraph, normaliseApprovedOutline, FIDELITY_RETRIES } = require("../src/lib/draftGraph");
const { USE } = require("../src/lib/draftEligibility");

const PAPER = [
  "Adaptive antenna arrays reduce interference by steering nulls toward unwanted sources. The method updates weights with a least-mean-squares rule every two milliseconds, which is fast enough for fixed interferers.",
  "In field trials the array improved the signal-to-noise ratio by eleven decibels with one interferer and by seven with two. The desired signal arrived at broadside in every trial, which is the easiest case for the array.",
  "The authors note that performance degrades when more than four interferers are present, because the array has only three degrees of freedom left once one is spent on the desired direction.",
].join("\n\n");

const source = { id: "src-1", origin: "harvested", title: "Adaptive nulling", year: 2024, use: USE.DRAFTABLE, reason: "licensed in full", words: 300 };
const prepared = composer.prepareSourceText(PAPER);
const input = { source, scholar: { name: "Test Scholar" }, audience: "adults", voice: "author", prepared, brief: "How does this help anyone today, and where does the same problem turn up in practice?" };

const PLAIN = "The array steers a null toward each source of noise, so the signal the receiver hears is cleaner. ".repeat(3);
const CONTEXT = "In practice the same problem turns up wherever a receiver must hear a weak signal beside a strong one, such as a handset at the edge of a cell in the 2.4 GHz band.";
const MISATTRIBUTED = "The paper shows this method is used in every phone sold today.";

/** A fake that plans one context beat, drafts it as the author's own, and judges it as told. */
function fakeModel({ contextTexts = [CONTEXT], judgeContext = () => "clear" } = {}) {
  const prompts = [];
  const generate = async ({ prompt, responseSchema }) => {
    prompts.push(prompt);
    if (responseSchema === plan.OUTLINE_SCHEMA) {
      assert.match(prompt, /answers the scholar's brief/);
      assert.match(prompt, /"context": the author's own context/);
      return { text: JSON.stringify({
        title: "Hearing a whisper beside a shout", deck: "What the array does, and where that matters.",
        beats: [
          { heading: "What the array does", goal: "state the result", kind: "paper", passage_ids: ["p2"] },
          { heading: "Where it breaks", goal: "limits", kind: "paper", passage_ids: ["p3"] },
          { heading: "Where this matters today", goal: "the author's own context", kind: "context", passage_ids: ["p2"] },
        ],
        brief_coverage: { met: "full", note: "" },
      }), usage: { input: 10, output: 5 } };
    }
    if (responseSchema === fidelity.JUDGE_SCHEMA) {
      const paragraphs = [...prompt.matchAll(/^\((\d+)\) (.*)$/gm)].map((m) => Number(m[1]));
      return { text: JSON.stringify({ paragraphs: paragraphs.map((index) => ({ index, verdict: "supported", unsupported_claims: [], reasons: [] })) }), usage: { input: 5, output: 5 } };
    }
    if (responseSchema === context.JUDGE_SCHEMA) {
      const rows = [...prompt.matchAll(/^\((\d+)\) (.*)$/gm)].map((m) => ({ index: Number(m[1]), text: m[2] }));
      return { text: JSON.stringify({ paragraphs: rows.map(({ index, text }) => {
        /* "clear": the author's own knowledge, plus one claim the paper does
           state. "misattributed": every claim worn as the paper's finding. */
        const clear = judgeContext(text) === "clear";
        return { index, claims: [
          { text: "the same problem turns up in the 2.4 GHz band", attributed: !clear, in_passages: false, anchor_ids: [], specifics: [{ text: "2.4 GHz band", kind: "standard" }] },
          { text: "the array gained eleven decibels", attributed: true, in_passages: clear, anchor_ids: clear ? ["p2"] : [], specifics: [{ text: "eleven decibels", kind: "number" }] },
        ] };
      }) }), usage: { input: 5, output: 5 } };
    }
    const m = prompt.match(/Write section (\d+) of/);
    const cited = [...prompt.matchAll(/\[(p\d+)\]/g)].map((x) => x[1]);
    if (/^Section kind: context$/m.test(prompt)) {
      assert.match(prompt, /PASSAGES THIS SECTION RELATES TO/);
      assert.match(prompt, /never as the paper's finding/);
      const redraft = /A reviewer read the paragraphs of the author's own context/.test(prompt);
      return { text: JSON.stringify({ paragraphs: contextTexts.map((t) => ({ text: `${t}${redraft ? " (redrafted)" : ""}`, passage_ids: [cited[0]] })), quote: null }), usage: { input: 20, output: 30 } };
    }
    assert.match(prompt, /The scholar's brief for the whole article/);
    return { text: JSON.stringify({ paragraphs: [{ text: `${PLAIN} (section ${m[1]})`, passage_ids: [cited[0]] }], quote: null }), usage: { input: 20, output: 30 } };
  };
  return { generate, prompts };
}

test("a context section is the author's own, judged for attribution, and its specifics are listed for the author to verify", async () => {
  const model = fakeModel();
  const progress = [];
  const r = await runDraftGraph(input, { generate: model.generate, onProgress: (e) => progress.push(e.step) });

  assert.ok(progress.includes("judge_context"), "the context judge ran");
  assert.deepEqual(r.outline.map((b) => b.kind), ["paper", "paper", "context"]);
  const ctx = r.bodyBlocks.filter((b) => b.ownView);
  assert.equal(ctx.length, 1);
  assert.equal(ctx[0].sourceRefs, undefined, "the author's own context carries no citation chip");
  assert.equal(ctx[0].fidelity, undefined, "never the fidelity judge's");
  assert.equal(ctx[0].context.verdict, context.VERDICT.CLEAR);
  assert.deepEqual(ctx[0].context.anchorIds, ["p2"]);
  assert.deepEqual(ctx[0].context.toVerify.map((v) => [v.text, v.verified]), [["2.4 GHz band", false], ["eleven decibels", false]]);
  assert.ok(r.bodyBlocks.filter((b) => b.type === "paragraph" && !b.ownView).every((b) => b.fidelity?.verdict === "supported"), "the paper's paragraphs are still the fidelity judge's");

  /* The checks name what the author must do before publishing. */
  assert.equal(r.checks.verify.unverified, 2);
  assert.ok(r.warnings.some((w) => /2 specifics .* verify/i.test(w)), r.warnings.join(" | "));
  assert.equal(r.checks.attribution.ok, true);
  assert.equal(r.checks.budget.context, 1);
  assert.ok(r.calls.some((c) => c.step === "judge_context"));
});

test("a context paragraph that keeps presenting itself as the paper's finding is sent back, then dropped with a warning; a section left with nothing refuses the run", async () => {
  const wearsThePaper = (t) => (/paper shows/.test(t) ? "misattributed" : "clear");
  const model = fakeModel({ contextTexts: [CONTEXT, MISATTRIBUTED], judgeContext: wearsThePaper });
  const r = await runDraftGraph(input, { generate: model.generate });
  const redrafts = model.prompts.filter((p) => /A reviewer read the paragraphs of the author's own context/.test(p)).length;
  assert.equal(redrafts, FIDELITY_RETRIES, "the section earns the same retries as the others");
  /* The fake judge's claims, not the paragraph's sentence: the note carries what the judge said. */
  assert.ok(model.prompts.some((p) => /"the same problem turns up in the 2.4 GHz band" — presents the author's own context as something the paper found/.test(p)), "the claim is named to the drafter");
  const kept = r.bodyBlocks.filter((b) => b.ownView);
  assert.equal(kept.length, 1, "the paragraph that wore the paper's authority is gone; the author's own stays");
  assert.match(kept[0].html, /^In practice/);
  assert.ok(r.warnings.some((w) => /1 paragraph in "Where this matters today" was left out because it presented your own context as the paper's finding/.test(w)), r.warnings.join(" | "));

  /* The same rule as the other kinds: nothing left in the section, no draft. */
  const nothingLeft = fakeModel({ contextTexts: [MISATTRIBUTED], judgeContext: () => "misattributed" });
  await assert.rejects(runDraftGraph(input, { generate: nothingLeft.generate }), /kept presenting your own context as the paper's finding/);
});

test("the planner's budget counts context with extension, and a plan without a brief is paper only", () => {
  const passages = [{ id: "p1" }, { id: "p2" }, { id: "p3" }];
  const raw = JSON.stringify({ title: "t", deck: "d", brief_coverage: { met: "full", note: "" }, beats: [
    { heading: "A", goal: "g", kind: "paper", passage_ids: ["p1"] },
    { heading: "B", goal: "g", kind: "context", passage_ids: ["p2"] },
    { heading: "C", goal: "g", kind: "extension", passage_ids: ["p3"] },
  ] });
  const briefed = plan.parseOutline(raw, passages, { allowExtension: true });
  assert.deepEqual(briefed.beats.map((b) => b.kind), ["paper", "context"], "one paper beat affords one beat beyond it");
  assert.equal(briefed.dropped, 1);
  const unbriefed = plan.parseOutline(raw, passages, { allowExtension: false });
  assert.deepEqual(unbriefed.beats.map((b) => b.kind), ["paper", "paper", "paper"]);
});

test("the brief map decides a section's kind, and an ask the plan never answered is coverage 'part' whatever the model claimed", () => {
  const passages = [{ id: "p1" }, { id: "p2" }, { id: "p3" }];
  const raw = JSON.stringify({
    title: "t", deck: "d",
    brief_map: [
      { ask: "what the array does", answered_by: "paper", section: "What the array does" },
      { ask: "where this turns up today", answered_by: "context", section: "Where this matters today" },
      { ask: "why it matters to a listener", answered_by: "extension", section: "A section that was never planned" },
    ],
    brief_coverage: { met: "full", note: "" },
    beats: [
      { heading: "What the array does", goal: "g", kind: "paper", passage_ids: ["p1"] },
      { heading: "Where it breaks", goal: "g", kind: "paper", passage_ids: ["p2"] },
      /* Planned as a paper section, named in the map as the author's context: the map wins. */
      { heading: "Where this matters today", goal: "g", kind: "paper", passage_ids: ["p3"] },
    ],
  });
  const out = plan.parseOutline(raw, passages, { allowExtension: true });
  assert.deepEqual(out.beats.map((b) => b.kind), ["paper", "paper", "context"]);
  assert.equal(out.coverage.met, "part");
  assert.match(out.coverage.note, /Not planned: why it matters to a listener/);
  assert.equal(out.briefMap.length, 3);
  /* Without a brief there is no map, and the model's kinds are not trusted either. */
  const unbriefed = plan.parseOutline(raw, passages, { allowExtension: false });
  assert.deepEqual(unbriefed.beats.map((b) => b.kind), ["paper", "paper", "paper"]);
  assert.equal(unbriefed.briefMap, null);
});

test("an approved outline keeps a context kind only where the proposal had it", () => {
  const passages = [{ id: "p1" }, { id: "p2" }];
  const proposed = { title: "t", deck: "d", beats: [{ heading: "A", kind: "paper", passageIds: ["p1"] }, { heading: "B", kind: "context", passageIds: ["p2"] }] };
  const approved = { beats: [
    { heading: "A", kind: "context", passageIds: ["p1"] },
    { heading: "B", kind: "context", passageIds: ["p2"] },
  ] };
  const out = normaliseApprovedOutline(proposed, approved, passages);
  assert.deepEqual(out.beats.map((b) => b.kind), ["paper", "context"], "a section can be cut, not promoted");
});
