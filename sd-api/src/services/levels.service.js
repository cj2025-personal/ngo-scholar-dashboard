/**
 * Reading levels as a service: write them, judge them, keep them on the
 * story, and let the scholar approve them for readers.
 *
 * A level is content, so writing or approving one is a version of the story
 * like any other write: guarded by the version the caller read, recorded in
 * the history with who did it. A level the scholar has not approved, or one
 * the article has moved on from, is never shown to the public.
 */

const { ApiError } = require("../lib/api-error");
const levels = require("../lib/levels");
const fidelity = require("../lib/fidelity");
const composer = require("../lib/draftComposer");
const { assessDraftReadability } = require("../lib/draftReadability");
const { AUDIENCES, normaliseAudience } = require("../lib/audiences");
const storyVersion = require("../lib/storyVersion");
const vertex = require("../lib/vertex");
const { traced } = require("../lib/tracing");
const { serializeMongoValue } = require("../lib/serialize");
const { passagesFor } = require("./passages.service");

/** One retry per paragraph for voice; then the level is refused. */
const VOICE_RETRIES = 1;

/**
 * Write the story for other readers.
 *
 * @param {import("mongodb").Db} db
 * @param {object} storyDoc     the raw story document
 * @param {object} p
 * @param {string[]|null} [p.audiences]   bands to write; default every band but the story's own
 * @param {string} p.actor
 * @param {number|null} [p.baseVersion]
 * @param {Function} [p.generate]         a model call, for the worker to pass its traced one
 * @param {Function} [p.onProgress]
 */
async function generateLevelsForDoc(db, storyDoc, { audiences = null, actor, baseVersion = null, generate = null, onProgress = async () => {} }) {
  const editorial = require("./editorial.service");
  const gen = generate || traced("levels.generateContent", (req) => vertex.generateContent(req), { metadata: { storyId: String(storyDoc._id) } });

  const [author, provenance, passages] = await Promise.all([
    editorial.resolveStoryAuthor(db, storyDoc.profile_id),
    editorial.resolveStoryProvenance(db, storyDoc.provenance),
    passagesFor(db, storyDoc),
  ]);
  if (!passages.length) throw new ApiError(409, "This story has no source paper on record, so it cannot be written for other readers.");

  const mapped = editorial.mapStoryDocument(storyDoc, author, provenance);
  const sourceAudience = normaliseAudience(storyDoc.provenance?.audience);
  const targets = levels.targetsFor(sourceAudience, audiences);
  if (!targets.length) throw new ApiError(400, "No reading level to write: every band asked for is the one the story is already written for.");
  const toRewrite = levels.levelPlan(mapped.bodyBlocks).filter((p) => p.rewrite);
  if (!toRewrite.length) throw new ApiError(409, "Nothing in this story is still drawn from the paper, so there is nothing to rewrite for another reader.");

  const system = composer.buildSystemInstruction();
  const made = {};
  const calls = [];

  for (const audience of targets) {
    await onProgress({ step: "draft_levels", message: `Writing it for ${AUDIENCES[audience].label.toLowerCase()}…`, audience });
    const rewrites = new Map();

    for (const { index } of toRewrite) {
      const block = mapped.bodyBlocks[index];
      let parsed = null;
      for (let attempt = 0; attempt <= VOICE_RETRIES; attempt += 1) {
        const prompt = levels.buildLevelPrompt({ scholar: { name: author?.name }, title: mapped.title, block, passages, audience, sourceAudience, strictVoice: attempt > 0 });
        const r = await gen({ prompt, systemInstruction: system, responseSchema: levels.LEVEL_SCHEMA, temperature: attempt ? 0.2 : 0.4, maxOutputTokens: 1024 });
        calls.push({ step: "draft_levels", audience, block: index + 1, usage: r.usage || null, model: r.modelVersion || null });
        parsed = levels.parseLevelResponse(r.text);
        if (parsed.violations.length === 0) break;
      }
      if (parsed.violations.length) throw new ApiError(502, `The level writer kept writing in the first person for block ${index + 1}; nothing was saved.`);
      rewrites.set(index, { text: parsed.text });
    }

    /* Judge every rewritten paragraph of this level in one call, claim by claim. */
    const draft = levels.assembleLevel({ blocks: mapped.bodyBlocks, rewrites });
    const judgeIndexes = [...rewrites.keys()];
    const judged = await fidelity.judgeSection({ blocks: judgeIndexes.map((i) => draft[i]), passages, generate: gen });
    if (judged.call) calls.push({ ...judged.call, audience });
    judgeIndexes.forEach((i, k) => { draft[i] = judged.blocks[k]; });
    const verdicts = judgeIndexes.map((i) => draft[i].fidelity?.verdict || null);

    const prose = draft.filter((b) => b.type === "paragraph").map((b) => levels.plain(b.html)).join("\n\n");
    const readability = assessDraftReadability({ text: prose, audience });

    /* Stored: rewritten paragraphs normalised like any saved block; carried
       blocks copied from the story as stored, so pictures keep their shape. */
    const blocks = draft.map((b, i) => (rewrites.has(i) ? editorial.normalizeRawBodyBlocks([b])[0] : storyDoc.body_blocks[i]));

    made[audience] = {
      audience,
      blocks,
      readability: { verdict: readability.verdict, fkGrade: readability.fkGrade, targetGrade: readability.targetGrade, drift: readability.drift },
      fidelity: {
        paragraphs: verdicts.length,
        supported: verdicts.filter((v) => v === "supported").length,
        partial: verdicts.filter((v) => v === "partial").length,
        unsupported: verdicts.filter((v) => v === "unsupported").length,
      },
      generated_at: new Date(),
      model: calls[calls.length - 1]?.model || null,
      levels_version: levels.LEVELS_VERSION,
      source_version: storyVersion.versionOf(storyDoc),
      source_hashes: levels.sourceHashes(mapped.bodyBlocks),
      approved: false,
      approved_at: null,
      approved_by: null,
    };
  }

  const nextLevels = { ...(storyDoc.levels || {}), ...made };
  const { version } = await editorial.commitStoryWrite(db, {
    story: storyDoc,
    set: { levels: nextLevels, updated_by: actor },
    source: storyVersion.SOURCE.LEVELS,
    actor,
    note: `Written for ${targets.map((a) => AUDIENCES[a].label.toLowerCase()).join(", ")}`,
    baseVersion,
  });
  await editorial.refreshEvidenceAfterWrite(db, storyDoc._id);
  return { written: targets, version, calls };
}

