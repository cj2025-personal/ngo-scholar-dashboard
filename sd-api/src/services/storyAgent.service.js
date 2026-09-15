/**
 * The story agent, wired to stories: ask, propose, accept or reject.
 *
 * ── The contract with the scholar ──────────────────────────────────────────
 * An instruction produces a PROPOSAL, stored as a turn: what was asked, what
 * the agent did (tool by tool), the resulting blocks, and the checks on what
 * it wrote — the fact-checker's verdict on every paragraph it changed, the
 * reading level, and anything it refused. The stored story does not change.
 * Accepting applies the proposal through the same path a hand edit takes;
 * rejecting discards it and deletes any illustration it generated. A
 * proposal made against a story that has since changed is refused rather
 * than applied to text the scholar no longer has.
 *
 * ── What the agent is given ─────────────────────────────────────────────────
 * The story's blocks with their citations, the passages of the paper it was
 * drawn from (the same numbering the chips use), and the last few turns so
 * "no, shorter" means something. A story with no source paper can still be
 * edited, but the agent can then only write the scholar's own view.
 */

const { ObjectId } = require("mongodb");

const { COLLECTIONS, getCollections } = require("../db/mongo");
const { ApiError } = require("../lib/api-error");
const storyVersion = require("../lib/storyVersion");
const { serializeMongoValue } = require("../lib/serialize");
const composer = require("../lib/draftComposer");
const plan = require("../lib/draftPlan");
const fidelity = require("../lib/fidelity");
const reach = require("../lib/reach");
const checksLib = require("../lib/checks");
const { assessDraftReadability, VERDICT } = require("../lib/draftReadability");
const agent = require("../lib/storyAgent");
const imageGen = require("../lib/imageGen");
const vertex = require("../lib/vertex");
const { traced } = require("../lib/tracing");
const editorial = require("./editorial.service");

const MAX_HISTORY_TURNS = 6;
const TURN_STATUS = { PROPOSED: "proposed", ACCEPTED: "accepted", REJECTED: "rejected" };

const { passagesFor } = require("./passages.service");

function serializeBlock(b) {
  if (b.type === "image") {
    return { type: "image", imageId: b.imageId || null, url: b.url || null, caption: b.caption || "", alt: b.alt || "", width: b.width || "body", generated: Boolean(b.generated), changed: Boolean(b.changed) };
  }
  return {
    type: b.type, html: b.html,
    sourceRefs: Array.isArray(b.sourceRefs) ? b.sourceRefs : [],
    draftedText: b.draftedText || "",
    fidelity: b.fidelity || null,
    ownView: Boolean(b.ownView),
    ...(b.extension ? { extension: true, reach: b.reach || null } : {}),
    changed: Boolean(b.changed),
  };
}

function viewTurn(doc, { withProposal = true } = {}) {
  return serializeMongoValue({
    id: doc._id,
    storyId: doc.story_id,
    instruction: doc.instruction,
    summary: doc.summary,
    status: doc.status,
    changes: doc.changes || [],
    calls: (doc.calls || []).map((c) => ({ name: c.name, result: c.result })),
    checks: doc.checks || null,
    warnings: doc.warnings || [],
    createdAt: doc.created_at,
    resolvedAt: doc.resolved_at || null,
    ...(withProposal && doc.status === TURN_STATUS.PROPOSED ? { proposal: doc.proposal } : {}),
  });
}

