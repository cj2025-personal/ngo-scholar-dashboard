/**
 * The story agent's reducer and loop, against scripted tool calls.
 *
 * What must hold: an untouched block is byte-identical and keeps its receipt;
 * a written block carries only the passages it cited; first person, empty
 * text, invented passages and unverifiable quotes are refused with a reason;
 * the diff names exactly what changed; the loop stops on finish.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const { stateFromStory, applyTool, diffStates, runStoryAgent, renderState, TOOL_DECLARATIONS } = require("../src/lib/storyAgent");

const story = {
  title: "Networks that hold", subtitle: "A deck", excerpt: "A summary",
  bodyBlocks: [
    { type: "subheading", html: "What the drought did", sourceRefs: [] },
    { type: "paragraph", html: "Nineteen boards kept allocating. Twelve suspended allocations.", sourceRefs: [{ passageId: "p2" }], draftedText: "Nineteen boards kept allocating. Twelve suspended allocations.", fidelity: { verdict: "supported", unsupportedClaims: [] } },
    { type: "paragraph", html: "The small boards held because the members called each other.", sourceRefs: [{ passageId: "p3" }] },
    { type: "image", imageId: "img1", caption: "A canal", alt: "canal", width: "body", url: "/x" },
  ],
};
const passages = [
  { id: "p2", text: "Nineteen of the thirty-one continued to allocate on schedule; twelve suspended allocations." },
  { id: "p3", text: "The members setting allocations were the same individuals who were called when infrastructure failed." },
];
const ctx = () => { let n = 0; return { passages, imagesAllowed: true, isVerbatim: (t, id) => passages.find((p) => p.id === id)?.text.toLowerCase().includes(t.toLowerCase().replace(/[.“”"]/g, "").trim()), nextKey: () => ++n }; };

test("the state is built from the story and rendered with numbers, types and citations", () => {
  const s = stateFromStory(story);
  assert.equal(s.blocks.length, 4);
  const r = renderState(s);
  assert.match(r, /^\[2\] \(paragraph\) cites p2: Nineteen boards/m);
  assert.match(r, /^\[4\] \(image\) caption: A canal/m);
  assert.match(r, /^\[1\] \(subheading\) \(no citation\)/m);
});

test("replace keeps the key, cites only known passages, and refuses the rules", () => {
  const s = stateFromStory(story);
  const c = ctx();
  const ok = applyTool(s, { name: "replace_block", args: { index: 2, text: "Nineteen boards kept going.", passage_ids: ["p2", "p99"] } }, c);
  assert.match(ok.result, /^ok/);
  assert.equal(ok.state.blocks[1].key, s.blocks[1].key);
  assert.deepEqual(ok.state.blocks[1].sourceRefs, [{ passageId: "p2" }], "p99 is not a passage and is dropped");
  assert.equal(ok.state.blocks[1].changed, true);
  assert.equal(ok.state.blocks[2], s.blocks[2], "an untouched block is the same object");

  assert.match(applyTool(s, { name: "replace_block", args: { index: 2, text: "I think so.", passage_ids: ["p2"] } }, c).result, /first-person/);
  assert.match(applyTool(s, { name: "replace_block", args: { index: 2, text: "A claim.", passage_ids: [] } }, c).result, /no valid passage_ids/);
  assert.match(applyTool(s, { name: "replace_block", args: { index: 2, text: "A claim.", passage_ids: [], own_view: true } }, c).result, /^ok/, "own view needs no citation");
  assert.match(applyTool(s, { name: "replace_block", args: { index: 9, text: "x", passage_ids: ["p2"] } }, c).result, /no block 9/);
  assert.match(applyTool(s, { name: "replace_block", args: { index: 4, text: "x", passage_ids: ["p2"] } }, c).result, /image/);
  assert.match(applyTool(s, { name: "replace_block", args: { index: 2, text: "<b>bold</b> & co", passage_ids: ["p2"] } }, c).state.blocks[1].html, /&lt;b&gt;bold&lt;\/b&gt; &amp; co/, "text is escaped, never HTML");
});

test("insert, delete, move, heading fields and search behave and renumber", () => {
  const s = stateFromStory(story);
  const c = ctx();
  const ins = applyTool(s, { name: "insert_block", args: { after: 0, kind: "quote", text: "twelve suspended allocations", passage_ids: ["p2"] } }, c);
  assert.match(ins.result, /inserted as block 1/);
  assert.equal(ins.state.blocks[0].type, "quote");
  assert.match(applyTool(s, { name: "insert_block", args: { after: 0, kind: "quote", text: "not in the paper at all", passage_ids: ["p2"] } }, c).result, /word for word/);

  const del = applyTool(s, { name: "delete_block", args: { index: 4 } }, c);
  assert.equal(del.state.blocks.length, 3);
  const mv = applyTool(s, { name: "move_block", args: { index: 3, to: 1 } }, c);
  assert.equal(mv.state.blocks[0].key, s.blocks[2].key);
  const hf = applyTool(s, { name: "set_heading_fields", args: { title: "New title" } }, c);
  assert.equal(hf.state.title, "New title");
  assert.equal(hf.state.subtitle, "A deck");
  assert.match(applyTool(s, { name: "set_heading_fields", args: { title: "My story" } }, c).result, /first-person/);
  const sr = applyTool(s, { name: "search_passages", args: { query: "infrastructure failed" } }, c);
  assert.match(sr.result, /\[p3\]/);
  assert.match(applyTool(s, { name: "search_passages", args: { query: "quantum gravity" } }, c).result, /no passages match/);
  assert.match(applyTool(s, { name: "nonsense", args: {} }, c).result, /unknown tool/);
});

test("images are queued for generation, labelled, and refused where images are off", () => {
  const s = stateFromStory(story);
  const on = applyTool(s, { name: "add_image", args: { after: 2, description: "a four-element antenna array on a mast", caption: "An array", alt: "array" } }, ctx());
  assert.match(on.result, /illustration will be generated as block 3/);
  assert.equal(on.state.blocks[2].type, "image");
  assert.equal(on.state.blocks[2].generated, true);
  assert.equal(on.state.blocks[2].pending.description, "a four-element antenna array on a mast");
  const off = applyTool(s, { name: "add_image", args: { after: 2, description: "x", caption: "", alt: "" } }, { ...ctx(), imagesAllowed: false });
  assert.match(off.result, /not available/);
});

test("the diff names added, changed, moved, removed blocks and changed fields", () => {
  const s = stateFromStory(story);
  const c = ctx();
  let w = applyTool(s, { name: "replace_block", args: { index: 2, text: "Nineteen boards kept going.", passage_ids: ["p2"] } }, c).state;
  w = applyTool(w, { name: "delete_block", args: { index: 4 } }, c).state;
  w = applyTool(w, { name: "insert_block", args: { after: 3, kind: "paragraph", text: "Members called each other.", passage_ids: ["p3"] } }, c).state;
  w = applyTool(w, { name: "set_heading_fields", args: { subtitle: "New deck" } }, c).state;
  const d = diffStates(s, w);
  const kinds = d.map((x) => x.kind).sort();
  assert.deepEqual(kinds, ["added", "changed", "field", "removed"]);
  assert.equal(d.find((x) => x.kind === "changed").before, "Nineteen boards kept allocating. Twelve suspended allocations.");
  assert.equal(d.find((x) => x.kind === "removed").text, "A canal");
  assert.equal(d.find((x) => x.kind === "field").field, "subtitle");
});

test("the loop applies calls, feeds results back, stops on finish, and reports", async () => {
  const s = stateFromStory(story);
  const seen = [];
  const generate = async ({ contents, tools, systemInstruction }) => {
    seen.push(contents.length);
    assert.ok(tools[0].functionDeclarations.length === TOOL_DECLARATIONS.length);
    assert.match(systemInstruction, /third person/);
    if (contents.length === 1) {
      const fcs = [{ name: "search_passages", args: { query: "suspended allocations" } }, { name: "replace_block", args: { index: 2, text: "Twelve boards suspended allocations.", passage_ids: ["p2"] } }];
      return { text: "", functionCalls: fcs, parts: fcs.map((fc) => ({ functionCall: fc })), usage: { input: 1, output: 1 } };
    }
    const results = contents[contents.length - 1].parts.map((p) => p.functionResponse.response.result);
    assert.match(results[0], /\[p2\]/);
    assert.match(results[1], /^ok/);
    const fc = { name: "finish", args: { summary: "Shortened block 2." } };
    return { text: "", functionCalls: [fc], parts: [{ functionCall: fc }], usage: { input: 1, output: 1 } };
  };
  const r = await runStoryAgent({ state: s, passages, instruction: "shorten block 2", generate, isVerbatim: () => true });
  assert.deepEqual(seen, [1, 3]);
  assert.equal(r.summary, "Shortened block 2.");
  assert.equal(r.calls.length, 3);
  assert.equal(r.changes.length, 1);
  assert.equal(r.changes[0].kind, "changed");
  assert.equal(r.state.blocks[2].html, s.blocks[2].html);
  assert.equal(r.usage.length, 2);
});

test("prose instead of a tool ends the loop as a summary, and the step cap holds", async () => {
  const s = stateFromStory(story);
  const prose = async () => ({ text: "Nothing to change here.", functionCalls: [], parts: [{ text: "Nothing to change here." }] });
  const r = await runStoryAgent({ state: s, passages, instruction: "x", generate: prose });
  assert.equal(r.summary, "Nothing to change here.");
  assert.equal(r.changes.length, 0);

  let n = 0;
  const forever = async () => { n += 1; const fc = { name: "search_passages", args: { query: "boards" } }; return { text: "", functionCalls: [fc], parts: [{ functionCall: fc }] }; };
  const capped = await runStoryAgent({ state: s, passages, instruction: "x", generate: forever });
  assert.match(capped.summary, /maximum number of steps/);
  assert.ok(n <= 12);
});
