/**
 * The drafting graph, run against a fake model.
 *
 * What is asserted: the node order, that every paragraph carries the passages
 * it cited, that a quote not in its passage is dropped, that first-person
 * prose earns one retry then a refusal, that the fidelity judge sends a
 * section back and eventually drops or refuses, and that a too-hard draft
 * loops back through draft_blocks exactly once.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const composer = require("../src/lib/draftComposer");
const plan = require("../src/lib/draftPlan");
const fidelity = require("../src/lib/fidelity");
const { runDraftGraph, SECTION_VOICE_RETRIES, FIDELITY_RETRIES } = require("../src/lib/draftGraph");
const { USE } = require("../src/lib/draftEligibility");

const PAPER = [
  "Adaptive antenna arrays reduce interference by steering nulls toward unwanted sources. The method updates weights with a least-mean-squares rule every two milliseconds, which is fast enough for fixed interferers.",
  "In field trials the array improved the signal-to-noise ratio by eleven decibels with one interferer and by seven with two. The desired signal arrived at broadside in every trial, which is the easiest case for the array.",
  "The authors note that performance degrades when more than four interferers are present, because the array has only three degrees of freedom left once one is spent on the desired direction.",
  "All trials were run in an anechoic chamber. Multipath in a real building would present many more apparent sources, so the degradation is expected to appear at lower interferer counts outdoors.",
].join("\n\n");

const source = { id: "src-1", origin: "harvested", title: "Adaptive nulling", year: 2024, use: USE.DRAFTABLE, reason: "licensed in full", words: 400 };
const prepared = composer.prepareSourceText(PAPER);
const input = { source, scholar: { name: "Test Scholar" }, audience: "general", prepared };

const PLAIN = "The array steers a null toward each source of noise, so the signal the receiver hears is cleaner. ".repeat(3);

/**
 * A fake model that answers the outline, each section, and the judge.
 *
 * `judge(paragraphText, round)` decides the verdict per paragraph; default
 * is supported. Sections are drafted from `sectionText`, with a marker for
 * the fidelity round appended so the judge can tell rounds apart.
 */
function fakeModel({ sectionText = PLAIN, quote = null, voiceOnFirstTry = false, judge = () => "supported" } = {}) {
  const calls = [];
  const generate = async ({ prompt, responseSchema }) => {
    calls.push(prompt);
    if (responseSchema === plan.OUTLINE_SCHEMA) {
      return {
        text: JSON.stringify({
          title: "Steering silence toward the noise",
          deck: "A trial of adaptive arrays.",
          beats: [
            { heading: "What the trial found", goal: "state the result", passage_ids: ["p2"] },
            { heading: "How it works", goal: "explain the method", passage_ids: ["p1"] },
            { heading: "Where it breaks", goal: "limits", passage_ids: ["p3", "p4"] },
          ],
        }),
        usage: { input: 10, output: 5 },
      };
    }
    if (responseSchema === fidelity.JUDGE_SCHEMA) {
      const paragraphs = [...prompt.matchAll(/^\((\d+)\) (.*)$/gm)].map((m) => ({ index: Number(m[1]), text: m[2] }));
      return {
        text: JSON.stringify({
          paragraphs: paragraphs.map((p) => {
            const verdict = judge(p.text);
            return { index: p.index, verdict, unsupported_claims: verdict === "supported" ? [] : ["a claim"], reasons: verdict === "supported" ? [] : ["not in the passages"] };
          }),
        }),
        usage: { input: 5, output: 5 },
      };
    }
    const m = prompt.match(/Write section (\d+) of/);
    const strict = /Third person only/.test(prompt);
    const retryRound = (prompt.match(/A fact-checker compared/g) || []).length; // 0 or 1 per prompt
    const cited = [...prompt.matchAll(/\[(p\d+)\]/g)].map((x) => x[1]);
    const text = voiceOnFirstTry && !strict ? `I found that ${sectionText}` : sectionText;
    return {
      text: JSON.stringify({
        paragraphs: [{ text: `${text} (section ${m[1]}${retryRound ? " redrafted" : ""})`, passage_ids: [cited[0], "p99"] }],
        quote: quote ? { text: quote, passage_id: cited[0] } : null,
      }),
      usage: { input: 20, output: 30 },
    };
  };
  return { generate, calls };
}

