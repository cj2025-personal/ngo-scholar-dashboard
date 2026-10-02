/* A story's excerpt ends at a word, with an ellipsis, never mid-word. */
process.env.MONGODB_URI ||= "mongodb://localhost:27017";
process.env.MONGODB_DB ||= "excerpt-test";

const test = require("node:test");
const assert = require("node:assert/strict");

const { buildExcerpt } = require("../src/services/editorial.service");

const BODY = "Small antenna arrays can steer a null toward interference, and the field trials showed how far that holds when the array is crowded. The method trades a little gain for a great deal of quiet. More follows.";

test("the opening of a long body ends at a word, with an ellipsis", () => {
  const excerpt = buildExcerpt("", BODY);
  assert.ok(excerpt.length <= 181, excerpt);
  assert.ok(excerpt.endsWith("…"), excerpt);
  const words = excerpt.slice(0, -1).split(" ");
  assert.ok(BODY.split(" ").includes(words[words.length - 1].replace(/[,.]$/, "")) || BODY.includes(`${words[words.length - 1]} `), `ends mid-word: ${excerpt}`);
});

test("an excerpt stored by the old rule, cut mid-word, is ended properly on read", () => {
  const stored = BODY.slice(0, 180);
  assert.match(stored, /a great dea$/);
  const excerpt = buildExcerpt(stored, BODY);
  assert.ok(excerpt.endsWith("great…"), excerpt);
});

test("an author's own excerpt and a short body are kept as written", () => {
  assert.equal(buildExcerpt("My own words about this story.", BODY), "My own words about this story.");
  assert.equal(buildExcerpt("", "A short body."), "A short body.");
  assert.equal(buildExcerpt("", ""), "");
});
