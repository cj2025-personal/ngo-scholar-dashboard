/**
 * The evidence ledger, tested for what a verifier relies on: the same
 * manifest always gives the same bytes, a signature made here verifies with
 * the published key and with nothing else, and any change to the manifest
 * breaks it.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");

const ledger = require("../src/lib/evidenceLedger");

const story = {
  id: "66f000000000000000000001",
  slug: "what-the-paper-found",
  title: "What the paper found",
  version: 4,
  status: "published",
  publishedAt: "2026-09-13T12:00:00.000Z",
  publicUrl: "/stories/what-the-paper-found",
  author: { name: "Test Scholar", profileId: "e2e-profile-0001" },
  provenance: { origin: "harvested", sourceId: "src-1", title: "Adaptive nulling", year: 2024, url: "https://pmc.example/src-1", licence: "cc_by", audience: "adults" },
  bodyBlocks: [
    { type: "subheading", html: "How it works" },
    {
      type: "paragraph", html: "The array improved the signal by <b>eleven</b> decibels.", traceable: true,
      sourceRefs: [{ passageId: "p1" }],
      fidelity: { verdict: "supported", claims: [{ text: "improved the signal by eleven decibels", verdict: "supported", passageIds: ["p1"], evidence: "improved the signal-to-noise ratio by eleven decibels" }] },
    },
    { type: "paragraph", html: "This is my own view.", ownView: true },
    { type: "image", imageId: "x", caption: "Illustration: an array" },
  ],
};
const passages = [{ id: "p1", text: "The array improved the signal-to-noise ratio by eleven decibels with one interferer." }];
const revisions = [
  { version: 4, source: "scholar", created_by: "a@x.edu", created_at: new Date("2026-09-13T12:00:00Z"), turn_id: null, note: null },
  { version: 1, source: "drafter", created_by: "drafter:draft-graph-2026.2", created_at: new Date("2026-09-13T11:00:00Z"), turn_id: null, note: "The draft as the machine wrote it" },
  { version: 2, source: "agent", created_by: "a@x.edu", created_at: new Date("2026-09-13T11:30:00Z"), turn_id: "t1", note: "shorten paragraph 2" },
];

test("canonical JSON sorts keys, drops undefined, and is stable across key order", () => {
  const a = ledger.canonicalJson({ b: 1, a: [3, { z: null, y: "s" }], c: undefined });
  const b = ledger.canonicalJson({ c: undefined, a: [3, { y: "s", z: null }], b: 1 });
  assert.equal(a, b);
  assert.equal(a, '{"a":[3,{"y":"s","z":null}],"b":1}');
  assert.equal(ledger.canonicalJson(new Date("2026-01-01T00:00:00Z")), '"2026-01-01T00:00:00.000Z"');
});

test("a paragraph that goes beyond the paper is ledgered apart: its implications, the passages they build on, and why any went too far", () => {
  const beyond = {
    ...story,
    bodyBlocks: [
      ...story.bodyBlocks,
      {
        type: "paragraph", html: "Which means any crowded band faces the same limit. This method is used in every phone.", traceable: true,
        sourceRefs: [{ passageId: "p1" }], extension: true,
        reach: { verdict: "partial", overreachClaims: ["This method is used in every phone."], claims: [
          { text: "Which means any crowded band faces the same limit.", verdict: "follows", reason: null, anchorIds: ["p1"] },
          { text: "This method is used in every phone.", verdict: "overreach", reason: "outside_fact", anchorIds: [] },
        ] },
      },
    ],
  };
  const m = ledger.buildManifest({ story: beyond, revisions, passages, versions: { judge: "fidelity-judge-2026.2", reach: "reach-judge-2026.1" }, keyId: "k1" });
  const p = m.paragraphs[3];
  assert.equal(p.extension, true);
  assert.equal(p.verdict, "partial", "the reach verdict stands where the fidelity verdict would");
  assert.deepEqual(p.cited, ["p1"]);
  assert.deepEqual(p.claims[0], { text: "Which means any crowded band faces the same limit.", verdict: "follows", reason: null, passage_ids: ["p1"], evidence: "" });
  assert.equal(p.claims[1].reason, "outside_fact");
  assert.deepEqual(m.totals, { paragraphs: 3, cited: 1, extension: 1, uncited: 1, own_view: 1, context: 0, to_verify: 0, verified: 0, claims: 3, supported: 1, unsupported: 0, follows: 1, overreach: 1 });
  assert.equal(m.models.reach, "reach-judge-2026.1");
  assert.match(ledger.summarySentence(m), /3 claims checked against the paper, 1 supported; 1 implication follows from it, 1 goes too far\./);
  assert.ok(!/implication/.test(ledger.summarySentence(ledger.buildManifest({ story, revisions, passages }))), "an article with nothing beyond the paper says nothing about implications");
});

test("the manifest records every claim, the approval, the whole history, and hashes rather than text", () => {
  const m = ledger.buildManifest({ story, revisions, passages, versions: { drafter: "draft-graph-2026.2", judge: "fidelity-judge-2026.2" }, keyId: "k1", generatedAt: new Date("2026-09-13T12:05:00Z") });
  assert.equal(m.ledger_version, ledger.LEDGER_VERSION);
  assert.equal(m.story.version, 4);
  assert.equal(m.approval.by, "a@x.edu");
  assert.equal(m.approval.version, 4);
  assert.deepEqual(m.history.map((h) => h.version), [1, 2, 4], "oldest first");
  assert.equal(m.history[1].turn_id, "t1");

  assert.equal(m.paragraphs.length, 3, "images are not paragraphs");
  const p = m.paragraphs[1];
  assert.equal(p.index, 2);
  assert.deepEqual(p.cited, ["p1"]);
  assert.equal(p.claims.length, 1);
  assert.equal(p.claims[0].passage_ids[0], "p1");
  assert.equal(p.hash, ledger.sha256("The array improved the signal by eleven decibels."), "the hash is of the plain text, not the markup");
  assert.equal(m.paragraphs[2].own_view, true);

  assert.deepEqual(m.totals, { paragraphs: 2, cited: 1, extension: 0, uncited: 1, own_view: 1, context: 0, to_verify: 0, verified: 0, claims: 1, supported: 1, unsupported: 0, follows: 0, overreach: 0 });
  assert.equal(m.paragraphs[1].extension, false);
  assert.equal(m.passages[0].id, "p1");
  assert.ok(!("text" in m.passages[0]), "passage text never travels in the manifest");
  assert.equal(m.models.judge, "fidelity-judge-2026.2");
  assert.equal(m.source.licence, "cc_by");
  assert.match(ledger.summarySentence(m), /1 claim checked against the paper, 1 supported\. Approved by a@x\.edu as version 4/);
});

test("a signature verifies with the key that made it, and with nothing else, and any change breaks it", () => {
  const keys = ledger.loadKeys({ isProduction: false });
  assert.ok(keys.ephemeral, "no key configured outside production means a per-process key");
  assert.match(keys.keyId, /^ed25519-[0-9a-f]{16}$/);
  const m = ledger.buildManifest({ story, revisions, passages, keyId: keys.keyId });
  const sig = ledger.sign(m, keys);
  const pem = ledger.publicKeyPem(keys);

  assert.deepEqual(ledger.verify(m, sig, pem), { valid: true, reason: null });
  assert.deepEqual(ledger.verify(JSON.parse(JSON.stringify(m)), sig, pem), { valid: true, reason: null }, "a round trip through JSON verifies");

  const tampered = JSON.parse(JSON.stringify(m));
  tampered.paragraphs[1].claims[0].verdict = "unsupported";
  assert.equal(ledger.verify(tampered, sig, pem).valid, false, "changing a verdict breaks the signature");

  const other = crypto.generateKeyPairSync("ed25519").publicKey.export({ type: "spki", format: "pem" });
  assert.equal(ledger.verify(m, sig, other).valid, false, "another key does not verify it");
  assert.equal(ledger.verify(m, "not base64!", pem).valid, false);
  assert.match(ledger.verify(m, sig, "garbage").reason, /could not verify/);
});

test("a configured key is used as given, as PEM or as base64 of the PEM, and production without one signs nothing", () => {
  const pair = crypto.generateKeyPairSync("ed25519");
  const pem = pair.privateKey.export({ type: "pkcs8", format: "pem" });
  const fromPem = ledger.loadKeys({ privateKey: pem, isProduction: true });
  assert.equal(fromPem.ephemeral, false);
  const fromB64 = ledger.loadKeys({ privateKey: Buffer.from(pem).toString("base64"), keyId: "prod-2026", isProduction: true });
  assert.equal(fromB64.keyId, "prod-2026");
  assert.equal(ledger.publicKeyPem(fromPem), ledger.publicKeyPem(fromB64));
  assert.equal(ledger.loadKeys({ isProduction: true }), null);
});

test("a verifier can confirm the passages they fetched are the ones the claims were judged against", () => {
  const m = ledger.buildManifest({ story, revisions, passages });
  assert.deepEqual(ledger.checkPassages(m, passages), { matched: 1, mismatched: [], missing: [] });
  assert.deepEqual(ledger.checkPassages(m, [{ id: "p1", text: "something else" }]), { matched: 0, mismatched: ["p1"], missing: [] });
  assert.deepEqual(ledger.checkPassages(m, []), { matched: 0, mismatched: [], missing: ["p1"] });
  assert.deepEqual(ledger.checkPassages(m, [{ id: "p1", text: "  The array   improved the signal-to-noise ratio by eleven decibels with one interferer. " }]).mismatched, [], "whitespace is not a difference");
});