test("passages are numbered paragraphs and long ones are split", () => {
  const p = plan.splitPassages(PAPER);
  assert.equal(p.length, 4);
  assert.deepEqual(p.map((x) => x.id), ["p1", "p2", "p3", "p4"]);
  const long = plan.splitPassages("A sentence of nine words sits right here now. ".repeat(60));
  assert.ok(long.length > 1);
  assert.ok(long.every((x) => x.words <= plan.PASSAGE.MAX_WORDS + 9));
});

test("a clean run: outline → sections with provenance → judged → assembled → measured", async () => {
  const progress = [];
  const model = fakeModel({ quote: "The desired signal arrived at broadside in every trial" });
  const r = await runDraftGraph(input, { generate: model.generate, onProgress: (e) => progress.push(e.step) });

  assert.equal(r.title, "Steering silence toward the noise");
  assert.deepEqual([...new Set(progress)], ["pick_source", "plan_outline", "draft_blocks", "judge_fidelity", "assemble", "verify"]);
  assert.equal(r.outline.length, 3);

  const paragraphs = r.bodyBlocks.filter((b) => b.type === "paragraph");
  assert.equal(paragraphs.length, 3);
  for (const b of paragraphs) {
    assert.equal(b.sourceRefs.length, 1, "the fake cited p99, which is not allowed, and one real passage");
    assert.match(b.sourceRefs[0].passageId, /^p[1-4]$/);
    assert.equal(b.fidelity.verdict, "supported");
    assert.equal(b.fidelity.checks.judged, true);
  }
  const quotes = r.bodyBlocks.filter((b) => b.type === "quote");
  assert.equal(quotes.length, 1, "the verbatim quote in section 1 (p2) is kept; the others cite passages that lack it");
  assert.equal(r.bodyBlocks[0].type, "subheading");
  assert.ok(r.warnings.some((w) => /left out because it does not appear/.test(w)));
  assert.ok(r.readability && typeof r.readability.fkGrade === "number");
  assert.equal(r.calls.filter((c) => c.step === "draft_blocks").length, 3);
  assert.equal(r.calls.filter((c) => c.step === "judge_fidelity").length, 3, "one judge call per section");
  assert.equal(r.calls.length, 7);
});

test("first-person prose earns one retry per section, then the run refuses", async () => {
  const retried = fakeModel({ voiceOnFirstTry: true });
  const r = await runDraftGraph(input, { generate: retried.generate });
  assert.equal(r.calls.filter((c) => c.step === "draft_blocks").length, 3 * (SECTION_VOICE_RETRIES + 1));
  assert.ok(r.calls.some((c) => c.strictVoice));

  const stubborn = {
    generate: async (req) => {
      const r0 = await fakeModel().generate(req);
      if (req.responseSchema === plan.SECTION_SCHEMA) {
        const d = JSON.parse(r0.text);
        d.paragraphs[0].text = `I insist. ${d.paragraphs[0].text}`;
        return { text: JSON.stringify(d) };
      }
      return r0;
    },
  };
  await assert.rejects(runDraftGraph(input, stubborn), /first person after a retry/);
});

