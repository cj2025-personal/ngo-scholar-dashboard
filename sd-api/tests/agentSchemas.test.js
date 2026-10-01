/**
 * Every schema an agent sends the model, checked for what the model API
 * refuses outright.
 *
 * The studio's conversation agent once offered "" as an enum value for "no
 * paper": the test double accepted it, the real API answered 400 on every
 * call, and the router — counting that as the model being down — opened the
 * breaker on gemini-2.5-flash for every purpose that uses it. So: no empty
 * enum value anywhere, no empty enum, and every required field declared.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const guard = require("../src/lib/agents/readerGuard");
const memory = require("../src/lib/agents/readerMemory");
const suggest = require("../src/lib/agents/readerSuggest");
const converse = require("../src/lib/agents/studioConverse");
const ideas = require("../src/lib/agents/studioIdeas");
const voice = require("../src/lib/agents/voiceJudge");
const band = require("../src/lib/agents/bandJudge");
const reviewer = require("../src/lib/agents/articleReviewer");
const caveats = require("../src/lib/agents/caveatJudge");
const sentinel = require("../src/lib/sentinel");
const readingAgent = require("../src/lib/readingAgent");
const fidelity = require("../src/lib/fidelity");
const reach = require("../src/lib/reach");
const context = require("../src/lib/context");
const storyAgent = require("../src/lib/storyAgent");
const { createRouter, resetBreakers, isRequestError } = require("../src/lib/modelRouter");

/** Every problem the API would refuse, by path. */
function problems(schema, path = "$") {
  if (!schema || typeof schema !== "object") return [];
  const out = [];
  if (Array.isArray(schema.enum)) {
    if (!schema.enum.length) out.push(`${path}: empty enum`);
    schema.enum.forEach((v, i) => { if (typeof v !== "string" || !v.trim()) out.push(`${path}.enum[${i}]: ${JSON.stringify(v)}`); });
  }
  if (Array.isArray(schema.required)) {
    for (const r of schema.required) if (!schema.properties || !(r in schema.properties)) out.push(`${path}: requires undeclared "${r}"`);
  }
  for (const [k, v] of Object.entries(schema.properties || {})) out.push(...problems(v, `${path}.${k}`));
  if (schema.items) out.push(...problems(schema.items, `${path}[]`));
  if (schema.parameters) out.push(...problems(schema.parameters, `${path}(params)`));
  return out;
}

const schemas = {
  "reader.guard": guard.SCHEMA,
  "reader.memory": memory.SCHEMA,
  "reader.suggest": suggest.SCHEMA,
  "reader.sentinel": sentinel.JUDGE_SCHEMA,
  "studio.converse": converse.schema({ paperKeys: ["harvested:a", "uploaded:b"], audiences: ["ages_8_11", "adults"], voices: ["author", "about"] }),
  "studio.converse (no papers)": converse.schema({ paperKeys: [], audiences: ["adults"], voices: ["author"] }),
  "studio.ideas": ideas.SCHEMA,
  "drafting.voice": voice.schemaFor([{ index: 1 }, { index: 2 }]),
  "drafting.band": band.SCHEMA,
  "drafting.review": reviewer.schemaFor(reviewer.plan({ title: "T", blocks: [{ type: "subheading", text: "h" }, { type: "paragraph", text: "p" }], passages: [] })),
  "drafting.review (re-read)": reviewer.schemaFor(reviewer.plan({ title: null, blocks: [{ type: "subheading", text: "h" }], passages: [], only: ["H1"] })),
  "drafting.review (no headings)": reviewer.schemaFor(reviewer.plan({ title: null, blocks: [{ type: "paragraph", text: "p" }], passages: [] })),
  "drafting.caveats": caveats.schemaFor([{ id: "p1" }]),
  "judge.fidelity": fidelity.JUDGE_SCHEMA,
  "judge.reach": reach.JUDGE_SCHEMA,
  "judge.context": context.JUDGE_SCHEMA,
};

test("no agent schema carries a value the model API refuses", () => {
  for (const [name, schema] of Object.entries(schemas)) {
    assert.deepEqual(problems(schema), [], name);
  }
  for (const fn of readingAgent.toolDeclarations({ maxFollowUps: 3 })) assert.deepEqual(problems(fn.parameters), [], `reader tool ${fn.name}`);
  for (const fn of storyAgent.TOOL_DECLARATIONS) assert.deepEqual(problems(fn.parameters), [], `edit tool ${fn.name}`);
});

test("the checker itself finds an empty enum value", () => {
  assert.deepEqual(problems({ type: "OBJECT", properties: { a: { type: "STRING", enum: ["", "x"] } }, required: ["a", "b"] }).sort(), ['$.a.enum[0]: ""', '$: requires undeclared "b"'].sort());
});

test("a request the model refuses as malformed does not open the breaker for every purpose", async () => {
  resetBreakers();
  const models = {
    routes: { "a": { primary: "flash", fallback: [] }, "b": { primary: "flash", fallback: [] } },
    breaker: { failureThreshold: 1, cooldownSeconds: 60 },
  };
  const bad = Object.assign(new Error("Vertex generateContent error 400: enum[0] cannot be empty"), { status: 400 });
  const r = createRouter({ models, call: async (req) => { if (req.prompt === "bad") throw bad; return { text: "ok" }; } });
  await assert.rejects(r.generate("a", { prompt: "bad" }), /400/);
  assert.equal((await r.generate("b", { prompt: "fine" })).model, "flash", "the other purpose still reaches the model");
  assert.equal(isRequestError({ status: 429 }), false, "a rate limit is the model's state, not the request's");
  assert.equal(isRequestError({ status: 503 }), false);
  assert.equal(isRequestError({ status: 404 }), true);
});
