/**
 * Watching the record, tested for what must not be missed: the DOI is found
 * wherever it hides, every kind of notice is read, only the ones that matter
 * become alerts, and an alert names the paragraphs that rest on the paper.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const record = require("../src/lib/record");

test("a DOI is found in a URL, a prefix, or a bare string, and trailing punctuation does not stick to it", () => {
  assert.equal(record.doiFrom("https://doi.org/10.1000/src-e2e-1"), "10.1000/src-e2e-1");
  assert.equal(record.doiFrom("doi:10.1234/ABC.DEF"), "10.1234/abc.def");
  assert.equal(record.doiFrom("See 10.5555/xyz123)."), "10.5555/xyz123");
  assert.equal(record.doiFrom("https://pmc.example/src-e2e-1"), null);
  assert.equal(record.doiFrom(""), null);
});

test("every kind of notice Crossref registers is read, and dated however it was given", () => {
  const notices = record.noticesFrom({
    "updated-by": [
      { type: "retraction", DOI: "10.1000/notice-1", label: "Retraction", updated: { "date-time": "2026-09-01T00:00:00Z" } },
      { type: "Expression of Concern", DOI: "10.1000/notice-2", updated: { "date-parts": [[2026, 3]] } },
      { type: "addendum", DOI: "10.1000/notice-3" },
      { type: "" },
    ],
  });
  assert.equal(notices.length, 3, "an entry with no type is nothing");
  assert.deepEqual(notices[0], { type: "retraction", kind: "retracted", doi: "10.1000/notice-1", label: "Retraction", date: "2026-09-01" });
  assert.equal(notices[1].kind, "concern");
  assert.equal(notices[1].date, "2026-03-01");
  assert.equal(notices[2].kind, "updated");
  assert.deepEqual(record.noticesFrom({}), []);
  assert.deepEqual(record.noticesFrom(null), []);
});

test("only notices that deserve attention become alerts, and each names the affected paragraphs", () => {
  const story = {
    provenance: { title: "Adaptive nulling" },
    bodyBlocks: [
      { type: "subheading", html: "h" },
      { type: "paragraph", html: "a", sourceRefs: [{ passageId: "p1" }] },
      { type: "paragraph", html: "b" },
      { type: "paragraph", html: "c", sourceRefs: [{ passageId: "p2" }] },
    ],
  };
  const notices = record.noticesFrom({ "updated-by": [
    { type: "correction", DOI: "10.1000/c", updated: { "date-time": "2026-05-02T00:00:00Z" } },
    { type: "addendum", DOI: "10.1000/a" },
    { type: "retraction", DOI: "10.1000/r", updated: { "date-time": "2026-09-01T00:00:00Z" } },
  ] });
  const alerts = record.alertsFor({ notices, story });
  assert.equal(alerts.length, 2, "an addendum is not an alert");
  assert.deepEqual(alerts.map((a) => a.kind), ["corrected", "retracted"]);
  assert.deepEqual(alerts[1].affected_blocks, [2, 4], "the paragraphs that rest on the paper, by number");
  assert.equal(alerts[1].notice_url, "https://doi.org/10.1000/r");
  assert.match(alerts[1].sentence, /“Adaptive nulling” was retracted on 2026-09-01/);
  assert.match(alerts[0].sentence, /corrected on 2026-05-02/);
  assert.match(record.headline(alerts), /retracted/, "the worst alert leads");
  assert.equal(record.headline([]), null);
  assert.match(record.sentenceFor("retracted", {}), /the paper this article is drawn from was retracted\./);
});
