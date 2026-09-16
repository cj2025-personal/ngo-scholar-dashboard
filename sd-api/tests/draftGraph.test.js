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
const reach = require("../src/lib/reach");
const { runDraftGraph, normaliseApprovedOutline, SECTION_VOICE_RETRIES, FIDELITY_RETRIES } = require("../src/lib/draftGraph");
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

/* Prose that sits inside the adult reading band — grade 9.3 against a target
   of 10 — so these tests measure node order, retries and provenance rather
   than tripping the readability loop, which has its own tests. */
const PLAIN = "The array steers a null toward each source of noise, so the receiver hears a cleaner signal. Unwanted energy is suppressed before detection. Interference arriving from another direction is reduced by the same mechanism. ".repeat(3);

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
    /* The retry is recognised by what the graph says on a retry, not by the
       voice rules, which differ between an article about a scholar and one
       they publish as their own. */
    const strict = /previous attempt used first-person/i.test(prompt);
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

test("first person that survives the retry costs the paragraph, not the article", async () => {
  /* Two paragraphs, one of which insists on speaking as the scholar. The
     article used to be thrown away whole for this: a scholar who approved
     six sections was told to try a different paper because one sentence in
     section one said "we". */
  const oneBad = {
    generate: async (req) => {
      const r0 = await fakeModel().generate(req);
      if (req.responseSchema === plan.SECTION_SCHEMA) {
        const d = JSON.parse(r0.text);
        const cited = [...req.prompt.matchAll(/\[(p\d+)\]/g)].map((x) => x[1]);
        d.paragraphs = [
          { text: "We measured the improvement at eleven decibels.", passage_ids: [cited[0]] },
          { text: d.paragraphs[0].text, passage_ids: [cited[0]] },
        ];
        return { text: JSON.stringify(d) };
      }
      return r0;
    },
  };
  const r = await runDraftGraph(input, oneBad);
  const prose = r.bodyBlocks.filter((b) => b.type === "paragraph");
  assert.ok(prose.length >= 3, "the article survives, one paragraph per section");
  assert.ok(prose.every((b) => !/We measured/.test(b.html)), "the paragraph that spoke as the scholar is gone");
  assert.ok(r.warnings.some((w) => /writing as you rather than about you/.test(w)), r.warnings.join(" | "));
  assert.ok(r.warnings.some((w) => /We measured the improvement/.test(w)), "the warning quotes the sentence");
});