async function askStoryAgent({ storyId, scholarId, profileId, user, instruction }) {
  if (!vertex.isConfigured()) throw new ApiError(503, `The story agent is not available on this deployment. ${vertex.describeMissingConfig()}`);

  const { db } = await getCollections();
  const storyDoc = await editorial.findOwnedStory({ storyId, scholarId, profileId });
  const mapped = editorial.mapStoryDocument(storyDoc, null, null);
  const passages = await passagesFor(db, storyDoc);
  const turns = db.collection(COLLECTIONS.storyTurns);

  const prior = await turns.find({ story_id: storyDoc._id }).sort({ created_at: -1 }).limit(MAX_HISTORY_TURNS).toArray();
  const history = prior.reverse().flatMap((t) => [{ role: "user", text: t.instruction }, { role: "model", text: t.summary || "" }]);

  const byId = new Map(passages.map((p) => [p.id, p]));
  const isVerbatim = (text, id) => byId.has(id) && composer.isVerbatim(text, byId.get(id).text);
  const generate = traced("agent.generateContent", (req) => vertex.generateContent(req), { metadata: { storyId: String(storyDoc._id), profileId } });
  const audience = storyDoc.provenance?.audience || "general";
  const startedAt = new Date();

  const stateBefore = agent.stateFromStory(mapped);
  /* The agent edits in whatever voice the article was drafted in, and needs
     the scholar's name to know which name it must not write. */
  const voice = composer.normaliseVoice(storyDoc.provenance?.voice || composer.VOICE.ABOUT);
  const author = await editorial.resolveStoryAuthor(db, storyDoc.profile_id);
  const result = await agent.runStoryAgent({
    state: stateBefore, passages, instruction, history, audience, voice, scholarName: author?.name || null, generate,
    imagesAllowed: imageGen.isConfigured(), isVerbatim,
  });

  /* Check what the agent wrote, and only that: paragraphs drawn from the
     paper for fidelity, paragraphs that go beyond it for reach. Each judge
     skips the other's kind. */
  const changed = result.state.blocks.map((b, i) => ({ b, i })).filter(({ b }) => b.changed && b.type === "paragraph" && !b.ownView && b.sourceRefs?.length);
  let judgeCall = null;
  let reachCall = null;
  if (changed.length && passages.length) {
    const judged = await fidelity.judgeSection({ blocks: changed.map(({ b }) => b), passages, generate });
    const reached = await reach.judgeSection({ blocks: judged.blocks, passages, audience, generate });
    reached.blocks.forEach((jb, k) => { result.state.blocks[changed[k].i] = { ...result.state.blocks[changed[k].i], fidelity: jb.fidelity || null, reach: jb.reach || null }; });
    judgeCall = judged.call;
    reachCall = reached.call;
  }

  /* Illustrations: generate, upload as inline images of this story, label.
     Until the proposal is accepted the image belongs to no story, so it is
     served through the proposal's own preview route. */
  const turnId = new ObjectId();
  const newImages = [];
  const assetDocuments = [];
  const imageFailures = [];
  const failedImageIndexes = new Set();
  let imageIndex = 0;
  for (let i = 0; i < result.state.blocks.length; i += 1) {
    const b = result.state.blocks[i];
    if (b.type !== "image" || !b.pending) continue;
    imageIndex += 1;
    /* An illustration that cannot be made must not cost the scholar the rest
       of the turn: the text edits the agent made alongside it are good work.
       The picture is dropped from the proposal and said out loud instead. */
    let made;
    try {
      made = await imageGen.generateImage({ description: b.pending.description });
    } catch (error) {
      console.warn("[story-agent] illustration could not be generated:", error.message);
      imageFailures.push(b.pending.description);
      failedImageIndexes.add(i);
      continue;
    }
    const uploaded = await editorial.uploadBufferToCloudStorage({
      scholarId, profileId, storyId: storyDoc._id, storySlug: storyDoc.slug, kind: "inline",
      uploadKey: `agent-${Date.now()}-${imageIndex}`,
      file: { buffer: made.buffer, mimetype: made.mimeType, originalname: `illustration-${imageIndex}.${made.mimeType === "image/jpeg" ? "jpg" : "png"}`, size: made.buffer.length },
      user,
    });
    newImages.push(uploaded.storyImage);
    assetDocuments.push(uploaded.assetDocument);
    const caption = b.pending.caption && /^illustration/i.test(b.pending.caption) ? b.pending.caption : `Illustration: ${b.pending.caption || b.pending.description}`;
    result.state.blocks[i] = {
      key: b.key, type: "image", imageId: String(uploaded.storyImage.file_id),
      url: `/api/editorial-stories/${storyDoc._id}/agent/turns/${turnId}/images/${uploaded.storyImage.file_id}`,
      caption, alt: b.pending.alt || b.pending.description, width: "body", generated: true, changed: true, model: made.model, description: b.pending.description,
    };
  }
  if (failedImageIndexes.size) {
    /* The picture is gone from the proposal, so it must be gone from the diff
       the scholar reads too, and the blocks after it renumbered. */
    result.state.blocks = result.state.blocks.filter((_, i) => !failedImageIndexes.has(i));
    result.changes = agent.diffStates(stateBefore, result.state);
  }
  if (assetDocuments.length) await editorial.insertAssetDocuments(db.collection(COLLECTIONS.editorialImageAssets), assetDocuments);

  /* Reading level over the whole draft as it would be. */
  const prose = result.state.blocks.filter((b) => b.type === "paragraph").map((b) => agent.plain(b.html)).join("\n\n");
  const readability = prose ? assessDraftReadability({ text: prose, audience }) : null;

  const paperChanged = changed.filter(({ i }) => !result.state.blocks[i].extension);
  const reachChanged = changed.filter(({ i }) => result.state.blocks[i].extension);
  const verdicts = paperChanged.map(({ i }) => result.state.blocks[i].fidelity?.verdict || null);
  const reachVerdicts = reachChanged.map(({ i }) => result.state.blocks[i].reach?.verdict || null);
  const checks = {
    paragraphsChanged: paperChanged.length,
    supported: verdicts.filter((v) => v === "supported").length,
    partial: verdicts.filter((v) => v === "partial").length,
    unsupported: verdicts.filter((v) => v === "unsupported").length,
    /* Paragraphs that go beyond the paper, judged for reach rather than fidelity. */
    extensionsChanged: reachChanged.length,
    follows: reachVerdicts.filter((v) => v === "follows").length,
    reachPartial: reachVerdicts.filter((v) => v === "partial").length,
    overreach: reachVerdicts.filter((v) => v === "overreach").length,
    worldClaims: checksLib.worldClaims({ blocks: reachChanged.map(({ i }) => result.state.blocks[i]) }),
    readability: readability ? { verdict: readability.verdict, fkGrade: readability.fkGrade, targetGrade: readability.targetGrade } : null,
    imagesGenerated: newImages.length,
    imagesFailed: imageFailures.length,
    refused: result.calls.filter((c) => String(c.result).startsWith("refused")).length,
    /* Every number the agent wrote must be in a passage it cited. A rule,
       not a model, because a fluent wrong number is the one that gets past. */
    numbers: checksLib.numericConsistency({ blocks: changed.map(({ b }) => b), passages }),
    /* Whether the article, as it would be, cites any of the paper's own caveats. */
    limitationsCited: checksLib.limitationsCoverage({ blocks: result.state.blocks, passages }).ok,
  };
  const warnings = [];
  if (checks.unsupported) warnings.push(`${checks.unsupported} changed paragraph${checks.unsupported === 1 ? " is" : "s are"} not supported by the paper.`);
  if (checks.partial) warnings.push(`${checks.partial} changed paragraph${checks.partial === 1 ? " is" : "s are"} only partly supported; the claims are marked.`);
  if (checks.overreach) warnings.push(`${checks.overreach} changed paragraph${checks.overreach === 1 ? " goes" : "s go"} beyond what the paper supports.`);
  if (checks.reachPartial) warnings.push(`${checks.reachPartial} changed paragraph${checks.reachPartial === 1 ? " draws" : "s draw"} an implication the paper only partly supports; the claims that go too far are marked.`);
  if (checks.worldClaims && checks.worldClaims.ok === false) {
    warnings.push(`${checks.worldClaims.hits.length === 1 ? "A sentence" : `${checks.worldClaims.hits.length} sentences`} in this change read${checks.worldClaims.hits.length === 1 ? "s" : ""} as a claim about the world rather than an implication: ${checks.worldClaims.hits.map((h) => `"${h.sentence}"`).join("; ")}.`);
  }
  if (checks.numbers && !checks.numbers.ok) {
    warnings.push(
      `${checks.numbers.misses.length === 1 ? "A number" : `${checks.numbers.misses.length} numbers`} in this change ${checks.numbers.misses.length === 1 ? "is" : "are"} not in the passages cited: ` +
      `${checks.numbers.misses.map((m) => `${m.number} (block ${m.block})`).join(", ")}. Check ${checks.numbers.misses.length === 1 ? "it" : "them"} against the paper.`,
    );
  }
  if (imageFailures.length) {
    warnings.push(
      `${imageFailures.length === 1 ? "An illustration" : `${imageFailures.length} illustrations`} could not be generated, so ` +
      `${imageFailures.length === 1 ? "it was" : "they were"} left out. Everything else in this change stands.`,
    );
  }
  if (readability && readability.verdict !== VERDICT.PASS && readability.reason) warnings.push(`After this change the draft ${readability.reason}.`);
  if (!passages.length && changed.length) warnings.push("This story has no source paper on record, so nothing the agent wrote could be checked against one.");

  const now = new Date();
  const doc = {
    _id: turnId,
    story_id: storyDoc._id,
    profile_id: profileId,
    story_updated_at: storyDoc.updatedAt || null,
    /* The version the proposal was computed against. Accepting checks it. */
    story_version: storyVersion.versionOf(storyDoc),
    instruction,
    summary: result.summary,
    changes: result.changes,
    calls: result.calls,
    proposal: {
      title: result.state.title, subtitle: result.state.subtitle, excerpt: result.state.excerpt,
      blocks: result.state.blocks.map(serializeBlock),
      newImages,
    },
    checks,
    warnings,
    status: TURN_STATUS.PROPOSED,
    agent_version: result.agentVersion,
    judge_version: fidelity.FIDELITY_VERSION,
    model_requested: vertex.resolveResourceName(),
    usage: [...result.usage, ...(judgeCall?.usage ? [judgeCall.usage] : []), ...(reachCall?.usage ? [reachCall.usage] : [])].reduce(
      (acc, u) => ({ input: acc.input + (u.input || 0), output: acc.output + (u.output || 0) }),
      { input: 0, output: 0 },
    ),
    created_at: now,
    duration_ms: now - startedAt,
    resolved_at: null,
  };
  await turns.insertOne(doc);
  return { turn: viewTurn(doc) };
}

