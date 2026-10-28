/**
 * A runtime policy change, and the evals in front of it.
 *
 * What must hold: a key the baseline does not have is named, so a misspelt
 * limit is refused rather than merged in silently; a new route or model
 * limit is allowed; each policy maps to the evals that read it, and a change
 * to the floors runs only the evals whose floors moved; a proposal from
 * `--policy` lays over the baseline exactly as production reads an override.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { EVALS, unknownPaths, evalsFor, readProposal, policyFor } = require("../src/lib/policyChange");
const { defaultsFor } = require("../src/lib/policyDefaults");

test("a key the baseline does not have is named, nested or not", () => {
  assert.deepEqual(unknownPaths("studio", { edit: { maxSteps: 8 } }), []);
  assert.deepEqual(unknownPaths("studio", { edit: { maxStep: 8 } }), ["edit.maxStep"]);
  assert.deepEqual(unknownPaths("studio", { edits: { maxSteps: 8 }, edit: { turnDeadlineSeconds: 60, deadline: 1 } }), ["edits", "edit.deadline"]);
  assert.deepEqual(unknownPaths("studio", { edit: 12 }), ["edit (an object in the baseline, number here)"]);
});

test("a new route or model limit is allowed; a new key inside a route is not", () => {
  assert.deepEqual(unknownPaths("models", { routes: { "studio.summarise": { primary: "gemini-2.5-flash", fallback: [] } } }), []);
  assert.deepEqual(unknownPaths("models", { modelLimits: { "gemini-3-pro": { minThinkingBudget: 256 } } }), []);
  assert.deepEqual(unknownPaths("models", { routes: { "studio.edit": { thinkingBudget: 512, thinking: 512 } } }), ["routes.studio.edit.thinking"]);
});

test("each policy maps to the evals that read it; a floor change runs only its own eval", () => {
  for (const spec of Object.values(EVALS)) assert.ok(fs.existsSync(path.join(__dirname, "..", spec.script)), spec.script);
  assert.deepEqual(evalsFor("models"), Object.keys(EVALS), "every eval calls a model");
  assert.deepEqual(evalsFor("studio"), ["converse", "edit"]);
  assert.deepEqual(evalsFor("drafting"), ["drafts", "review", "guard"]);
  assert.deepEqual(evalsFor("reader"), ["reader"]);
  assert.deepEqual(evalsFor("evals", { edit: { supported: 0.9 } }), ["edit"]);
  assert.deepEqual(evalsFor("evals", {}), []);
  assert.deepEqual(evalsFor("policy"), []);
  assert.deepEqual(evalsFor("audit"), []);
});

test("a proposal lays over the baseline as production reads an override; a bad one is refused before any model runs", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "policy-test-"));
  const file = path.join(dir, "p.json");
  fs.writeFileSync(file, JSON.stringify({ studio: { edit: { maxSteps: 3 } }, models: { routes: { "studio.edit": { thinkingBudget: 512 } } } }));
  const proposal = readProposal(["node", "x", "--policy", file]);
  const studio = policyFor("studio", proposal);
  assert.equal(studio.edit.maxSteps, 3);
  assert.equal(studio.edit.maxToolCalls, defaultsFor("studio").edit.maxToolCalls, "the rest of the policy is the baseline");
  const route = policyFor("models", proposal).routes["studio.edit"];
  assert.equal(route.thinkingBudget, 512);
  assert.equal(route.temperature, defaultsFor("models").routes["studio.edit"].temperature);
  assert.deepEqual(policyFor("evals", proposal), defaultsFor("evals"), "a policy the proposal leaves alone is the baseline");
  assert.deepEqual(readProposal(["node", "x"]), {}, "no flag, no proposal");

  fs.writeFileSync(file, JSON.stringify({ studio: { edit: { maxStep: 3 } } }));
  assert.throws(() => readProposal(["node", "x", "--policy", file]), /edit\.maxStep/);
  fs.writeFileSync(file, JSON.stringify({ nonsense: {} }));
  assert.throws(() => readProposal(["node", "x", "--policy", file]), /Unknown policy/);
});