test("the inclusive we of an explainer is not the scholar speaking, and does not cost a retry", async () => {
  /* The sentences a real model wrote for an ages 8-11 article, which used to
     refuse the run on the first section. */
  const childish = {
    generate: async (req) => {
      const r0 = await fakeModel().generate(req);
      if (req.responseSchema === plan.SECTION_SCHEMA) {
        const d = JSON.parse(r0.text);
        d.paragraphs[0].text = "It helps us find where sounds come from. This is useful for many things we use every day.";
        return { text: JSON.stringify(d) };
      }
      return r0;
    },
  };
  const r = await runDraftGraph(input, childish);
  assert.ok(r.calls.filter((c) => c.step === "draft_blocks").every((c) => !c.strictVoice), "no section was sent back for voice");
  assert.ok(r.bodyBlocks.some((b) => /things we use every day/.test(b.html)), "the prose is kept as written");
  assert.ok(!r.warnings.some((w) => /writing as you/.test(w)), r.warnings.join(" | "));
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

/* ── whose account it is ─────────────────────────────────────────────────── */

test("an article the scholar publishes as their own work never refers to them; a name that survives the retry is a warning, not a lost draft", async () => {
  /* The drafter names the scholar until it is told not to. */
  let toldNotTo = 0;
  const named = {
    generate: async (req) => {
      const r0 = await fakeModel().generate(req);
      if (req.responseSchema !== plan.SECTION_SCHEMA) return r0;
      const cited = [...req.prompt.matchAll(/\[(p\d+)\]/g)].map((x) => x[1]);
      if (/previous attempt referred to the author/i.test(req.prompt)) {
        toldNotTo += 1;
        return { text: JSON.stringify({ paragraphs: [{ text: `The array steers a null toward each source of noise. ${PLAIN}`, passage_ids: [cited[0]] }], quote: null }) };
      }
      return { text: JSON.stringify({ paragraphs: [{ text: `Test Scholar steers a null toward each source of noise. ${PLAIN}`, passage_ids: [cited[0]] }], quote: null }) };
    },
  };
  const r = await runDraftGraph(input, named);
  assert.equal(toldNotTo, 3, "each section was sent back once with the name quoted at it");
  assert.ok(r.bodyBlocks.filter((b) => b.type === "paragraph").every((b) => !/Test Scholar/.test(b.html)));
  assert.ok(!r.warnings.some((w) => /refers to you by name/.test(w)));

  /* A drafter that will not stop naming them ships, with the sentence named. */
  const stubborn = {
    generate: async (req) => {
      const r0 = await fakeModel().generate(req);
      if (req.responseSchema !== plan.SECTION_SCHEMA) return r0;
      const cited = [...req.prompt.matchAll(/\[(p\d+)\]/g)].map((x) => x[1]);
      return { text: JSON.stringify({ paragraphs: [{ text: `Test Scholar steers a null toward each source of noise. ${PLAIN}`, passage_ids: [cited[0]] }], quote: null }) };
    },
  };
  const shipped = await runDraftGraph(input, stubborn);
  assert.equal(shipped.bodyBlocks.filter((b) => b.type === "paragraph").length, 3, "the draft is not lost over a name");
  assert.equal(shipped.warnings.filter((w) => /refers to you by name/.test(w)).length, 3);
  assert.ok(shipped.warnings.some((w) => /Test Scholar steers a null/.test(w)), "the sentence is quoted so it can be found");
});

test("an article written about a scholar keeps the old rules, and is checked for one pronoun throughout", async () => {
  const about = { ...input, voice: "about" };
  const model = fakeModel();
  const r = await runDraftGraph(about, { generate: model.generate });
  assert.ok(model.calls.some((p) => /about a paper by Test Scholar/.test(p)), "the section prompt names the scholar");
  assert.equal(r.checks.pronouns.ok, null, "the fake lifts the paper's own sentences, which use no pronoun");

  /* Sections are separate calls; without this check they disagreed in production. */
  const split = {
    generate: async (req) => {
      const r0 = await fakeModel().generate(req);
      if (req.responseSchema !== plan.SECTION_SCHEMA) return r0;
      const n = req.prompt.match(/Write section (\d+) of/)[1];
      const pronoun = n === "3" ? "She" : "He";
      const cited = [...req.prompt.matchAll(/\[(p\d+)\]/g)].map((x) => x[1]);
      return { text: JSON.stringify({ paragraphs: [{ text: `${pronoun} steered a null toward each source of noise. ${PLAIN}`, passage_ids: [cited[0]] }], quote: null }) };
    },
  };
  const mixed = await runDraftGraph(about, split);
  assert.equal(mixed.checks.pronouns.ok, false);
  assert.deepEqual(mixed.checks.pronouns.used, ["he", "she"]);
  assert.ok(mixed.warnings.some((w) => /One of them is wrong about a real person/.test(w)), mixed.warnings.join(" | "));
});

/* ── beyond the paper ────────────────────────────────────────────────────── */

const IMPLIED = "Which means any receiver that must hear one signal beside a stronger one faces the same limit.";

/**
 * A fake for a briefed run: the outline has two paper sections and one that
 * goes beyond the paper; the extension section drafts one paper paragraph
 * and one implication; the reach judge answers by `reachJudge(text)`.
 */
function briefedModel({ reachJudge = () => "follows", implied = IMPLIED, coverage = { met: "full", note: "" }, beats = null } = {}) {
  const calls = [];
  const generate = async ({ prompt, responseSchema }) => {
    calls.push(prompt);
    if (responseSchema === plan.OUTLINE_SCHEMA) {
      return {
        text: JSON.stringify({
          title: "Steering silence toward the noise",
          deck: "A trial of adaptive arrays.",
          beats: beats || [
            { heading: "What the trial found", goal: "The array cut the noise.", kind: "paper", passage_ids: ["p2"] },
            { heading: "Where it breaks", goal: "Too many interferers defeat it.", kind: "paper", passage_ids: ["p3", "p4"] },
            { heading: "Why it matters", goal: "The same limit faces any crowded band.", kind: "extension", passage_ids: ["p1", "p3"] },
          ],
          brief_coverage: coverage,
        }),
        usage: { input: 10, output: 5 },
      };
    }
    if (responseSchema === fidelity.JUDGE_SCHEMA) {
      const paragraphs = [...prompt.matchAll(/^\((\d+)\) (.*)$/gm)].map((m) => ({ index: Number(m[1]), text: m[2] }));
      return { text: JSON.stringify({ paragraphs: paragraphs.map((p) => ({ index: p.index, verdict: "supported", unsupported_claims: [], reasons: [] })) }), usage: { input: 5, output: 5 } };
    }
    if (responseSchema === reach.JUDGE_SCHEMA) {
      const anchor = (prompt.match(/^\[(p\d+)\]/m) || [])[1] || "p1";
      const paragraphs = [...prompt.matchAll(/^\((\d+)\) (.*)$/gm)].map((m) => ({ index: Number(m[1]), text: m[2] }));
      return {
        text: JSON.stringify({ paragraphs: paragraphs.map((p) => {
          const v = reachJudge(p.text);
          const follows = { text: p.text, verdict: "follows", reason: "", anchor_ids: [anchor] };
          const over = { text: "used in every phone", verdict: "overreach", reason: "outside_fact", anchor_ids: [] };
          return { index: p.index, claims: v === "follows" ? [follows] : v === "partial" ? [follows, over] : [over] };
        }) }),
        usage: { input: 5, output: 5 },
      };
    }
    const m = prompt.match(/Write section (\d+) of/);
    const cited = [...prompt.matchAll(/\[(p\d+)\]/g)].map((x) => x[1]);
    const redrafted = /A reviewer compared/.test(prompt) ? " redrafted" : "";
    if (/^Section kind: extension$/m.test(prompt)) {
      return {
        text: JSON.stringify({ paragraphs: [
          { text: `${PLAIN} (section ${m[1]})`, passage_ids: [cited[0]], extension: false },
          { text: `${implied} (section ${m[1]}${redrafted})`, passage_ids: [cited[0]], extension: true },
        ], quote: null }),
        usage: { input: 20, output: 30 },
      };
    }
    return { text: JSON.stringify({ paragraphs: [{ text: `${PLAIN} (section ${m[1]})`, passage_ids: [cited[0]] }], quote: null }), usage: { input: 20, output: 30 } };
  };
  return { generate, calls };
}
const briefed = { ...input, brief: "explain why this matters for anyone using a phone in a crowded place" };

test("with a brief, a section beyond the paper is planned, its implications are judged for reach, and the article says which paragraphs go beyond", async () => {
  const progress = [];
  const model = briefedModel();
  const r = await runDraftGraph(briefed, { generate: model.generate, onProgress: (e) => progress.push(e) });

  assert.deepEqual(r.outline.map((b) => b.kind), ["paper", "paper", "extension"]);
  assert.deepEqual(r.coverage, { met: "full", note: "" });
  assert.ok(progress.some((e) => e.step === "plan_outline" && e.detail?.extensions === 1 && e.detail?.coverage === "full"));
  assert.ok(progress.some((e) => e.step === "judge_reach"));
  assert.ok(progress.some((e) => e.step === "draft_blocks" && e.detail?.kind === "extension"));

  const paragraphs = r.bodyBlocks.filter((b) => b.type === "paragraph");
  const extension = paragraphs.filter((b) => b.extension);
  assert.equal(paragraphs.length, 4);
  assert.equal(extension.length, 1);
  assert.equal(extension[0].reach.verdict, "follows");
  assert.equal(extension[0].reach.claims[0].anchorIds[0], "p1");
  assert.equal(extension[0].fidelity, undefined, "the fidelity judge left it alone");
  assert.ok(paragraphs.filter((b) => !b.extension).every((b) => b.fidelity.verdict === "supported" && b.reach === undefined));
  assert.equal(r.calls.filter((c) => c.step === "judge_reach").length, 1, "one reach call, for the one extension section");
  assert.equal(r.calls.filter((c) => c.step === "judge_fidelity").length, 3);
  assert.deepEqual([r.checks.budget.extension, r.checks.budget.paper, r.checks.budget.ok], [1, 3, true]);
  assert.equal(r.checks.worldClaims.ok, true);
  assert.ok(!r.warnings.some((w) => /beyond|brief/.test(w)), r.warnings.join(" | "));
  assert.ok(model.calls.some((p) => /^Section kind: extension$/m.test(p) && /Say implications as implications/.test(p)));
  assert.ok(model.calls.some((p) => /PARAGRAPHS THAT BUILD ON THEM:/.test(p) && !/THE READER:/.test(p)), "an adult reader is not named to the reach judge");
});

test("the reach judge names the reader when the band is young, and the drafter is told the reader is a child", async () => {
  const model = briefedModel();
  await runDraftGraph({ ...briefed, audience: "ages_8_11" }, { generate: model.generate });
  assert.ok(model.calls.some((p) => /^THE READER: readers aged 8 to 11/m.test(p)));
  assert.ok(model.calls.some((p) => /^Section kind: extension$/m.test(p) && /The reader is a child/.test(p)));
});

test("the reach judge sends a section back with the claims named; what still overreaches is dropped, what partly follows ships marked", async () => {
  const once = briefedModel({ reachJudge: (text) => (/redrafted/.test(text) ? "follows" : "overreach") });
  const r = await runDraftGraph(briefed, { generate: once.generate });
  assert.equal(r.calls.filter((c) => c.step === "judge_reach").length, 2, "the extension section was judged twice");
  assert.ok(once.calls.some((p) => /A reviewer compared the paragraphs that go beyond the paper/.test(p) && /"used in every phone" — brings in a fact/.test(p)));
  assert.ok(r.bodyBlocks.some((b) => b.extension && b.reach.verdict === "follows"));
  assert.ok(!r.warnings.some((w) => /beyond what the paper supports/.test(w)));

  const never = briefedModel({ reachJudge: () => "overreach" });
  const dropped = await runDraftGraph(briefed, { generate: never.generate });
  assert.equal(dropped.calls.filter((c) => c.step === "judge_reach").length, FIDELITY_RETRIES + 1);
  assert.equal(dropped.bodyBlocks.filter((b) => b.extension).length, 0, "the implication is gone");
  assert.equal(dropped.bodyBlocks.filter((b) => b.type === "paragraph").length, 3, "the paper paragraph in that section stays");
  assert.ok(dropped.warnings.some((w) => /1 paragraph in "Why it matters" was left out because it went beyond what the paper supports/.test(w)), dropped.warnings.join(" | "));

  const partly = briefedModel({ reachJudge: () => "partial" });
  const marked = await runDraftGraph(briefed, { generate: partly.generate });
  const ext = marked.bodyBlocks.find((b) => b.extension);
  assert.equal(ext.reach.verdict, "partial");
  assert.deepEqual(ext.reach.overreachClaims, ["used in every phone"]);
  assert.ok(marked.warnings.some((w) => /draws an implication the paper only partly supports/.test(w)));
});

test("a section that is only an implication and keeps overreaching refuses the run with its own sentence", async () => {
  const model = briefedModel({ reachJudge: () => "overreach" });
  const onlyImplied = {
    generate: async (req) => {
      const r0 = await model.generate(req);
      if (req.responseSchema === plan.SECTION_SCHEMA && /^Section kind: extension$/m.test(req.prompt)) {
        const d = JSON.parse(r0.text);
        d.paragraphs = d.paragraphs.filter((p) => p.extension);
        return { text: JSON.stringify(d) };
      }
      return r0;
    },
  };
  await assert.rejects(runDraftGraph(briefed, onlyImplied), /kept going beyond what the paper supports/);
});

test("a sentence that reads as a claim about the world is a warning even when the judge let it through", async () => {
  const model = briefedModel({ implied: "Which means the same limit faces any crowded band. This method is now used in every phone." });
  const r = await runDraftGraph(briefed, { generate: model.generate });
  assert.equal(r.checks.worldClaims.ok, false);
  assert.ok(r.warnings.some((w) => /reads as a claim about the world/.test(w) && /used in every phone/.test(w)), r.warnings.join(" | "));
});

test("the brief is answered out loud: coverage short of full is a warning, and a budget of extension sections is kept", async () => {
  const part = briefedModel({ coverage: { met: "part", note: "the paper says nothing about phones" } });
  const r = await runDraftGraph(briefed, { generate: part.generate });
  assert.deepEqual(r.coverage, { met: "part", note: "the paper says nothing about phones" });
  assert.ok(r.warnings.some((w) => /Part of the brief was left out: the paper says nothing about phones/.test(w)), r.warnings.join(" | "));

  const none = briefedModel({ coverage: { met: "none", note: "" }, beats: [
    { heading: "A", goal: "a", kind: "paper", passage_ids: ["p1"] },
    { heading: "B", goal: "b", kind: "paper", passage_ids: ["p2"] },
  ] });
  const r2 = await runDraftGraph(briefed, { generate: none.generate });
  assert.ok(r2.warnings.some((w) => /The paper cannot carry what the brief asked for/.test(w)));

  const greedy = briefedModel({ beats: [
    { heading: "A", goal: "a", kind: "paper", passage_ids: ["p1"] },
    { heading: "X", goal: "x", kind: "extension", passage_ids: ["p2"] },
    { heading: "Y", goal: "y", kind: "extension", passage_ids: ["p3"] },
    { heading: "Z", goal: "z", kind: "extension", passage_ids: ["p4"] },
  ] });
  const r3 = await runDraftGraph(briefed, { generate: greedy.generate });
  assert.deepEqual(r3.outline.map((b) => b.kind), ["paper", "extension"], "no more sections beyond the paper than from it");
  assert.ok(r3.warnings.some((w) => /2 proposed sections that went beyond the paper were left out/.test(w)), r3.warnings.join(" | "));

  /* Without a brief there is nothing to go beyond: a beat marked extension is planned as the paper's. */
  const unbriefed = briefedModel();
  const r4 = await runDraftGraph(input, { generate: unbriefed.generate });
  assert.ok(r4.outline.every((b) => b.kind === "paper"));
  assert.equal(r4.coverage, null);
  assert.ok(!r4.bodyBlocks.some((b) => b.extension));
  assert.ok(unbriefed.calls.some((p) => /No brief was given/.test(p)));
});

test("an approved outline keeps a section's kind, and a section cannot be promoted to go beyond the paper by the client", () => {
  const passages = plan.splitPassages(PAPER);
  const proposed = { title: "T", deck: "D", coverage: { met: "full", note: "" }, beats: [
    { index: 1, heading: "Found", goal: "", kind: "paper", passageIds: ["p1"] },
    { index: 2, heading: "Why it matters", goal: "", kind: "extension", passageIds: ["p2"] },
  ] };
  const kept = normaliseApprovedOutline(proposed, { beats: [{ heading: "Why it matters", kind: "extension", passageIds: ["p2"] }, { heading: "Found", kind: "extension", passageIds: ["p1"] }] }, passages);
  assert.deepEqual(kept.beats.map((b) => [b.heading, b.kind]), [["Why it matters", "extension"], ["Found", "paper"]]);
  assert.deepEqual(kept.coverage, { met: "full", note: "" });
  assert.ok(normaliseApprovedOutline(proposed, null, passages).beats.every((b, i) => b.kind === proposed.beats[i].kind));
});