async function generateLevels({ storyId, scholarId, profileId, user, audiences = null, baseVersion = null }) {
  const editorial = require("./editorial.service");
  const { getDb } = require("../db/mongo");
  const db = await getDb();
  const storyDoc = await editorial.findOwnedStory({ storyId, scholarId, profileId });
  const actor = user?.login_email || scholarId;
  const result = await generateLevelsForDoc(db, storyDoc, { audiences, actor, baseVersion: storyVersion.parseBaseVersion(baseVersion) });
  const story = await editorial.getEditorialStory({ storyId, scholarId, profileId });
  return serializeMongoValue({ ...story, written: result.written, calls: result.calls.length });
}

/** The scholar approves levels for readers. A stale level cannot be approved: rewrite it first. */
async function approveLevels({ storyId, scholarId, profileId, user, audiences = null, baseVersion = null }) {
  const editorial = require("./editorial.service");
  const { getDb } = require("../db/mongo");
  const db = await getDb();
  const storyDoc = await editorial.findOwnedStory({ storyId, scholarId, profileId });
  const have = storyDoc.levels || {};
  const wanted = (Array.isArray(audiences) && audiences.length ? audiences.map((a) => normaliseAudience(a)) : Object.keys(have)).filter((a) => have[a]);
  if (!wanted.length) throw new ApiError(400, "There are no reading levels to approve yet. Write them first.");

  const mapped = editorial.mapStoryDocument(storyDoc, null, null);
  const now = new Date();
  const actor = user?.login_email || scholarId;
  const next = { ...have };
  for (const a of wanted) {
    const st = levels.staleness(have[a], mapped.bodyBlocks);
    if (st.stale) throw new ApiError(409, `The ${AUDIENCES[a].label.toLowerCase()} level is out of date: ${st.reason}. Write it again before approving it.`);
    next[a] = { ...have[a], approved: true, approved_at: now, approved_by: actor };
  }
  await editorial.commitStoryWrite(db, {
    story: storyDoc,
    set: { levels: next, updated_by: actor },
    source: storyVersion.SOURCE.SCHOLAR,
    actor,
    note: `Approved the ${wanted.map((a) => AUDIENCES[a].label.toLowerCase()).join(", ")} level${wanted.length === 1 ? "" : "s"}`,
    baseVersion: storyVersion.parseBaseVersion(baseVersion),
  });
  await editorial.refreshEvidenceAfterWrite(db, storyDoc._id);
  const story = await editorial.getEditorialStory({ storyId, scholarId, profileId });
  return serializeMongoValue({ ...story, approved: wanted });
}

module.exports = { generateLevelsForDoc, generateLevels, approveLevels };
