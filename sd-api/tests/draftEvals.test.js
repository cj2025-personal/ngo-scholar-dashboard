const test = require("node:test");
const assert = require("node:assert/strict");

const { THRESHOLDS, scoreDraft, summarise, validateRow, parseJsonl, inputFor } = require("../src/lib/draftEvals");

const para = (html, verdict = "supported", refs = ["p1"]) => ({
  type: "paragraph", html, fidelity: verdict ? { verdict, unsupportedClaims: [], reasons: [] } : undefined, sourceRefs: refs.map((passageId) => ({ passageId })),
});
const good = {
  bodyBlocks: [{ type: "subheading", html: "H" }, para("The array steers a null toward each interferer."), para("It lowers the noise the receiver hears."), { type: "quote", html: "q", sourceRefs: [{ passageId: "p1" }] }],
  readability: { verdict: "pass", fkGrade: 9.8, drift: -0.2 },
  words: 400,
  calls: [{ usage: { input: 10, output: 5 } }, { usage: { input: 20, output: 7 } }],
  warnings: [],
};

test("a clean draft scores full marks on every dimension", () => {
  const s = scoreDraft(good);
  assert.equal(s.paragraphs, 2);
  assert.equal(s.entailment, 1);
  assert.equal(s.bandFit, 1);
  assert.equal(s.voiceViolations, 0);
  assert.equal(s.provenance, 1);
  assert.deepEqual(s.tokens, { input: 30, output: 12 });
  assert.equal(s.calls, 2);
});

test("partial verdicts, a warn band, first person and a missing citation each cost what they should", () => {
  const s = scoreDraft({
    ...good,
    bodyBlocks: [para("Supported.", "supported"), para("Partly.", "partial"), para("I think so.", "supported", []), para("Nothing.", "unsupported")],
    readability: { verdict: "warn", fkGrade: 13.2, drift: 3.2 },
  });
  assert.equal(s.entailment, 0.5);
  assert.equal(s.partial, 1);
  assert.equal(s.unsupported, 1);
  assert.equal(s.bandFit, 0.5);
  assert.equal(s.voiceViolations, 1);
  assert.equal(s.provenance, 0.75);
});

test("the set passes only when every mean clears its threshold, and names what missed", () => {
  const pass = summarise([scoreDraft(good), scoreDraft(good)]);
  assert.equal(pass.pass, true);
  assert.deepEqual(pass.failures, []);
  assert.equal(pass.n, 2);

  const bad = summarise([scoreDraft(good), scoreDraft({ ...good, bodyBlocks: [para("A.", "unsupported"), para("B.", "unsupported")], readability: { verdict: "fail" } })]);
  assert.equal(bad.pass, false);
  assert.ok(bad.failures.some((f) => f.startsWith("entailment: 0.5 against at least " + THRESHOLDS.entailment)));
  assert.ok(bad.failures.some((f) => f.startsWith("bandFit: 0.5")));
  assert.equal(summarise([]).pass, false, "an empty set proves nothing and does not pass");
});

test("rows are validated and JSONL is parsed with comments and blank lines ignored", () => {
  const text = `# synthetic\n\n{"id":"a","title":"A","audience":"general","text":"${"word ".repeat(220).trim()}"}\n{"id":"b","text":"too short"}\n`;
  const rows = parseJsonl(text);
  assert.equal(rows.length, 2);
  assert.deepEqual(validateRow(rows[0], 0), []);
  assert.ok(validateRow(rows[1], 1).some((p) => /under 200 words/.test(p)));
  assert.ok(validateRow({ id: "c", text: "w ".repeat(300), audience: "toddlers" }, 2).some((p) => /unknown audience/.test(p)));
  assert.throws(() => parseJsonl("{not json}"), /line 1/);

  const input = inputFor(rows[0]);
  assert.equal(input.source.use, "draftable");
  assert.equal(input.audience, "general");
  assert.ok(input.prepared.words >= 200);
});