async function listStoryTurns({ storyId, scholarId, profileId }) {
  const { db } = await getCollections();
  const storyDoc = await editorial.findOwnedStory({ storyId, scholarId, profileId });
  const rows = await db.collection(COLLECTIONS.storyTurns).find({ story_id: storyDoc._id }).sort({ created_at: -1 }).limit(20).toArray();
  return { turns: rows.map((r) => viewTurn(r)) };
}

async function resolveStoryTurn({ storyId, turnId, scholarId, profileId, user, action }) {
  const { db } = await getCollections();
  const storyDoc = await editorial.findOwnedStory({ storyId, scholarId, profileId });
  if (!ObjectId.isValid(String(turnId))) throw new ApiError(404, "No such proposal.");
  const turns = db.collection(COLLECTIONS.storyTurns);
  const turn = await turns.findOne({ _id: new ObjectId(String(turnId)), story_id: storyDoc._id });
  if (!turn) throw new ApiError(404, "No such proposal.");
  if (turn.status !== TURN_STATUS.PROPOSED) throw new ApiError(409, `That proposal was already ${turn.status}.`);

  const now = new Date();
  if (action === "reject") {
    const ids = (turn.proposal?.newImages || []).map((img) => img.file_id);
    if (ids.length) {
      const assetCollection = db.collection(COLLECTIONS.editorialImageAssets);
      const assets = await editorial.fetchAssetDocumentsByImageIds(assetCollection, ids);
      await editorial.markAssetDocumentsDeleted({ assetCollection, assets, updatedBy: user?.login_email || scholarId });
    }
    await turns.updateOne({ _id: turn._id }, { $set: { status: TURN_STATUS.REJECTED, resolved_at: now } });
    return { turn: viewTurn({ ...turn, status: TURN_STATUS.REJECTED, resolved_at: now }) };
  }

  /* Accept: only onto the story the proposal was made against.
     The version is the authority; the timestamp is kept for older turns that
     were recorded before versions existed. */
  const proposedAgainst = storyVersion.isVersion(turn.story_version) ? turn.story_version : null;
  const nowAt = storyVersion.versionOf(storyDoc);
  if (proposedAgainst !== null && proposedAgainst !== nowAt) {
    throw new ApiError(409, "The story changed after this proposal was made. Ask again so the agent works from the current text.");
  }
  if (proposedAgainst === null) {
    const then = turn.story_updated_at ? new Date(turn.story_updated_at).getTime() : null;
    const current = storyDoc.updatedAt ? new Date(storyDoc.updatedAt).getTime() : null;
    if (then !== null && current !== null && then !== current) {
      throw new ApiError(409, "The story changed after this proposal was made. Ask again so the agent works from the current text.");
    }
  }
  const applied = await editorial.applyStoryRevision({
    storyId, scholarId, profileId, user,
    fields: { title: turn.proposal.title, subtitle: turn.proposal.subtitle, excerpt: turn.proposal.excerpt },
    blocks: turn.proposal.blocks,
    newImages: turn.proposal.newImages || [],
    baseVersion: proposedAgainst,
    turnId: turn._id,
    note: turn.instruction ? String(turn.instruction).slice(0, 200) : null,
  });
  await turns.updateOne({ _id: turn._id }, { $set: { status: TURN_STATUS.ACCEPTED, resolved_at: now } });
  return { turn: viewTurn({ ...turn, status: TURN_STATUS.ACCEPTED, resolved_at: now }, { withProposal: false }), story: applied.story };
}

