/**
 * The voice and reading-level judges, against scripted rulings.
 *
 * What must hold: a ruling is carried as the model gave it, with every
 * quoted sentence checked against the text it claims to quote; a voice
 * ruling that leaves a paragraph out, or cannot be read, is asked for once
 * more and then reported unchecked — never as a pass; in the "about" voice
 * naming the scholar is expected and never flagged; paragraphs map back to
 * the blocks they came from, past quotes and headings; the writer's note
 * carries the judge's sentences and reasons; the band ruling decides, and
 * its note adds no fact.
 *
 * Whether the real model rules well is the eval's to say:
 * `node scripts/evalVoice.js`.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const voice = require("../src/lib/agents/voiceJudge");
const band = require("../src/lib/agents/bandJudge");

const row = (index, ...findings) => ({ id: `P${index}`, findings });
const finding = (kind, sentence, reason = "") => ({ kind, sentence, reason });
const scripted = (...answers) => {
  const prompts = [];
  const generate = async ({ prompt }) => {
    prompts.push(prompt);
    const a = answers[Math.min(prompts.length - 1, answers.length - 1)];
    return { text: typeof a === "string" ? a : JSON.stringify(a), usage: { input: 1 }, model: "judge-m" };
  };
  return { generate, prompts };
};

test("the voice prompt says whose account it is and lists every paragraph by index", () => {
  const p = voice.buildPrompt({ paragraphs: [{ index: 1, text: "A." }, { index: 2, text: "B." }], voice: "author", scholarName: "Inder Gupta" });
  assert.match(p, /^THE VOICE: author — the scholar's own account/m);
  assert.match(p, /^THE SCHOLAR: Inder Gupta$/m);
  assert.ok(p.endsWith(`${voice.MARKER}\n[P1] A.\n[P2] B.`));
  assert.deepEqual(voice.schemaFor([{ index: 1 }, { index: 2 }]).properties.paragraphs.items.properties.id.enum, ["P1", "P2"], "the model may name only the paragraphs it was shown");
  assert.match(voice.SYSTEM, /inclusive "we"/);
});

test("quoted sentences are kept only if the paragraph says them; about-voice never flags a name", () => {
  const paragraphs = [{ index: 1, text: "Imagine a noisy room. We measured the gain at eleven decibels." }, { index: 2, text: "Gupta built the array." }];
  const v = voice.parseVerdicts(JSON.stringify({ paragraphs: [
    row(1, finding("speaks_as_author", "We measured the gain at eleven decibels.", "The researchers speak."), finding("speaks_as_author", "We invented this sentence.", "Also them.")),
    row(2, finding("names_author", "Gupta built the array."), finding("pronoun_for_author", "Gupta built the array.")),
  ] }), paragraphs, "about");
  assert.deepEqual(v.get(1).sentences, ["We measured the gain at eleven decibels."], "an invented quote is not shown to the scholar");
  assert.equal(v.get(1).speaksAsAuthor, true, "the judge decided; the quote check does not overrule it");
  assert.equal(v.get(1).reason, "The researchers speak. Also them.");
  const odd = voice.parseVerdicts(JSON.stringify({ paragraphs: [row(1, finding("shouting", "Imagine a noisy room.")), row(2)] }), paragraphs, "author");
  assert.equal(odd.get(1).speaksAsAuthor || odd.get(1).namesAuthor, false, "a kind the judge was not offered counts for nothing");
  assert.equal(v.get(2).namesAuthor, false, "naming the scholar is expected in an article about them");
  assert.equal(v.get(2).pronounForAuthor, false);
  assert.equal(voice.parseVerdicts(JSON.stringify({ paragraphs: [row(1)] }), paragraphs, "about"), null, "a ruling that leaves a paragraph out is not a ruling");
  assert.equal(voice.parseVerdicts("not json", paragraphs, "author"), null);
});

test("an unreadable voice ruling is asked for once more, then reported unchecked", async () => {
  const once = scripted("nonsense", { paragraphs: [row(1)] });
  const r = await voice.judgeVoice({ paragraphs: [{ index: 1, text: "The array works." }], voice: "author", generate: once.generate });
  assert.equal(once.prompts.length, 2);
  assert.match(once.prompts[1], /YOUR LAST ANSWER COULD NOT BE READ/);
  assert.equal(r.unchecked, false);
  assert.equal(r.calls.length, 2);
  assert.equal(r.calls[0].promptVersion, voice.VOICE_JUDGE_VERSION);

  const never = scripted("nonsense");
  const u = await voice.judgeVoice({ paragraphs: [{ index: 1, text: "The array works." }], voice: "author", generate: never.generate });
  assert.equal(u.unchecked, true);
  assert.equal(u.verdicts, null);
  assert.equal(never.prompts.length, 2);
  assert.deepEqual(await voice.judgeVoice({ paragraphs: [], voice: "author", generate: never.generate }), { verdicts: new Map(), unchecked: false, calls: [] });
});

test("paragraphs map back to their blocks past quotes and headings, and the note carries what the judge found", async () => {
  const blocks = [
    { type: "subheading", html: "How it works" },
    { type: "paragraph", html: "The array steers a null." },
    { type: "quote", html: "We found it." },
    { type: "paragraph", html: "We measured the gain &amp; the noise." },
    { type: "paragraph", html: "He tested it twice." },
  ];
  const { generate, prompts } = scripted({ paragraphs: [
    row(1),
    row(2, finding("speaks_as_author", "We measured the gain & the noise.", "It speaks as the researchers.")),
    row(3, finding("pronoun_for_author", "He tested it twice.", "He may be the author.")),
  ] });
  const plain = (h) => h.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&");
  const r = await voice.judgeBlocks({ blocks, voice: "author", scholarName: "Test Scholar", generate, plain });
  assert.ok(!/We found it/.test(prompts[0]), "a quote is the paper's words and is not judged");
  assert.deepEqual(r.speaking, [3]);
  assert.deepEqual(r.pronouns, [4]);
  assert.deepEqual(r.naming, []);
  assert.match(r.note, /These sentences: “We measured the gain & the noise\.”/);
  assert.match(r.note, /Why: It speaks as the researchers\./);
});

test("the band prompt gives the reader's brief and the measurement as evidence", () => {
  const p = band.buildPrompt({ text: "Prose.", audience: "ages_12_14", measured: { fkGrade: 11.2, words: 340, reliable: true } });
  assert.match(p, /^THE READER: readers aged 12 to 14\. What they need: students aged 12 to 14/m);
  assert.match(p, /Flesch-Kincaid grade 11\.2 over 340 words \(the usual grade for this reader is about 7\)/);
  assert.match(band.buildPrompt({ text: "x", audience: "adults", measured: { fkGrade: null } }), /MEASURED: nothing measurable/);
  assert.match(band.SYSTEM, /weigh it, do not obey it/);
  const again = band.buildPrompt({ text: "Prose.", audience: "adults", previous: { verdict: "too_hard", reason: "LMS is never explained.", guidance: "Explain LMS where it first appears." } });
  assert.match(again, /THIS IS A REWRITE\. YOUR PREVIOUS RULING: too_hard — LMS is never explained\./);
  assert.match(again, /WHAT YOU ASKED FOR: Explain LMS where it first appears\./);
  assert.ok(!/REWRITE/.test(band.buildPrompt({ text: "x", audience: "adults", previous: { verdict: "fits", reason: "ok" } })), "a ruling that passed asks for nothing");
  assert.match(band.SYSTEM, /Do not raise a new standard/);
});

test("a band ruling is carried as given, its quotes checked against the prose, and an unreadable one is unchecked", async () => {
  const text = "Convergence took between forty and three hundred updates. The array works.";
  const r = band.parseRuling(JSON.stringify({ verdict: "too_hard", reason: "Convergence is not explained.", guidance: "Explain convergence where it first appears.", sentences: ["Convergence took between forty and three hundred updates.", "Made up."] }), text);
  assert.deepEqual(r.sentences, ["Convergence took between forty and three hundred updates."]);
  assert.equal(band.parseRuling(JSON.stringify({ verdict: "fits", reason: "ok", guidance: "ignored", sentences: [] }), text).guidance, "");
  assert.equal(band.parseRuling(JSON.stringify({ verdict: "maybe" }), text), null);

  const never = scripted("nope");
  const u = await band.judgeBand({ text, audience: "adults", generate: never.generate });
  assert.equal(u.verdict, "unchecked");
  assert.equal(never.prompts.length, 2);
  const empty = await band.judgeBand({ text: "  ", audience: "adults", generate: never.generate });
  assert.equal(empty.verdict, "unchecked");
  assert.equal(empty.calls.length, 0, "nothing to read is not a model call");
});

test("the band note is the editor's guidance and sentences, and asks for no new fact", () => {
  const ruling = { verdict: "too_simple", reason: "It talks down to an adult.", guidance: "Join the short sentences that belong together.", sentences: ["The array is good."] };
  const note = band.bandNote(ruling, "adults");
  assert.match(note, /^An editor read your previous draft as too simple for adult readers: It talks down to an adult\./);
  assert.match(note, /Join the short sentences/);
  assert.match(note, /“The array is good\.”/);
  assert.match(note, /Keep every fact and add none/);
  assert.equal(band.bandNote({ verdict: "fits" }, "adults"), null);
  assert.equal(band.bandNote({ verdict: "unchecked" }, "adults"), null);
});
