/**
 * The rule checks that the author's own context adds: the budget counts it
 * as beyond the paper; a sentence that wears the paper's authority is
 * caught by wording; and the list to verify is what the author has not yet
 * ticked.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const { extensionBudget, attributionCues, verifyList } = require("../src/lib/checks");

const paper = (html) => ({ type: "paragraph", html, sourceRefs: [{ passageId: "p1" }] });
const ext = (html) => ({ ...paper(html), extension: true });
const ctx = (html, toVerify = []) => ({ type: "paragraph", html, ownView: true, context: { toVerify } });
const own = (html) => ({ type: "paragraph", html, ownView: true });

test("the budget counts context and extension together against the paper's paragraphs", () => {
  const ok = extensionBudget({ blocks: [paper("a"), paper("b"), ext("c"), ctx("d")] });
  assert.equal(ok.ok, true);
  assert.equal(ok.context, 1);
  assert.equal(ok.extension, 1);
  assert.match(ok.sentence, /1 as your own context/);
  const over = extensionBudget({ blocks: [paper("a"), ext("c"), ctx("d"), own("e")] });
  assert.equal(over.ok, false, "a bare own-view paragraph is the scholar's and is not counted either way");
  assert.match(over.sentence, /rest mostly on what the paper says/);
  assert.equal(extensionBudget({ blocks: [paper("a")] }).ok, null);
});

test("a context sentence that says the paper showed something is caught by wording; the author's own knowledge is not", () => {
  const r = attributionCues({ blocks: [
    paper("The paper shows eleven decibels."),
    ctx("In practice this turns up everywhere. The paper shows it is used in every phone. As the study found, receivers struggle."),
    ctx("Anyone who has used a phone at the edge of a cell has met this."),
  ] });
  assert.equal(r.heuristic, true);
  assert.equal(r.checked, 2, "only the author's own context is checked");
  assert.deepEqual(r.hits.map((h) => h.block), [2, 2]);
  assert.match(r.hits[0].sentence, /^The paper shows it is used/);
  assert.equal(r.ok, false);
  assert.equal(attributionCues({ blocks: [paper("The paper shows x.")] }).ok, null);
});

test("the list to verify is every specific the author has not ticked, by block", () => {
  const r = verifyList({ blocks: [
    paper("a"),
    ctx("b", [{ text: "2.4 GHz", kind: "standard", verified: false }, { text: "Philips", kind: "organisation", verified: true }]),
    ctx("c", [{ text: "since 2019", kind: "date", verified: false }]),
  ] });
  assert.equal(r.total, 3);
  assert.equal(r.unverified, 2);
  assert.equal(r.ok, false);
  assert.deepEqual(r.items.map((i) => [i.block, i.text, i.verified]), [[2, "2.4 GHz", false], [2, "Philips", true], [3, "since 2019", false]]);
  assert.equal(verifyList({ blocks: [paper("a")] }).ok, null);
  assert.equal(verifyList({ blocks: [ctx("b", [{ text: "x", kind: "other", verified: true }])] }).ok, true);
});
