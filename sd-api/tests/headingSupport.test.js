/**
 * A heading may not name what the article never says.
 *
 * Every judge skips a block that is not a paragraph, so headings were the one
 * part of an article nothing read. Asked to connect a signal-processing paper
 * to cancer, the real model wrote paragraphs that said nothing about cancer —
 * the reach judge forbids it — under the heading "Potential Applications in
 * Cancer Treatment and Protein Folding". These are the rules that catch that
 * without catching an honest heading.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const { headingSupport } = require("../src/lib/checks");

const passages = [
  { id: "p1", text: "The array improved the signal-to-noise ratio by eleven decibels with one interferer." },
  { id: "p2", text: "Performance degrades when more than four interferers are present in a crowded band." },
];
const head = (t) => ({ type: "subheading", html: t });
const para = (t) => ({ type: "paragraph", html: t });

test("a heading naming what neither the article nor the paper mentions is caught — the cancer case, verbatim", () => {
  const r = headingSupport({
    blocks: [
      head("Potential Applications in Cancer Treatment and Protein Folding"),
      para("The method can find weak signals even when they are buried in stronger interference. This suggests it could apply where subtle variations matter."),
    ],
    passages,
  });
  assert.equal(r.ok, false);
  assert.equal(r.unsupported.length, 1);
  assert.equal(r.unsupported[0].kind, "heading");
  assert.deepEqual(r.unsupported[0].missing.sort(), ["cancer", "folding", "protein", "treatment"]);
});

test("an honest heading passes, including one that frames rather than names", () => {
  const blocks = [
    head("Weak signals in crowded bands"),
    para("A crowded band makes the weak signal hard to hear beside the strong one."),
    head("Why this matters"),
    para("The same problem faces any receiver in that situation."),
    head("What the interferers do"),
    para("Performance degrades when more than four interferers are present."),
  ];
  const r = headingSupport({ blocks, passages });
  assert.equal(r.ok, true, JSON.stringify(r.unsupported));
  assert.equal(r.checked, 3);
});

test("a word the paper uses counts as said, even where the article's prose does not repeat it", () => {
  const r = headingSupport({
    blocks: [head("Decibels and interferers"), para("The gain was measurable.")],
    passages,
  });
  assert.equal(r.ok, true, JSON.stringify(r.unsupported));
});

test("plurals and longer forms count: a heading may say signals where the paper said signal", () => {
  const r = headingSupport({
    blocks: [head("Signalling in crowded bands"), para("The band is crowded.")],
    passages: [{ id: "p1", text: "The signal arrives at broadside." }],
  });
  assert.equal(r.ok, true, JSON.stringify(r.unsupported));
});

test("the title is held to the same rule as a heading", () => {
  const r = headingSupport({
    blocks: [head("Weak signals"), para("The weak signal is hard to hear.")],
    passages,
    title: "How this cures cancer",
  });
  assert.equal(r.ok, false);
  assert.deepEqual(r.unsupported.map((u) => u.kind), ["title"]);
  assert.deepEqual(r.unsupported[0].missing.sort(), ["cancer", "cures"]);
});

test("an article with no headings and no title says nothing either way", () => {
  assert.equal(headingSupport({ blocks: [para("x")], passages }).ok, null);
});

test("one odd word is imagery and passes; a second is a topic the article does not have", () => {
  const blocks = [head("Steering silence toward the noise"), para("The array steers a null toward each source of noise.")];
  assert.equal(headingSupport({ blocks, passages }).ok, true, "a metaphor is not a false claim");
  const two = [head("Steering silence toward the orchestra"), para("The array steers a null toward each source of noise.")];
  assert.equal(headingSupport({ blocks: two, passages }).ok, false);
});

test("everyday verbs frame a section without claiming a topic", () => {
  for (const heading of ["Where it breaks", "What the trial found", "What this means beyond the paper", "How it works", "Why this matters today"]) {
    const r = headingSupport({ blocks: [head(heading), para("The array steers a null toward each source of noise, so the signal is cleaner.")], passages });
    assert.equal(r.ok, true, `${heading} → ${JSON.stringify(r.unsupported)}`);
  }
});