test("the judge sends a section back with the claims named, and a redraft that passes is accepted", async () => {
  /* Unsupported until the drafter has been told once. */
  const model = fakeModel({ judge: (text) => (/redrafted/.test(text) ? "supported" : "unsupported") });
  const r = await runDraftGraph(input, { generate: model.generate });
  const drafts = r.calls.filter((c) => c.step === "draft_blocks");
  assert.equal(drafts.length, 6, "each of three sections drafted twice");
  assert.ok(drafts.some((c) => c.round === 1));
  assert.ok(model.calls.some((p) => /A fact-checker compared your previous draft/.test(p) && /"a claim"/.test(p)));
  assert.equal(r.calls.filter((c) => c.step === "judge_fidelity").length, 6);
  assert.ok(r.bodyBlocks.filter((b) => b.type === "paragraph").every((b) => b.fidelity.verdict === "supported"));
  assert.ok(!r.warnings.some((w) => /unsupported/.test(w)));
});

test("after the retries an unsupported paragraph is dropped with a warning, and a section with no prose left refuses the run", async () => {
  /* Two paragraphs per section: one always supported, one never. */
  const twoPara = {
    generate: async (req) => {
      const base = fakeModel({ judge: (text) => (/never/.test(text) ? "unsupported" : "supported") });
      const r0 = await base.generate(req);
      if (req.responseSchema === plan.SECTION_SCHEMA) {
        const d = JSON.parse(r0.text);
        d.paragraphs.push({ text: `This never checks out. ${PLAIN}`, passage_ids: d.paragraphs[0].passage_ids });
        return { text: JSON.stringify(d) };
      }
      return r0;
    },
  };
  const r = await runDraftGraph(input, { generate: twoPara.generate });
  assert.equal(r.calls.filter((c) => c.step === "draft_blocks").length, 3 * (FIDELITY_RETRIES + 1));
  assert.equal(r.bodyBlocks.filter((b) => b.type === "paragraph").length, 3, "the never-supported paragraph is gone from each section");
  assert.equal(r.warnings.filter((w) => /left out because the fact-check found/.test(w)).length, 3);

  const nothingSupported = fakeModel({ judge: () => "unsupported" });
  await assert.rejects(runDraftGraph(input, { generate: nothingSupported.generate }), /kept making claims the paper doesn't support/);
});

test("a partly supported paragraph survives with its claims marked and a warning", async () => {
  const model = fakeModel({ judge: () => "partial" });
  const r = await runDraftGraph(input, { generate: model.generate });
  const paragraphs = r.bodyBlocks.filter((b) => b.type === "paragraph");
  assert.equal(paragraphs.length, 3);
  assert.ok(paragraphs.every((b) => b.fidelity.verdict === "partial" && b.fidelity.unsupportedClaims.length === 1));
  assert.equal(r.warnings.filter((w) => /only partly supported/.test(w)).length, 3);
});

test("a draft too hard for its audience loops through draft_blocks once with a note", async () => {
  const DENSE = "Electromagnetic interference mitigation methodologies necessitate multidimensional characterisation of heterogeneous propagation environments. ".repeat(4);
  const model = fakeModel({ sectionText: DENSE });
  const steps = [];
  const r = await runDraftGraph({ ...input, audience: "students" }, { generate: model.generate, onProgress: (e) => steps.push(e.step) });
  assert.equal(steps.filter((s) => s === "draft_blocks").length, 6, "three sections, drafted twice");
  assert.ok(model.calls.some((p) => /measured at reading grade/.test(p)), "the retry prompt names the measured grade");
  assert.equal(r.readability.verdict, "fail");
  assert.ok(r.warnings.some((w) => /grades above the level for readers aged 15 to 18/.test(w)));
  assert.equal(r.calls.filter((c) => c.step === "draft_blocks").length, 6);
  assert.equal(r.calls.filter((c) => c.step === "judge_fidelity").length, 6);
});

test("a source that is not draftable is refused before any model call", async () => {
  const model = fakeModel();
  await assert.rejects(
    runDraftGraph({ ...input, source: { ...source, use: USE.CITABLE, reason: "licence allows short quotes only" } }, { generate: model.generate }),
    /short quotes only/,
  );
  assert.equal(model.calls.length, 0);
});