/** An illustration a proposal generated, before it belongs to any story. */
async function streamProposalImage({ storyId, turnId, fileId, scholarId, profileId, res }) {
  const { db } = await getCollections();
  const storyDoc = await editorial.findOwnedStory({ storyId, scholarId, profileId });
  if (!ObjectId.isValid(String(turnId)) || !ObjectId.isValid(String(fileId))) throw new ApiError(404, "Image not found.");
  const turn = await db.collection(COLLECTIONS.storyTurns).findOne({ _id: new ObjectId(String(turnId)), story_id: storyDoc._id }, { projection: { "proposal.newImages": 1 } });
  const listed = (turn?.proposal?.newImages || []).some((img) => String(img.file_id) === String(fileId));
  if (!listed) throw new ApiError(404, "Image not found.");
  const asset = await db.collection(COLLECTIONS.editorialImageAssets).findOne({ _id: new ObjectId(String(fileId)), status: "active" });
  if (!asset) throw new ApiError(404, "Image not found.");
  await editorial.streamAssetToResponse({ asset, cacheControl: "private, no-store", res });
}

/** The passages of a story's source paper, for the source rail and the reader's Sources toggle. */
async function storyPassages({ storyId, scholarId, profileId }) {
  const { db } = await getCollections();
  const storyDoc = await editorial.findOwnedStory({ storyId, scholarId, profileId });
  return { passages: await passagesFor(db, storyDoc) };
}

async function publicStoryPassages({ slug }) {
  const { db } = await getCollections();
  const { story } = await editorial.getPublishedStoryBySlug(slug);
  const storyDoc = await db.collection(COLLECTIONS.scholarEditorials).findOne({ _id: new ObjectId(String(story.id)) }, { projection: { provenance: 1 } });
  return { passages: await passagesFor(db, storyDoc || {}) };
}

module.exports = { askStoryAgent, listStoryTurns, resolveStoryTurn, streamProposalImage, storyPassages, publicStoryPassages, TURN_STATUS };
